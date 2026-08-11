---
change_id: testing-frontend-extension-logic
title: Frontend/extension logic coverage — test-plan rollout Phase 5
status: implementing
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
