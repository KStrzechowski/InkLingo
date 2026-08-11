import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

// The A4 geometry of the printed sheet is encoded in three places that must
// agree, with nothing linking them:
//
//   @page             margin        — the real printed margin
//   .print-page       padding       — the on-screen sheet, which must match it
//   .print-page-probe height        — the capacity printPagination.ts packs to
//
// Change one and nothing fails: the packer simply packs to a capacity the paper
// does not have, and content spills or pages come out half empty. That is the
// "content clipped outside the printable area" half of test-plan Risk #2.
//
// This is a static source comparison, not a rendering test — the same idiom as
// backend/test/route-reachability.test.ts and backend/test/route-ownership.test.ts:
// read the file as plain text, extract, compare, and carry a tripwire so a
// parser that silently stops matching fails loudly instead of passing vacuously.

// Read off disk rather than imported. Vite's `?raw` was tried first and does
// not survive Vitest: CSS handling is disabled in the test environment, so the
// plugin hands back an object instead of the file's text and every extraction
// below silently returns null. node:fs is also what the backend's two static
// checks use, so this stays consistent with them.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PRINT_CSS_PATH = path.join(__dirname, '..', '..', 'src', 'pages', 'print.css')
const source = fs.readFileSync(PRINT_CSS_PATH, 'utf8')

// ISO 216: A4 is 210 x 297 mm. This is the independent oracle for everything
// below — not a value read back out of the stylesheet.
const A4_WIDTH_MM = 210
const A4_HEIGHT_MM = 297

// print.css holds the probe deliberately short of the true printable height:
// the packer fills each page to the millimetre from screen measurements, but
// print lays text out at a different device resolution, so a band that just
// fits on screen can just miss on paper. Changing this is a real decision, so
// it is named here and must be changed in both places on purpose.
const PROBE_SLACK_MM = 4

// Matches only the top-level `.print-page { ... }` rule: `^` under the `m` flag
// rules out the indented copy inside @media print, and requiring `{` right
// after the selector rules out `.print-page + .print-page`, `.print-page::after`
// and `.print-page-probe`.
function topLevelRule (selector: string): string | null {
  const pattern = new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([\\s\\S]*?)\\}`, 'm')
  const match = pattern.exec(source)
  return match === null ? null : match[1]
}

function mmPair (block: string, property: string): [number, number] | null {
  const match = new RegExp(`${property}:\\s*([\\d.]+)mm\\s+([\\d.]+)mm`).exec(block)
  return match === null ? null : [Number(match[1]), Number(match[2])]
}

function mmValue (block: string, property: string): number | null {
  const match = new RegExp(`${property}:\\s*([\\d.]+)mm`).exec(block)
  return match === null ? null : Number(match[1])
}

const pageAtRule = /@page\s*\{([\s\S]*?)\}/.exec(source)?.[1] ?? null
const printPageRule = topLevelRule('.print-page')
const probeRule = topLevelRule('.print-page-probe')

const columnWidths = [...source.matchAll(
  /^\.print-table th:nth-child\((\d+)\)\s*\{\s*width:\s*([\d.]+)%/gm
)].map((match) => ({ column: Number(match[1]), width: Number(match[2]) }))

describe('print.css parser tripwire', () => {
  // Every assertion below is vacuous if extraction silently returns nothing —
  // a reformatted stylesheet must fail here, naming what stopped matching,
  // rather than reporting green because it compared undefined to undefined.
  it('still recognises every declaration it depends on', () => {
    expect(pageAtRule, 'no @page at-rule found in print.css').not.toBeNull()
    expect(printPageRule, 'no top-level .print-page rule found in print.css').not.toBeNull()
    expect(probeRule, 'no .print-page-probe rule found in print.css').not.toBeNull()
    expect(
      columnWidths.map((entry) => entry.column),
      'expected five .print-table th:nth-child(N) width declarations'
    ).toEqual([1, 2, 3, 4, 5])
  })
})

describe('print.css A4 geometry', () => {
  it('draws the on-screen sheet at real A4 size', () => {
    expect(mmValue(printPageRule!, 'width')).toBe(A4_WIDTH_MM)
    expect(mmValue(printPageRule!, 'min-height')).toBe(A4_HEIGHT_MM)
  })

  it('prints A4 portrait', () => {
    expect(pageAtRule).toMatch(/size:\s*A4\s+portrait/)
  })

  it('matches the on-screen sheet margins to the printed @page margins', () => {
    // If these drift, the preview stops being a preview: the same content
    // occupies a different amount of a screen sheet than of a paper one.
    const printedMargin = mmPair(pageAtRule!, 'margin')
    const screenPadding = mmPair(printPageRule!, 'padding')

    expect(printedMargin, 'no mm margin pair in @page').not.toBeNull()
    expect(screenPadding, 'no mm padding pair on .print-page').not.toBeNull()
    expect(
      screenPadding,
      `.print-page padding ${String(screenPadding)} does not match @page margin ${String(printedMargin)} — ` +
      'the on-screen sheet and the printed sheet would have different text areas'
    ).toEqual(printedMargin)
  })

  it('sizes the measurement probe to the real printable height', () => {
    // The probe is what printPagination.ts packs against. It must equal the
    // paper's printable height less the deliberate slack.
    const printedMargin = mmPair(pageAtRule!, 'margin')!
    const probeHeight = mmValue(probeRule!, 'height')
    const expected = A4_HEIGHT_MM - (2 * printedMargin[0]) - PROBE_SLACK_MM

    expect(
      probeHeight,
      `.print-page-probe height is ${String(probeHeight)}mm but @page's ${printedMargin[0]}mm vertical margins ` +
      `leave ${A4_HEIGHT_MM - 2 * printedMargin[0]}mm printable, so the probe should be ${expected}mm ` +
      `(printable less ${PROBE_SLACK_MM}mm slack). The packer would pack to the wrong page capacity.`
    ).toBe(expected)
  })
})

