import { expect, test } from '@playwright/test'
import { openPrintedSheet } from './support'

// Two things this file establishes: the harness path works at all, and the
// printed sheet is black on white in a dark OS theme. The second is the reason
// a browser is involved — jsdom loads no stylesheet, so nothing in the Vitest
// suite can see a colour.

test.describe('harness', () => {
  test('renders the print document with native-language headings', async ({ page }) => {
    await openPrintedSheet(page, 'five-languages')

    // The five-languages fixture is Polish-native, so the furniture is Polish.
    // Locators are role/text based per the project's testing rules.
    //
    // Scoped to the first sheet because the column header repeats on every one
    // of them — that repetition is asserted in pagination.spec.ts, and left
    // unscoped here it would just be a strict-mode violation.
    //
    // `exact: true` is load-bearing too: getByRole's `name` is a
    // case-insensitive *substring* match by default, so 'Tłumaczenie' also
    // matches the 'Zdanie (tłumaczenie)' header.
    const sheet = page.locator('.print-page').first()

    await expect(sheet.getByRole('columnheader', { name: 'Słowo', exact: true })).toBeVisible()
    await expect(sheet.getByRole('columnheader', { name: 'Znaczenie', exact: true })).toBeVisible()
    await expect(sheet.getByRole('columnheader', { name: 'Tłumaczenie', exact: true })).toBeVisible()
    await expect(sheet.getByRole('columnheader', { name: 'Zdanie', exact: true })).toBeVisible()
    await expect(sheet.getByRole('columnheader', { name: 'Zdanie (tłumaczenie)', exact: true })).toBeVisible()
  })

  test('hides the screen-only Print button on paper', async ({ page }) => {
    await openPrintedSheet(page, 'five-languages')

    await expect(page.getByRole('button', { name: 'Print' })).toBeHidden()
  })

  test('shows an empty-collection message with no table', async ({ page }) => {
    await openPrintedSheet(page, 'empty')

    await expect(page.getByText('Nothing to print')).toBeVisible()
    await expect(page.locator('table.print-table')).toHaveCount(0)
  })
})

test.describe('printed colour', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`prints black on white under a ${colorScheme} OS theme`, async ({ page }) => {
      // index.css swaps every colour variable under
      // @media (prefers-color-scheme: dark) — --text becomes #9ca3af. Left
      // alone the sheet would print light grey on paper. print.css overrides
      // it; this is what proves the override is still in force.
      await openPrintedSheet(page, 'five-languages', { colorScheme })

      const body = page.locator('body')
      await expect(body).toHaveCSS('color', 'rgb(0, 0, 0)')
      await expect(body).toHaveCSS('background-color', 'rgb(255, 255, 255)')

      const cell = page.locator('.print-table tbody td').first()
      await expect(cell).toHaveCSS('color', 'rgb(0, 0, 0)')

      const heading = page.locator('.print-header h1')
      await expect(heading).toHaveCSS('color', 'rgb(0, 0, 0)')
    })
  }

  test('draws every table rule with a non-zero width', async ({ page }) => {
    // Deliberately relative, not an absolute >= 1px: under print emulation
    // Firefox reports these at 0.766667px because it scales CSS pixels for the
    // print medium, so an absolute threshold would measure the engine rather
    // than the stylesheet. The "never declare a sub-pixel border" rule — the
    // one that made Firefox round 0.5pt to nothing and print the sheet as bare
    // text in columns — is enforced statically in
    // test/pages/printCssGeometry.test.ts, where the declared value lives.
    // What matters here is that a rule survives to computed style at all.
    await openPrintedSheet(page, 'five-languages')

    const cell = page.locator('.print-table tbody td').first()
    const widths = await cell.evaluate((node) => {
      const style = getComputedStyle(node)
      return {
        right: parseFloat(style.borderRightWidth),
        bottom: parseFloat(style.borderBottomWidth)
      }
    })

    expect(widths.right).toBeGreaterThan(0)
    expect(widths.bottom).toBeGreaterThan(0)
  })

  test('draws a single-weight rule at the left of the table only, even with a nested rowSpan', async ({ page }) => {
    // Regression guard for 0d7a203, extended for D-1's nesting. The original
    // bug: the separate-border grid drew its left edge with
    // th:first-child, td:first-child, which matches the first cell of every
    // *row* — and a band's continuation rows began with the language <td> in
    // column 2, which took a left border flush against the word column's
    // right one, doubling the rule under the separate model.
    //
    // D-1 reintroduces the same shape one level down: column 2 is now
    // SOMETIMES a <th> too (the gloss cell opening a meaning's row-group), and
    // a row whose meaning-group does not start on the band's own first row has
    // no column-1 cell at all — so that gloss <th> is genuinely first-child of
    // its <tr>. A selector keyed on tag or position alone would draw a border
    // there. Only the 'multi-meaning' fixture can exercise this: it is the
    // only one with a band whose gloss row-groups do not all start where the
    // band itself does.
    await openPrintedSheet(page, 'multi-meaning')

    const firstCells = await page.locator('.print-table tbody tr').evaluateAll(
      (rows) => rows.map((row) => {
        const first = row.firstElementChild
        if (first === null) {
          return null
        }
        return {
          tag: first.tagName,
          isWordCell: first.classList.contains('print-word'),
          borderLeftWidth: parseFloat(getComputedStyle(first).borderLeftWidth)
        }
      })
    )

    // Every row not opening a band — whether its first cell is a plain
    // language <td>, or a mid-band gloss <th> that happens to land first —
    // must carry no left border at all. The band's own opening word cell
    // spans the whole band and has already closed them.
    const nonOpeningRows = firstCells.filter((cell) => cell !== null && !cell.isWordCell)
    expect(nonOpeningRows.length, 'fixture produced no non-opening rows to check').toBeGreaterThan(0)
    for (const cell of nonOpeningRows) {
      expect(cell!.borderLeftWidth).toBe(0)
    }
    // A mid-band gloss <th> landing first-child is exactly the case that would
    // have been missed by a selector keyed on tag alone.
    expect(nonOpeningRows.some((cell) => cell!.tag === 'TH')).toBe(true)

    // And the band-opening rows, which start with the word <th>, must have one.
    const openingRows = firstCells.filter((cell) => cell?.isWordCell === true)
    expect(openingRows.length).toBeGreaterThan(0)
    for (const cell of openingRows) {
      expect(cell!.borderLeftWidth).toBeGreaterThan(0)
    }
  })
})
