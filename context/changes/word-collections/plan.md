# Word Collections (S-02) Implementation Plan

## Overview

Implement FR-004 (create a named collection) and FR-005 (browse the list of a user's collections and each one's contents) on top of the already-shipped auth (S-01) and schema (F-01) foundations. Adds 3 backend endpoints, the CDK wiring to expose them, and a frontend that goes from a single static `App.tsx` to a routed, multi-page authenticated app.

## Current State Analysis

- Both prerequisites are done and archived: auth (`account-auth`) decorates every request under `routes/api/` with `request.authUser` via a cascading autoload hook; the schema (`minimal-database`) already has `collections` and `entries` tables with no application code using them yet.
- No route in this repo currently registers more than one HTTP method, and no route queries `fastify.sql` directly from a handler (the one production `fastify.sql` call lives in the auth hook, not a route) — this plan's backend phase breaks new ground on both fronts, so conventions are decided here rather than followed.
- `entries` has no `user_id` column — ownership only flows through `entries.collection_id → collections.user_id`. Any query for "this collection's contents" must check `collections.user_id` first.
- CDK's `ApiConstruct` registers routes explicitly (no `{proxy+}` catch-all) and its CORS preflight currently allows only `GET, OPTIONS` — both need updating for the new routes, and the CORS gap in particular is invisible in local dev (`npm run dev` has no API Gateway in front of it) so it only surfaces once deployed.
- The frontend is a single 73-line `App.tsx` with no router, no shared API client, no data-fetching library, and no auth context — `cognito.ts`'s `getUser()`/`login()`/`logout()` are called directly and imperatively from that one file.

### Key Discoveries:

- `backend/src/routes/api/autohooks.ts:38` — `request.authUser = { id, cognitoSub, email }`, the accessor every new route uses for the internal `users.id`.
- `backend/src/app.ts:39-45` — the routes `AutoLoad` registration does not set `routeParams: true`, so `@fastify/autoload`'s underscore-folder (`_id`) dynamic-route convention is **not** active in this project; a folder named `_id` would not become `:id` today.
- `backend/migrations/1784584360698_create-core-schema.ts:14-39` — exact current schema for `collections` and `entries` (see research.md for full column list).
- `backend/src/plugins/sensible.ts` — `@fastify/sensible` is registered with no customization, so `reply.notFound()` / `reply.conflict()` / `reply.badRequest()` are all available.
- `infra/lib/constructs/api-construct.ts:99` — `corsPreflight.allowMethods` is `[GET, OPTIONS]` only. `infra/lib/constructs/api-construct.ts:116-129` — the explicit-route pattern to mirror (`/health`, `/api/me`), including the comment that no CDK-level authorizer is used for `/api/me` since app-level JWT verification is the sole gate.
- `infra/package.json` — `diff:api` script (`cdk diff InkLingo-ApiStack -c stack=ApiStack`) already exists and was used by account-auth to verify its own route change; reused here unchanged.
- `frontend/src/App.tsx:16` — today's Cognito `/callback` handling is a manual `window.location.pathname === '/callback'` check, done *before* the login-gate conditional (i.e. the callback must render regardless of auth state) — this ordering constraint carries over into the routed version.
- `frontend/package.json` — confirmed no router, no axios/data-fetching library, no `components/`/`pages/`/`api/` folders exist yet.

## Desired End State

A logged-in user can create a named collection (rejecting blank, over-length, or duplicate-for-that-user names with a clear error), see the list of their own collections, and open one to see its entries — each entry showing its translations and example sentences once S-03 starts populating them (today that list will typically be empty, which the UI must handle as a normal state, not an error).

**Verification**: backend automated tests cover ownership, validation, duplicate-detection, and nested-response shape; a manual pass confirms the deployed CDK routes work (not just local dev) and that the frontend's existing login/logout/call-API flow still works after being moved onto a router, before the new collections pages are exercised end-to-end.

## What We're NOT Doing

