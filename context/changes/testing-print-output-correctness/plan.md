# Print Output Correctness Implementation Plan

## Overview

Rollout Phase 4 of `context/foundation/test-plan.md` — make a print/A4 regression
detectable without re-running a 12-case manual print matrix. Risk #2: a CSS or
component change silently breaks pagination, prints grey-on-dark under a dark OS
theme, or pushes content outside the printable area.

The work is layered cheapest-first. Three browser-free layers land inside the
existing `npm test` gate and cover the row model, the pagination packer, and the
A4 geometry constants. A two-engine Playwright layer then covers only what those
provably cannot see: real print-media color, real text measurement, and real page
count. A reduced manual print-to-paper gate stays, because two of the four
defects this surface has already shipped were Firefox-only.

## Current State Analysis

The print surface is four files and ~870 lines, all under `frontend/src/pages/`:

- `PrintCollectionPage.tsx` — route component: auth-gated fetch, the row model
  (`buildBands`), the `body.print-mode` toggle, and the two-pass pagination
  render.
- `print.css` — screen rules plus `@media print`, gated on `body.print-mode`.
- `printPagination.ts` — `measurePrintPages` (DOM reads) and `packPrintPages`
  (pure).
- `printLabels.ts` — native-language column headings and the `Intl.DisplayNames`
  language namer.

**Nothing automated covers any of it.** The archived plan said so at the time:
*"Verification is entirely manual. With no frontend test runner, nothing
automated will catch a regression in this page."*
(`context/archive/2026-08-02-printable-export/plan.md:280`).

**The risk is not theoretical.** Of the four commits that built this surface, two
were post-ship fixes found by manually printing after `build` and `lint` had
already gone green:

```
a80df46  2026-08-03 16:34  feat: print route and document structure (p1)
7ca8fb6  2026-08-03 16:35  feat: print stylesheet (p2)
7a312d4  2026-08-03 17:48  fix: column order, native headings, print borders
0d7a203  2026-08-04 16:56  fix: paginate the preview, fix doubled column rule
```

Since `testing-auth-resilience`, `frontend/` has a live Vitest + jsdom suite
(`frontend/vite.config.ts:9-12`), tests under `frontend/test/` mirroring the
source tree, no test globals, and a CI step that already runs `npm test` in both
workflows (`.github/workflows/pr-diff.yml:101-105`). No browser automation
exists anywhere in the repo.

## Desired End State

A change to `print.css`, `PrintCollectionPage.tsx`, or `index.css` that breaks
the printout fails a test before it reaches a human.

Concretely, after this plan:

- `npm test` in `frontend/` covers the row model, the language furniture, the
  pagination packer, and the A4 geometry constants — no browser, no new CI cost.
- `npm run test:print` drives Chromium and Firefox against a harness page that
  mounts the real print document and the real stylesheet, asserting black-on-white
  under a dark OS theme, no language-name overflow across all 8×8 ICU
  combinations, and a PDF page count matching the on-screen sheet count.
- Both run in CI on every PR, the browser layer as its own job.
- The manual matrix shrinks from 12 cases to a short paper-only gate, with a
  written record of which cases automation absorbed.

