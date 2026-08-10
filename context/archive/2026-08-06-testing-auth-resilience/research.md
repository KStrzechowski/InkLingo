---
date: 2026-08-06T13:43:39+00:00
researcher: Claude
git_commit: 1502edfdb9d4bfa9fd71372cae6c865df96dd279
branch: main
repository: KStrzechowski/InkLingo
topic: "Auth resilience (test-plan §3 Phase 3) — current token-renewal state, authorizer/CORS split, and Vitest bootstrap groundwork"
tags: [research, codebase, frontend, auth, cognito, vitest, testing]
status: complete
last_updated: 2026-08-06
last_updated_by: Claude
---

# Research: Auth resilience (test-plan.md §3 Phase 3)

**Date**: 2026-08-06T13:43:39+00:00
**Researcher**: Claude
**Git Commit**: 1502edfdb9d4bfa9fd71372cae6c865df96dd279
**Branch**: main
**Repository**: KStrzechowski/InkLingo

## Research Question

Phase 3 of the frozen test-plan rollout (`context/foundation/test-plan.md` §3) targets Risk #4: "An expired or invalid auth token is sent with a request and the failure surfaces as an opaque CORS error instead of a clean re-authentication prompt." The phase's stated test type is "frontend unit/integration tests (bootstraps Vitest for `frontend/`)." Before planning: what is the current state of the token-renewal logic this phase is supposed to protect, what's the exact backend/infra split that causes the CORS-masking failure mode, and what groundwork exists (or doesn't) for bootstrapping Vitest in `frontend/`?

## Summary

**The bug Risk #4 describes is already fixed on `main`.** Commit `3294830` (`fix(auth): renew the expired id_token instead of sending it`) shipped the exact remediation `context/foundation/lessons.md`'s "An expired token reads as a CORS failure, not a 401" entry recommends — before that lesson entry was even committed (`bd25fb6` documents the incident one commit later). Every piece of the recommended fix is present and unchanged as of `HEAD`:

| Recommendation | Status | Location |
|---|---|---|
| Never attach a stored token without checking `.expired` first | **Present** | `frontend/src/auth/cognito.ts:51` |
| Renew via `signinSilent()` when expired | **Present** | `frontend/src/auth/cognito.ts:56` |
| Dedupe concurrent renewal calls | **Present** | `frontend/src/auth/cognito.ts:47,56` (`renewal ??=` pattern) |
| Drop session on a 401 that survives renewal | **Present** | `frontend/src/api/client.ts:25-33` |

This reframes Phase 3: it is not "implement the fix," it's "add the automated coverage that was never written for a fix that already shipped" — structurally identical to how Phase 2 (`testing-ai-usability-cross-user-isolation`) found IDOR protection already in place and needed a regression guard, not new protection. `frontend/` currently has **zero** test infrastructure — no test script, no Vitest/testing-library/jsdom dependency, no `*.test.ts(x)` files anywhere — so this phase's first job is the Vitest bootstrap the test-plan already names, then coverage for the four rows above.

One genuine open question survives the fix: the current renewal logic only catches tokens the client can **locally** detect as expired (`user.expired`, a clock-based check). A token the Cognito-backed Gateway authorizer rejects for a different reason (revoked, tampered, clock skew, wrong audience) is never proactively renewed client-side, and would still hit the original CORS-masking failure mode — because a CORS-blocked response gives the browser no readable status code, so `client.ts`'s response interceptor (`error.response?.status === 401`) can never fire on it. This is not a bug in what shipped; it's a residual gap the *invalid* half of Risk #4's title ("expired **or invalid**") still names. Worth a planning-time decision on whether it's in scope.

## Detailed Findings

### Frontend token/auth handling (already fixed)

