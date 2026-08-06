<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: AI Usability + Cross-User Isolation

- **Plan**: context/changes/testing-ai-usability-cross-user-isolation/plan.md
- **Scope**: Phase 1-4 of 4 (full plan)
- **Date**: 2026-08-05
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Ownership helper over-selects columns vs. 3 of 4 original queries

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend/src/routes/api/collections/ownership.ts:19-26
- **Detail**: `fetchOwnedCollection` always selects `id, name, native_language_code, created_at`, but 3 of the 4 original inline queries (translate, entries POST, entry-translations POST) only selected `id, native_language_code`. This was explicitly anticipated and accepted in the plan's contract ("Selects the superset of columns any of the 4 call sites need; unused columns are cheap to select and ignore") — flagging for visibility, not as a defect.
- **Fix**: No action needed; already a deliberate, plan-documented tradeoff.
- **Decision**: SKIPPED

### F2 — route-ownership.test.ts's handler-slicing heuristic has a known blind spot

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: backend/test/route-ownership.test.ts
- **Detail**: The "slice source between consecutive route-registration matches" approach could produce a false negative if `fetchOwnedCollection(`/`fetchOwnedEntry(` text appears in the sliced range without actually being invoked on the request's own params (dead code, a comment, or an unrelated call as the file grows). This is the same class of accepted limitation `route-reachability.test.ts` already documents for its own literal-call-shape matching, and the plan's own Critical Implementation Details section flags this exact caveat.
- **Fix**: No action needed now — already documented in code comments and the plan; worth a real brace-matcher only if the codebase's route-registration shape ever becomes nested.
- **Decision**: SKIPPED

### F3 — methodCallPattern/joinPrefix duplicated across the two static test files

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: backend/test/route-ownership.test.ts:12 vs backend/test/route-reachability.test.ts:44-54
- **Detail**: Phase 2 extracted `walkRouteFiles`/`NON_ROUTE_FILES`/`ROUTES_DIR` into the shared `helpers/routes.ts` per the plan, but `methodCallPattern` and `joinPrefix` are duplicated verbatim in both test files rather than joining that extraction. Defensible today — `route-ownership.test.ts` consumes the regex differently (needs `match.index` for slicing, vs. reachability's set-based comparison) — but a plausible follow-up extraction if a third static test appears.
- **Fix**: Extract `methodCallPattern` and `joinPrefix` into `helpers/routes.ts` alongside the Phase 2 helpers, parameterizing for the two consumption shapes.
- **Decision**: FIXED
