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
    await expect(sheet.getByRole('columnheader', { name: 'Język', exact: true })).toBeVisible()
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

  test('draws a single-weight rule between Word and Language on every row', async ({ page }) => {
    // Regression guard for 0d7a203: the separate-border grid drew its left edge
    // with th:first-child, td:first-child, which matches the first cell of every
    // *row* — and a band's continuation rows begin with the language <td>, in
    // column 2. Those took a left border flush against the word column's right
    // border, and under the separate model the two do not merge: they stack
    // into a doubled rule on every row but the first of each band.
    await openPrintedSheet(page, 'five-languages')

    const firstCells = await page.locator('.print-table tbody tr').evaluateAll(
      (rows) => rows.map((row) => {
        const first = row.firstElementChild
        if (first === null) {
          return null
        }
        return {
          tag: first.tagName,
          borderLeftWidth: parseFloat(getComputedStyle(first).borderLeftWidth)
        }
      })
    )

    // A continuation row is one whose first cell is the language <td>, sitting
    // in column 2 because the rowSpan'd word <th> belongs to the band's first
    // row only. Those cells must carry no left border at all — the word cell
    // spans the band and has already closed them.
    const continuationRows = firstCells.filter((cell) => cell?.tag === 'TD')
    expect(continuationRows.length, 'fixture produced no continuation rows to check').toBeGreaterThan(0)
    for (const cell of continuationRows) {
      expect(cell!.borderLeftWidth).toBe(0)
    }

    // And the band-opening rows, which start with the word <th>, must have one.
    const openingRows = firstCells.filter((cell) => cell?.tag === 'TH')
    expect(openingRows.length).toBeGreaterThan(0)
    for (const cell of openingRows) {
      expect(cell!.borderLeftWidth).toBeGreaterThan(0)
    }
  })
})
