# Account Auth Implementation Plan

## Overview

Move JWT verification from "trusted only by API Gateway" to "verified in-app, on every request under `routes/api/`," JIT-provision a `users` row for each Cognito identity on first sight, expose a real protected endpoint (`GET /api/me`), and delete the now-redundant `/api/ping` diagnostic route entirely — its own code comment already says "Remove once confirmed against a real deployed request (Phase 2)." This closes out roadmap slice S-01 (FR-001, FR-002, FR-003, Access Control) on the backend — the frontend already has Cognito hosted-UI login/logout wired (`frontend/src/auth/cognito.ts`, `frontend/src/App.tsx`).

## Current State Analysis

- Auth is enforced **only** at the API Gateway edge: `HttpUserPoolAuthorizer` on `/api/ping` (`infra/lib/constructs/api-construct.ts:132-141`). The Lambda handler just trusts a forwarded `x-amzn-request-context` header that API Gateway's Lambda Web Adapter injects (`backend/src/routes/api/ping/index.ts:11-33`) — explicitly marked `TEMPORARY` in the code.
- Nothing verifies anything locally: `npm run dev` runs the Fastify app directly, with no API Gateway in front of it, so the header never appears and auth is effectively off in local dev.
- The frontend already sends `Authorization: Bearer <id_token>` on every API call (`frontend/src/App.tsx:38-40`) — no frontend change needed.
- `backend/src/plugins/config.ts:11-14,53-55` already exposes `cognitoUserPoolId`/`cognitoClientId` on `fastify.config`, read from plain env vars (`COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`) — not secrets, and the deployed Lambda already gets them baked in by CDK (`infra/lib/constructs/api-construct.ts:91-92`). Local `backend/.env` currently has only `NEON_DATABASE_URL` and `ANTHROPIC_API_KEY` — the two Cognito values are missing there.
- The `users` table already exists (`backend/migrations/1784584360698_create-core-schema.ts:8-12`: `id uuid pk`, `cognito_sub text unique not null`, `created_at`) — nothing inserts into it yet.
- No JWT/JWKS verification library is installed (`backend/package.json` has neither `aws-jwt-verify`, `jose`, nor `jsonwebtoken`).
- `@fastify/autoload` registers `routes/` in `backend/src/app.ts:39-43` with no `autoHooks`/`cascadeHooks` options — both default to off.
- `@fastify/sensible` is already registered (`backend/src/plugins/sensible.ts`), giving `reply.unauthorized()` with the standard `{ statusCode, error, message }` shape.
- Tests build a full app via `test/helper.ts`'s `build(t)` and talk to the **real** configured Neon database through `app.sql` (see `backend/test/schema/core-schema.test.ts:6-17`, `backend/test/plugins/support.test.ts`), cleaning up rows in `t.after`.

### Key Discoveries:

- `infra/lib/constructs/api-construct.ts` registers routes explicitly (`httpApi.addRoutes({ path: '/api/ping', ... })`, `:123-141`) — there is no `{proxy+}` catch-all. Any new backend route (e.g. `/api/me`) needs its own explicit `addRoutes()` entry or it 404s at the gateway in production, independent of any auth question.
- `@fastify/autoload`'s hook-cascading feature (`autoHooksPattern` matches `autohooks.ts`) requires the parent `AutoLoad` registration to pass `autoHooks: true, cascadeHooks: true` — without `cascadeHooks`, a hook file at `routes/api/autohooks.ts` would apply only to files directly in `routes/api/`, not to nested route folders like `routes/api/ping/` or a future `routes/api/me/` (confirmed against `backend/node_modules/@fastify/autoload/README.md`).
- `aws-jwt-verify`'s `CognitoJwtVerifier` supports `.cacheJwks(jwks)` to inject a JWKS document directly, bypassing the network fetch to Cognito — this is the documented mechanism for testing signature/issuer/audience/expiry logic without a live Cognito call.
- Fastify v5 (installed) exposes route-level `config` via `request.routeOptions.config` inside a hook — the mechanism a future public-route opt-out would use. Not built now (see `[[account-auth-public-route-opt-out-deferred]]` in project memory) — every route under `routes/api/` is secure by default with zero opt-in needed, and there is currently no route that needs to opt out.

