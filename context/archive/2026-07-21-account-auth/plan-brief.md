# Account Auth — Plan Brief

> Full plan: `context/changes/account-auth/plan.md`

## What & Why

InkLingo's backend currently trusts a header that only exists because API Gateway happens to forward it — locally, with no API Gateway in front of Fastify, auth is effectively off. This plan moves JWT verification in-app (canonical, testable, works locally), JIT-provisions a `users` row per Cognito identity, ships the first real protected endpoint (`GET /api/me`), and deletes the temporary `/api/ping` diagnostic route it replaces. It closes roadmap slice S-01 (FR-001/002/003, Access Control) on the backend — the frontend's Cognito login/logout is already built.

## Starting Point

Auth is enforced only at the API Gateway edge (`HttpUserPoolAuthorizer` on `/api/ping`); the Lambda handler just reads a forwarded header and is marked `TEMPORARY`. Cognito config (`cognitoUserPoolId`/`cognitoClientId`) already exists on `fastify.config`, the frontend already sends `Authorization: Bearer <id_token>`, and the `users` table already exists with a `cognito_sub` column — nothing writes to it yet.

## Desired End State

Every route under `routes/api/` verifies the caller's JWT before the handler runs, with zero per-route opt-in. A first-time identity gets a `users` row automatically. `GET /api/me` proves it end-to-end, returning the caller's internal id and email. `/api/ping` — route, file, and CDK authorizer — is gone entirely; its own code comment already called for this ("Remove once confirmed against a real deployed request").

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Verification architecture | In-app JWT verification is canonical | Works locally (unlike the API-Gateway-only header trust) and is unit-testable | Prior session (change.md) |
| JIT provisioning | Idempotent upsert on every authenticated request | Zero frontend orchestration, nothing can "forget" to provision | Prior session (change.md) |
| Route protection scope | Whole `routes/api/` subtree, secure by default | New routes need zero opt-in to be protected | Prior session (change.md) |
| Public-route opt-out | Deferred to v2+, not built now | No real public route exists yet to exercise it; avoid untested speculative code | Plan (this session) |
| CDK authorizer on new routes | Not extended past `/api/ping` — and now deleted, not grandfathered | Extending it would recouple "is this route secure" to an infra PR, contradicting secure-by-default; once `/api/ping` is deleted the authorizer has no route left to protect, so it's dead code | Plan (this session) |
| `/api/ping` | Deleted entirely, not cleaned up | Its own code comment already says "Remove once confirmed against a real deployed request (Phase 2)"; `/api/me`'s JIT-upsert already proves DB reachability, making a separate diagnostic route redundant | Plan (this session) |
| `/api/me` CDK routing | Explicit `addRoutes()` entry, no authorizer | This API has no catch-all route — required for prod reachability regardless of the auth-layer decision | Plan (this session) |
| Test suite timing | Ships in this change, not a fast-follow | Auth is the highest-risk surface to leave under-tested even briefly | Plan (this session) |
| Logout (FR-003) | Stateless, no server-side revocation | PRD's guardrail is data loss, not session security; standard JWT expiry is enough for MVP | Prior session (change.md) |
| Test tokens | Self-signed JWKS via `.cacheJwks()`, no live Cognito | Documented offline-testing escape hatch in `aws-jwt-verify` | Prior session (change.md) |

## Scope

**In scope:**
- Auth verification plugin + request hook cascading over `routes/api/`
- JIT user provisioning (upsert on verified request)
- `GET /api/me`; deletion of `/api/ping` (route, file, CDK route, CDK authorizer)
- CDK routing for the new endpoint
- Self-signed-JWKS automated tests + one manual real-Cognito pass

**Out of scope:**
- Public-route opt-out mechanism (deferred, see project memory)
- Server-side token revocation / logout denylist
- Dedicated one-time provisioning endpoint
- Any schema migration or frontend change

## Architecture / Approach

A Fastify plugin (`plugins/auth.ts`) builds a `CognitoJwtVerifier` from existing config. An `@fastify/autoload` `autohooks.ts` file at `routes/api/` cascades an `onRequest` hook to every nested route (requires turning on `autoHooks`/`cascadeHooks` in `app.ts`, currently off). The hook verifies the bearer token, upserts the `users` row, and decorates `request.authUser`. `/api/me` reads that decoration. `/api/ping` — file, CDK route, and CDK authorizer — is deleted outright, not cleaned up: its diagnostic purpose is now fully covered by `/api/me`. A new explicit CDK route makes `/api/me` reachable in production (no catch-all route exists), deliberately without a CDK-level authorizer — app-level verification is the sole gate everywhere now, with no legacy exception.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Auth verification plugin + hook cascade | Verifier + hook + JIT upsert | The hook cascade reaches the pre-existing `/api/ping` route immediately, not just new routes — accounted for, not a true "isolated" phase |
| 2. Wire `/api/me` + delete `/api/ping` + CDK route | Real protected endpoint; temp route, its CDK route, and its authorizer all removed | Forgetting the explicit CDK route entry means `/api/me` 404s in prod despite working locally |
| 3. Self-signed-JWKS tests + manual verification | Automated coverage of every rejection path + `/api/ping` staying 404'd, one real-Cognito pass | Test JWKS/claims not matching real Cognito token shape closely enough |

**Prerequisites:** AuthStack already deployed (it is — Cognito User Pool ID/Client ID needed for local `.env` and already baked into the Lambda's env by CDK).
**Estimated effort:** ~2-3 sessions across 3 phases.

## Open Risks & Assumptions

- Assumes `aws-jwt-verify`'s `CognitoJwtVerifier` rejects expired/tampered/wrong-issuer/wrong-audience tokens uniformly enough that a single `reply.unauthorized()` catch-all is sufficient (no need to distinguish failure modes in the response) — plausible from the library's documented design, but not verified against its installed source since it isn't a dependency yet.
- The Cognito ID token's `email` claim is confirmed present, not assumed: `infra/lib/constructs/auth-construct.ts` sets `standardAttributes: { email: { required: true } }` and the UserPoolClient's `oAuth.scopes` includes `cognito.OAuthScope.EMAIL`; the frontend requests `scope: 'openid email profile'` (`frontend/src/auth/cognito.ts:14`).

## Success Criteria (Summary)

- A logged-in user can call `/api/me` and get back their real internal id and email; an unauthenticated caller gets 401 — both locally and against the deployed API.
- Logging in twice with the same account never creates a second `users` row.
- `/api/ping` is fully gone — 404 everywhere, no route, no CDK authorizer left behind.