- `frontend/src/auth/cognito.ts:9-21` — `UserManager` config: `response_type: 'code'`, scope `openid email profile`, `userStore: new WebStorageStateStore({ store: window.localStorage })`, `automaticSilentRenew: true` (covers a token expiring while the tab stays open; doesn't cover the "reopened the next day" case the incident hit).
- `frontend/src/auth/cognito.ts:49-68` — `getFreshUser()`: returns the cached user if `!user.expired` (line 51); otherwise calls `signinSilent()` (line 56) behind a module-level `renewal ??= ...` promise so concurrent callers share one in-flight renewal; on renewal failure calls `removeUser()` (line 61) and returns `null`. The raw, expiry-unaware `getUser()` (lines 31-33) still exists but is no longer used on the request path.
- `frontend/src/auth/AuthContext.tsx:13-15` — `AuthProvider.refresh` calls `getFreshUser()`, not `getUser()`, specifically to avoid rendering the signed-in shell around a dead token (the exact symptom from the 2026-08-04 incident). Lines 24-33 subscribe to `userManager.events.addUserLoaded`/`addUserUnloaded` so both timer-driven silent renewal and interceptor-driven `removeUser()` calls propagate into React state.
- `frontend/src/api/client.ts:9-18` — request interceptor calls `getFreshUser()` and attaches `Authorization: Bearer ${user.id_token}` only when a user comes back.
- `frontend/src/api/client.ts:25-33` — response interceptor: on `axios.isAxiosError(error) && error.response?.status === 401`, calls `removeUser()` before rejecting, so a 401 surviving renewal drops the session.
- No other file under `frontend/src/` references `signinSilent`, `.expired`, `removeUser`, or `getFreshUser` — the whole mechanism is confined to these three files.

### Backend/infra authorizer + CORS split (confirms the lesson is still accurate)

- `infra/lib/constructs/api-construct.ts:105-127` unchanged since the incident — `defaultAuthorizer: authorizer` (line 117) where `authorizer` is `new HttpUserPoolAuthorizer('CognitoAuthorizer', userPool, { userPoolClients: [userPoolClient] })`; `corsPreflight` (lines 118-127) sets `allowOrigins`/`allowMethods`/`allowHeaders`. Two later commits (`8da3a52`, `8d28e70`) only appended new `addRoutes` entries — neither touched this block.
- **The split that causes the masking**: `HttpUserPoolAuthorizer` runs before the Lambda integration and generates its own rejection independently of `corsPreflight`, which only governs responses that actually reach the Lambda/Fastify app. HTTP APIs (unlike REST APIs) have no `GatewayResponses` mechanism to attach CORS headers to an authorizer-level rejection — so an authorizer-rejected request has genuinely no way to carry CORS headers back, by design of the AWS primitive, not a misconfiguration.
- `backend/src/plugins/auth.ts:17-23` is a **second, independent** JWT check that only runs if a request clears the Gateway authorizer and reaches Lambda — a rejection here is a normal Fastify response and gets `@fastify/cors` headers via `backend/src/plugins/cors.ts:8-11` before leaving Lambda. So there are two distinct 401 shapes in this system: a Gateway-authorizer 401 (no CORS headers, looks like a CORS failure in the browser) and a backend-plugin 401 (clean, has CORS headers) — only the former is the bug class Risk #4 names.
- `idTokenValidity`/`tokenValidity` still appears nowhere in `infra/` — Cognito ID tokens still default to 1 hour validity, unchanged.

### Vitest bootstrap groundwork

- `frontend/package.json` — scripts are only `dev`/`build`/`lint`/`preview`; no test script; no Vitest/testing-library/jsdom in dependencies or devDependencies today.
- `frontend/vite.config.ts` (8 lines) — only `plugins: [react()]`, no aliases, no existing `test` block — a Vitest config has no existing complexity to reconcile with.
- `frontend/tsconfig.json` uses project references (`tsconfig.app.json` + `tsconfig.node.json`), neither sets `"strict": true` explicitly, and `tsconfig.app.json` sets `verbatimModuleSyntax: true` — test files must use type-only import syntax where applicable. A test tsconfig needs its own `types` entry (e.g. `vitest/globals`) and either a third project reference or inclusion in `tsconfig.app.json`.
- `frontend/.oxlintrc.json` (9 lines) — only `react/rules-of-hooks` and `react/only-export-components` rules; no test-file overrides or Vitest-global awareness configured today.
- `frontend/src/auth/cognito.ts:3-7` reads `import.meta.env.VITE_COGNITO_*` at **module load time**, not lazily — any Vitest setup must stub `import.meta.env` (a mode-specific env file or a setup-file stub) *before* the module is imported, or provide a `.env.test`. No `.env.example`/`.env.test` exists today; only `.env.development`/`.env.production`.
- Backend's analogous conventions (different runner, same shape to mirror): `backend/test/helper.ts` builds one full app instance per test via `build(t)`, registering `t.after()` teardown; `backend/test/helpers/` holds fixture/stub factories (`fixtures.ts`, `jwks.ts`, `anthropic.ts`, `routes.ts`); `backend/test/tsconfig.json` extends the root config and adds its own `include`. A frontend equivalent would be `frontend/test/helpers/` (or colocated `*.test.tsx`) with a mock `UserManager`/`User` fixture factory for auth tests, plus a test tsconfig following the same extend-and-include pattern.
- `frontend/src/auth/` contains exactly three files: `cognito.ts`, `AuthContext.tsx`, `useAuth.ts` — the entire surface this phase needs coverage for.

## Code References

- `frontend/src/auth/cognito.ts:9-21` - `UserManager` config, `automaticSilentRenew: true`
- `frontend/src/auth/cognito.ts:49-68` - `getFreshUser()`: expiry check, deduped `signinSilent()` renewal, `removeUser()` fallback
- `frontend/src/auth/AuthContext.tsx:13-15,24-33` - bootstraps from `getFreshUser()`, subscribes to userLoaded/userUnloaded
- `frontend/src/api/client.ts:9-18` - request interceptor attaches token via `getFreshUser()`
- `frontend/src/api/client.ts:25-33` - response interceptor drops session on a 401 surviving renewal
- `infra/lib/constructs/api-construct.ts:105-127` - `defaultAuthorizer` + `corsPreflight`, unchanged since the incident
- `backend/src/plugins/auth.ts:17-23` - second, independent JWT check inside Lambda (produces CORS-clean 401s)
- `backend/src/plugins/cors.ts:8-11` - `@fastify/cors` registration, irrelevant to Gateway-authorizer rejections
- `frontend/package.json:6-11` - no test script; no test dependencies
- `frontend/vite.config.ts` - minimal config, no existing complexity for a Vitest config to reconcile with
- `backend/test/helper.ts:24-38` - `build(t)` per-test app + teardown pattern to mirror structurally

## Architecture Insights

- The CORS-masking failure mode is a structural property of API Gateway HTTP APIs (no `GatewayResponses` equivalent for authorizer rejections), not a fixable misconfiguration — the only lever is never sending a token the authorizer would reject, which is exactly what the shipped fix does for the *locally-detectable-expired* case.
- Two independent 401-producing layers exist in this system (Gateway `HttpUserPoolAuthorizer` vs. backend `plugins/auth.ts`) with different CORS-header behavior — any test plan for this risk needs to be explicit about which layer it's exercising, since only the Gateway layer reproduces the original incident.
- The extension (`extension/`) uses a completely separate auth mechanism (`browser.identity.launchWebAuthFlow` + PKCE, `browser.storage.local`, its own `exp`-claim-based refresh check per `context/archive/2026-07-25-capture-translate-save/plan.md:253-255`) — architecturally unrelated to `oidc-client-ts`/`signinSilent()` and untouched by `3294830`. Test-plan.md scopes extension test-runner bootstrapping to a later, separate phase (§3 Phase 5), and Risk #4's own incident was web-app-specific — the extension is very likely out of this phase's scope, but wasn't explicitly ruled out anywhere.

## Historical Context (from prior changes)

- `context/archive/2026-08-05-testing-backend-ci-safety-net/` and `context/archive/2026-08-05-testing-ai-usability-cross-user-isolation/` - the two prior rollout phases, both of which found their target risk's runtime protection already substantially in place and pivoted to closing the regression-coverage gap rather than building new protection. This phase follows the same shape.
- `context/archive/2026-07-21-account-auth/plan.md` - established JIT upsert-per-request provisioning (accepted as-is), stateless logout with no server-side revocation (deferred), and no public-route opt-out (deferred to v2+). Explicitly backend-only — "No frontend changes — App.tsx already sends the bearer token correctly" — so it predates and doesn't touch the client-side renewal logic `3294830` later added.
- `context/archive/2026-07-23-word-collections/plan.md` - introduced the original `AuthContext`/`useAuth()` and axios `apiClient` interceptor pattern, using plain `getUser()` (no freshness check) — this is the pre-fix state `3294830` replaced.
- `context/foundation/lessons.md` ("An expired token reads as a CORS failure, not a 401") - the incident writeup this phase's Risk #4 traces to; committed one commit after the fix itself (`bd25fb6` vs `3294830`).

## Related Research

- `context/archive/2026-08-05-testing-backend-ci-safety-net/research.md` - prior rollout-phase research, same document shape
- `context/archive/2026-08-05-testing-ai-usability-cross-user-isolation/plan.md` - prior phase's plan, structurally analogous ("protection already exists, add regression coverage")

## Open Questions

1. **Is the "invalid but not locally-expired token" gap in scope for this phase?** The shipped fix only catches tokens the client can detect as expired via `.expired`. A Gateway-authorizer rejection for any other reason (revoked, tampered, clock skew) still produces an unreadable CORS-blocked response client-side, since `error.response` is undefined for a CORS-blocked request — the existing 401-drop logic in `client.ts:25-33` can't fire on it. This is a real residual gap, not a test-coverage question; it may warrant its own risk/backlog item rather than blocking this phase's test-writing goal.
2. **Is the extension in scope?** Its auth mechanism is separate and unverified against the same class of bug, but test-plan.md scopes it to Phase 5 (§3), and Risk #4's own incident was web-app-only.
3. **What real assertion is achievable for the `automaticSilentRenew` timer-driven path** (as opposed to the on-demand `getFreshUser()` path, which is directly testable) — oidc-client-ts's internal timer isn't trivially triggerable in a unit test; may need to be scoped out or handled with fake timers.
