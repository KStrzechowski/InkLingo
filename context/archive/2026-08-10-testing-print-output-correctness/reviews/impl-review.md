<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Print Output Correctness

- **Plan**: `context/changes/testing-print-output-correctness/plan.md`
- **Scope**: Phases 1–5 of 5 (all automated criteria complete; manual pending)
- **Date**: 2026-08-10
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 3 observations
- **Reviewer caveat**: this review was performed by the same agent that wrote the
  implementation. Findings are a checklist, not an independent all-clear.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Automated criteria all pass: `npm run build` PASS, `npm run lint` PASS,
`npm test` 90 passed, `npm run test:print` 51 passed / 1 skipped, CI green on
PR #4 (`diff: success`, `print-tests: success`).

## Findings

### F1 — The `useLayoutEffect` ordering fix has no regression test

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `frontend/src/pages/PrintDocument.tsx:35`
- **Detail**: Mutation-tested. Reverting the body-class effect from
  `useLayoutEffect` back to `useEffect` — the exact bug found during Phase 4,
  where bands are measured at the app's 18px font instead of the sheet's 11pt —
  leaves **all 51 browser tests passing**. The guard was lost when the fixture
  sentences were shortened in `fc67851` to fix CI: that change removed the very
  margin that made the mis-measurement observable. The sibling fix (render-phase
  pagination reset) *is* guarded — reverting it fails 5 tests across both
  engines with the "no longer paginates" tripwire.
- **Fix A ⭐ Recommended**: Add a static source check asserting the print-mode
  class is applied in a `useLayoutEffect` declared before the measuring effect.
  - Strength: Font-independent, so it holds on any runner — which is precisely
    why the behavioural guard could not survive. Uses the project's established
    static-source-comparison idiom (`route-reachability.test.ts`, §6.2/§6.6).
  - Tradeoff: Mirrors implementation structure rather than observable behaviour,
    which the plan's own anti-pattern list warns about.
  - Confidence: HIGH — the ordering invariant has no other observable once
    fixtures are sized for font-independence.
  - Blind spot: Would not catch a future component that measures without adding
    the class at all.
- **Fix B**: Add a second fixture with deliberately tall bands, used only by a
  test asserting sheet count under a known layout.
  - Strength: Guards behaviour rather than structure.
  - Tradeoff: Reintroduces the exact font-sensitivity that made CI red; would
    likely need to be excluded from CI, so it guards nothing where it matters.
  - Confidence: LOW — the CI failure in `31424566975` is direct evidence this
    approach is fragile.
  - Blind spot: None significant; the failure mode is already demonstrated.
- **Decision**: FIXED via Fix A — `frontend/test/pages/printDocumentEffects.test.ts`
  asserts both hook type and declaration order. Both halves verified by mutation:
  reverting to `useEffect` fails the hook-type assertion, and moving the class
  effect after the measuring effect fails the ordering assertion. The deliberate
  anti-pattern exception is recorded in the plan under "Deliberate exceptions".

### F2 — `print.css` was edited despite the plan forbidding it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: `frontend/src/pages/print.css:232-236` (commit `51ab9f2`)
- **Detail**: The plan's "What We're NOT Doing" states: *"No changes to the
  printed design. Column widths, fonts, hyphenation settings, and layout are
  treated as the spec... If a test disagrees with the current output, that is a
  finding to raise, not a reason to edit `print.css`."* The Language column was
  widened 17% → 19%, taking 2 points from the sentence columns. The process was
  followed — the finding was raised and explicitly approved — but the plan still
  records the prohibition, so a future reader sees a contradiction with no
  recorded override.
- **Fix**: Add an addendum to the plan's "What We're NOT Doing" recording the
  override, its date, its rationale (`system-ui` is per-OS; the 2026-08-03
  measurement saw one font), and that it was approved.
  - Strength: Keeps the plan usable as ground truth for `/10x-archive` and any
    later reader.
  - Tradeoff: None material.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED — plan now carries a "Deliberate exceptions, recorded
  during implementation" section under "What We're NOT Doing", covering this
  override and F1's structural-test exception, each with date and rationale.

### F3 — `harnessBuild.test.ts`'s `dist/` guard never runs in CI

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `frontend/test/pages/harnessBuild.test.ts:76`
- **Detail**: The test returns early when `dist/` is absent. Both workflows run
  "Run frontend tests" (`pr-diff.yml:156`) *before* "Build frontend"
  (`pr-diff.yml:166`), and `dist/` is gitignored, so in CI this assertion is
  always a no-op. Criterion 3.5 ("`dist/` contains no `print-harness.html`") is
  therefore only verified locally. The two structural checks in the same file
  (no `rollupOptions`, not in `public/`) do run and are the substantive guard.