## Desired End State

Every request under `routes/api/` is verified against Cognito's JWKS in-app before it reaches a route handler. A first-time verified identity gets a `users` row created automatically. `GET /api/me` returns `{ id, email }` for an authenticated caller and a standard 401 otherwise. `/api/ping` is gone entirely — its diagnostic purpose (DB reachability, real Cognito claims) is now covered by `/api/me`, which itself proves DB connectivity via the JIT-upsert on every request. The CDK `HttpUserPoolAuthorizer` is deleted along with it — with no route left to protect, keeping it would be dead code. App-level JWT verification is the sole gate for every route, with no legacy exception.

Verified by: automated tests pass locally against real (self-signed, cached) JWKS material with no live Cognito dependency, and one manual pass against a real deployed Cognito test account confirms the same behavior end-to-end.

## What We're NOT Doing

- No public-route opt-out mechanism (`config: { public: true }` style) — deferred to v2+, see `[[account-auth-public-route-opt-out-deferred]]`. Nothing needs it yet.
- No CDK `HttpUserPoolAuthorizer` anywhere — app-level verification is the sole gate for every route, including the one route (`/api/ping`) that used to have it; that authorizer is deleted along with the route, not kept as a legacy exception.
- No replacement diagnostic route for `/api/ping` — `/api/me` already proves DB reachability (via the JIT-upsert) and real Cognito verification in one call; a separate ping-style check would be redundant.
- No server-side token revocation / denylist for logout (FR-003 stays stateless) — see `[[account-auth-logout-revocation-note]]`.
- No dedicated one-time provisioning endpoint — JIT upsert runs on every authenticated request, accepted as-is — see `[[account-auth-jit-provisioning-perf-note]]`.
- No schema changes — `users.cognito_sub` already exists and is exactly what's needed; `email` is read from the verified token's claims at request time, never persisted.
- No change to `/health` — it stays outside `routes/api/`, unauthenticated, exactly as today.
- No frontend changes — `App.tsx` already sends the bearer token correctly.

## Implementation Approach

Three phases, each independently mergeable: (1) the verification + provisioning plumbing; (2) wiring it to a real route and deleting the temporary one it replaces; (3) proving it with automated self-signed-JWKS tests plus one manual real-Cognito pass. This order lets phase 1 be reviewed purely on its own correctness (plugin + hook + config), phase 2 on routing/infra correctness, and phase 3 on behavioral correctness — each phase's success criteria are independently checkable.

## Critical Implementation Details

**Hook cascade wiring order**: `backend/src/app.ts`'s routes `AutoLoad` registration must gain `autoHooks: true, cascadeHooks: true` in the same commit that introduces `routes/api/autohooks.ts` — the hook file is silently inert without it (see Key Discoveries above). Easy to miss because nothing errors; requests just sail through unverified.

**Upsert-and-return-id in one round trip**: the JIT upsert needs the row's `id` back whether it was just inserted or already existed. `ON CONFLICT (cognito_sub) DO NOTHING RETURNING id` returns zero rows on a conflict (existing user), which would force a second query. Use the standard "no-op update" idiom instead — `ON CONFLICT (cognito_sub) DO UPDATE SET cognito_sub = EXCLUDED.cognito_sub RETURNING id` — which always returns exactly one row in a single statement. Same idempotent-upsert semantics as originally decided, just phrased to also always yield the id.

## Phase 1: Auth verification plugin + hook cascade

### Overview

Introduce the verifier and the request-level hook that uses it, plus JIT provisioning. No *new* route consumes it yet, but note this isn't fully isolated: `/api/ping` already exists as a nested route under `routes/api/`, so the moment `cascadeHooks: true` is turned on and `autohooks.ts` lands, the new hook cascades onto `/api/ping` immediately — it starts requiring a valid Bearer token in local dev, before Phase 2 deletes it. Harmless (its stale claims-extraction code just becomes unreachable dead weight for one phase, and production already gates it via the CDK authorizer with the same token), but worth confirming directly rather than assuming — see the added manual check below.

### Changes Required:

#### 1. Dependency

**File**: `backend/package.json`

