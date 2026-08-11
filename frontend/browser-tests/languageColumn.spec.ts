import { expect, test } from '@playwright/test'
import { openPreview } from './support'
import { SUPPORTED_LANGUAGES } from '../src/languages'

// The Language column is pinned at 17% of the text width, and that number came
// from a one-off manual measurement on 2026-08-03: at the previous 10% the
// column offered 50.9px and 43 of the 64 native x target language names
// overflowed it, along with the English and German column headings. The binding
// case was Russian 'французский' at 90.1px. `word-wrap: break-word` — there for
// the sentence columns — turned every overflow into a mid-word split
// ('niemieck/i'), which is why the cells are `white-space: nowrap` now: a name
// that no longer fits crosses its border visibly instead of splitting quietly.
//
// That measurement has never been re-run, and adding a 9th supported language
// would invalidate it. This re-derives it on every run, in both engines —
// Firefox is the one that matters, since the sheet is printed from it and the
// 17% was chosen with ~8px of headroom for Firefox shaping the font slightly
// differently from Chromium.

for (const native of SUPPORTED_LANGUAGES) {
  test(`every language name fits the Language column on a ${native.label} sheet`, async ({ page }) => {
    // Screen media, not print: only there is the sheet drawn at real A4 width,
    // which is what sizes the column. See openPreview.
    await openPreview(page, 'all-languages', { native: native.code })

    const measured = await page.evaluate(() => {
      const table = document.querySelector('.print-table')
      if (table === null) {
        return null
      }

      // scrollWidth is useless here: a cell in a `table-layout: fixed` table
      // never scrolls, so scrollWidth always equals clientWidth even while the
      // text visibly overflows its border. A Range over the cell's contents
      // reports where the text actually lands. (Verified against the archived
      // 2026-08-03 measurement: this reproduces 'французский' at 90.1px.)
      const naturalWidth = (element: HTMLElement): number => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return range.getBoundingClientRect().width
      }

      // Usable width is the content box — clientWidth still includes padding.
      const contentWidth = (element: HTMLElement): number => {
        const style = getComputedStyle(element)
        return element.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight)
      }

      const heading = table.querySelector('thead th:nth-child(2)')
      let headingMeasurement = null
      if (heading instanceof HTMLElement) {
        // The heading is not nowrap — it wraps rather than overflowing, and a
        // Range over wrapped text spans the whole cell. Force nowrap just long
        // enough to read its natural single-line width.
        const previous = heading.style.whiteSpace
        heading.style.whiteSpace = 'nowrap'
        headingMeasurement = {
          text: heading.textContent ?? '',
          natural: naturalWidth(heading),
          available: contentWidth(heading)
        }
        heading.style.whiteSpace = previous
      }

      const cells = [...document.querySelectorAll('.print-language')]
        .filter((cell): cell is HTMLElement => cell instanceof HTMLElement)
        .map((cell) => ({
          text: cell.textContent ?? '',
          natural: naturalWidth(cell),
          available: contentWidth(cell)
        }))

      return { heading: headingMeasurement, cells }
    })

    expect(measured, 'no print table rendered').not.toBeNull()
    expect(measured!.heading, 'no Language column heading found').not.toBeNull()

    // Tripwire: the fixture must actually put every supported language in the
    // column, or this test proves nothing.
    expect(
      measured!.cells.length,
      'the all-languages fixture rendered fewer language cells than there are supported languages'
    ).toBe(SUPPORTED_LANGUAGES.length)

    const heading = measured!.heading!
    expect(
      heading.natural,
      `the '${heading.text}' heading needs ${heading.natural}px but the Language column offers ` +
      `${heading.available}px on a ${native.label} sheet — it will wrap onto two lines`
    ).toBeLessThanOrEqual(heading.available)

    for (const cell of measured!.cells) {
      expect(
        cell.natural,
        `'${cell.text}' needs ${cell.natural}px but the Language column offers ${cell.available}px ` +
        `on a ${native.label} sheet — the name will cross its cell border. The column width in ` +
        'print.css was measured against the widest of these; re-derive it before widening the set.'
      ).toBeLessThanOrEqual(cell.available)
    }
  })
}