describe('print.css border widths', () => {
  // Re-declaring the table border as 0.5pt (~0.67px at 96dpi) inside
  // @media print once made Firefox round it toward zero, dropping every rule
  // and printing the sheet as bare text in columns — while the screen rule was
  // untouched, so the page still looked correct on screen. All table structure
  // is carried by borders (Firefox omits background colours from printouts
  // unless the user enabled "Print backgrounds"), so a rule that rounds away
  // takes the table's structure with it.
  //
  // Checked here rather than in the browser: under print emulation Firefox
  // reports computed border widths at 0.766667px because it scales CSS pixels
  // for the print medium, so a computed-style threshold would measure the
  // engine. The declared value is the thing that must never be sub-pixel.
  const borderDeclarations = [...source.matchAll(
    /border(?:-(?:top|right|bottom|left))?:\s*([\d.]+)(px|pt|mm|em|rem)/g
  )]

  it('still finds the border declarations it checks', () => {
    expect(
      borderDeclarations.length,
      'no sized border declarations found in print.css — the parser stopped matching'
    ).toBeGreaterThanOrEqual(8)
  })

  it('never declares a sub-pixel border', () => {
    for (const [declaration, value, unit] of borderDeclarations) {
      const px = unit === 'px' ? Number(value) : unit === 'pt' ? Number(value) * (96 / 72) : Number.NaN

      expect(
        Number.isNaN(px) ? 99 : px,
        `"${declaration.trim()}" is ${px}px — Firefox rounds sub-pixel print borders toward zero, ` +
        'which drops the rule from the printout entirely. Keep printed borders at 1px or wider.'
      ).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('print.css column widths', () => {
  it('sums to exactly 100% of the text width', () => {
    const total = columnWidths.reduce((sum, entry) => sum + entry.width, 0)

    expect(
      total,
      `column widths are ${columnWidths.map((entry) => `${entry.width}%`).join(' + ')} = ${total}%`
    ).toBe(100)
  })

  it('gives the two sentence columns the bulk of the width', () => {
    // The sheet folds down the middle to become a self-test, which only works
    // while the two sentence columns are the widest pair.
    const byColumn = new Map(columnWidths.map((entry) => [entry.column, entry.width]))
    const sentenceWidth = byColumn.get(4)! + byColumn.get(5)!

    expect(sentenceWidth).toBeGreaterThan(40)
  })
})
