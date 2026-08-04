// Page splitting for the printable sheet.
//
// This is done in JavaScript because CSS cannot do it on screen: fragmenting
// a document into pages exists only in the print medium, so a
// browser-paginated table is one endless column right up until the moment it
// is printed. That makes "review before printing" a review of something other
// than what prints — the very thing the preview exists to prevent. Measuring
// the rendered entry bands and dealing them into explicit page elements gives
// the same breaks on screen and on paper, because the same page elements
// carry the breaks in both media.
//
// Kept out of PrintCollectionPage.tsx so that file exports only its component
// (`react/only-export-components`, configured as a warning in
// frontend/.oxlintrc.json).

export interface PrintPageMetrics {
  /** Printable height of one sheet, in px. */
  pageHeight: number
  /** The document header plus its bottom margin — first page only. */
  headerHeight: number
  /** The column header row, which every page repeats. */
  theadHeight: number
  /** One entry band (`<tbody>`) each, in document order. */
  bandHeights: number[]
}

// Reads the geometry off the unpaginated first render. Returns null when the
// document isn't in a measurable state — no collection loaded yet, or the
// empty-collection branch, which has no table. The caller treats null as
// "leave it unpaginated", so a measurement that cannot be taken degrades to
// the single continuous column rather than to a broken page.
export function measurePrintPages (root: HTMLElement): PrintPageMetrics | null {
  const probe = root.querySelector('.print-page-probe')
  const header = root.querySelector('.print-header')
  const table = root.querySelector('table.print-table')

  if (!(probe instanceof HTMLElement) ||
      !(header instanceof HTMLElement) ||
      !(table instanceof HTMLTableElement) ||
      table.tHead === null) {
    return null
  }

  return {
    pageHeight: probe.getBoundingClientRect().height,
    // The distance between the two, not the header's own box: that gap is the
    // header's height *plus* its bottom margin, which together are what push
    // the table down the first page. Reading it this way means the margin can
    // change in print.css without this file knowing.
    headerHeight: table.getBoundingClientRect().top - header.getBoundingClientRect().top,
    theadHeight: table.tHead.getBoundingClientRect().height,
    // Band heights measured inside one shared table are the heights they will
    // have in a per-page table, because `table-layout: fixed` plus the
    // percentage column widths make every page's table the same geometry.
    bandHeights: Array.from(table.tBodies, (body) => body.getBoundingClientRect().height)
  }
}

// Greedy first-fit: bands keep their order, and a band moves to the next page
// whole. Returns one array of band indexes per page.
export function packPrintPages (metrics: PrintPageMetrics): number[][] {
  const { pageHeight, headerHeight, theadHeight, bandHeights } = metrics

  const pages: number[][] = []
  let current: number[] = []
  let used = 0
  // The first page also carries the document header; every page carries the
  // repeated column header.
  let capacity = pageHeight - headerHeight - theadHeight

  for (const [index, height] of bandHeights.entries()) {
    // The `current.length > 0` guard covers a band taller than a whole sheet
    // — an entry with enough languages, or long enough sentences, to fill a
    // page on its own. Without it that band would be pushed to a fresh page
    // for ever. With it, it lands on a page of its own and overflows, which
    // the browser then fragments; `break-inside: avoid` on the `<tbody>` is
    // ignored when the box cannot fit anywhere, so this fails soft.
    if (current.length > 0 && used + height > capacity) {
      pages.push(current)
      current = []
      used = 0
      capacity = pageHeight - theadHeight
    }
    current.push(index)
    used += height
  }
  pages.push(current)

  return pages
}