- **Fix**: Add a `test -f frontend/dist/print-harness.html && exit 1` style
  assertion to the "Build frontend" CI step, where `dist/` actually exists.
  - Strength: Puts the check where the artifact is, and fails the job loudly.
  - Tradeoff: Splits the guard across a test file and a workflow step.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED — post-build assertion added to all three "Build frontend"
  steps (`pr-diff.yml` diff, `deploy.yml` diff, `deploy.yml` deploy), failing the
  job if `dist/print-harness.html` exists. The test file keeps its two structural
  checks, which do run in CI and guard the causes.

### F4 — Progress row 5.1 has a modified title and no landing SHA

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/testing-print-output-correctness/plan.md:670`
- **Detail**: The row reads `- [x] 5.1 Both workflows parse and a PR run shows
  the new print-tests job — YAML validated locally; the PR run itself is part of
  manual verification`. The Progress contract states "Do not rename step
  titles"; explanatory prose was appended to the title instead. As a side
  effect, the SHA-stamping pass skipped it (it looks for rows lacking ` — `), so
  it is the only checked row carrying no SHA. The row also conflates two things:
  the YAML parses (done) and a PR run shows the job (now actually true, via run
  `31427262125`).
- **Fix**: Restore the original title, append the landing SHA, and move the
  caveat into a note outside the Progress section.
- **Decision**: FIXED — title restored to its planned wording with ` — e8c9e2b`
  appended. The caveat was dropped rather than moved: run `31427262125` has since
  satisfied both halves of the criterion, so it was no longer true.

### F5 — Sub-pixel border check moved layers without a plan update

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `frontend/test/pages/printCssGeometry.test.ts:105`,
  `frontend/browser-tests/harness.spec.ts:61`
- **Detail**: Phase 3's contract specified the browser spec assert "table cell
  borders are a full `1px` or wider". Firefox reports `0.766667px` under print
  emulation because it scales CSS pixels for the print medium, so the assertion
  was moved to the static `print.css` check (where the *declared* value lives)
  and the browser assertion relaxed to `> 0`. This is well-documented in both
  files' comments and is the better design, but the plan's Phase 3 text still
  describes the original.
- **Fix**: Note the layer move in the plan's Phase 3 contract.
- **Decision**: FIXED — Phase 3's contract now carries an "Amended during
  implementation" note covering both the border-width layer move and the `dist/`
  assertion move from F3.

### F6 — Chromium-only scoping uses `test.skip` rather than a project

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `frontend/browser-tests/pagination.spec.ts:79`
- **Detail**: The plan said the page-count spec should be "scoped to the
  Chromium project rather than skipped at runtime, so the Firefox run does not
  report a passing test that never executed." Implementation uses
  `test.skip(({ browserName }) => browserName !== 'chromium', reason)`. The
  observable requirement (criterion 4.4 — Firefox reports no page-count test as
  passing) is satisfied: it reports as skipped-with-reason. The mechanism
  differs from the plan's wording.
- **Fix**: Accept and note in the plan, or introduce a dedicated Playwright
  project if strict scoping is wanted.
- **Decision**: ACCEPTED — mechanism kept, since the observable requirement is
  met (reports as skipped-with-reason, never as passing). Recorded in Phase 4's
  contract as an "Amended during implementation" note, alongside the screen-media
  departure.

### F7 — `FIXTURE_NAMES` is exported and never used

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `frontend/browser-tests/harness/fixtures.ts:172`
- **Detail**: Dead export — no spec or harness code references it. Left over
  from an earlier harness design that listed available fixtures.
- **Fix**: Delete the export.
- **Decision**: FIXED — export removed.

---

## Triage outcome (2026-08-10)

| Finding | Decision |
|---|---|
| F1 — unguarded `useLayoutEffect` fix | FIXED (Fix A — static check, both halves mutation-verified) |
| F2 — `print.css` edited against plan | FIXED (deliberate-exceptions addendum) |
| F3 — inert `dist/` guard in CI | FIXED (post-build assertion in all three build steps) |
| F4 — Progress row 5.1 | FIXED (title restored, SHA appended) |
| F5 — border check layer move | FIXED (Phase 3 amendment note) |
| F6 — `test.skip` vs project | ACCEPTED (mechanism noted in Phase 4) |
| F7 — dead export | FIXED (removed) |

Post-triage verification: `npm run build` PASS, `npm run lint` PASS,
`npm test` 94 passed / 11 files, `npm run test:print` 51 passed / 1 skipped,
both workflows parse.

Net: 6 fixed, 1 accepted, 0 skipped. One new test file
(`test/pages/printDocumentEffects.test.ts`, +4 tests), one CI assertion in three
places, one dead export removed, four plan corrections.
