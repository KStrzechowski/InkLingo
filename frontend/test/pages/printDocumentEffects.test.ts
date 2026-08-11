import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

// PrintDocument measures the rendered bands to decide what lands on each sheet.
// That measurement is only correct if the sheet's own styling is already in
// force — print.css is gated on `body.print-mode`, and without it the document
// still inherits the app's 18px body font instead of the sheet's 11pt. Bands
// then measure ~25% too tall and the packer puts one entry on each page.
//
// So two things must hold, and neither is observable after the fact:
//   1. both the class toggle and the measurement run in `useLayoutEffect`
//      (a passive effect runs after layout effects, i.e. after measuring)
//   2. the class toggle is declared *first*, since React runs layout effects
//      in declaration order
//
// ---------------------------------------------------------------------------
// This is a structural check, and the plan's anti-pattern list warns against
// tests that mirror implementation rather than assert behaviour. It is a
// deliberate exception, for a reason worth stating:
//
// The behavioural symptom is a wrong page count, and page count is a function
// of font metrics. `system-ui` resolves to a different face on every OS, so any
// fixture tuned to make the mis-measurement change the sheet count on one
// machine stops doing so on another — this was demonstrated, not assumed: CI
// run 31424566975 went red on exactly that sensitivity, and the fixtures were
// deliberately resized to be font-independent in response. That resizing is
// what removed the behavioural guard, verified by mutation: reverting the
// layout effect leaves all 51 browser tests green.
//
// A structural assertion is therefore the only font-independent guard available
// for this invariant. It is narrow on purpose — it asserts the ordering rule,
// not the shape of the component around it.
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = path.join(__dirname, '..', '..', 'src', 'pages', 'PrintDocument.tsx')
const source = fs.readFileSync(SOURCE_PATH, 'utf8')

// The statement that applies the sheet's styling, and the one that reads the
// geometry. Both are load-bearing strings; if either stops matching, the
// tripwire below fails rather than the ordering check passing vacuously.
const CLASS_MARKER = "classList.add('print-mode')"
const MEASURE_MARKER = 'measurePrintPages('

interface EnclosingHook {
  name: 'useLayoutEffect' | 'useEffect'
  index: number
}

// Walks backwards from a statement to the hook call that contains it. Crude but
// sufficient: PrintDocument declares its effects at the top level of the
// component, one statement per effect body, and `useEffect(` is not a substring
// of `useLayoutEffect(`.
function enclosingHook (markerIndex: number): EnclosingHook | null {
  const before = source.slice(0, markerIndex)
  const layout = before.lastIndexOf('useLayoutEffect(')
  const passive = before.lastIndexOf('useEffect(')

  if (layout === -1 && passive === -1) {
    return null
  }
  return layout > passive
    ? { name: 'useLayoutEffect', index: layout }
    : { name: 'useEffect', index: passive }
}

const classIndex = source.indexOf(CLASS_MARKER)
const measureIndex = source.indexOf(MEASURE_MARKER)
const classHook = classIndex === -1 ? null : enclosingHook(classIndex)
const measureHook = measureIndex === -1 ? null : enclosingHook(measureIndex)

describe('PrintDocument effect-ordering parser tripwire', () => {
  it('still finds both statements it depends on', () => {
    expect(
      classIndex,
      `no "${CLASS_MARKER}" in PrintDocument.tsx — this check can no longer see the class toggle`
    ).toBeGreaterThan(-1)
    expect(
      measureIndex,
      `no "${MEASURE_MARKER}" in PrintDocument.tsx — this check can no longer see the measurement`
    ).toBeGreaterThan(-1)
    expect(classHook, 'the print-mode class is not inside any effect hook').not.toBeNull()
    expect(measureHook, 'the measurement is not inside any effect hook').not.toBeNull()
  })
})

describe('PrintDocument measures against the sheet, not the app shell', () => {
  it('applies the print-mode class in a layout effect', () => {
    expect(
      classHook!.name,
      'the print-mode class is applied in a passive useEffect, which runs *after* the ' +
      'useLayoutEffect that measures the bands. The document would then be measured while it ' +
      'still inherits the app shell\'s 18px font instead of the sheet\'s 11pt, so every band ' +
      'measures too tall and the packer puts one entry on each page.'
    ).toBe('useLayoutEffect')
  })

  it('measures in a layout effect', () => {
    expect(
      measureHook!.name,
      'the measurement runs in a passive useEffect, so the browser would paint the unpaginated ' +
      'pass before the sheets replace it.'
    ).toBe('useLayoutEffect')
  })

  it('declares the class toggle before the measurement', () => {
    expect(
      classHook!.index,
      'the print-mode class is applied in a layout effect declared *after* the one that ' +
      'measures. React runs layout effects in declaration order, so the measurement would still ' +
      'run against the unstyled document.'
    ).toBeLessThan(measureHook!.index)
  })
})
