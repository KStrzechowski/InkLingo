<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Frontend/Extension Logic Coverage

- **Plan**: `context/changes/testing-frontend-extension-logic/plan.md`
- **Scope**: Full plan (Phases 1-7 of 7)
- **Date**: 2026-08-11
- **Verdict**: NEEDS ATTENTION → all 6 findings triaged 2026-08-11 (4 fixed, 2 accepted by design)
- **Findings**: 0 critical, 2 warnings, 4 observations
- **Reviewer note**: this review was produced by the same session that wrote the
  implementation. Findings are grounded in re-read source and freshly-run
  commands rather than recollection, but a genuinely independent pass would be
  worth more — treat F1 and F2 as the ones to check hardest.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Automated criteria re-run at review time: `extension` 19 tests / build / lint
clean; `frontend` 111 tests / build / lint clean; CI run 31524186475 green on
both jobs. Every manual row was confirmed by the human.

## Findings

### F1 — `handleSave` overwrites a collection switch made during the save

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `extension/src/popup/App.tsx:337-371`
- **Detail**: `handleSave` reads `activeCollection` before its `await`, then
  after it calls `rememberCollection(activeCollection.id)` and `setText('')`.
  The collection select is not disabled during a save (only the Save button is,
  via `working`), so the user can switch collections while it runs. The entry
  itself lands correctly — it posts to the id captured before the await — but
  the *last-used* pointer is then rewritten to the old collection, silently
  undoing the switch the user just made; the next popup open lands on the wrong
  collection. `setText('')` likewise clears anything typed since.

  This is the same defect class this change added to `lessons.md` ("A value read
  before an `await` must not be written back after it"), and the rule as written
  covers "any handler that awaits a network or AI call and then sets state" —
  so the implementation is now inconsistent with its own rule. It is
  **pre-existing**, not introduced here: the select was equally live before
  Phase 3. `handleLogin` and `loadCollections` share the shape but have no
  plausible interleaving.
- **Fix A ⭐ Recommended**: Guard the post-await writes with the generation ref,
  as `handleTranslate` and `handleRegenerate` already do — keep showing the
  "Saved …" confirmation (it is true, and names the collection it saved to), but
  skip `rememberCollection` and `setText('')` when the generation moved.
  - Strength: Consistent with the three guards already in the file and with the
    new lesson; keeps the select usable, which was the deliberate Phase 3 choice.
  - Tradeoff: A fourth call site for the same ritual; the file gains one more
    stale-check branch.
  - Confidence: HIGH — `abandonInFlight()` already fires on collection change,
    so the signal needed is present with no new state.
  - Blind spot: Not covered by the existing suite; would need one more deferred
    test, which the `webext.ts` fixture already supports.
- **Fix B**: Disable the collection select while `busy === 'save'`.
  - Strength: One attribute; makes the interleaving unreachable.
  - Tradeoff: Re-introduces the lock-the-UI approach Phase 3 deliberately
    rejected for translate, and leaves the underlying stale write in place for
    any future caller.
  - Confidence: HIGH — trivially correct.
  - Blind spot: Inconsistent UX (select live during translate, frozen during
    save) invites the question again later.
- **Decision**: FIXED via Fix A — generation guard on handleSave's post-await writes; the "Saved …" confirmation still shows. Regression test added (`does not rewrite the last-used collection when one is chosen mid-save`), verified non-vacuous: removing the guard fails that case alone.

### F2 — Two unplanned behaviour changes on `CollectionsListPage`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: `frontend/src/pages/CollectionsListPage.tsx` (create handler; list render)
- **Detail**: Planning explicitly chose "Try again on the page's own error
  state" and listed "refetch the whole list after a successful create" as the
  *rejected* alternative. The implementation ships the retry **plus** two things
  the plan's Phase 5 contract never described: (1) a refetch when a create
  succeeds while `loadError` is set, and (2) hiding the list section entirely
  while the load is broken, so "No collections yet." is not rendered.

  Both are defensible — they close a state the retry-only design creates, where
  a successful create leaves the user with no list at all — and both are tested
  and recorded in the commit and in `change.md`. But neither reached `plan.md`,
  which is the artifact future reviews read as ground truth, and (1) is
  literally the option the user turned down when asked.
- **Fix A ⭐ Recommended**: Record both as an addendum under Phase 5 in
  `plan.md`, noting why the rejected option returned in scoped form.
  - Strength: Preserves tested, working behaviour and makes the plan honest;
    the archive then contains a plan that matches the code.
  - Tradeoff: The plan becomes a moving target; a reader must trust the
    addendum was reviewed rather than slipped in.
  - Confidence: HIGH — the reasoning is already written up in the commit body
    and `change.md`, so this is a transcription, not a new decision.
  - Blind spot: The user chose "retry only" in planning and has not explicitly
    signed off on the blended version.
- **Fix B**: Revert both extras to match the planned option exactly.
  - Strength: Strict scope discipline; the plan stands unamended.
  - Tradeoff: Restores the confusing state — create succeeds, list stays hidden
    or shows only the new row — and deletes a passing test.
  - Confidence: MEDIUM — the revert is small, but the resulting UX is worse
    than what ships today.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — addendum recorded under Phase 5 in plan.md covering both the scoped post-create refetch and the hidden list section.

### F3 — `CollectionsListPage.test.tsx` hand-rolls a fixture the helpers already provide

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `frontend/test/pages/CollectionsListPage.test.tsx:24-36`
- **Detail**: Declares a local `collection()` builder with its own id sequence,
  while `frontend/test/helpers/collections.ts` exports `createCollection` —
  whose own header says "extend these rather than hand-rolling literals per
  test, so a change to the API types surfaces in one place". `test-plan.md` §6.3
  records the same convention. `CollectionDetailPage.test.tsx`, written in the
  previous phase, uses the helper correctly.
- **Fix**: Use `createCollection` from `../helpers/collections`; it returns
  `CollectionDetail`, which is assignable where `Collection` is expected.
- **Decision**: FIXED — CollectionsListPage.test.tsx now builds fixtures with the shared createCollection (aliased to buildCollection, since the mocked API module exports the same name).

### F4 — `deferred()` duplicated instead of shared

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `frontend/test/pages/CollectionDetailPage.test.tsx:29-42`
- **Detail**: The frontend inlines its own `deferred()` while the extension
  exports one from `test/helpers/webext.ts`. Deferred responses are now the
  house idiom for testing in-flight state in both apps, so the frontend copy
  belongs beside its other shared fakes rather than in one spec file.
- **Fix**: Move it to `frontend/test/helpers/` (e.g. `helpers/deferred.ts`) and
  import it from the spec.
- **Decision**: FIXED — deferred() extracted to frontend/test/helpers/deferred.ts and imported by CollectionDetailPage.test.tsx.

### F5 — Documented deviation: variant radios not disabled during regeneration

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `extension/src/popup/App.tsx` (variant radio inputs)
- **Detail**: Phase 3's contract called for disabling the variant radios while a
  language regenerates. Not done — disabling them would make E-3's guard
  unreachable through the UI and therefore untestable, and browsing other
  meanings while sentences regenerate is harmless. The deviation was flagged
  before implementing, and is recorded in the Phase 3 commit and in
  `change.md`'s Outcome section. E-3 is instead fixed by the functional
  `setSelections` write, which has its own failing-when-removed proof.
- **Fix**: None needed — listed so the deviation is visible in the review record
  rather than only in commit history.
- **Decision**: ACCEPTED — deviation is by design and now visible in the review record.

### F6 — Unplanned production fix: `writeManifest` gated with `apply: 'build'`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `extension/vite.config.ts`
- **Detail**: The plan asserted Vitest never triggers `closeBundle`. It does —
  once per Vite environment — so `npm test` rewrote `dist/manifest.json` with
  the checked-in wildcard `host_permissions`, degrading whatever build was
  loaded in Firefox. The fix is a one-line `apply: 'build'`. Strictly outside
  the planned change set, but the phase could not be correct without it: adding
  a test runner that quietly widens the shipped add-on's permissions would have
  been a net loss. Verified by the human (manual row 1.5) that `npm run dev`
  still produces a loadable add-on.
- **Fix**: None needed — recorded so the unplanned production edit is visible.
- **Decision**: ACCEPTED — unplanned production fix, required for the phase to be correct; visible in the review record.
