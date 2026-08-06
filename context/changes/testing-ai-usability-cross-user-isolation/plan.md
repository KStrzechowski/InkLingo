# AI Usability + Cross-User Isolation Implementation Plan

## Overview

Phase 2 of the frozen test-plan rollout (`context/foundation/test-plan.md` §3). Closes out Risk #5 (IDOR — one user reaching another user's collection/entry data) and Risk #3 (an AI call returning a structurally valid but unusable empty result, silently). Both risks turn out to be substantially mitigated already; this phase converts that into provable, regression-safe coverage and a fresh empirical measurement, rather than building either mechanism from scratch.

## Current State Analysis

- **Risk #5 (IDOR) already has the right runtime behavior everywhere it applies.** All 4 ID-accepting routes in `backend/src/routes/api/collections/index.ts` — `GET /:id` (:146), `POST /:id/translate` (:213), `POST /:id/entries` (:251), `POST /:id/entries/:entryId/translations` (:361) — filter by `user_id` (collections) or by the already-verified `collection.id` (entries), and each already has a passing cross-user 404 test (`collections.test.ts:201`, `translate.test.ts:220`, `entries.test.ts:115`, `entry-translations.test.ts:141`). There are no `DELETE`/`PATCH`/`PUT` routes anywhere in the backend. What's missing is not coverage — it's a guarantee that the *next* ID-accepting route added won't skip this pattern, the same class of silent-gap risk that Risk #1 named for gateway registration.
- **The 4 ownership checks are duplicated inline SQL**, not a shared convention: `WHERE id = ${request.params.id} AND user_id = ${request.authUser.id}` appears verbatim 3 times (`index.ts:154,228,290,373`), and the entry-level check `WHERE id = ${request.params.entryId} AND collection_id = ${collection.id}` appears once (`:382`). Nothing currently prevents a new route from writing its own ad hoc (and possibly wrong) ownership query instead of reusing a known-correct one.
- **Risk #3 (AI usability) already has a retry mechanism, not silent pass-through.** `backend/src/ai/translate.ts`: the tool schema documents `minItems: 1` on `variants`/`sentences` as *advisory only* (:71-89, Anthropic tool schemas don't enforce it), `isEmpty()` (:122-124) detects an all-languages-empty result, and `generateTranslation()` (:155-164) retries once (`EMPTY_RESULT_RETRIES = 1`, :19) before giving up. A still-empty result after the retry returns `200` with empty `variants: []` per language; the frontend renders "Nothing came back for this language" (confirmed by `translate.test.ts:151-176`). This has been confirmed sufficient — it's user-visible and non-silent, not a bare empty screen.
- **The only prior usability measurement predates this mitigation.** `context/archive/2026-07-25-capture-translate-save/follow-ups/pending-manual-checks.md:19-32` recorded ~3-in-34 (~9%) empty-result calls, $0.0063/capture, 4.7-10.0s latency — but that number was measured before the retry logic existed (it's what motivated adding the retry). No committed script or fresh number exists for the current, post-retry behavior.
- **No IDOR-detection or AI-usability-measurement mechanism exists anywhere in the test suite today.** `backend/test/route-reachability.test.ts` is the closest analog — a static source-comparison test for a different risk (Risk #1) — and its route-enumeration logic (`walkRouteFiles`, `NON_ROUTE_FILES`, the routes directory constant) is currently private to that file, not shared.

### Key Discoveries:

- `backend/test/route-reachability.test.ts:40-51` (`walkRouteFiles`) and its `NON_ROUTE_FILES`/`ROUTES_DIR` constants are exactly what a new route-enumerating test needs — extracting them avoids re-deriving the same file-walking logic a second time.
- All 4 ID-accepting routes live in one file today, and none of their handler bodies are nested inside another route's handler — each `fastify.<method>(...)` call is a top-level statement in `collections/index.ts`. A static check can safely slice each handler's source as "from this route registration's start to the next route registration's start" without full brace-matching.
- The route param naming convention is already consistent and machine-checkable: `collectionParamsSchema` uses `id` (`schemas.ts:18`), `entryParamsSchema` uses `id` + `entryId` (`schemas.ts:27`). A route path containing `:id` needs a collection-ownership call; one also containing `:entryId` needs an entry-ownership call too.
- `generateTranslation` (`backend/src/ai/translate.ts:155`) is called directly by `generateWithTimeout` (`index.ts:43-57`) with a real or stubbed `fastify.anthropicClient`. Measuring Risk #3 doesn't require going through the HTTP layer, auth, or a database at all — calling `generateTranslation` directly with a real Anthropic client is the cheapest layer that actually exercises what the risk is about, consistent with the test-plan's cost × signal principle.
- `backend/test/helpers/anthropic.ts`'s stub helpers are irrelevant to this phase's empirical measurement — that script deliberately does NOT stub the client; stubbing is precisely what the "stubbed AI client cannot tell you the model's output is usable" lesson warns cannot substitute for a real-API check.

## Desired End State

- `backend/src/routes/api/collections/ownership.ts` exports `fetchOwnedCollection` and `fetchOwnedEntry`; all 4 ID-accepting routes call them instead of inline ownership SQL, with identical external behavior (same 404s, same existing tests passing unchanged).
- `cd backend && npm test` includes a new static test that fails, naming the specific route, if any `:id`/`:entryId`-accepting route stops calling the shared ownership helper.
- A fresh, real-API measurement of AI translate usability has been taken once (not committed, not automated) and its numbers (usable-output rate, cost, latency) are recorded in `context/foundation/test-plan.md` §6.
- `context/foundation/test-plan.md`'s §3 rollout table shows Phase 2 as `complete`, §5's gate table lists the new IDOR guard as enforced, and §6's cookbook documents both the ownership-helper convention and the AI-usability empirical-check pattern for future readers.

**Verification**: `cd backend && npm test` passes, including the 4 pre-existing cross-user tests (now exercising the shared helpers) and the new `route-ownership.test.ts`; deliberately removing one route's ownership-helper call makes the new test fail, naming that exact route; the empirical script, run once with explicit live permission, produces a usable-output percentage, latency, and cost figure that lands in `test-plan.md`.

## What We're NOT Doing

- Not changing the AI response contract or adding frontend error-state UI for empty results — the current empty-array-plus-frontend-message behavior was confirmed sufficient; this phase is backend/test-only.
- Not retuning `EMPTY_RESULT_RETRIES` regardless of what the fresh measurement shows — this phase proves/measures the existing guard, it doesn't redesign it, mirroring Phase 1's precedent of not retuning the rate-limit threshold it was proving.
- Not committing the empirical measurement script to the repo — it stays a one-off, run locally, per the existing lesson's explicit guidance ("the scratchpad is fine, it needn't be committed").
- Not adding the empirical script to CI, `npm test`, or any automated pipeline — it makes real, costly Anthropic API calls and must only ever run manually, once, with explicit live permission granted at execution time.
- Not building the ownership convention as a lint rule, ESLint plugin, or compile-time check — enforcement is the new static `node:test` file only, consistent with how Risk #1's gateway check works today.
- Not extending the ownership-helper pattern to any resource type beyond collections/entries — no other ID-accepting resource exists yet to justify a more generic abstraction.
- Not touching `frontend/` or `extension/` — those are test-plan.md Phase 3 and Phase 5's scope.

## Implementation Approach

Refactor first (Phase 1: extract the ownership helpers, prerequisite for the guard to have something meaningful to check), then the regression guard that depends on it (Phase 2), then the independent AI-usability measurement (Phase 3, no dependency on 1/2), then documentation close-out that records Phase 3's results and reflects Phases 1-2's shipped state (Phase 4, depends on all three).

## Critical Implementation Details

**Handler-slicing heuristic is codebase-shape-dependent.** `route-ownership.test.ts` (Phase 2) determines each route's "handler source" by slicing from one `fastify.<method>(...)` registration's match position to the next one's (or end of file) — safe today because no route handler is nested inside another, but this would silently mis-slice if that ever changed. Note this the same way `route-reachability.test.ts:53-60` already flags its own literal-call-shape limitation, so a future reader isn't surprised.

**The empirical script must use a real Anthropic API key, not the CI placeholder.** Phase 1 of the prior change (`testing-backend-ci-safety-net`) established `ANTHROPIC_API_KEY` placeholder values (e.g. `eu-central-1_ciplaceholder1`-style strings) for CI, which only satisfy `config.ts`'s presence check. The Phase 3 script needs a real, working key (local `.env`) — reusing the placeholder pattern here would produce authentication failures, not usability data.

## Phase 1: Extract shared ownership helpers

### Overview

Pull the 4 duplicated inline ownership queries into two shared functions, and point all 4 existing routes at them, with no behavior change.

### Changes Required:

#### 1. New ownership helpers

**File**: `backend/src/routes/api/collections/ownership.ts` (new)

**Intent**: Single source of truth for "fetch this collection/entry only if the requesting user owns it," replacing 4 copies of near-identical SQL.

**Contract**:
- `fetchOwnedCollection(fastify, collectionId, userId): Promise<CollectionRow | undefined>` — `SELECT id, name, native_language_code, created_at FROM collections WHERE id = ${collectionId} AND user_id = ${userId}`. Selects the superset of columns any of the 4 call sites need; unused columns are cheap to select and ignore.
- `fetchOwnedEntry(fastify, entryId, collectionId): Promise<EntryRow | undefined>` — `SELECT id, word_or_phrase FROM entries WHERE id = ${entryId} AND collection_id = ${collectionId}`.
- Both return `undefined` when no matching row exists (mirrors postgres.js/Neon driver's existing destructuring pattern already used at every call site: `const [row] = await fastify.sql\`...\``).

#### 2. Refactor the 4 existing routes

**File**: `backend/src/routes/api/collections/index.ts`

**Intent**: Replace each inline ownership query with a call to the new shared helper, preserving exact existing behavior (same 404 on a missing/foreign row).

**Contract**: At `:146` (`GET /:id`), `:213` (`POST /:id/translate`), `:251` (`POST /:id/entries`), and `:361` (`POST /:id/entries/:entryId/translations`), replace the inline `fastify.sql\`SELECT ... WHERE id = ... AND user_id = ...\`` with `await fetchOwnedCollection(fastify, request.params.id, request.authUser.id)`. At `:361`'s entry lookup (`:379-383`), replace with `await fetchOwnedEntry(fastify, request.params.entryId, collection.id)`. The `collection === undefined` / `entry === undefined` → `reply.notFound()` checks stay as-is.

### Success Criteria:

#### Automated Verification:

- `cd backend && npm test` passes, including the 4 pre-existing cross-user tests (`collections.test.ts`, `translate.test.ts`, `entries.test.ts`, `entry-translations.test.ts`), now exercising the shared helpers with unchanged assertions
- `cd backend && npm run build:ts` succeeds

---

## Phase 2: Add the IDOR regression guard

### Overview

A static test that fails, naming the specific route, if any `:id`/`:entryId`-accepting backend route stops calling the shared ownership helper from Phase 1 — the same static-source-comparison approach `route-reachability.test.ts` uses for Risk #1, applied to Risk #5.

### Changes Required:

#### 1. Extract shared route-enumeration helper

**File**: `backend/test/helpers/routes.ts` (new)

**Intent**: `route-reachability.test.ts` already has route-file-walking logic (`walkRouteFiles`, `NON_ROUTE_FILES`, `ROUTES_DIR`) that the new test also needs — extract rather than duplicate, matching the `testing-backend-ci-safety-net` Phase 1 convention of extracting shared test helpers (`test/helpers/anthropic.ts`).

**Contract**: Move `walkRouteFiles`, `NON_ROUTE_FILES`, and `ROUTES_DIR` out of `route-reachability.test.ts` verbatim into this new file, exported.

#### 2. Update the import in the existing test

**File**: `backend/test/route-reachability.test.ts`

**Intent**: Use the extracted helper instead of the local definitions.

**Contract**: Replace the local `walkRouteFiles`/`NON_ROUTE_FILES`/`ROUTES_DIR` definitions with an import from `helpers/routes.ts`. No test bodies or assertions change.

#### 3. New IDOR regression-guard test

**File**: `backend/test/route-ownership.test.ts` (new)

**Intent**: Fail CI when an ID-accepting route is added, or an existing one is edited, without a call to the shared ownership helper — the exact failure mode Risk #5 describes, before it ships rather than after.

**Contract**:
- Enumerate route files via the extracted `walkRouteFiles(ROUTES_DIR)`.
- For each file, regex-match `fastify\.(get|post|put|delete|patch)\s*\(\s*(['"\`])(.*?)\2` (same pattern `route-reachability.test.ts` already uses) to find each route's method, path, and source match position.
- For paths containing a `:id` segment, slice the handler's source region (this match's start to the next match's start, or end of file — see Critical Implementation Details) and assert it contains `fetchOwnedCollection(`.
- For paths also containing a `:entryId` segment, additionally assert the same region contains `fetchOwnedEntry(`.
- On failure, name the specific method + path and which helper call is missing — matching `route-reachability.test.ts`'s actionable-failure-message convention.

### Success Criteria:

#### Automated Verification:

- `cd backend && npm test` passes, including the new `route-ownership.test.ts` and the updated `route-reachability.test.ts`
- `cd backend && npm run build:ts` succeeds

#### Manual Verification:

- Temporarily remove one `fetchOwnedCollection(` (or `fetchOwnedEntry(`) call from a route handler, re-run `npm test`, confirm `route-ownership.test.ts` fails naming that exact route and the missing helper — then revert. This is the proof the check catches the failure it exists to catch, not just that it passes against today's already-correct state.

---

## Phase 3: Empirical AI-usability measurement

### Overview

A one-off, uncommitted script that calls `generateTranslation()` directly against the real Anthropic API (~12-15 varied inputs), run exactly once with your explicit live permission, to get a current usable-output rate for the post-retry behavior — the archived ~9% figure predates the retry mitigation and isn't evidence for today's code.

### Changes Required:

#### 1. Empirical measurement script

**File**: not committed — a temporary local script (e.g. in the session scratchpad), deleted after use

**Intent**: Measure how often a real call to `generateTranslation` (`backend/src/ai/translate.ts:155`) — with the existing 1-retry-on-empty logic active — still returns an unusable (all-empty) result, plus latency and cost, against the actual current mitigation rather than a stubbed response.

**Contract**: Instantiate a real Anthropic client (real `ANTHROPIC_API_KEY` from local `.env` — see Critical Implementation Details), call `generateTranslation` directly (bypassing HTTP/auth/DB — Risk #3 is about the AI call itself) for ~12-15 varied word/phrase inputs across the project's existing target-language set, and for each call record: whether `isEmpty()` was still true after the built-in retry, latency, and token usage if the SDK response exposes it. Print a summary: total calls, usable-output rate, average latency, estimated total cost.

**This step requires your explicit go-ahead at the moment it actually runs** — it is not authorized by approving this plan.

### Success Criteria:

#### Manual Verification:

- You grant explicit, live permission to run the script against the real Anthropic API
- Script runs once, producing a usable-output percentage, average latency, and estimated cost
- Script and any temporary output files are discarded afterward — nothing from this phase is committed

---

## Phase 4: Close out test-plan.md bookkeeping

### Overview

Record Phase 3's measured numbers and document the patterns Phases 1-2 established, so `context/foundation/test-plan.md` stays an accurate living reference, and flip rollout Phase 2 to `complete`.

### Changes Required:

#### 1. Cookbook, gates, and rollout-status updates

**File**: `context/foundation/test-plan.md`

**Intent**: Make the doc reflect what actually shipped in this phase.

**Contract**:
- §3 Phased Rollout table: Phase 2's `Status` cell → `complete`.
- §5 Quality Gates table: add a row for the IDOR ownership guard (`backend/test/route-ownership.test.ts`, part of `npm test`, required — shipped in `testing-ai-usability-cross-user-isolation` p2, catches a route accepting a resource ID without an ownership filter, Risk #5).
- §6 cookbook: add a subsection documenting the ownership-helper convention (`fetchOwnedCollection`/`fetchOwnedEntry` in `backend/src/routes/api/collections/ownership.ts`) and that `route-ownership.test.ts` enforces its use on any new `:id`/`:entryId`-accepting route; extend §6.4's existing note (which already covers the route-reachability requirement) to also mention this.
- §6 cookbook: add a subsection for the AI-usability empirical-check pattern, recording Phase 3's measured numbers (usable-output rate, latency, cost) with a `checked: <today>` date, and noting the script is deliberately not committed — re-derive from `backend/src/ai/translate.ts` and this plan if a future refresh needs to re-measure.
- §8 Freshness Ledger: update "Strategy (§1-§5) last reviewed" to today's date.

### Success Criteria:

#### Automated Verification:

- `grep "| 2 | AI usability" context/foundation/test-plan.md` shows the Phase 2 row's Status column as `complete`

#### Manual Verification:

- Read the updated §5/§6 sections and confirm they accurately describe what shipped in Phases 1-3, including the real measured numbers from Phase 3

---

## Testing Strategy

### Unit Tests:

- N/A — this phase adds integration-level and static-analysis-level tests only; the ownership helpers are simple enough to be fully covered by the existing route-level integration tests.

### Integration Tests:

- Ownership refactor (Phase 1): the 4 pre-existing cross-user 404 tests continue to pass unchanged, proving the refactor preserves behavior exactly.
- IDOR regression guard (Phase 2): source-level static comparison, not an HTTP test — verifies a build-time invariant (every ID-route calls the ownership helper), not runtime behavior.
- AI usability (Phase 3): a one-off empirical script against the real API, deliberately outside the automated suite.

### Manual Testing Steps:

1. Confirm Phase 1's refactor changed no behavior — `npm test`'s existing cross-user tests still pass with unchanged assertions.
2. Remove one ownership-helper call, confirm `route-ownership.test.ts` fails naming that exact route, then revert (Phase 2).
3. Grant live permission and run the empirical script once against the real Anthropic API; record usable-output rate, latency, and cost (Phase 3).
4. Read the updated `test-plan.md` §5/§6 sections for accuracy against what shipped (Phase 4).

## Performance Considerations

The ownership-helper refactor issues the same number of queries as before, just deduplicated into shared functions — no runtime performance change. The empirical script costs roughly a dozen-plus real Anthropic calls (~$0.08-0.10 based on the prior ~$0.0063/call figure) as a one-time, manual, non-recurring cost — no effect on CI or production runtime.

## Migration Notes

No schema or data changes. No production data affected.

## References

- Test-plan: `context/foundation/test-plan.md` §2 (Risks #3, #5), §3 (Phase 2 row)
- Prior (pre-retry) empirical measurement: `context/archive/2026-07-25-capture-translate-save/follow-ups/pending-manual-checks.md:19-32`
- Lesson this phase's Phase 3 directly applies: `context/foundation/lessons.md` ("A stubbed AI client cannot tell you the model's output is usable")
- Lesson this phase's Phase 1-2 directly applies: `context/foundation/lessons.md` ("Every new backend API route needs a matching api-construct.ts entry" — same silent-gap risk shape, applied to ownership instead of gateway registration)
- Existing static-check pattern to extend: `backend/test/route-reachability.test.ts`
- Routes being refactored: `backend/src/routes/api/collections/index.ts:146,213,251,361`
- AI retry logic: `backend/src/ai/translate.ts:19,122-124,155-164`
- Prior CI placeholder-key pattern (not reusable for Phase 3): `context/archive/2026-08-05-testing-backend-ci-safety-net/plan.md` §Key Discoveries

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extract shared ownership helpers

#### Automated

- [x] 1.1 `cd backend && npm test` passes, including the 4 pre-existing cross-user tests now exercising the shared helpers — 1c62fda
- [x] 1.2 `cd backend && npm run build:ts` succeeds — 1c62fda

### Phase 2: Add the IDOR regression guard

#### Automated

- [x] 2.1 `cd backend && npm test` passes, including the new `route-ownership.test.ts` and updated `route-reachability.test.ts` — 8dc3462
- [x] 2.2 `cd backend && npm run build:ts` succeeds — 8dc3462

#### Manual

- [x] 2.3 Temporarily remove one ownership-helper call, confirm `route-ownership.test.ts` fails naming that route and the missing helper, then revert

### Phase 3: Empirical AI-usability measurement

#### Manual

- [x] 3.1 Explicit live permission granted to run the script against the real Anthropic API — fd8ca1c
- [x] 3.2 Script run once, producing usable-output rate, average latency, and estimated cost — fd8ca1c
- [x] 3.3 Script and temporary output discarded — nothing committed — fd8ca1c

### Phase 4: Close out test-plan.md bookkeeping

#### Automated

- [x] 4.1 `grep "| 2 | AI usability" context/foundation/test-plan.md` shows Phase 2's Status as `complete` — ec8c925

#### Manual

- [x] 4.2 Updated §5/§6 sections read accurately against what shipped, including Phase 3's real measured numbers
