# AI Usability + Cross-User Isolation — Plan Brief

> Full plan: `context/changes/testing-ai-usability-cross-user-isolation/plan.md`

## What & Why

Phase 2 of the frozen `context/foundation/test-plan.md` rollout. Closes out Risk #5 (one user reaching another user's collection/entry data — IDOR) and Risk #3 (an AI translate call returning a structurally valid but unusable empty result, silently). Both risks are largely already mitigated at runtime; this phase converts that into provable, regression-safe coverage plus a fresh, real-API measurement — not new protection built from scratch.

## Starting Point

All 4 ID-accepting backend routes already filter by ownership and already have passing cross-user 404 tests — but as 4 duplicated inline SQL queries with no shared convention, so nothing stops a future route from skipping the pattern. The AI translate path already retries once on an empty result before giving up and returning a visible "Nothing came back" state — but the only usability number on record (~9%, from an archived doc) predates that retry mitigation entirely.

## Desired End State

Every ID-accepting route calls one of two shared ownership helpers, and a new static test fails (naming the exact route) if a future route skips that call — the same pattern Risk #1's gateway-reachability check already established. A fresh, real-API measurement of the AI path's current usable-output rate is recorded in `test-plan.md`, without changing the AI code itself.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| AI "unusable result" UX | Keep current behavior (empty array + frontend message) | Already user-visible and non-silent; no need to touch the frontend for a backend-scoped phase | Plan (user-confirmed) |
| Empirical measurement | Run ~12-15 fresh real-API calls, once | The archived ~9% figure predates the retry mitigation, so it's not evidence for current behavior | Plan (user-confirmed) |
| Script commit status | Not committed — scratchpad one-off | Matches the existing lesson's guidance verbatim; avoids a new maintenance surface | Plan (user-confirmed) |
| IDOR guard mechanism | Shared ownership-helper convention + static test enforcing its use | Closes the same silent-gap risk class Risk #1 named, for authorization instead of gateway registration | Plan (user-confirmed) |
| Retry tuning | Do not retune `EMPTY_RESULT_RETRIES` | This phase proves/measures the guard, it doesn't redesign it — mirrors Phase 1's precedent | Plan (user-confirmed) |
| Results recording | `test-plan.md` §6 cookbook, dated | Keeps the living reference doc current for future rollout phases/refreshes | Plan (user-confirmed) |

## Scope

**In scope:**
- Extracting `fetchOwnedCollection`/`fetchOwnedEntry` shared helpers and refactoring the 4 existing routes onto them
- A new static regression-guard test (`route-ownership.test.ts`) enforcing the convention on all `:id`/`:entryId` routes
- A one-off, manually-run, uncommitted empirical script measuring real AI-call usability
- `test-plan.md` bookkeeping: gate table, cookbook, rollout status

**Out of scope:**
- Any frontend/extension change
- Changing the AI response contract or retry threshold
- Committing the empirical script or adding it to CI
- A lint rule or compile-time enforcement of the ownership convention

## Architecture / Approach

Backend-only. Phase 1 extracts and refactors; Phase 2 adds a static source-comparison test (reusing `route-reachability.test.ts`'s file-walking helper, extracted into `test/helpers/routes.ts`) that greps each ID-accepting route's handler source for a call to the shared helper. Phase 3 is fully independent — a throwaway script calling `generateTranslation()` directly with a real Anthropic client, sidestepping HTTP/auth/DB entirely since the risk lives purely in the AI call. Phase 4 documents all of it.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Extract ownership helpers | `fetchOwnedCollection`/`fetchOwnedEntry`, 4 routes refactored, zero behavior change | Refactor accidentally changes a 404 case — mitigated by existing tests running unchanged |
| 2. IDOR regression guard | `route-ownership.test.ts` fails naming any route missing the helper call | Handler-slicing heuristic depends on today's non-nested route-registration shape |
| 3. Empirical AI measurement | Fresh usable-output rate, latency, cost for the post-retry behavior | Requires real Anthropic spend and your live permission at run time |
| 4. Bookkeeping | `test-plan.md` reflects shipped state + Phase 3's real numbers | None — pure documentation |

**Prerequisites:** None beyond what already exists (backend test suite, a real `ANTHROPIC_API_KEY` locally for Phase 3).
**Estimated effort:** ~1 session across 4 phases — Phases 1-2 are a small refactor + one new static test; Phase 3 is a short script; Phase 4 is doc edits.

## Open Risks & Assumptions

- The static guard's handler-slicing heuristic (registration-to-next-registration) assumes route handlers stay non-nested, matching today's codebase shape but not enforced elsewhere.
- Phase 3's real-API run needs your explicit, live go-ahead when it's actually executed — approving this plan does not itself authorize those calls.

## Success Criteria (Summary)

- `cd backend && npm test` passes, including all 4 refactored cross-user tests and the new IDOR guard test
- Deliberately breaking the ownership-helper call on one route makes the guard fail, naming that route
- A real, current usable-output rate for the AI translate path is measured once and recorded in `test-plan.md`