Verified by: making a deliberate breaking edit to `print.css` (e.g. changing
`@page`'s margin without the probe, or restoring `border-collapse: collapse`) and
confirming a named test fails.

### Key Discoveries:

- **jsdom sees no layout and no CSS.** Empirically probed at
  `research.md` §2: `getBoundingClientRect()` is all zeros,
  `document.styleSheets.length` is `0` (Vitest does not process the
  `import './print.css'` at `PrintCollectionPage.tsx:8`), and
  `window.matchMedia` is `undefined`. The DOM/semantic layer, by contrast,
  renders correctly and deterministically.
- **`packPrintPages` is pure** (`printPagination.ts:61-90`) — the single
  highest-value unit target in the change, and it needs no DOM.
- **The A4 geometry is encoded three times and drifts silently**: `@page`
  margin `14mm` (`print.css:269`), `.print-page` padding `14mm`
  (`print.css:63`), and `.print-page-probe` height `265mm` (`print.css:102`,
  = 297 − 2×14 − 4mm slack). Change one and nothing fails; the packer just packs
  to a capacity the paper does not have.
- **`printLabels.LABELS` must track `SUPPORTED_LANGUAGES`** — 8 entries each
  today (`printLabels.ts:20-77`, `languages.ts:6-15`). A 9th language added
  without a `LABELS` entry silently prints English headings on a native-language
  sheet (`printLabels.ts:81-83`).
- **`page.pdf()` is headless-Chromium-only**; Firefox throws. Confirmed
  externally 2026-08-10 and recorded in-repo 2026-08-03 (`archive/…/plan.md:78`).
- **Two of the four shipped defects were Firefox-only** and provably invisible to
  Chromium — the sub-pixel border rounding (`archive/…/plan.md:82`) and the
  collapsed-border open bottom, where the archive records *"Chromium's PDF output
  was measured before and after — closed in both cases"* (`archive/…/plan.md:78`).
- **The project already has a static-source-comparison test idiom**, used twice:
  `backend/test/route-reachability.test.ts` and `backend/test/route-ownership.test.ts`.
  Both read files as plain text, regex-extract, and carry a `MIN_EXPECTED_*`
  tripwire so a parser that silently stops matching fails loudly.

## What We're NOT Doing

- **No pixel baselines / reference images.** Decided during planning: every
  assertion gets an independent oracle (ISO 216 A4 dimensions, the
  black-and-white product requirement, arithmetic), not "whatever it looked like
  when someone blessed it." This also keeps the two-engine choice affordable —
  there is no second baseline set to maintain.
- **No jsdom assertions about `print.css`.** Proven inert: no stylesheet loads
  under Vitest, so any `getComputedStyle` assertion would test jsdom's defaults
  and pass regardless of what the CSS says.
- **No auth or backend in the browser layer.** The harness bypasses
  `PrintLayout` and `getCollection` entirely. Testing Cognito redirects is not
  this phase's risk.
- **No dependency on the dev database.** The "Print test 5 languages" collection
  and its hand-added long-word entries stay a manual convenience; automated
  fixtures are committed.
- **No changes to the printed design.** Column widths, fonts, hyphenation
  settings, and layout are treated as the spec, not as things to improve. If a
  test disagrees with the current output, that is a finding to raise, not a
  reason to edit `print.css`.
- **No `@10x-e2e` browser flow tests.** Nothing here drives the real route
  through a running backend; the risk lives in the document and the stylesheet.
- **Not deleting the manual gate.** It shrinks; it does not go away.

### Deliberate exceptions, recorded during implementation

Two of the boundaries above were crossed on purpose. Both were raised before
acting; neither was a silent override.

- **`print.css` was edited** (2026-08-10, commit `51ab9f2`) — the Language
  column widened 17% → 19%. `browser-tests/languageColumn.spec.ts` found that
  the 17% figure, measured once on 2026-08-03 against Segoe UI, does not hold
  for other fonts: `system-ui` resolves per-OS, and on the CI runner
  `французский` renders 104.9px against ~101px of column, crossing its cell
  border. Raised as a finding and approved before the edit. The rule stands for
  everything else — this is the one case where the measurement the design rested
  on was itself shown to be environment-specific.
- **One structural test was written** (`test/pages/printDocumentEffects.test.ts`)
  despite the anti-pattern list's warning about implementation-mirroring tests.
  It asserts that `PrintDocument` applies the `print-mode` class in a
  `useLayoutEffect` declared before the one that measures. The behavioural
  symptom is a wrong page count, which is a function of font metrics, so any
  fixture tuned to expose it on one machine stops doing so on another — CI run
  `31424566975` demonstrated exactly that sensitivity, and the fixtures were
  resized for font-independence in response, which is what removed the
  behavioural guard (confirmed by mutation: reverting the fix left all 51
  browser tests green). A structural assertion is the only font-independent
  guard available for this invariant.

## Implementation Approach

Five phases, each independently verifiable, ordered so that every phase that
needs no new infrastructure ships before any phase that does.

Phases 1–2 are pure additions to the existing Vitest suite plus two small
extractions of shipped code. They bank the majority of the coverage inside the
CI gate that already exists. If the rollout stopped after Phase 2, Risk #2 would
already be materially reduced.

Phase 3 introduces Playwright and the harness. The enabling move is extracting a
presentational `PrintDocument` component that both the real route and the harness
render — which is what makes "the harness can drift from the route" structurally
false for the document itself, rather than something a comment has to promise.

Phase 4 adds the assertions that justify having a browser at all. Phase 5 wires
CI and reconciles the test plan and the manual matrix.

## Critical Implementation Details

**Vitest will collect Playwright specs unless told otherwise.** Vitest's default
`include` is `**/*.{test,spec}.?(c|m)[jt]s?(x)` (verified in
`node_modules/vitest`), so a `*.spec.ts` anywhere under `frontend/` is picked up
by `npm test` and fails on the `@playwright/test` import. Phase 3 must narrow
Vitest's `include` to the Vitest directory explicitly, and keep Playwright in its
own directory with its own extension convention.

**The harness must not reach production.** `vite build`'s default input is
`index.html` alone, so a root-level `print-harness.html` is served by `vite` dev
(which serves any root `.html` by path) and excluded from `dist/` for free — as
long as nobody adds it to `build.rollupOptions.input` or `public/`. Phase 3 adds
an assertion on `dist/` rather than relying on that staying true.

**TypeScript projects must not overlap.** `frontend/tsconfig.json` is a solution
file with three references; `tsconfig.vitest.json` includes `["src", "test"]`.
The Playwright directory and the harness therefore need their own project and
must live outside `test/`, or `tsc -b` will report files owned by two projects.

**Firefox needs a reload after a `colorScheme` change.** `emulateMedia({
colorScheme: 'dark' })` applies immediately in Chromium but not in Firefox
([playwright#2352](https://github.com/microsoft/playwright/issues/2352)) — set
the color scheme before navigating, or reload after setting it. A test that
skips this passes in Chromium and silently asserts light-mode values in Firefox,
which is worse than not having it.

**Page-count assertions are Chromium-only by construction.** `page.pdf()` throws
in Firefox. The Phase 4 pagination spec must be scoped to the Chromium project
rather than skipped at runtime, so the Firefox run does not report a passing test
that never executed.

**The 4mm slack is deliberate and must not be asserted away.** `print.css:97-101`
holds the probe 4mm short of the true 269mm printable height because the packer
fills to the millimetre from screen measurements while print lays out at a
different device resolution. The Phase 2 invariant check asserts the
*relationship* including the slack, not that the probe equals 269mm.

---

## Phase 1: Row model and language furniture

### Overview

Extract the row model so it can be tested directly, then cover it and the
native-language furniture with unit tests in the existing Vitest suite. Covers
the "header/row integrity" third of Risk #2.

### Changes Required:

#### 1. Extract the row model

**File**: `frontend/src/pages/printRows.ts` (new), `frontend/src/pages/PrintCollectionPage.tsx`

**Intent**: `buildBands` and `collatorFor` are module-local
(`PrintCollectionPage.tsx:33-81`), so testing them means rendering React. Move
them to a sibling module for the same reason `printPagination.ts` already exists
— `react/only-export-components` forbids the `.tsx` exporting non-components.

**Contract**: `printRows.ts` exports `buildBands(collection: CollectionDetail):
PrintBand[]` plus the `PrintRow` / `PrintBand` interfaces; `PrintCollectionPage`
imports them. Behavior is unchanged — this is a move, not a rewrite. The
explanatory comments move with the code.

#### 2. Row model tests

**File**: `frontend/test/pages/printRows.test.ts` (new)

**Intent**: Lock the behaviors that the archived plan's manual matrix cases 4, 5
and 6 were checking by eye, plus the degenerate cases the code explicitly
handles.

**Contract**: Covers, each as a named case — a language present in
`targetLanguageCodes` but absent from the entry produces no row (backfill gap,
no blank filler); a legacy uppercase code (`'DE'`, `'EN'`) matches a lowercase
saved row and vice versa; an entry with a translation but no sentence still
renders its row with the other cell empty; an entry with neither renders one row
so the word is not dropped; entries sort by the collection's native collator; a
malformed `nativeLanguageCode` falls back to the default collator instead of
throwing. Oracles are the FR/plan requirements, not the current output.

#### 3. Language furniture tests

**File**: `frontend/test/pages/printLabels.test.ts` (new)

**Intent**: `printLabels` and `printLanguageNamer` are the "furniture in the
native language" requirement, and the `LABELS` table is a hand-maintained mirror
of `SUPPORTED_LANGUAGES` with no link between them.

**Contract**: Asserts every code in `SUPPORTED_LANGUAGES` has a `LABELS` entry —
failing with the specific missing code — so adding a 9th language cannot
silently fall back to English headings. Also covers: a legacy uppercase native
code resolves its native labels rather than English; a malformed native code
falls back to English labels *and* to `languageLabel` for names, consistently;
`printLanguageNamer` returns native-orthography names (Polish `angielski` lower
case, German `Englisch` upper).

### Success Criteria:

#### Automated Verification:

- Type check and build pass: `cd frontend && npm run build`
- Lint passes with no new warnings: `cd frontend && npm run lint`
- Frontend suite passes: `cd frontend && npm test`
- Deleting a `LABELS` entry makes `printLabels.test.ts` fail naming that code

#### Manual Verification:

- A print page still renders identically after the `buildBands` extraction —
  spot-check one 5-language collection against its pre-change appearance

---

## Phase 2: Pagination packer and static geometry invariants

### Overview

Cover the "content clipped / mis-paginated" third of Risk #2 without a browser,
by unit-testing the packer and by asserting the A4 constants in `print.css` agree
with each other.

### Changes Required:

#### 1. Packer tests

**File**: `frontend/test/pages/printPagination.test.ts` (new)

**Intent**: `packPrintPages` decides what lands on each sheet. Its edge cases are
where content gets clipped, and it is pure, so this is the cheapest real signal
in the whole phase.

**Contract**: Covers — the first page's capacity is reduced by both the document
header and the column header while later pages are reduced only by the column
header; a band never splits across pages; document order is preserved; a band
taller than a whole page lands on its own page rather than looping forever (the
`current.length > 0` guard at `printPagination.ts:78`); an empty
`bandHeights` yields one page rather than zero. Expected page counts are computed
by hand in the test from the synthetic inputs — never read back from the
function.

#### 2. Static `print.css` geometry invariant check

**File**: `frontend/test/pages/printCssGeometry.test.ts` (new)

**Intent**: The A4 geometry lives in three places that must agree
(`print.css:63`, `:102`, `:269`) with nothing linking them. This is the same
class of cross-file drift that `route-reachability.test.ts` and
`route-ownership.test.ts` already guard, so it follows their idiom: read the file
as plain text, regex-extract, compare, and carry a tripwire.

**Contract**: Parses `frontend/src/pages/print.css` and asserts — the `@page`
vertical margin equals `.print-page`'s vertical padding (screen sheet matches
printed sheet); `.print-page-probe`'s height equals `297mm − 2 × @page vertical
margin − 4mm` slack, with the slack named as a constant in the test and its
rationale cited; `.print-page`'s width and min-height are `210mm` / `297mm` (ISO
216); the five `th:nth-child` column widths sum to `100`. A `MIN_EXPECTED_*`-style
tripwire asserts the parser found all the declarations it expects, so a
reformatted stylesheet fails loudly instead of vacuously passing.

Failure messages name the specific constant and the two values that disagree.

### Success Criteria:

#### Automated Verification:

- Type check and build pass: `cd frontend && npm run build`
- Lint passes with no new warnings: `cd frontend && npm run lint`
- Frontend suite passes: `cd frontend && npm test`
- Changing `@page`'s margin in `print.css` without updating the probe fails
  `printCssGeometry.test.ts` with both values named
- Reformatting a covered rule (e.g. collapsing it to one line) either still
  parses or trips the tripwire — it does not silently pass with zero matches

#### Manual Verification:

- None — this phase adds no user-visible behavior

---

## Phase 3: Print harness and Playwright bootstrap

### Overview

Introduce browser automation and a harness page that mounts the *real* print
document and stylesheet with committed fixtures, then land the first assertion
that needs a browser: black-on-white under a dark OS theme in print media.

### Changes Required:

#### 1. Extract the presentational document

**File**: `frontend/src/pages/PrintDocument.tsx` (new), `frontend/src/pages/PrintCollectionPage.tsx`

**Intent**: The harness must render what production renders, or it is a copy that
drifts. Split the fetch/auth/routing concern from the document concern so both
the route and the harness mount the same component.

**Contract**: `PrintDocument({ collection }: { collection: CollectionDetail })`
owns everything below the fetch — the `body.print-mode` effect, the
`documentRef`, the pagination `useLayoutEffect`, the probe, the sheets, and the
table. `PrintCollectionPage` keeps `useParams`, the fetch lifecycle and its
loading/404/error branches, and renders `<PrintDocument collection={collection} />`.
The `print.css` import moves to `PrintDocument`. No behavior change.

#### 2. Fixtures and harness entry

**File**: `frontend/browser-tests/harness/fixtures.ts`, `frontend/browser-tests/harness/main.tsx`, `frontend/print-harness.html` (all new)

**Intent**: Give the browser deterministic collections to render, selected by
query parameter, with no network and no auth.

**Contract**: `fixtures.ts` exports named `CollectionDetail` fixtures covering the
cases the browser layer needs — a Polish-native 5-language collection long enough
to span 3+ sheets, a Russian-native collection (the `французский` worst case for
column width), a collection with a backfill gap, one with legacy uppercase codes,
one with a word long enough to force hyphenation, and an empty one. `main.tsx`
reads `?fixture=<name>` and mounts `<PrintDocument>` into `#root`, importing
`../../src/index.css` first so the global shell and its dark-mode block are
present — the stylesheet `print.css` exists to override. `print-harness.html`
lives at the `frontend/` root so `vite` dev serves it and `vite build` ignores it.

#### 3. Playwright setup

**File**: `frontend/playwright.config.ts`, `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.browser-tests.json`, `frontend/tsconfig.json`, `frontend/.gitignore`

**Intent**: Wire the runner without letting it collide with Vitest or with
`tsc -b`.

**Contract**: `playwright.config.ts` sets `testDir: './browser-tests'`, projects
for `chromium` and `firefox`, and a `webServer` running `vite` against the dev
server. `package.json` gains `test:print` (`playwright test`) and
`@playwright/test` as a devDependency; `test` stays `vitest run` so the existing
CI step is unaffected. `vite.config.ts` narrows `test.include` to the Vitest
directory so Playwright specs are never collected (see Critical Implementation
Details). `tsconfig.browser-tests.json` covers `browser-tests/` and is referenced
from `tsconfig.json`, with no include overlap against `tsconfig.vitest.json`.
`.gitignore` gains Playwright's report/results output.

#### 4. Harness honesty guard and first assertion

**File**: `frontend/browser-tests/harness.spec.ts`, `frontend/test/pages/harnessBuild.test.ts` (both new)

**Intent**: Two things must stay true for the harness to be worth trusting: it
renders the production document, and it never ships.

**Contract**: `harnessBuild.test.ts` (Vitest, runs in `npm test`) asserts
`print-harness.html` is absent from `frontend/dist/` after a build, and that
`main.tsx` imports `PrintDocument` from `src/` rather than defining its own
markup. `harness.spec.ts` (Playwright, both engines) asserts the harness renders
a table with the expected column headings for its fixture — the smoke test that
the whole harness path works — and then the first real assertion: with
`emulateMedia({ media: 'print', colorScheme: 'dark' })`, the computed color of
the document body and of a table cell is black and the background is white, and
table cell borders are a full `1px` or wider, never sub-pixel.

> **Amended during implementation (2026-08-10).** Two parts of this contract
> shifted, both documented at the code:
>
> - **The border-width assertion moved** to `test/pages/printCssGeometry.test.ts`.
>   Under print emulation Firefox reports these borders at `0.766667px` because
>   it scales CSS pixels for the print medium, so an absolute threshold in the
>   browser measures the engine rather than the stylesheet. The rule that matters
>   — never *declare* a sub-pixel border, which is what made Firefox round
>   `0.5pt` away and print the sheet as bare text in columns — is now checked
>   statically against the declared value, and the browser spec keeps a relative
>   assertion that a rule survives to computed style at all.
> - **The `dist/` assertion moved** to a post-build step in both workflows. Both
>   run the frontend tests before the build, so `dist/` does not exist when
>   `harnessBuild.test.ts` runs in CI; that file keeps the two structural checks
>   (no `rollupOptions` input, harness not in `public/`), which guard the causes.

### Success Criteria:

#### Automated Verification:

- Type check and build pass: `cd frontend && npm run build`
- Lint passes with no new warnings: `cd frontend && npm run lint`
- Vitest suite passes and collects no Playwright specs: `cd frontend && npm test`
- Browser suite passes in both engines: `cd frontend && npm run test:print`
- `dist/` contains no `print-harness.html` after `npm run build`
- Forcing `--dark` text color into `print.css`'s print block fails the dark-theme
  assertion in both engines

#### Manual Verification:

- The real `/collections/:id/print` route still renders and prints correctly
  after the `PrintDocument` extraction — print one 5-language collection to PDF
  and compare against the pre-change output

---

## Phase 4: Geometry and pagination assertions

### Overview

Add the assertions that justify running a browser at all: real text measurement
for the language column, and real page count from a real PDF.

### Changes Required:

#### 1. Language column overflow

**File**: `frontend/browser-tests/languageColumn.spec.ts` (new)

**Intent**: `print.css:232-236` pins the Language column at 17%, derived from a
one-off manual measurement on 2026-08-03 that found 43 of 64 native × target
names overflowing at the previous 10%. That measurement has never been re-run and
a 9th language would invalidate it.

**Contract**: For each of the 8 native languages, renders the harness and asserts
no `.print-language` cell overflows its column (`scrollWidth <= clientWidth`) for
any of the 8 target names, and that the column heading itself fits. Runs in both
engines, with Firefox authoritative on shaping — the 17% figure was chosen with
~8px of headroom specifically for Firefox rendering the same font differently
from Chromium (`print.css:224-226`). Failure names the language pair and the two
widths.

#### 2. Page geometry and count

**File**: `frontend/browser-tests/pagination.spec.ts` (new)

**Intent**: The browser-free packer tests prove the packing *logic*; only a real
PDF proves the measured capacity, the real `@page` capacity, and the packer agree
on real paper.

**Contract**: Chromium project only (`page.pdf()` throws in Firefox — scoped by
project, not skipped at runtime). Against the 3+ sheet fixture: the number of
`.print-page` sections rendered on screen equals the page count of the generated
A4 PDF, with no trailing blank page; the PDF's page count is read from the page
tree's `/Count`. Also asserts, in both engines under print emulation, that a
`.print-page` box matches A4 within a tolerance and that no `<tbody>` band is
split across two sheets. Oracles are ISO 216 and the preview-matches-printout
requirement, not stored values.

> **Amended during implementation (2026-08-10).** Two departures:
>
> - **Scoping mechanism.** Chromium-only scoping is done with
>   `test.skip(({ browserName }) => browserName !== 'chromium', reason)` rather
>   than a separate Playwright project. The requirement this contract exists to
>   satisfy — Firefox never reports a page-count test as *passing* — is met: it
>   reports as skipped with the reason attached, visible as `1 skipped` in every
>   run. A dedicated project would need the `chromium` project to also exclude
>   the file, which is more configuration for the same observable.
> - **Media.** The on-screen assertions run in *screen* media, not print
>   emulation. The sheets are a screen artifact drawn at 210 × 297mm so the user
>   can review real pages; under `media: 'print'` they collapse to plain blocks
>   because `@page` supplies the geometry instead, and the table then spans the
>   viewport — measuring a column there gives roughly twice its width on paper.

### Success Criteria:

#### Automated Verification:

- Browser suite passes in both engines: `cd frontend && npm run test:print`
- Narrowing the Language column below its measured floor in `print.css` fails
  `languageColumn.spec.ts` naming the binding language pair
- Changing the probe height without the `@page` margin makes the on-screen sheet
  count and the PDF page count disagree in `pagination.spec.ts`
- The Firefox project reports no page-count test as passing (it is scoped out,
  not silently skipped)

#### Manual Verification:

- Print the 3+ sheet fixture from Firefox to paper and confirm the page count
  matches what `pagination.spec.ts` asserts in Chromium — the one check that
  confirms the two engines agree on this fixture

---

## Phase 5: CI wiring and plan reconciliation

### Overview

Make the browser layer a real gate, then update the test plan and shrink the
manual matrix to what only paper can answer.

### Changes Required:

#### 1. CI job

**File**: `.github/workflows/pr-diff.yml`, `.github/workflows/deploy.yml`

**Intent**: The browser suite needs no AWS credentials and no Neon branch, unlike
the existing `diff` job, so it runs as its own job rather than lengthening the
critical path.

**Contract**: A new `print-tests` job in both workflows: checkout, Node 24,
`npm ci` in `frontend/`, a cache on Playwright's browser directory keyed by the
resolved `@playwright/test` version, `npx playwright install --with-deps chromium
firefox`, then `npm run test:print`. In `deploy.yml` the existing `deploy` job's
`needs:` gains this job so a failure blocks deployment the same way the `diff`
job already does. Playwright's report is uploaded on failure.

#### 2. Test plan reconciliation

**File**: `context/foundation/test-plan.md`

**Intent**: The plan reserved a "print visual diff" gate row and a §6.5 cookbook
placeholder for this phase; both need to describe what actually shipped, which is
not a visual diff.

**Contract**: §3 Phase 4 Status → `complete`. §5's `print visual diff` row is
renamed to match reality (assertion-based, two engines, own CI job) and records
the same PR-path branch-protection caveat the other rows carry, since the new job
needs its own required-status-check rule. §6.5 is filled in with the shipped
patterns: where browser-free print tests go, where browser specs go, how the
harness works and why it cannot drift, the Vitest/Playwright glob separation, and
the Chromium-only page-count constraint. §4's stack table gains the Playwright
row with a `checked:` date.

#### 3. Manual matrix reduction

**File**: `context/changes/testing-print-output-correctness/manual-print-gate.md` (new)

**Intent**: The archived 12-case matrix
(`archive/2026-08-02-printable-export/plan.md:238-255`) is now partly redundant.
Record which cases automation absorbed and which remain paper-only, so the
reduction is auditable rather than a quiet deletion.

**Contract**: A table mapping each of the 12 original cases to `automated by
<test>` or `manual — <why paper only>`. The retained gate is the short list that
survives: a Firefox print-to-paper run on a 3+ page collection, "Print
backgrounds" off, dark OS theme, and glyph rendering (IPA / Cyrillic /
diacritics). Cites `archive/…/plan.md:84` — Firefox's own preview disagreed with
its printout — as the reason paper cannot be replaced by any preview-based check.

### Success Criteria:

#### Automated Verification:

- Both workflows parse: `gh workflow view` or a successful PR run showing the new
  `print-tests` job
- The `print-tests` job passes on a PR without AWS credentials being required
- `deploy.yml`'s `deploy` job is skipped when `print-tests` fails

#### Manual Verification:

- A required-status-check rule is added for the `print-tests` job in
  Settings → Branches, or the PR-path caveat is explicitly recorded in §5 as
  still open
- The retained manual gate is run once end-to-end and takes materially less time
  than the original 12-case matrix

---

## Testing Strategy

### Unit Tests (Vitest, `npm test`):

- Row model edge cases: backfill gaps, legacy uppercase codes, partial
  translation/sentence pairs, zero-language entries, collator fallback
- Language furniture: `LABELS` ↔ `SUPPORTED_LANGUAGES` coverage, native
  orthography, malformed-code fallbacks
- Pagination packer: first-page vs later-page capacity, no band split, order
  preserved, oversized-band guard
- Static `print.css` geometry invariants, with a parser tripwire
- Harness build guard: absent from `dist/`, imports the production component

### Browser Tests (Playwright, `npm run test:print`):

- Both engines: print-media black-on-white under `colorScheme: dark`, border
  widths not sub-pixel, language-column overflow across all 8×8 names, A4 page
  box, no band split across sheets
- Chromium only: PDF page count equals on-screen sheet count, no trailing blank

### Manual Testing Steps:

1. Print the 3+ sheet fixture from Firefox to actual paper; confirm page count
   and that every page's table closes at the bottom
2. With Firefox "Print backgrounds" off, confirm all table rules are visible
3. With the OS in dark theme, confirm the printout is black on white
4. Confirm IPA, Cyrillic and Polish diacritics render on paper

## Performance Considerations

The Vitest additions are negligible — the current frontend suite runs in ~2s and
these are pure functions plus one file read. The browser layer is the real cost:
two engine downloads (~300MB, cached) and a `vite` dev server per run. Keeping it
in its own CI job means it runs in parallel with the existing `diff` job rather
than extending it.

## Migration Notes

Two refactors of shipped code (`buildBands` → `printRows.ts` in Phase 1,
`PrintDocument` extraction in Phase 3) are behavior-preserving moves. Each phase's
manual verification includes a visual comparison against pre-change output. No
schema, API, or stored-data changes.

## References

- Research: `context/changes/testing-print-output-correctness/research.md`
- Test plan Phase 4 and Risk #2: `context/foundation/test-plan.md`
- Original print implementation: `context/archive/2026-08-02-printable-export/plan.md`
- Static-check idiom to follow: `backend/test/route-reachability.test.ts:38-111`
- Vitest conventions established by: `context/archive/2026-08-06-testing-auth-resilience/`
- Recurring rules: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Row model and language furniture

#### Automated

- [x] 1.1 Type check and build pass: `cd frontend && npm run build` — e8c9e2b
- [x] 1.2 Lint passes with no new warnings: `cd frontend && npm run lint` — e8c9e2b
- [x] 1.3 Frontend suite passes: `cd frontend && npm test` — e8c9e2b
- [x] 1.4 Deleting a `LABELS` entry makes `printLabels.test.ts` fail naming that code — e8c9e2b

#### Manual

- [ ] 1.5 Print page renders identically after the `buildBands` extraction

### Phase 2: Pagination packer and static geometry invariants

#### Automated

- [x] 2.1 Type check and build pass: `cd frontend && npm run build` — e8c9e2b
- [x] 2.2 Lint passes with no new warnings: `cd frontend && npm run lint` — e8c9e2b
- [x] 2.3 Frontend suite passes: `cd frontend && npm test` — e8c9e2b
- [x] 2.4 Changing `@page`'s margin without the probe fails `printCssGeometry.test.ts` with both values named — e8c9e2b
- [x] 2.5 Reformatting a covered rule either still parses or trips the tripwire — e8c9e2b

### Phase 3: Print harness and Playwright bootstrap

#### Automated

- [x] 3.1 Type check and build pass: `cd frontend && npm run build` — e8c9e2b
- [x] 3.2 Lint passes with no new warnings: `cd frontend && npm run lint` — e8c9e2b
- [x] 3.3 Vitest suite passes and collects no Playwright specs: `cd frontend && npm test` — e8c9e2b
- [x] 3.4 Browser suite passes in both engines: `cd frontend && npm run test:print` — e8c9e2b
- [x] 3.5 `dist/` contains no `print-harness.html` after `npm run build` — e8c9e2b
- [x] 3.6 Forcing a dark text color into `print.css`'s print block fails the dark-theme assertion in both engines — e8c9e2b

#### Manual

- [ ] 3.7 Real `/collections/:id/print` route still renders and prints correctly after the `PrintDocument` extraction

### Phase 4: Geometry and pagination assertions

#### Automated

- [x] 4.1 Browser suite passes in both engines: `cd frontend && npm run test:print` — e8c9e2b
- [x] 4.2 Narrowing the Language column below its measured floor fails `languageColumn.spec.ts` naming the binding pair — e8c9e2b
- [x] 4.3 Changing the probe height without the `@page` margin makes sheet count and PDF page count disagree — e8c9e2b
- [x] 4.4 The Firefox project reports no page-count test as passing (scoped out, not skipped) — e8c9e2b

#### Manual

- [ ] 4.5 Firefox print-to-paper page count matches what `pagination.spec.ts` asserts in Chromium

### Phase 5: CI wiring and plan reconciliation

#### Automated

- [x] 5.1 Both workflows parse and a PR run shows the new `print-tests` job — e8c9e2b
- [x] 5.2 The `print-tests` job passes without AWS credentials — 51ab9f2
- [ ] 5.3 `deploy.yml`'s `deploy` job is skipped when `print-tests` fails

#### Manual

- [ ] 5.4 Required-status-check rule added for `print-tests`, or the PR-path caveat recorded as open in §5
- [ ] 5.5 Retained manual gate run once end-to-end and confirmed materially shorter than the 12-case matrix
