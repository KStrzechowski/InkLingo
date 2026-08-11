---
date: 2026-08-10T18:05:35+02:00
researcher: Claude (10x-research)
git_commit: b7c1147ea36630fe6b3ca8bcebd8d98f91c7a300
branch: main
repository: InkLingo
topic: "Grounding rollout Phase 4 (Print output correctness, Risk #2) of context/foundation/test-plan.md"
tags: [research, codebase, print, css, visual-diff, vitest, playwright, risk-2]
status: complete
last_updated: 2026-08-10
last_updated_by: Claude (10x-research)
---

# Research: Print output correctness (test-plan Phase 4, Risk #2)

**Date**: 2026-08-10T18:05:35+02:00
**Researcher**: Claude (10x-research)
**Git Commit**: `b7c1147ea36630fe6b3ca8bcebd8d98f91c7a300`
**Branch**: `main`
**Repository**: InkLingo

## Research Question

Ground rollout Phase 4 of `context/foundation/test-plan.md`. Risk #2: a print/A4
export regresses silently after a CSS or component change — broken pagination,
wrong colors under dark-mode OS preference, or content clipped outside the
printable area.

Verify (not blindly accept) the plan's response guidance: prove A4-safe
geometry, black-on-white color, and header/row integrity across a change, in
both light and dark OS theme; challenge "looks right on screen"; avoid a
snapshot that locks in the current, possibly-still-wrong layout.

## Summary

