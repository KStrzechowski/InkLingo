---
change_id: account-auth
title: Account auth
status: implementing
created: 2026-07-21
updated: 2026-07-22
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### /10x-plan session in progress (2026-07-22) — paused before plan.md was written

Research done (via Explore agents) confirmed:
- Auth currently enforced only at API Gateway (`HttpUserPoolAuthorizer` on `/api/ping`, `infra/lib/constructs/api-construct.ts:132-141`); Lambda just trusts a forwarded `x-amzn-request-context` header (TEMPORARY code, `backend/src/routes/api/ping/index.ts:24-28`). Nothing verifies anything locally (`npm run dev` has no API Gateway in front of it).
- Frontend already sends `Authorization: Bearer <id_token>` (`frontend/src/App.tsx:38-40`).
- `backend/src/plugins/config.ts` already has `cognitoUserPoolId`/`cognitoClientId` fields, plain env vars (Lambda gets them baked in by CDK already, `api-construct.ts:91-92`) — just needs the same two values added to local `.env`, no SSM wiring needed (they're not secrets).
- No JWT/JWKS library installed yet. Confirmed via web research that `aws-jwt-verify`'s `CognitoJwtVerifier` is the right fit, and its `.cacheJwks(jwks)` method lets tests inject a self-signed JWKS (no network, no live Cognito needed for automated tests) — `CognitoJwtVerifier` itself doesn't support overriding the JWKS URI directly, `cacheJwks()` is the documented escape hatch.
- `users` table exists (F-01), nothing inserts into it yet.

8 design questions resolved:
1. **Verification architecture**: in-app JWT verification is canonical (works locally + testable); keep the existing CDK `HttpUserPoolAuthorizer` on `/api/ping` untouched (free, zero infra risk, defense-in-depth). Confirmed API Gateway JWT authorizers on HTTP APIs have no separate billing (unlike Lambda authorizers) — cost was not a factor.
2. **JIT user-provisioning**: idempotent upsert (`INSERT INTO users (cognito_sub) VALUES ($1) ON CONFLICT (cognito_sub) DO NOTHING`) inside the auth hook, on every authenticated request. Accepted as a "good enough for now" call — see memory note `account-auth-jit-provisioning-perf-note` (revisit if request-path perf work ever happens; switching to a dedicated one-time endpoint later needs no schema change).
3. **Route scope**: one hook protects the entire `routes/api/` autoloaded context (cascades to nested routes via Fastify encapsulation); `/health` stays outside it, unauthenticated, exactly as today. No public-route opt-out mechanism built now (nothing needs it yet — add a `config: { public: true }` check later if/when a real free route shows up).
4. **Proof route**: new `GET /api/me` — returns internal user id + email if authenticated, 401 otherwise.
5. **Testing strategy**: self-signed JWKS test helper (mint valid/expired/tampered-signature/wrong-issuer/wrong-audience tokens, inject via `cacheJwks()`) for the automated suite, plus one manual check logging into the real app with a real Cognito test account.
6. **Error shape**: `@fastify/sensible`'s `reply.unauthorized()` (already installed, standard `{statusCode: 401, error, message}` shape).
7. **`/api/ping` cleanup**: replace its TEMPORARY header-trusting code with the new verified-identity decorator (it falls under `routes/api/` so it gets the hook automatically).
8. **Logout (FR-003)**: stateless — no server-side token revocation. Cognito hosted-UI logout + natural JWT expiry is enough for now. Flagged for future reconsideration — see memory note `account-auth-logout-revocation-note`.

Proposed 3-phase structure (not yet confirmed): (1) JWT verification plugin + JIT provisioning, (2) wire into `/api/me` + clean up `/api/ping`, (3) self-signed-JWKS tests + manual check. User paused right after seeing this breakdown, before confirming — **resume `/10x-plan account-auth` and re-confirm the phase breakdown before writing `plan.md`.**
