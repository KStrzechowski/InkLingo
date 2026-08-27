import { expect, test } from '@playwright/test'
import { openPreview } from './support'

// Cases the Language-column and pagination specs do not reach: the Translation
// column's meaning/transcription pair, a single-target collection, and a
// backfill gap rendered rather than unit-tested.

test.describe('the Translation column', () => {
  test('keeps the space between meaning and transcription outside the nowrap span', async ({ page }) => {
    // The exact regression from the printable-export change: the separating
    // space was written *inside* `<span class="print-phonetic">`, which is
    // white-space: nowrap. That stopped it being a break opportunity and welded
    // meaning and transcription into one unbreakable run, so the browser broke
    // the *word* instead — 'independence /ˌɪndɪˈpendəns/' printed as
    // 'indepen-/denc/e /ˌɪndɪˈpendəns/'.
    await openPreview(page, 'long-words')

    const structure = await page.evaluate(() => {
      return [...document.querySelectorAll('.print-phonetic')].map((span) => {
        const previous = span.previousSibling
        return {
          transcription: span.textContent ?? '',
          previousIsText: previous?.nodeType === Node.TEXT_NODE,
          previousText: previous?.textContent ?? '',
          whiteSpace: getComputedStyle(span).whiteSpace
        }
      })
    })

    expect(structure.length, 'fixture rendered no transcriptions').toBeGreaterThan(0)

    for (const node of structure) {
      expect(node.whiteSpace, `${node.transcription} is not nowrap`).toBe('nowrap')
      expect(
        node.previousIsText && /\s$/.test(node.previousText),
        `the space before ${node.transcription} is not a separate text node outside the span — ` +
        'inside it, it stops being a break opportunity and the meaning gets shredded instead'
      ).toBe(true)
    }
  })

  test('keeps a meaning whole when it and its transcription each fit alone', async ({ page }) => {
    // The archived measurement is precise about the condition: 'independence'
    // is 94.0px and '/ˌɪndɪˈpendəns/' is 105.7px against 118.9px of column —
    // *neither overflows alone, but together they are 203.9px*. That is the
    // case where the meaning must stay whole and the transcription drop to the
    // next line; if the meaning fragments there, the nowrap tail is dictating
    // where the earlier breaks fall.
    //
    // Deliberately NOT asserted when the transcription is itself wider than the
    // column: an unbreakable box that can never fit legitimately reflows the
    // text before it. Nor when the meaning alone overflows — print.css sets
    // `hyphenate-limit-chars: 12 5 4` specifically so long compounds like
    // 'Geschwindigkeitsbe-/grenzung' still hyphenate, which is intended.
    await openPreview(page, 'long-words')

    const cells = await page.evaluate(() => {
      const widthOf = (node: Node): { width: number, lines: number } => {
        const range = document.createRange()
        range.selectNodeContents(node)
        return { width: range.getBoundingClientRect().width, lines: range.getClientRects().length }
      }

      return [...document.querySelectorAll('.print-phonetic')].map((span) => {
        const cell = span.parentElement!
        // Not `cell.firstChild`: since D-1 that is the language-code span
        // ('EN'), not the meaning. The meaning is the text node right before
        // the space that precedes this transcription span.
        const meaningNode = span.previousSibling!.previousSibling!
        const style = getComputedStyle(cell)
        const available = cell.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight)

        const meaning = widthOf(meaningNode)
        return {
          meaning: meaningNode.textContent ?? '',
          meaningWidth: meaning.width,
          meaningLines: meaning.lines,
          transcriptionWidth: widthOf(span).width,
          available
        }
      })
    })

    const applicable = cells.filter(
      (cell) => cell.meaningWidth <= cell.available &&
        cell.transcriptionWidth <= cell.available &&
        cell.meaningWidth + cell.transcriptionWidth > cell.available
    )

    // Tripwire: without a cell meeting the precondition this test asserts
    // nothing. The long-words fixture carries the measured 'independence' case
    // precisely so one always does.
    expect(
      applicable.length,
      'no cell had a meaning and transcription that each fit alone but not together — ' +
      'the fixture no longer reproduces the measured case'
    ).toBeGreaterThan(0)

    for (const cell of applicable) {
      expect(
        cell.meaningLines,
        `'${cell.meaning}' needs ${Math.round(cell.meaningWidth)}px and its transcription ` +
        `${Math.round(cell.transcriptionWidth)}px, against ${Math.round(cell.available)}px of column — ` +
        'each fits alone, so the meaning must stay on one line and the transcription drop below it. ' +
        `It rendered across ${cell.meaningLines} lines instead.`
      ).toBe(1)
    }
  })
})

test.describe('a single-target collection', () => {
  test('renders one row per entry with no rowSpan banding', async ({ page }) => {
    await openPreview(page, 'one-language')

    const bands = await page.locator('.print-table tbody').evaluateAll(
      (bodies) => bodies.map((body) => ({
        rows: body.querySelectorAll('tr').length,
        rowSpan: body.querySelector('th[scope="row"]')?.getAttribute('rowspan') ?? null
      }))
    )

    expect(bands.length).toBe(6)
    for (const band of bands) {
      expect(band.rows).toBe(1)
      // rowSpan={1} — React omits the attribute at 1, which is correct HTML.
      expect(band.rowSpan === null || band.rowSpan === '1').toBe(true)
    }

    // Every row still carries its language-code prefix rather than it being
    // collapsed away when there is only one target.
    await expect(page.locator('.print-language-code')).toHaveCount(6)
  })
})

test.describe('a collection with a backfill gap', () => {
  test('renders no blank filler row for a language the entry predates', async ({ page }) => {
    // 'zamek' has only EN; 'woda' has EN and DE. The collection targets both,
    // so a naive renderer would emit an empty German row for zamek.
    await openPreview(page, 'backfill-gap')

    const bands = await page.locator('.print-table tbody').evaluateAll(
      (bodies) => bodies.map((body) => ({
        word: body.querySelector('th[scope="row"]')?.textContent ?? '',
        languageCodes: [...body.querySelectorAll('.print-language-code')].map((c) => c.textContent ?? '')
      }))
    )

    const zamek = bands.find((band) => band.word === 'zamek')
    const woda = bands.find((band) => band.word === 'woda')

    expect(zamek, 'zamek band missing').toBeDefined()
    expect(woda, 'woda band missing').toBeDefined()

    // One row, for the one language it has — and matched despite the stored
    // code being uppercase 'EN' against the collection's lowercase 'en'.
    expect(zamek!.languageCodes).toHaveLength(1)
    expect(woda!.languageCodes).toHaveLength(2)

    // No cell in the table is missing its language-code prefix.
    for (const band of bands) {
      for (const languageCode of band.languageCodes) {
        expect(languageCode.trim(), `${band.word} has a blank language-code cell`).not.toBe('')
      }
    }
  })
})

test.describe('an empty collection', () => {
  test('offers no Print button, since there is nothing to print', async ({ page }) => {
    await openPreview(page, 'empty')

    await expect(page.getByRole('button', { name: 'Print' })).toHaveCount(0)
  })
})