- Not building entry creation — `entries`/`entry_translations`/`entry_sentences` stay empty except for manually-inserted test fixtures; that's S-03 (`capture-translate-save`).
- Not implementing collection rename or delete — FR-004/FR-005 only require create + browse.
- Not adding automated frontend tests — deferred to the project's `/10x-test-plan` phase; this slice's frontend is verified manually.
- Not building a "last used collection" default (that's FR-013, part of S-03's save flow).
- Not adding collection sharing or multi-user access — the PRD's flat access model (owner-only) applies as-is.
- Not adding pagination to either the collections list or an entries list — out of scope at MVP scale.

## Implementation Approach

Backend first (routes + the DB constraint they depend on), then the CDK wiring those routes need to be reachable once deployed, then the frontend — split into a routing/infrastructure phase (which must not change any existing user-visible behavior) followed by the actual collections UI built on top of it. Each phase's automated verification reuses established conventions from account-auth/minimal-database rather than introducing new ones (same `build(t)` + JWKS test helper, same `node-pg-migrate` tooling, same explicit-CDK-route pattern).

## Critical Implementation Details

- **IDOR risk on `GET /:id`**: because `entries` has no `user_id`, the handler must confirm `collections.user_id = request.authUser.id` before returning anything, and must return the same 404 for "doesn't exist" and "exists but belongs to someone else" — never a distinguishable 403, which would confirm the collection's existence to a non-owner.
- **JSON-schema validation doesn't catch whitespace-only names**: Fastify's `minLength: 1` on the raw request body passes for a string like `"   "` (length 3, not empty). The handler must trim before its own non-empty check, independent of the schema.
- **Race-safe duplicate detection**: don't rely solely on a "check if a collection with this name exists, then insert" query — two near-simultaneous requests can both pass that check before either inserts. The migration's unique index is what actually guarantees no duplicates; the route handler's job is to catch the resulting Postgres unique-violation (error code `23505`) and turn it into a 409, not to prevent it by querying first.
- **CORS is invisible locally**: `npm run dev` has no API Gateway in front of it, so a missing `POST` in `corsPreflight.allowMethods` will not surface until the frontend is tested against a deployed backend. Phase 2's manual verification exists specifically to catch this before it ships.
- **`/callback` must stay reachable regardless of auth state**: today's manual pathname check runs before the login-gate conditional; the routed version must preserve that — the `/callback` route sits outside whatever wrapper gates `/` and `/collections/:id` behind a logged-in check.

## Phase 1: Backend — collections routes

### Overview

Add the DB constraint the "no duplicate names" rule depends on, then implement list/create/get-with-contents, then cover all of it with tests using the already-established JWKS test helper.

### Changes Required:

#### 1. Uniqueness migration

**File**: `backend/migrations/<timestamp>_add-collections-name-uniqueness.ts`

**Intent**: Enforce "a user cannot have two collections with the same name (case-insensitive)" at the database level, so it holds even under concurrent create requests.

**Contract**: A unique index on `collections` over `(user_id, lower(name))`, named `collections_user_id_lower_name_key`. Corresponding `down` drops the index. Follows the same `node-pg-migrate` file convention as `backend/migrations/1784584360698_create-core-schema.ts`.

#### 2. Collections routes

**File**: `backend/src/routes/api/collections/index.ts`

**Intent**: List the authenticated user's collections, create a new one, and fetch one collection with its full contents (entries + their translations + their example sentences). Auth is already handled by the cascading hook — this file is pure business logic.

**Contract**:

