import { describe, expect, it } from 'vitest'
import { packPrintPages, type PrintPageMetrics } from '../../src/pages/printPagination'

// packPrintPages decides what lands on each sheet, and it is pure — no DOM, no
// layout. Its edge cases are where content gets clipped or a word's languages
// split across a fold, so this is the cheapest real signal on the print page.
//
// Expected page counts below are worked out by hand from the synthetic inputs,
// never read back from the function.

function metrics (overrides: Partial<PrintPageMetrics> = {}): PrintPageMetrics {
  return {
    pageHeight: 1000,
    headerHeight: 100,
    theadHeight: 50,
    bandHeights: [],
    ...overrides
  }
}

describe('packPrintPages — page capacity', () => {
  it('gives the first page less room, because it also carries the document header', () => {
    // Page 1 capacity: 1000 - 100 (document header) - 50 (column header) = 850,
    // so two 300px bands fit and a third does not.
    // Page 2 capacity: 1000 - 50 = 950, so three fit.
    const pages = packPrintPages(metrics({ bandHeights: [300, 300, 300, 300, 300] }))

    expect(pages).toEqual([[0, 1], [2, 3, 4]])
  })

  it('fills a page exactly to capacity without spilling', () => {
    // Page 1 capacity is 850; two bands of 425 use precisely that.
    const pages = packPrintPages(metrics({ bandHeights: [425, 425, 100] }))

    expect(pages[0]).toEqual([0, 1])
    expect(pages[1]).toEqual([2])
  })

  it('puts everything on one page when it all fits', () => {
    const pages = packPrintPages(metrics({ bandHeights: [100, 200, 300] }))

    expect(pages).toEqual([[0, 1, 2]])
  })
})

describe('packPrintPages — bands are never split', () => {
  it('keeps every band whole and in document order', () => {
    const bandHeights = [120, 340, 90, 500, 260, 410, 75]
    const pages = packPrintPages(metrics({ bandHeights }))

    const flattened = pages.flat()

    // Each band appears exactly once, in its original position — the packer
    // deals bands out, it never reorders or duplicates them.
    expect(flattened).toEqual(bandHeights.map((_, index) => index))
  })

  it('never exceeds a page capacity with the bands it assigns', () => {
    const bandHeights = [120, 340, 90, 500, 260, 410, 75]
    const input = metrics({ bandHeights })
    const pages = packPrintPages(input)

    pages.forEach((bandIndexes, pageIndex) => {
      const used = bandIndexes.reduce((sum, index) => sum + bandHeights[index], 0)
      const capacity = pageIndex === 0
        ? input.pageHeight - input.headerHeight - input.theadHeight
        : input.pageHeight - input.theadHeight

      // A page holding more than one band must fit; a page holding a single
      // oversized band is the documented fail-soft case covered below.
      if (bandIndexes.length > 1) {
        expect(used, `page ${pageIndex} overflows`).toBeLessThanOrEqual(capacity)
      }
    })
  })
})

describe('packPrintPages — a band taller than a whole page', () => {
  it('lands an oversized band on its own page instead of looping forever', () => {
    // An entry with enough languages, or long enough sentences, to fill a page
    // on its own. Without the `current.length > 0` guard this band would be
    // pushed to a fresh page for ever. With it, it lands alone and overflows,
    // which the browser then fragments — fail-soft, not a hang.
    const pages = packPrintPages(metrics({ bandHeights: [300, 2000, 300] }))

    expect(pages).toEqual([[0], [1], [2]])
  })

  it('handles an oversized band as the very first one', () => {
    const pages = packPrintPages(metrics({ bandHeights: [5000] }))

    expect(pages).toEqual([[0]])
  })
})

describe('packPrintPages — degenerate input', () => {
  it('returns a single empty page for a document with no bands', () => {
    // Measurement returning zero bands must not produce zero pages — the
    // caller renders one section per entry in this array.
    const pages = packPrintPages(metrics({ bandHeights: [] }))

    expect(pages).toEqual([[]])
  })

  it('does not hang when every measurement is zero', () => {
    // What jsdom produces: getBoundingClientRect returns all zeros, so the
    // component must still render rather than spin.
    const pages = packPrintPages({
      pageHeight: 0,
      headerHeight: 0,
      theadHeight: 0,
      bandHeights: [0, 0, 0]
    })

    expect(pages).toEqual([[0, 1, 2]])
  })
})
