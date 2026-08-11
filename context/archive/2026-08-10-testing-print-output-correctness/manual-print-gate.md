# Manual print gate — after automation

The archived print change shipped with a 12-case manual matrix
(`context/archive/2026-08-02-printable-export/plan.md:238-255`). Most of it is
now automated. This records which cases moved and which did not, so the
reduction is auditable rather than a quiet deletion.

The gate did **not** go away. Firefox's own print preview disagreed with its
printout during the original change (`archive/…/plan.md:84`), and two of the
four defects that surface shipped were Firefox-only in the print medium —
including one that Chromium's PDF output was measured against and could not see
(`archive/…/plan.md:78`, `:82`). No headless engine can replace paper here:
`page.pdf()` does not exist in Firefox.

## Disposition of the original 12 cases

| # | Original case | Now covered by |
|---|---|---|
| 1 | 1-language collection, few entries | `browser-tests/columns.spec.ts` (`one-language` fixture) — one row per entry, no rowSpan banding, Language column still populated |
| 2 | 5-language collection, few entries | `browser-tests/pagination.spec.ts` + `languageColumn.spec.ts` (`five-languages` fixture — column geometry, band integrity) |
| 3 | Collection with 3+ printed pages | `browser-tests/pagination.spec.ts` — sheet count > 1, header repeated per sheet, document header on the first sheet only, PDF page count equals sheet count (Chromium) |
| 4 | Collection with a backfill gap | `test/pages/printRows.test.ts` (row model) **and** `browser-tests/columns.spec.ts` (`backfill-gap` fixture rendered — no blank language cell) |
| 5 | Legacy-code collection (`PL`, `EN`) | `test/pages/printRows.test.ts` (both matching directions), `test/pages/printLabels.test.ts` (uppercase native code resolves native labels), and the `backfill-gap` fixture, whose stored code is uppercase `EN` |
| 6 | Non-English native collection | `browser-tests/languageColumn.spec.ts` — all 8 × 8 names measured via the `all-languages` fixture, including `?native=ru` (the `французский` worst case); `test/pages/printLabels.test.ts` for the headings |
| 7 | Empty collection | `browser-tests/harness.spec.ts` (message, no table) + `columns.spec.ts` (no Print button) |
| 8 | Dark OS theme | `browser-tests/harness.spec.ts` — black on white under `colorScheme: dark`, **both engines**. Retained on paper too (see below) |
| 9 | "Print backgrounds" off | **Manual only** — a browser preference, not a page property |
| 10 | Cyrillic + Polish diacritics + IPA | **Manual only** — glyph rendering on paper depends on the printer's fonts. The browser suite renders all three (Cyrillic language names, IPA in the `long-words` fixture) but cannot speak for the printer |
| 11 | Long meaning beside its IPA | `browser-tests/columns.spec.ts` — the space stays a break opportunity outside the `nowrap` span, and a meaning that fits alone stays on one line when its transcription also fits alone. Reproduces the measured `independence /ˌɪndɪˈpendəns/` case |
| 12 | Word too long for its column | Partially: `columns.spec.ts` asserts a long compound is *allowed* to hyphenate (`hyphenate-limit-chars: 12 5 4` intends this). **Whether it breaks at a syllable boundary is manual only** — it depends on Firefox's bundled dictionaries, which Chromium does not have |

## The retained gate

Run before trusting a change to `print.css`, `PrintDocument.tsx`, or
`index.css`. Print from **Firefox**, to **actual paper** at least once — not the
preview.

1. **3+ page collection, printed to paper.** Confirm the page count matches the
   on-screen preview, every page's table closes at the bottom, the column header
   repeats, and no entry's language rows split across a fold.
2. **"Print backgrounds" off** (Firefox's default). Confirm every table rule is
   still visible — all structure is carried by borders precisely because
   backgrounds do not print.
3. **Dark OS theme.** Confirm the printout is black on white. Automated in both
   engines, kept here because the automated check reads computed styles and only
   paper proves what the printer actually lays down.
4. **Glyphs.** Confirm IPA, Cyrillic and Polish diacritics render on the printed
   page, using the `long-words` fixture or a collection with the same content.

Four cases, one print run each — cases 1-3 can share a single printout.

## What to do when a paper check fails

The automated suite will usually still be green, because these are the failures
it provably cannot see. Do not adjust an automated test to match; add the case
here if it is repeatable, and treat the paper result as authoritative.