- `GET /` → `{ collections: [{ id, name, createdAt }] }`, filtered by `request.authUser.id`, ordered by `name` ascending.
- `POST /` → body schema `{ name: string, minLength: 1, maxLength: 100 }` (Fastify JSON-schema validation, required); handler trims the name and re-checks non-empty (see Critical Implementation Details) before inserting; success → 201 `{ id, name, createdAt }`; Postgres unique-violation (`23505`) → `reply.conflict()`; post-trim empty → `reply.badRequest()`.
- `GET /:id` → verifies `collections.id = :id AND collections.user_id = request.authUser.id`; no match → `reply.notFound()` (same response whether the id doesn't exist or belongs to another user); match → 200 `{ id, name, createdAt, entries: [{ id, wordOrPhrase, sourceLanguageCode, createdAt, translations: [{ id, languageCode, meaningText }], sentences: [{ id, languageCode, sentenceText, createdAt }] }] }`, entries ordered by `createdAt` descending. Fetch entries, then their translations and sentences batched by `entry_id = ANY(...)` (not one query per entry), and assemble in the handler.
- All three query `fastify.sql` via the tagged-template form, matching the one existing production precedent (`autohooks.ts`) rather than the `.query()` form used only in tests.
- Response fields are camelCase (translated from the schema's snake_case columns in the handler) — no existing multi-word-field precedent to follow, chosen for JS/TS idiom consistency with the frontend that will consume it.

#### 3. Tests

**File**: `backend/test/routes/api/collections.test.ts`

**Intent**: Prove ownership enforcement, validation, race-safe duplicate detection, and the nested response shape, using the same pattern as `test/routes/api/me.test.ts`.

**Contract**: `build(t)` + `app.jwtVerifier.cacheJwks(jwks)` + `signToken()`, per the established pattern. Cases: empty list for a fresh user; created collection appears in a subsequent list call; duplicate name for the same user (case-insensitive) → 409; blank/whitespace-only name → 400; over-max-length name → 400; `GET /:id` for a collection owned by a different user → 404; `GET /:id` returns correctly nested translations/sentences for an entry that has more than one of each (insert fixtures directly via `fastify.sql`/`.query()`, mirroring `test/schema/core-schema.test.ts`'s fixture style, since entry creation isn't built yet).

### Success Criteria:

#### Automated Verification:

- [ ] Migration applies and reverses cleanly: `cd backend && npm run migrate:up` then `npm run migrate:down` then `npm run migrate:up` again
- [ ] Type checking passes: `cd backend && npm run build:ts`
- [ ] Full backend test suite passes: `cd backend && npm test`

#### Manual Verification:

- [ ] Inspect the new unique index in a Postgres client after `migrate:up` and confirm it matches the contract
- [ ] Hit all 3 endpoints locally (`npm run dev`) with a real Cognito test token and confirm response shapes match the contract above

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Infra — CDK route registration

### Overview

Register the 3 new routes in API Gateway and fix the CORS gap, so the endpoints Phase 1 built are actually reachable (and callable cross-origin) once deployed — not just locally.

### Changes Required:

#### 1. API Gateway routes + CORS

**File**: `infra/lib/constructs/api-construct.ts`

**Intent**: Expose the 3 collections endpoints the same way `/api/me` is exposed today (explicit route, no CDK-level authorizer, same Lambda integration), and extend CORS so the frontend's `POST` call isn't rejected pre-flight.

**Contract**: Two new `this.httpApi.addRoutes(...)` calls — `path: '/api/collections', methods: [GET, POST]` and `path: '/api/collections/{id}', methods: [GET]` — both reusing the existing `integration`. Extend `corsPreflight.allowMethods` to include `apigatewayv2.CorsHttpMethod.POST` alongside the existing `GET`/`OPTIONS`.

### Success Criteria:

#### Automated Verification:

- [ ] Infra type checking passes: `cd infra && npm run build`
- [ ] CDK synthesizes cleanly: `cd infra && npx cdk synth InkLingo-ApiStack -c stack=ApiStack`

#### Manual Verification:

- [ ] `cd infra && npm run diff:api` shows exactly the 2 new routes added and the CORS method list updated to include `POST`, nothing else

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Frontend — routing & API infrastructure

### Overview

Move `App.tsx` onto `react-router` and introduce the axios client, without changing any user-visible behavior yet — today's login/logout/call-API flow must work identically afterward, just routed through the new structure. No new user-facing feature lands in this phase.

### Changes Required:

#### 1. Dependencies

**File**: `frontend/package.json`

**Intent**: Add the router and HTTP client this feature (and future roadmap slices) will build on.

**Contract**: New `dependencies` entries for `react-router` and `axios`.

#### 2. Router shell

**File**: `frontend/src/main.tsx`

**Intent**: Wrap the app in the router.

**Contract**: `<BrowserRouter>` wraps `<App />`.

#### 3. Auth context

**File**: `frontend/src/auth/AuthContext.tsx`

**Intent**: Let every route component read the current Cognito user without each one calling `getUser()` independently — necessary now that there's more than one authenticated page.

**Contract**: A React context + `useAuth()` hook exposing `{ user, loading }`, backed by `cognito.ts`'s `getUser()`, initialized once at the provider and refreshed after `handleLoginCallback()` completes.

#### 4. App shell rewrite

**File**: `frontend/src/App.tsx`

**Intent**: Become the router shell instead of one monolithic conditional component: today's login-button / signed-in-panel behavior stays exactly as-is, now rendered inside a route rather than inline.

**Contract**: `<Routes>` with `/callback` (a small `CallbackPage`, unconditionally reachable — see Critical Implementation Details) and a layout/wrapper covering `/` that applies today's existing loading/logged-out/logged-in gating logic unchanged. `/` keeps rendering exactly the same "Call API" panel as today.

#### 5. Axios client

**File**: `frontend/src/api/client.ts`

**Intent**: One shared axios instance every API call in the app uses, so the Bearer token is attached automatically instead of per call-site.

**Contract**: `axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL })` with a request interceptor that reads the current user (via `useAuth`'s state or `getUser()`) and sets `Authorization: Bearer <id_token>`, exported as `apiClient`. The existing inline `fetch('/api/me')` call in `App.tsx` is migrated to use `apiClient` too, so there is exactly one way tokens get attached across the app.

### Success Criteria:

#### Automated Verification:

- [ ] Build passes: `cd frontend && npm run build`
- [ ] Lint passes: `cd frontend && npm run lint`

#### Manual Verification:

- [ ] `npm run dev`: log in, confirm the existing "Call API" button still successfully hits `/api/me` through the new axios client
- [ ] Log out, log back in, confirm the Cognito `/callback` redirect still completes correctly through the new route

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Frontend — collections UI

### Overview

Build the actual user-facing feature — create + browse collections — on top of Phase 3's routing and API-client infrastructure.

### Changes Required:

#### 1. Collections API wrapper

**File**: `frontend/src/api/collections.ts`

**Intent**: Typed functions for the 3 backend endpoints, so page components don't construct requests by hand.

**Contract**: `listCollections()`, `createCollection(name: string)`, `getCollection(id: string)`, each using `apiClient` from Phase 3. Local TypeScript interfaces mirror the backend's camelCase response shapes (there is no shared-types package between the two apps, so these are hand-written, not imported).

#### 2. Collections list page

**File**: `frontend/src/pages/CollectionsListPage.tsx`

**Intent**: The `/` route's authenticated content — replaces today's placeholder "Call API" panel with the real feature.

**Contract**: On mount, calls `listCollections()`. A name input + submit button calls `createCollection`; on success, appends the new collection to local state; on failure (400/409), surfaces the server's error message inline. Each listed collection links to `/collections/:id`.

#### 3. Collection detail page

**File**: `frontend/src/pages/CollectionDetailPage.tsx`

**Intent**: The `/collections/:id` route's content.

**Contract**: Reads `id` via `useParams`, calls `getCollection(id)` on mount. Renders the collection's name and its entries (word/phrase, translations, sentences); an empty `entries` array renders an explicit "no entries yet" message, not a blank page. A 404 response renders a "collection not found" message rather than throwing.

#### 4. Route registration

**File**: `frontend/src/App.tsx`

**Intent**: Wire the two new pages into the router built in Phase 3.

**Contract**: `/` → `CollectionsListPage`, `/collections/:id` → `CollectionDetailPage`, both inside the same logged-in-gated layout `/callback` sits outside of.

### Success Criteria:

#### Automated Verification:

- [ ] Build passes: `cd frontend && npm run build`
- [ ] Lint passes: `cd frontend && npm run lint`

#### Manual Verification:

- [ ] Log in, create a collection, see it appear in the list
- [ ] Attempt to create a duplicate name and see the inline error
- [ ] Attempt to create a blank name and see the inline error
- [ ] Click into a collection with no entries and see the empty-state message
- [ ] After manually inserting a test entry + translation + sentence via a Postgres client, click into that collection and confirm the nested data renders correctly

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- None beyond Phase 1's route-level tests — no frontend unit-test infrastructure exists yet; introducing it is explicitly deferred to `/10x-test-plan`.

### Integration Tests:

- `backend/test/routes/api/collections.test.ts` is the integration layer: a real Fastify app (`build(t)`), a real (self-signed test) JWT, and real SQL against `fastify.sql` — proving auth, ownership, validation, duplicate-detection, and nested-response shape all hold together, not just in isolation.

### Manual Testing Steps:

1. Run `npm run migrate:up`, confirm the new unique index in a Postgres client.
2. Hit all 3 endpoints locally with a real Cognito test token; confirm shapes.
3. `cd infra && npm run diff:api`; confirm the exact expected route/CORS diff.
4. In the frontend, verify login/logout/call-API still work after the router migration, before touching the new pages.
5. Exercise the full collections UI: create, duplicate-name error, blank-name error, empty-collection view, populated-collection view (via manually inserted fixtures).

## Performance Considerations

`GET /:id` fetches entries and their translations/sentences via a fixed small number of queries (batched by `entry_id = ANY(...)`, not one query per entry), so response time doesn't scale with entry count in a way that matters at MVP volume. All join columns (`collections.user_id`, `entries.collection_id`, `entry_translations.entry_id`, `entry_sentences.entry_id`) are already indexed by the F-01 migration.

## Migration Notes

The new migration only adds an index — `collections` has no rows in any environment yet (nothing has written to it before this change), so there is no existing data to reconcile against the new uniqueness constraint.

## References

- Research: `context/changes/word-collections/research.md`
- Prior migration convention: `backend/migrations/1784584360698_create-core-schema.ts`
- Auth hook (auth is inherited, not re-implemented): `backend/src/routes/api/autohooks.ts`
- CDK route precedent: `infra/lib/constructs/api-construct.ts:116-129`
- Frontend auth wiring being extended: `frontend/src/auth/cognito.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend — collections routes

#### Automated

- [x] 1.1 Migration applies and reverses cleanly: `cd backend && npm run migrate:up` then `npm run migrate:down` then `npm run migrate:up` again — 9697432
- [x] 1.2 Type checking passes: `cd backend && npm run build:ts` — 9697432
- [x] 1.3 Full backend test suite passes: `cd backend && npm test` — 9697432

#### Manual

- [x] 1.4 Inspect the new unique index in a Postgres client after `migrate:up` and confirm it matches the contract — 9697432
- [x] 1.5 Hit all 3 endpoints locally with a real Cognito test token and confirm response shapes match the contract — 9697432

### Phase 2: Infra — CDK route registration

#### Automated

- [x] 2.1 Infra type checking passes: `cd infra && npm run build`
- [x] 2.2 CDK synthesizes cleanly: `cd infra && npx cdk synth InkLingo-ApiStack -c stack=ApiStack`

#### Manual

- [ ] 2.3 `cd infra && npm run diff:api` shows exactly the 2 new routes added and the CORS method list updated, nothing else

### Phase 3: Frontend — routing & API infrastructure

#### Automated

- [ ] 3.1 Build passes: `cd frontend && npm run build`
- [ ] 3.2 Lint passes: `cd frontend && npm run lint`

#### Manual

- [ ] 3.3 Log in, confirm the existing "Call API" button still successfully hits `/api/me` through the new axios client
- [ ] 3.4 Log out, log back in, confirm the Cognito `/callback` redirect still completes correctly through the new route

### Phase 4: Frontend — collections UI

#### Automated

- [ ] 4.1 Build passes: `cd frontend && npm run build`
- [ ] 4.2 Lint passes: `cd frontend && npm run lint`

#### Manual

- [ ] 4.3 Log in, create a collection, see it appear in the list
- [ ] 4.4 Attempt to create a duplicate name and see the inline error
- [ ] 4.5 Attempt to create a blank name and see the inline error
- [ ] 4.6 Click into a collection with no entries and see the empty-state message
- [ ] 4.7 After manually inserting a test entry + translation + sentence, click into that collection and confirm the nested data renders correctly
