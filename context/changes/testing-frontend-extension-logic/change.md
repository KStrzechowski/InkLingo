---
change_id: testing-frontend-extension-logic
title: Frontend/extension logic coverage — test-plan rollout Phase 5
status: impl_reviewed
created: 2026-08-11
updated: 2026-08-11
archived_at: null
---

## Notes

Rollout Phase 5 of `context/foundation/test-plan.md`: "Frontend/extension logic coverage".

**Risk covered — #6:** frontend collection language-gap detection and extension popup
variant/sentence selection state break silently; both areas have zero test coverage and
own the highest recent churn in the repo (`frontend/src/pages` 21 commits/30d,
`extension/src` 11 commits/30d).

**Test types planned:** component/unit tests — extends the existing frontend Vitest setup
(shipped in `testing-auth-resilience`) and bootstraps a test runner for `extension/`,
which has none.

**Risk response intent (from §2 Risk Response Guidance):**

- *Prove:* language-gap detection and popup variant/sentence selection produce correct
  output on documented edge cases (missing-language entries, multi-language collections,
  collection-switch mid-selection), not just the happy path.
- *Challenge:* the assumption that "the UI looked right during manual testing" proves the
  state logic is right — it does not prove state transitions (e.g. stale selection after
  switching collections) are handled.
- *Avoid:* reaching for e2e/browser tests to cover a zero-coverage gap that a cheaper
  unit/component test would catch just as well.

This is the last pending row in §3; the rollout is complete once it lands.

## Outcome

Seven phases, 2026-08-11. Extension suite: 0 → 19 tests. Frontend suite: 94 → 111.
The extension went from no CI presence at all to test + lint + build inside the
already-required `diff` job.

Grounding turned the risk into four live defects, all the same shape — a value
read before an `await` and written after it (now `lessons.md`'s newest entry):

| # | Defect | Fix |
|---|---|---|
| E-1 | A translate started under collection A could render and be **saved** under B, with A's word normalization and B's `source_language_code`. The backend guard only rejects this when the two collections' target languages differ | Generation ref, bumped by every call and by collection switch / logout |
| E-2 | Enter in the word input started a second concurrent AI call; the regeneration continuation then rebuilt state from a pre-await closure, resurrecting the previous word | Generation ref + functional writes + `disabled={working}` on the input |
| E-3 | A variant picked during a regeneration was silently reverted when it returned | Functional `setSelections`, writing only when the user is still on the regenerated meaning |
| L-1 | `CollectionsListPage` appended a created collection to a list that had failed to load, showing one collection as the user's complete list (the defect `lessons.md` was already written about) | A "Try again" control on the page's own error state, plus a refetch when a create succeeds while the load is still broken |

**Non-vacuity results.** Every guard was verified by removal, and each fails
exactly one test and nothing else: translate generation guard → "drops a
translate that lands after the collection changed"; regenerate generation guard
→ "does not splice a late regeneration into a different word's results";
functional `setSelections` → "keeps a variant picked while its sentences were
regenerating"; input disabling → "locks the word input while a call is in
flight". On the frontend: dropping the two `toLowerCase()` calls in the gap
comparison fails exactly the two legacy-code cases; reverting the retry control
fails the four recovery cases and leaves the three picker cases green;
reverting the post-create refetch fails only its own case.

The functional `setCapture` in the regeneration continuation is the one guard
with **no** independent failing test — once the generation ref is in place there
is no reachable scenario that needs it. Kept as defense in depth, recorded here
rather than claimed as covered.

**Two plan deviations**, both recorded in the commits:

1. The plan said Vitest never triggers `writeManifest`'s `closeBundle`. It does —
   once per Vite environment — so `npm test` was rewriting `dist/manifest.json`
   with the checked-in wildcard placeholders, silently widening
   `host_permissions` on whatever build was loaded in Firefox. Fixed with
   `apply: 'build'` (p1).
2. The plan called for disabling the variant radios during regeneration. Not
   done: it would make E-3's guard unreachable through the UI and therefore
   untestable, and browsing other meanings while sentences regenerate is
   harmless. Only the text input is disabled; E-3 is fixed by the functional
   state write instead.
