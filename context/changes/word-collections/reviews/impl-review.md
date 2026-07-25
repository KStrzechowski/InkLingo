<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Word Collections (S-02) Implementation Plan

- **Plan**: context/changes/word-collections/plan.md
- **Scope**: Phase 4 of 4 (full plan review)
- **Date**: 2026-07-23
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 5 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — `GET /api/collections/:id` has no schema validation on `id`, leaking a raw driver error on malformed input

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend/src/routes/api/collections/index.ts:67-75
- **Detail**: Unlike `POST /` (which declares a JSON schema on the body), `GET /:id` declares no schema for `request.params.id`. A request like `GET /api/collections/not-a-uuid` with a valid token reaches the `fastify.sql` query directly, Postgres throws `NeonDbError` code `22P02` ("invalid input syntax for type uuid"), nothing catches it, and it falls through to Fastify's default error handler as a 500 — with the raw Postgres error message serialized into the response body. Expected behavior is a clean 4xx, not a 500 that leaks a driver-level message.
- **Fix**: Add `schema: { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } } }` to the route (Fastify rejects malformed ids with 400 before touching the DB).
- **Decision**: FIXED

### F2 — `CollectionDetailPage` silently swallows non-404 errors, misreporting them as "not found"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend/src/pages/CollectionDetailPage.tsx:20-24
- **Detail**: The `.catch` only branches on `axios.isAxiosError(err) && err.response?.status === 404`. Any other failure (500, network drop, a timeout once F4 is addressed) falls through doing nothing; `.finally` still sets `loading` false, `collection` stays `null`, and the render logic (`if (notFound || !collection)`) shows "Collection not found." — indistinguishable from a real 404. A user hitting a transient server error is told to stop looking for something that in fact just failed to load, with no retry affordance. `CollectionsListPage` already has the right pattern (a generic `error` state via `extractErrorMessage`) that this sibling page doesn't reuse.
- **Fix**: Add an `error` state to `CollectionDetailPage` mirroring `CollectionsListPage`'s `extractErrorMessage`, and only show "Collection not found." specifically for the 404 case.
- **Decision**: FIXED (via a new shared `frontend/src/api/errors.ts`, imported by both pages instead of duplicating the helper — also resolves F9's pattern-gap sibling note)

### F3 — No test covers a collection with zero entries (the common current-day case)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend/test/routes/api/collections.test.ts
- **Detail**: `GET /:id` batches translations/sentences via `entry_id = ANY(${entryIds})`. No test exercises the case where `entryIds` is `[]` — exactly the state every brand-new collection is in today, since entry creation isn't built until S-03. Empty-array parameters are a known edge case for driver type-inference; this path is unverified. It was manually confirmed working (Progress 4.6), but there's no automated regression guard for it.
- **Fix**: Add a test creating a collection with zero entries and asserting `GET /:id` returns `entries: []`.
- **Decision**: FIXED (test added; full suite passes 31/31, confirming the empty-array `ANY(...)` path works as expected)

### F4 — Shared axios client has no request timeout

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend/src/api/client.ts:4-6
- **Detail**: `axios.create({ baseURL: ... })` has no `timeout`, and the request interceptor's `await getUser()` is likewise unbounded. If a request hangs (cold Lambda, stalled network), the promise never resolves or rejects, so any page relying on `.then/.catch/.finally` to end `loading` (both collections pages) stays stuck showing a loading state forever with no error and no retry option — the same failure class as the bug fixed earlier in `CollectionsListPage`, but at the transport layer instead of the promise-chaining layer.
- **Fix**: Add a `timeout` (e.g. 10000ms) to `axios.create({...})`.
- **Decision**: FIXED (used 8000ms per user preference — tighter than the initial suggestion, still comfortable above a cold-Lambda-start latency)

### F5 — Race condition: a stale `GET /:id` response can overwrite the current view after fast navigation

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend/src/pages/CollectionDetailPage.tsx:12-26
- **Detail**: The effect keys on `[id]` but has no stale-response guard. If a user navigates quickly between two collections (e.g. `A → B`) and `A`'s request resolves after `B`'s, nothing checks that `id` at resolution time still matches the `id` the fetch was for — `A`'s data can render under `B`'s URL.
- **Fix**: Capture `id` in a local const at effect-start and compare it against the current `id` before calling `setCollection`/`setNotFound` in the `.then`/`.catch`.
- **Decision**: FIXED (used a `cancelled` flag set in the effect's cleanup function — the standard React idiom, also guards against post-unmount state updates)

### F6 — `AuthContext.tsx`/`useAuth.ts` split beyond the plan's single named file

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: frontend/src/auth/AuthContext.tsx, frontend/src/auth/useAuth.ts
- **Detail**: Phase 3 named a single file (`AuthContext.tsx`). Two exist: `AuthContext.tsx` (exports only the `AuthProvider` component) and `useAuth.ts` (the context object + `useAuth()` hook). This was a deliberate, already-discussed fix for oxlint's `react/only-export-components` warning (a `.tsx` file can't mix a component export with a hook export without breaking Fast Refresh). Functionally the contract (`{user, loading}`, backed by `getUser()`, refreshed after `handleLoginCallback()`) is fully met — plus an added `refresh` function needed to satisfy the refresh requirement. Confirmed `npm run lint` is clean. No action needed; recorded here for anyone auditing the diff against the plan later.
- **Decision**: ACCEPTED-AS-RULE: "React context + hook pairs split across two files" (context/foundation/lessons.md). Re-verified against current code: `AuthContext.tsx` exports only `AuthProvider`, `useAuth.ts` exports only the context object + `useAuth()` — already matches the rule exactly, no fix needed.

### F7 — New CDK routes don't repeat the "no CDK-level authorizer" comment

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: infra/lib/constructs/api-construct.ts
- **Detail**: The `/api/me` route carries a comment explaining app-level JWT verification is the sole gate (no CDK authorizer). The two new `/api/collections` routes don't repeat or reference it, so a future reader diffing this file could momentarily wonder whether auth was forgotten.
- **Fix**: Add a one-line comment above the two new routes referencing the same rationale.
- **Decision**: SUPERSEDED — re-reading the code, the existing comment already declared its scope as "this route and every route after it," so no duplication was needed. This also led to a much bigger discussion: re-adding a CDK-level `defaultAuthorizer` (`HttpUserPoolAuthorizer`) to the `HttpApi` for defense-in-depth, reopening a deliberate account-auth decision now that `HttpApi.defaultAuthorizer` removes the original "per-route wiring is forgettable" objection. Implemented and committed separately (commit `25299fe`, `infra/lib/constructs/api-construct.ts`) since it's a cross-cutting security change, not scoped to word-collections. The stale "no CDK-level authorizer" comment on `/api/me` was rewritten as part of that commit to reflect the new reality.

### F8 — Migration would fail to apply against any pre-existing case-insensitive duplicate names

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend/migrations/1784819058952_add-collections-name-uniqueness.ts
- **Detail**: `CREATE UNIQUE INDEX` on `(user_id, lower(name))` will fail to apply if any environment already has duplicate rows. The plan's own Migration Notes assert `collections` has no rows anywhere yet, so this is a non-issue today — flagged only as a pre-deploy sanity check if that assumption ever changes.
- **Decision**: ACCEPTED-AS-RULE: "Check for pre-existing duplicates before adding a uniqueness migration" (context/foundation/lessons.md). No fix needed here — per the plan's own Migration Notes, `collections` has zero rows in any environment today.

### F9 — Test fixture helpers duplicated between `collections.test.ts` and `core-schema.test.ts`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: backend/test/routes/api/collections.test.ts, backend/test/schema/core-schema.test.ts
- **Detail**: `createUserRow`/`createCollectionRow`/`createEntryRow`-style fixture helpers are re-declared in both files rather than shared. Consistent with this codebase's current per-file-self-contained test convention, so not a violation — just a DRY opportunity if this area grows.
- **Fix**: Optional — factor into a shared test-fixture module if a third test file needs the same fixtures.
- **Decision**: PENDING

## Scope check ("What We're NOT Doing")

No violations found: no entry-creation UI, no rename/delete controls, no frontend test files, no "last used collection" logic, no sharing/multi-user UI, no pagination. The one unplanned addition — a catch-all `<Route path="*" element={<Navigate to="/" replace/>} />` in App.tsx — is benign (preserves the pre-router behavior that any unknown path still rendered the app) and not a scope violation.

## Success criteria verification

All automated checks (migration up/down/up, backend build + full test suite, infra build + synth, frontend build + lint) were run and passed during implementation (see plan.md Progress section, phase commits 9697432/36285a8/8338aa7/02838da). All manual verification items were confirmed by the user during implementation and are recorded with commit SHAs in the Progress section. No rubber-stamped items detected — each manual confirmation followed a concrete description of expected behavior discussed in-session (including one real bug found and fixed live: `CollectionsListPage`'s initial fetch was missing `.catch()`/`.finally()`, which could leave the page stuck on "Loading collections…" forever).