**Risk #2 is real, and the hot-spot evidence understates it.** The print surface
shipped in four commits over 25 hours, and *two of those four were follow-up
fixes* found by manually printing after `build` + `lint` had already gone green
([see below](#6-hot-spot-evidence-holds-up-and-sharpens)). The archived plan says so itself:
"Verification is entirely manual. With no frontend test runner, nothing
automated will catch a regression in this page."

**But the plan's assumed response — "deterministic visual diff/snapshot" — needs
correcting on its central assumption.** Risk #2 is not one risk; it is three
sub-risks with three *different* cheapest layers, and the visual-diff layer is
the one that buys the least:

| Sub-risk | Cheapest useful layer | Can a browser-free test see it? |
|---|---|---|
| Header/row integrity (row model, native-language furniture) | Vitest + jsdom, **already installed** | Yes — proven empirically below |
| Content clipped / mis-paginated | Pure unit test on `packPrintPages` + a **static CSS-invariant check** | Yes — the geometry constants are the bug surface, not the pixels |
| A4 geometry, black-on-white under dark theme, border rendering | Real browser, **nothing in the repo can do this** | No |

**The hard finding that reframes the phase:** the printout is produced from
**Firefox**, but headless PDF export is **Chromium-only** — confirmed still true
in 2026 ([Playwright docs](https://playwright.dev/docs/emulation), [playwright-python#2909](https://github.com/microsoft/playwright-python/issues/2909)) and independently documented in-repo on
2026-08-03 ("headless Firefox cannot print (no `--print` flag, `window.print()`
is a no-op)", `plan.md:78`). Cross-checking the four defects this project
actually shipped against that constraint:

- The **sub-pixel border** bug (`0.5pt` rounding to zero, printing the sheet as
  bare text in columns) was **Firefox-only** — `plan.md:82`.
- The **collapsed-border open-bottom** bug was **Firefox-only**, and the archive
  records that "Chromium's PDF output was measured before and after — closed in
  both cases" (`plan.md:78`). A Chromium diff was *run* against this bug and
  could not see it.
- The **doubled column rule** and the **unpaginated preview** were screen-side
  and *were* caught in a headless render (`plan.md:80`, `plan.md:86`).

So a headless-Chromium print diff would have caught **two of four**, and would
have been provably blind to the two that made the printout unusable. That is not
an argument against the layer — it is an argument against treating it as the
phase's centre of gravity, and against any success criterion phrased as "the
visual diff is green."

## Detailed Findings

### 1. The print surface: four files, one coupling point

The whole risk surface is small and self-contained:

- `frontend/src/pages/PrintCollectionPage.tsx` (300 lines) — route component,
  fetch lifecycle, the row model (`buildBands`), and the two-pass pagination
  render.
- `frontend/src/pages/print.css` (366 lines) — screen rules *and* `@media print`
  rules, gated on a `body.print-mode` class.
- `frontend/src/pages/printPagination.ts` (90 lines) — `measurePrintPages` (DOM
  reads) + `packPrintPages` (**pure**).
- `frontend/src/pages/printLabels.ts` (112 lines) — native-language column
  headings + `Intl.DisplayNames` language namer.

The single coupling point between component and stylesheet is the
`print-mode` body class, added on mount and removed on unmount
(`PrintCollectionPage.tsx:97-102`). `print.css` is imported only by this page
(`PrintCollectionPage.tsx:8`), so no other route can be affected.

**The mechanism that matters for Risk #2**: CSS cannot paginate on screen, so
pagination is done in JavaScript. `measurePrintPages` reads a hidden probe
element's height, the document header's height, the `<thead>` height, and one
height per `<tbody>`; `packPrintPages` greedily first-fits bands into pages; the
component re-renders as one `<section class="print-page">` per page in a
`useLayoutEffect` (`PrintCollectionPage.tsx:152-160`). In print, `@page` supplies
the geometry and `.print-page + .print-page { break-before: page }` supplies the
breaks (`print.css:300-302`).

That design is what makes "the preview matches the printout page for page" true
— and it is also what makes the failure mode *silent*: if the measured page
capacity drifts from the real `@page` capacity, nothing errors. Pages just
overflow or under-fill.

### 2. What jsdom can and cannot observe (empirically probed)

I rendered `PrintCollectionPage` under the project's existing Vitest + jsdom
setup with a mocked `getCollection`, then deleted the probe. Results:

```json
{
  "tableRect": { "w": 0, "h": 0 },
  "styleSheetsLoaded": 0,
  "theadThBorderRight": "16px",
  "hasMatchMedia": "undefined",
  "pageSections": 1,
  "headerTexts": ["Słowo", "Język", "Tłumaczenie", "Zdanie", "Zdanie (tłumaczenie)"],
  "langCells": ["angielski", "niemiecki"],
  "rowCount": 2,
  "tbodyCount": 1
}
```

Four conclusions, each load-bearing:

1. **jsdom computes no layout.** `getBoundingClientRect()` is all zeros. So
   `measurePrintPages` returns all-zero metrics, `packPrintPages` puts
   everything on one page (`pageSections: 1`), and **no geometry assertion is
   possible.** This also means the component renders *deterministically* under
   test — a useful property, not a problem.
2. **`import './print.css'` is a complete no-op.** `document.styleSheets.length`
   is `0`, because Vitest does not process CSS by default. The
   `theadThBorderRight: "16px"` is jsdom's default for `medium`, **not** the
   `1px` rule in `print.css:162`. Any `getComputedStyle` assertion against the
   print stylesheet would be asserting jsdom's defaults — a test that passes
   whatever the CSS says. **This is the trap to name explicitly in the plan.**
3. **`window.matchMedia` is `undefined`.** `prefers-color-scheme` cannot even be
   simulated, and polyfilling it would change nothing while no CSS is loaded.
4. **The DOM/semantic layer is fully observable and correct.** Note the probe
   deliberately used a legacy uppercase `'DE'` translation code with only an
   `'en'` sentence — the row model still produced 2 rows, matched
   case-insensitively, and rendered the German row with an empty sentence cell.
   Native-language furniture (`Słowo`/`Język`, `angielski`/`niemiecki`) resolved
   correctly through `Intl.DisplayNames`.

**`packPrintPages` is pure** and needs no DOM at all — a synthetic
`{pageHeight, headerHeight, theadHeight, bandHeights}` produced the expected
multi-page split.

### 3. The Firefox / Chromium print asymmetry (the crux)

Verified externally (2026-08-10) and against in-repo measurements:

| Capability | Chromium (headless) | Firefox (headless) |
|---|---|---|
| `page.pdf()` — real pagination, page count | **Yes** | **No** — throws |
| `emulateMedia({ media: 'print' })` | Yes | Yes |
| `emulateMedia({ colorScheme: 'dark' })` | Yes, immediate | Yes, but **needs `page.reload()`** ([playwright#2352](https://github.com/microsoft/playwright/issues/2352)) |
| Hyphenation dictionaries | Absent unless fetched via component updater (`plan.md:70`) | Bundled for pl/de/ru/uk (`plan.md:70`) |
| Sub-pixel print border rounding | Tolerant | **Rounds toward zero** (`plan.md:82`) |
| Collapsed-border closure at a page break | Closed either way (`plan.md:78`) | **Open bottom** — the bug (`plan.md:78`) |

The practical consequence for planning: **the two browsers cover different
halves of Risk #2, and neither covers it alone.**

- Only Chromium can answer *"how many pages, and does the printout match the
  preview with no trailing blank?"*
- Only Firefox can answer *"does the sheet actually look right in the browser the
  user prints from?"* — and only in `emulateMedia({media:'print'})` screenshot
  form, never as real pagination.

Also worth flagging to `/10x-plan`: `plan.md:84` records that **"Firefox's print
preview is not the printout"** — the same build rendered no table in Firefox's
preview pane yet printed a correct table to paper. Any Firefox-side automation
inherits that caveat; it is evidence for keeping a manual print-to-paper step as
the final gate rather than deleting it once automation lands.

### 4. Static invariants — real signal, no browser, and an independent oracle

This is the finding I'd most want carried into the plan, because it fits an
idiom this project has already shipped twice: `backend/test/route-reachability.test.ts`
(§6.2) and `backend/test/route-ownership.test.ts` (§6.6) are both **static source
comparisons**, not runtime tests. The print surface has the same shape of bug.

**(a) The A4 geometry is encoded in three places that must agree.**

| Constant | Location | Value today |
|---|---|---|
| `@page` margin | `print.css:269` | `14mm 15mm` |
| Screen sheet padding | `print.css:63` | `14mm 15mm` |
| Measured page height probe | `print.css:102` | `265mm` |

The probe's own comment states the derivation: A4's 297mm less two 14mm margins
is 269mm printable, with 4mm held back as slack (`print.css:97-101`). Change
`@page { margin }` without updating the probe and **nothing fails** — the packer
simply packs to a capacity the paper does not have, and content spills. This is
precisely "content clipped outside the printable area," and it is checkable by
parsing `print.css`, with ISO 216 (A4 = 210×297mm) as a genuinely independent
oracle.

**(b) Column widths must sum to 100%.** `print.css:232-236` declares
`16 / 17 / 20 / 23.5 / 23.5`. Sums to 100 today. Independent oracle: arithmetic.

**(c) The Language column must fit the widest language name.** `plan.md:68`
records that at the old 10% width, **43 of 64 native × target names overflowed**,
and the binding case (Russian `французский`, 90.1px) drove the column to 17%.
That measurement was done by hand in a headless Chromium on 2026-08-03 and has
never been re-run. Adding a 9th language — plausible; `SUPPORTED_LANGUAGES` has
8 (`frontend/src/languages.ts:6-15`) — could silently reintroduce the overflow.
Independent oracle: the rendered text width of the ICU names vs. the declared
column width. Needs a browser to measure text, but it is a *measurement*, not a
pixel diff.

**(d) `printLabels.LABELS` must cover every `SUPPORTED_LANGUAGES` code.**
`printLabels.ts:20-77` has exactly 8 entries matching
`languages.ts:6-15`. A 9th language added to `SUPPORTED_LANGUAGES` without a
`LABELS` entry falls back to **English headings on a native-language sheet**
(`printLabels.ts:81-83`) — silent, cosmetic, and exactly the class of regression
Risk #2 names. Pure unit test, zero DOM, independent oracle (the requirement
that furniture is in the native language).

### 5. Existing verification and where a gate would plug in

- **No visual-diff or browser tooling exists anywhere in the repo.** No
  playwright, puppeteer, percy, argos, lost-pixel, or backstop in any
  `package.json`. This phase bootstraps it from zero.
- **Frontend test infra is live and conventions are set** — `vitest run` via
  `npm test` (`frontend/package.json:11`), config on the existing
  `vite.config.ts` (`test.environment: 'jsdom'`, `setupFiles: ['./test/setup.ts']`),
  tests under `frontend/test/` mirroring the source tree, explicit
  `describe`/`it`/`expect`/`vi` imports with no globals, `afterEach(cleanup)`
  registered manually in `test/setup.ts`.
- **CI already runs frontend tests**: the "Run frontend tests" step in
  `.github/workflows/pr-diff.yml:101-105` (and the mirror in `deploy.yml`) does
  `npm ci && npm test` in `frontend/`, needing no database and no credentials.
  Anything added to `npm test` is gated automatically. A browser-based check is
  a different matter — it needs a browser download step in CI, which is new
  surface for this repo.
- The archived plan's **12-case manual matrix** (`plan.md:238-255`) is the
  current source of truth for correctness. It is thorough and worth mining for
  fixtures; it is also the thing that is too expensive to re-run on every CSS
  change, which is the whole point of this phase.
- Per `MEMORY.md`, the dev DB has a hand-made "Print test 5 languages"
  collection with three long-word entries added so the columns actually
  overflow. That is a *manual* fixture in a shared dev database — an automated
  test needs its own committed fixture, not a dependency on dev DB state.

### 6. Hot-spot evidence holds up, and sharpens

The test plan cites `frontend/src/pages` at 21 commits/30d as likelihood
evidence. Narrowed to the print files specifically, the last 30 days show:

```
4  frontend/src/pages/PrintCollectionPage.tsx
3  frontend/src/pages/print.css
2  frontend/src/pages/printLabels.ts
1  frontend/src/pages/printPagination.ts
```

…from exactly four commits, and the sequence is the real argument:

```
a80df46  2026-08-03 16:34  feat: print route and document structure (p1)
7ca8fb6  2026-08-03 16:35  feat: print stylesheet (p2)
7a312d4  2026-08-03 17:48  fix: column order, native headings, print borders
0d7a203  2026-08-04 16:56  fix: paginate the preview, fix doubled column rule
```

**Half the commits to this surface are post-ship fixes**, landing 1h13m and 25h
after the feature, both found by manual inspection *after* `build` and `lint`
passed. The `Source` citation in §2 is sound; it can be sharpened from a
directory-level count to this commit sequence without adding a file anchor.

By contrast, `frontend/src/index.css` — the global stylesheet the archived plan
flags as the silent-degradation vector (`plan.md:280`) — saw **1 commit in 30
days**. Real risk, low frequency.

## Verification of the test plan's response guidance

| §2 guidance for Risk #2 | Verdict |
|---|---|
| "prove A4-safe geometry, black-on-white, header/row integrity, in both themes" | **Confirmed as the right target**, but it is three targets with three different layers — see the Summary table. Planning it as one deliverable will produce one over-scoped browser test. |
| "challenge: *looks right on screen* proves nothing about print" | **Confirmed and strengthened.** `plan.md:84` records the sharper version: in Firefox, *print preview* is not the printout either. |
| "likely cheapest layer: deterministic visual diff/snapshot (light + dark); manual print spot-check as final gate" | **Partially corrected.** A visual diff is the *most expensive* layer here and covers the smallest share of the risk; it is also Chromium-bound, and the two worst shipped defects were Firefox-only and provably invisible to Chromium. The cheapest layers are the unit/static ones (§4), which need no browser at all. Keep the manual print gate — the archive's Firefox findings are an argument for it, not against. |
| "anti-pattern: a snapshot that locks in the current, possibly-still-wrong layout" | **Confirmed, and there is a second, sharper one**: a jsdom `getComputedStyle` assertion against `print.css`. §2 above proves no stylesheet is loaded under Vitest, so such a test asserts jsdom's defaults and passes regardless of what the CSS says. It would look like print coverage and be worth nothing. |

**Nothing in Risk #2 is speculative** — every sub-risk maps to a defect this
project has already shipped and fixed, or to a constant-drift path that exists in
the code today.

## Suggested layering for `/10x-plan` (hypotheses, not commands)

Ordered by cost × signal, cheapest first:

1. **Row model + furniture, jsdom** (`buildBands`, `printLabels`,
   `printLanguageNamer`). Covers "header/row integrity". Runner already exists;
   this is the cheapest real signal available. Note `buildBands` is currently
   module-local (`PrintCollectionPage.tsx:41`) — testable through the rendered
   component, or by exporting it (weigh against `react/only-export-components`,
   which is why `printPagination.ts` is a separate file at all).
2. **`packPrintPages` pure unit tests.** Covers mis-pagination logic: the
   taller-than-a-page band guard (`printPagination.ts:78`), first-page vs.
   subsequent-page capacity, no band split.
3. **Static `print.css` invariant check** (§4a/4b). Covers geometry-constant
   drift. Same idiom as the two static checks already shipped.
4. **`LABELS` ↔ `SUPPORTED_LANGUAGES` coverage test** (§4d). One assertion.
5. **Browser-based checks** — only here, and scoped tightly to what layers 1–4
   provably cannot see: black-on-white under `colorScheme: 'dark'` in
   `media: 'print'`, the language-column overflow measurement, and Chromium
   `page.pdf()` page-count vs. the preview's sheet count. Expect a CI browser
   install step. If a full-page pixel diff is adopted, it needs an explicit
   answer to "what independent oracle says this baseline is correct?" — the
   archive's answer was *printing it on paper*.
6. **Keep a reduced manual print-to-paper gate.** `plan.md:84` and the
   Firefox-only defect class make this irreplaceable, not redundant.

## Code References

- `frontend/src/pages/PrintCollectionPage.tsx:41-81` — `buildBands`, the row model; case-insensitive language matching
- `frontend/src/pages/PrintCollectionPage.tsx:97-102` — `body.print-mode` toggle, the one component↔stylesheet coupling
- `frontend/src/pages/PrintCollectionPage.tsx:152-160` — two-pass pagination `useLayoutEffect`
- `frontend/src/pages/PrintCollectionPage.tsx:182` — unpaginated fallback when measurement fails
- `frontend/src/pages/printPagination.ts:32-57` — `measurePrintPages`, DOM reads (unobservable in jsdom)
- `frontend/src/pages/printPagination.ts:61-90` — `packPrintPages`, **pure**, the prime unit-test target
- `frontend/src/pages/printPagination.ts:78` — the taller-than-a-page band guard
- `frontend/src/pages/print.css:93-103` — `.print-page-probe`, the 265mm measured capacity
- `frontend/src/pages/print.css:232-236` — column widths `16/17/20/23.5/23.5`
- `frontend/src/pages/print.css:263-270` — `@media print` + `@page { size: A4 portrait; margin: 14mm 15mm }`
- `frontend/src/pages/print.css:300-302` — `.print-page + .print-page { break-before: page }`
- `frontend/src/pages/printLabels.ts:20-77` — the 8-language `LABELS` table
- `frontend/src/languages.ts:6-15` — `SUPPORTED_LANGUAGES`, the 8 codes `LABELS` must track
- `frontend/src/index.css:33-51` — the dark-mode variable block `print.css` must override
- `frontend/src/index.css:53-63` — `#root` fixed 1126px shell that `print.css` neutralises
- `frontend/vite.config.ts:9-12` — Vitest config (jsdom, setup file); note no `css` option, hence no stylesheet under test
- `.github/workflows/pr-diff.yml:101-105` — the frontend test step any `npm test` addition lands in

## Architecture Insights

- **The project already has a "static source comparison" test idiom** and has
  reached for it twice for exactly this shape of problem — a rule that must hold
  across two files with no runtime link (`route-reachability`, `route-ownership`).
  The print geometry constants are a third instance.
- **Separation of `printPagination.ts` from the `.tsx` was forced by
  `react/only-export-components`** (`printPagination.ts:12-14`) — an oxlint rule
  that, incidentally, produced the most testable module in the change. The same
  pressure applies if `buildBands` is to be exported.
- **`print.css` carries an unusually high comment-to-rule ratio**, and the
  comments encode measured empirical results (px widths, browser behaviours,
  dates). Those comments are the closest thing this surface has to a spec, and
  several are directly convertible into assertions.
- **Failure modes here are soft by design**: measurement failure leaves the
  document unpaginated rather than blank (`PrintCollectionPage.tsx:178-182`), and
  the print-media `thead`/`tbody` rules are explicitly demoted to "safety nets"
  (`print.css:345-358`). Good for users; it also means **regressions do not throw**,
  which is precisely why this risk needs tests rather than error monitoring.

## Historical Context (from prior changes)

- `context/archive/2026-08-02-printable-export/plan.md` — the primary source.
  Critical Implementation Details (lines 62-94) is effectively a written spec of
  the print behaviour, with dates and measurements. Its "Open Risks" (line 280)
  predicted this exact phase: *"Verification is entirely manual. With no frontend
  test runner, nothing automated will catch a regression in this page."*
- `context/archive/2026-08-06-testing-auth-resilience/` — bootstrapped Vitest for
  `frontend/` and set every convention this phase will follow (test layout,
  no globals, `helpers/` fixtures, `.env.test`).
- `context/foundation/lessons.md:47-52` — "Clearing a failure signal doesn't
  restore the view it was raised over." Not directly about print, but the same
  underlying pattern applies: the print page fetches once on mount
  (`PrintCollectionPage.tsx:106-141`) with no retry.
- `context/foundation/test-plan.md:120-124` — the CI gate rows this phase's new
  gate slots beside; §5 already reserves a "print visual diff / required after §3
  Phase 4" row.

## Related Research

None — this is the first research artifact for the print surface. The archived
`printable-export` change went straight from `plan-brief.md` to `plan.md` with no
`research.md`.

## Open Questions

1. **Which browser does the automated layer target?** Chromium gives real
   pagination and no Firefox coverage; Firefox gives the user's real rendering
   but no pagination. Running both doubles CI cost. This is a `/10x-plan`
   decision and it should be made explicitly, not by defaulting to whatever the
   tool installs first.
2. **Is a pixel diff wanted at all, or only assertions?** Layers 1–4 plus
   targeted measurement assertions may cover enough of Risk #2 that a baseline
   image — with its maintenance cost and its oracle problem — is not worth it.
   Worth deciding before installing anything.
3. **Does CI get a browser?** No workflow currently downloads one. This is the
   main new infrastructure cost of the phase, and it lands in both `pr-diff.yml`
   and `deploy.yml`.
4. **Should `buildBands` be exported for direct testing**, or tested through the
   rendered component? The oxlint rule pushes toward extraction to a sibling
   module, mirroring `printPagination.ts`.
5. **Is the 2026-08-03 language-column measurement still valid?** It was taken at
   11pt system-ui on one machine. If a 9th language is ever added, that number
   needs re-deriving — which is an argument for automating the measurement
   rather than re-asserting `17%`.
