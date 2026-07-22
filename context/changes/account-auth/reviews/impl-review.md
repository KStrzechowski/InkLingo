<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Account Auth Implementation Plan

- **Plan**: context/changes/account-auth/plan.md
- **Scope**: Phase 3 of 3 (full plan)
- **Date**: 2026-07-23
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — JWT verification failures are silently swallowed with no logging

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend/src/routes/api/autohooks.ts:29-31
- **Detail**: The `catch` around `fastify.jwtVerifier.verify(token)` converts every failure into a bare 401 with zero logging. Signature/expiry/issuer/audience rejections are indistinguishable in logs from a genuine outage (e.g. Cognito's JWKS endpoint unreachable, DNS failure, misconfigured pool ID) — a real incident would just look like a spike of 401s with no breadcrumb to diagnose it.
- **Fix**: Add `fastify.log.warn({ err }, 'jwt verification failed')` (or similar) before `reply.unauthorized()` in the catch block.
- **Decision**: FIXED — log.warn added in backend/src/routes/api/autohooks.ts

### F2 — `declare module 'fastify'` augmentations are scattered per-file, creating import-order fragility

- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: backend/src/plugins/auth.ts:1-10
- **Detail**: `auth.ts` needs a type-only `import type { AppConfig } from './config.ts'` purely to force ts-node to see `config.ts`'s `FastifyInstance.config` augmentation before checking `auth.ts` — necessary because `@fastify/autoload` dynamically imports `plugins/` files alphabetically, and `auth` sorts before `config`. This is a real, correctly-diagnosed and correctly-fixed issue for this file, but the underlying fragility class remains: any future plugin whose filename sorts before the file declaring the augmentation it depends on will hit the same spurious TS2339 error.
- **Fix**: Consider centralizing all `declare module 'fastify'` blocks into one shared ambient `.d.ts` file to remove the ordering dependency entirely. Not urgent — only `auth.ts` is currently affected, and the existing workaround is well-documented in place.
- **Decision**: FIXED — centralized into `backend/src/fastify.d.ts`. Note: a `.d.ts` file matched by `tsconfig`'s `include` is NOT automatically picked up by `ts-node/esm`'s per-file dynamic-import checking the way it is by a full `tsc` build — it still needed one anchor `import type` (now pointing at `fastify.d.ts` instead of `config.ts`) from `auth.ts`, the one file with an actual ordering problem. `config.ts`/`neon.ts` no longer need any anchor at all, since centralizing removed their own local `declare module` blocks entirely.

### F3 — No test covers a wrong-`token_use` (access) token against `/api/me`

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend/test/routes/api/me.test.ts
- **Detail**: The verifier is configured with a fixed `tokenUse: 'id'`, so a syntactically valid access token would correctly fail `validateCognitoJwtFields`'s token-use check and get caught into the same uniform 401 — this is confirmed correct by inspection, but it's a distinct validation branch from the 8 cases already tested and isn't exercised by any test. This wasn't part of the plan's Phase 3 test contract, so it's not a plan violation — just a coverage gap worth a conscious decision.
- **Fix**: Add one more case mirroring the existing wrong-issuer/wrong-audience tests: `signToken({ tokenUse: 'access' })` → expect 401.
- **Decision**: PENDING