**Intent**: Add the library that verifies Cognito-issued JWTs against the pool's JWKS, with a documented offline-testing escape hatch.

**Contract**: Add `aws-jwt-verify` to `dependencies`.

#### 2. Verifier plugin

**File**: `backend/src/plugins/auth.ts` (new)

**Intent**: Construct a `CognitoJwtVerifier` from the app's Cognito config and expose it to the rest of the app, following the same `fp`-wrapped, config-dependent decorator pattern as `backend/src/plugins/neon.ts`.

**Contract**: `fp` plugin named `'auth'` with `dependencies: ['config']`. Creates `CognitoJwtVerifier.create({ userPoolId: fastify.config.cognitoUserPoolId, tokenUse: 'id', clientId: fastify.config.cognitoClientId })` (matches the frontend, which sends `id_token` — `frontend/src/App.tsx:39`). Decorates `fastify.jwtVerifier` with the instance; augment `FastifyInstance` in a `declare module 'fastify'` block, same style as `config.ts:61-65`.

#### 3. Auth hook

**File**: `backend/src/routes/api/autohooks.ts` (new)

**Intent**: One `onRequest` hook, cascaded to every route under `routes/api/`, that rejects unverified requests and makes the caller's identity available to handlers.

**Contract**: Default-exported async plugin function. On each request: read the `Authorization` header, require a `Bearer <token>` scheme (else `reply.unauthorized()`); call `fastify.jwtVerifier.verify(token)`, catching any rejection and calling `reply.unauthorized()` (expired, tampered signature, wrong issuer, and wrong audience are all rejections the library throws for — no need to distinguish them, matches the already-decided uniform 401 error shape). On success, run the upsert described in Critical Implementation Details using the verified `sub` claim, then decorate `request.authUser = { id, cognitoSub: sub, email }` (`email` read straight from the token's `email` claim — not persisted). Augment `FastifyRequest` with `authUser` in a `declare module 'fastify'` block. DB upsert failures are deliberately *not* caught here — they propagate to Fastify's default error handler (500 via `@fastify/sensible`), which is correct: a provisioning failure isn't a bad credential and shouldn't be reported as 401.

#### 4. Hook cascade activation

**File**: `backend/src/app.ts`

**Intent**: Turn on autoload's hook-cascading so `routes/api/autohooks.ts` actually applies to nested route folders (see Critical Implementation Details).

**Contract**: Add `autoHooks: true, cascadeHooks: true` to the options object passed to the routes `AutoLoad` registration at `app.ts:39-43`. The plugins `AutoLoad` registration (`:30-34`) is unaffected — it holds no route-shaped subtrees this applies to.

#### 5. Local dev config

**File**: `backend/.env`

**Intent**: Let `npm run dev` verify real tokens locally instead of failing config validation.

**Contract**: Add `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID`, sourced from the already-deployed AuthStack (same values CDK bakes into the Lambda's environment at `infra/lib/constructs/api-construct.ts:91-92` — retrievable from the AWS Console's Cognito page or the AuthStack's CDK outputs).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `cd backend && npm run build:ts`
- Standalone plugin test passes (new test, mirrors `backend/test/plugins/support.test.ts`'s pattern of registering the plugin on a bare `Fastify()` instance and asserting the decorator exists): `cd backend && npm test`

#### Manual Verification:

- `npm run dev` starts without config errors once `backend/.env` has the two new values
- With the app running, confirm `/api/ping` now returns 401 without a token and 200 with a valid one — proof the hook cascade is actually active, ahead of Phase 2 deleting the route

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Wire `/api/me` + delete `/api/ping` + CDK route

### Overview

Give the verification plumbing an actual caller, and delete the temporary diagnostic route it replaces.

### Changes Required:

#### 1. New protected route

**File**: `backend/src/routes/api/me/index.ts` (new)

**Intent**: The proof-of-life endpoint for the whole auth flow — returns the caller's identity, sourced entirely from `request.authUser` set by the Phase 1 hook.

**Contract**: `GET /api/me` → `{ id: string; email: string | undefined }`, HTTP 200. No route-level auth code — 401 is already handled by the hook before the handler runs.

#### 2. Delete `/api/ping`

**File**: `backend/src/routes/api/ping/index.ts` (deleted)

**Intent**: Remove the temporary diagnostic route entirely — its own code comment already says "Remove once confirmed against a real deployed request (Phase 2)." `/api/me` now covers everything it was checking: real Cognito verification (the hook) and DB reachability (the JIT-upsert runs on every authenticated request, including calls to `/api/me`).

**Contract**: Delete `backend/src/routes/api/ping/` (the file and its now-empty directory). `GET /api/ping` returns 404 going forward — `@fastify/autoload` no longer finds anything to register at that path.

#### 3. CDK routing

**File**: `infra/lib/constructs/api-construct.ts`

**Intent**: Make `/api/me` reachable through API Gateway in production — required regardless of the auth-layer decision, since this API has no catch-all route — and remove the now-orphaned `/api/ping` route along with the CDK authorizer that only existed to protect it.

**Contract**: Add `httpApi.addRoutes({ path: '/api/me', methods: [apigatewayv2.HttpMethod.GET], integration })` — no `authorizer` property (app-level verification is canonical; this is the only gate going forward). Delete the existing `/api/ping` `addRoutes()` call (`:136-141`) and the `HttpUserPoolAuthorizer` construction (`:132-134`). With the authorizer gone, `userPool`/`userPoolClient` (`:49-52`) become unused — the raw `userPoolId`/`userPoolClientId` *strings* (`:40-43`) are still needed for the Lambda's environment variables (`:91-92`), but the CDK-level imported constructs built from them are not — delete those two `const` declarations along with the now-unused `HttpUserPoolAuthorizer` (`:7`) and `cognito` (`:9`) imports.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `cd backend && npm run build:ts`
- Backend test suite passes: `cd backend && npm test`
- CDK synthesizes cleanly: `cd infra && npm run build && npx cdk synth InkLingo-ApiStack -c stack=ApiStack`

#### Manual Verification:

- `cd infra && npm run diff:api` shows `/api/me` added (no authorizer), `/api/ping` and its `HttpUserPoolAuthorizer` removed, and nothing else changed

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Self-signed-JWKS automated tests + manual verification

### Overview

Prove the verification, provisioning, and cleanup behavior automatically, with no live Cognito dependency — then one manual pass against the real thing.

### Changes Required:

#### 1. Test token helper

**File**: `backend/test/helpers/jwks.ts` (new)

**Intent**: Mint a throwaway RSA keypair once per test run and issue configurably-wrong tokens against it, so tests can exercise every rejection path deterministically.

**Contract**: Uses `jose` (new devDependency — no signing library is currently installed; `aws-jwt-verify` only verifies) to generate an RS256 keypair, export a JWKS document exposing the public key, and a `signToken(overrides)` helper (`jose.SignJWT`) defaulting to a valid token (correct `iss` for the configured user pool, `token_use: 'id'`, `aud`/`client_id` matching the configured client, a fresh `sub`, an `email` claim, and a future `exp`) with each field overridable to produce the expired/wrong-issuer/wrong-audience cases. A tampered-signature case reuses a valid token with its signature segment corrupted, rather than needing a second keypair.

#### 2. `/api/me` + provisioning tests

**File**: `backend/test/routes/api/me.test.ts` (new)

**Intent**: Cover the full request path: verification, JIT provisioning and its idempotency, and the response contract.

**Contract**: Each test calls `build(t)`, then `app.jwtVerifier.cacheJwks(jwks)` from the Phase 3.1 helper before injecting requests (mirrors `backend/test/schema/core-schema.test.ts`'s pattern of asserting DB state via `app.sql`, with `t.after` cleanup). Cases: valid token → 200 with `{ id, email }` and exactly one new `users` row; same `sub` requested twice → second response reuses the same `id`, still exactly one row (idempotency); missing `Authorization` header → 401; non-`Bearer` scheme → 401; expired token → 401; tampered signature → 401; wrong issuer → 401; wrong audience → 401; `GET /api/ping` → 404 (regression guard confirming Phase 2's deletion stuck — no dedicated test file needed for one assertion).

### Success Criteria:

#### Automated Verification:

- Full backend suite passes with coverage: `cd backend && npm test`
- Type checking passes: `cd backend && npm run build:ts`

#### Manual Verification:

- Log into the deployed app with a real Cognito test account, confirm `/api/me` returns a real `id`/`email`
- Log out and back in with the same account; confirm no duplicate `users` row was created (spot-check via `psql`/Neon console or by observing the same `id` returned twice)
- Confirm a request with no token (e.g. curl without `Authorization`) gets 401 against the deployed `/api/me` API Gateway endpoint, not just locally
- Confirm `GET /api/ping` returns 404 against the deployed API Gateway endpoint — the route is fully gone, not just locally unmounted

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Auth plugin decorates `fastify.jwtVerifier` correctly (standalone, Phase 1)

### Integration Tests:

- Full request-path coverage through `/api/me` under `build(t)`, real Neon DB, self-signed JWKS (Phase 3), plus a `GET /api/ping` → 404 regression guard confirming the route stays deleted — see cases enumerated above

### Manual Testing Steps:

1. `npm run dev` locally with real Cognito config, confirm `/api/me` returns real identity when logged in via the frontend
2. Log out/in twice with the same account, confirm no duplicate DB row
3. Confirm a request with no `Authorization` header is rejected both locally and against the deployed API Gateway endpoint
4. Confirm `/api/ping` is fully gone (404) against the deployed API Gateway endpoint, not just locally

## Performance Considerations

JIT upsert adds one DB round trip to every authenticated request, forever — already reviewed and accepted, not a new consideration for this plan (see `[[account-auth-jit-provisioning-perf-note]]`).

## Migration Notes

No schema migration needed — `users.cognito_sub` already exists from the F-01 core-schema migration. This plan only activates code paths against data that migration already created.

## References

- Prior research and resolved decisions: `context/changes/account-auth/change.md`
- PRD: `context/foundation/prd.md` (FR-001, FR-002, FR-003, Access Control)
- Roadmap slice: `context/foundation/roadmap.md` (S-01)
- Temporary route being deleted (its own comment says "Remove once confirmed against a real deployed request (Phase 2)"): `backend/src/routes/api/ping/index.ts:28-30`
- CDK authorizer being deleted along with its only route: `infra/lib/constructs/api-construct.ts:132-141`
- Existing decorator/plugin pattern to follow: `backend/src/plugins/neon.ts`
- Existing DB-backed test pattern to follow: `backend/test/schema/core-schema.test.ts:6-17`
- Existing standalone-plugin test pattern to follow: `backend/test/plugins/support.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Auth verification plugin + hook cascade

#### Automated

- [x] 1.1 Type checking passes: `cd backend && npm run build:ts` — d3408a1
- [x] 1.2 Standalone plugin test passes: `cd backend && npm test` — d3408a1

#### Manual

- [x] 1.3 `npm run dev` starts without config errors with the two new `.env` values — d3408a1
- [x] 1.4 `/api/ping` returns 401 without a token and 200 with a valid one, proving the hook cascade is active — d3408a1

### Phase 2: Wire `/api/me` + delete `/api/ping` + CDK route

#### Automated

- [x] 2.1 Type checking passes: `cd backend && npm run build:ts` — b708192
- [x] 2.2 Backend test suite passes: `cd backend && npm test` — b708192
- [x] 2.3 CDK synthesizes cleanly: `cd infra && npm run build && npx cdk synth InkLingo-ApiStack -c stack=ApiStack` — b708192

#### Manual

- [x] 2.4 `cd infra && npm run diff:api` shows `/api/me` added (no authorizer) and `/api/ping` + its authorizer removed, nothing else — b708192

### Phase 3: Self-signed-JWKS automated tests + manual verification

#### Automated

- [x] 3.1 Full backend suite passes with coverage: `cd backend && npm test` — 288a6f6
- [x] 3.2 Type checking passes: `cd backend && npm run build:ts` — 288a6f6

#### Manual

- [ ] 3.3 Real Cognito test account returns correct identity from the deployed app
- [ ] 3.4 Logging out/in twice does not create a duplicate `users` row
- [ ] 3.5 Unauthenticated request is rejected against the deployed `/api/me` API Gateway endpoint
- [ ] 3.6 `GET /api/ping` returns 404 against the deployed API Gateway endpoint
