import { expect, test } from '@playwright/test'
import { openPreview } from './support'

// The Vitest suite proves the packing *logic* (packPrintPages is pure). Only a
// browser can prove that the measured page capacity, the real @page capacity
// and the packer agree on real paper — which is the whole point of the
// two-pass render: "the preview matches the printout page for page."
//
// Deliberately NOT under print emulation: the on-screen sheets are a screen
// artifact, drawn at 210 x 297mm so the user can review real pages before
// printing. Emulating print collapses .print-page to a plain block and the
// count would no longer be the thing the user saw.

const MM_TO_PX = 96 / 25.4
const A4_WIDTH_PX = 210 * MM_TO_PX
const A4_HEIGHT_PX = 297 * MM_TO_PX
// One CSS pixel of slack for sub-pixel layout rounding, which differs slightly
// between engines.
const TOLERANCE_PX = 1.5

test.describe('on-screen sheets', () => {
  test('draws each sheet at real A4 size', async ({ page }) => {
    await openPreview(page, 'five-languages')

    const box = await page.locator('.print-page').first().boundingBox()

    expect(box).not.toBeNull()
    expect(Math.abs(box!.width - A4_WIDTH_PX)).toBeLessThan(TOLERANCE_PX)
    expect(Math.abs(box!.height - A4_HEIGHT_PX)).toBeLessThan(TOLERANCE_PX)
  })

  test('splits a long collection into several sheets', async ({ page }) => {
    await openPreview(page, 'five-languages')

    // Tripwire: if this fixture ever stops paginating, every assertion in this
    // file becomes vacuous. It regressed exactly this way once — a passive
    // effect reset the measured pagination straight after the layout effect
    // computed it, and the document rendered as one 17302px "sheet".
    const sheets = await page.locator('.print-page').count()

    expect(sheets, 'the five-languages fixture no longer paginates').toBeGreaterThan(1)
  })

  test('keeps every entry, once, in alphabetical order across the sheets', async ({ page }) => {
    await openPreview(page, 'five-languages')

    // Each sheet holds its own table, so a band cannot straddle a fold by
    // construction; what has to hold is that dealing bands into sheets loses
    // none, duplicates none, and preserves order.
    const words = await page.locator('.print-table tbody th[scope="row"]').allTextContents()

    expect(words.length).toBe(20)
    expect(new Set(words).size, 'a word appears on more than one sheet').toBe(20)

    const collator = new Intl.Collator('pl')
    expect(words).toEqual([...words].sort((a, b) => collator.compare(a, b)))
  })

  test('repeats the column header on every sheet', async ({ page }) => {
    await openPreview(page, 'five-languages')

    const sheets = await page.locator('.print-page').count()
    const heads = await page.locator('.print-table thead').count()

    expect(heads).toBe(sheets)
  })

  test('puts the document header on the first sheet only', async ({ page }) => {
    await openPreview(page, 'five-languages')

    await expect(page.locator('.print-header')).toHaveCount(1)
  })
})

test.describe('printed page count', () => {
  // page.pdf() is implemented only in headless Chromium — Firefox and WebKit
  // throw. Skipped with a reason rather than silently absent, so the Firefox
  // run never reports a page-count test as passing.
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'page.pdf() is headless-Chromium-only; Firefox print fidelity is covered by the manual paper gate'
  )

  test('produces exactly one PDF page per on-screen sheet, with no trailing blank', async ({ page }) => {
    await openPreview(page, 'five-languages')
    const sheets = await page.locator('.print-page').count()

    const pdf = await page.pdf({ format: 'A4', printBackground: false })

    // Page count comes from the PDF page tree's /Count. Dependency-free, and
    // enough for a count; if this ever proves brittle across Chromium versions,
    // a small PDF library is the fallback.
    const counts = [...pdf.toString('latin1').matchAll(/\/Count\s+(\d+)/g)].map((match) => Number(match[1]))
    expect(counts.length, 'no /Count found in the generated PDF — the parser needs revisiting').toBeGreaterThan(0)

    const pdfPages = Math.max(...counts)

    expect(
      pdfPages,
      `the preview showed ${sheets} sheets but the PDF has ${pdfPages} pages — the measured page ` +
      'capacity and the real @page capacity have drifted apart, so what the user reviews is not ' +
      'what prints'
    ).toBe(sheets)
  })
})
