<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Account Auth Implementation Plan

- **Plan**: context/changes/account-auth/plan.md
- **Mode**: Deep
- **Date**: 2026-07-22
- **Verdict**: REVISE
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

8/8 paths ✓, subagent-verified email claim ✓, blast radius clean ✓, no existing hook pattern to reuse ✓ (confirmed novel), brief↔plan ~ (1 staleness note, see F3)

## Findings

### F1 — Phase 1 changes /api/ping's live behavior despite claiming isolation

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Overview
- **Detail**: Phase 1's Overview says "Nothing routes to it yet... verifiable in isolation." That's not accurate: `/api/ping` already exists as a nested route under `routes/api/`, so the moment Phase 1 turns on `cascadeHooks: true` and adds `routes/api/autohooks.ts`, the new hook cascades onto `/api/ping` immediately — it now requires a valid Bearer token to be reached at all, in local dev, before Phase 2's cleanup ever lands. Not broken (the stale claims-extraction code inside ping just becomes unreachable dead weight until Phase 2 removes it, and prod already gates ping via the CDK authorizer with the same token), but Phase 1's own manual verification doesn't check for this behavior change, and the "isolated" framing could lead an implementer to skip smoke-testing `/api/ping` after Phase 1 lands.
- **Fix**: Correct the Phase 1 Overview to note that `/api/ping` starts being gated by the new hook immediately (harmless — its dead code just stops mattering until Phase 2), and add a Phase 1 manual verification bullet: confirm `/api/ping` returns 401 without a token and 200 with a valid one, right after `npm run dev` starts.
- **Decision**: FIXED — applied as proposed (Phase 1 Overview + manual verification bullet 1.4)

### F2 — No stated behavior for JIT-upsert DB failures in the auth hook

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Changes Required §3 (Auth hook)
- **Detail**: The hook's Contract specifies error handling only for JWT verification failure (→ 401). It's silent on what happens if the JIT-upsert DB call itself fails (Neon timeout, network blip) — by construction it falls through to Fastify's default handler (500 via `@fastify/sensible`), which is the right outcome (a provisioning failure isn't a bad credential), but the plan doesn't say so, leaving the implementer to guess whether that's intentional.
- **Fix**: Add one sentence to Phase 1 §3's Contract: "DB upsert failures are not caught here — they propagate to Fastify's default error handler (500), which is correct: a provisioning failure isn't a bad credential and shouldn't be reported as 401."
- **Decision**: FIXED — sentence added to Phase 1 §3's Contract

### F3 — plan-brief's "open assumption" about the email claim is actually confirmed

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: plan-brief.md — Open Risks & Assumptions
- **Detail**: The brief lists "Assumes the real Cognito ID token's email claim is present and reliable" as an open risk. The review's sub-agent verification confirmed this in code: `infra/lib/constructs/auth-construct.ts` sets `standardAttributes: { email: { required: true } }` and the UserPoolClient's `oAuth.scopes` includes `cognito.OAuthScope.EMAIL`; the frontend's OIDC config requests `scope: 'openid email profile'` (`frontend/src/auth/cognito.ts:14`). This isn't an assumption, it's a confirmed fact — the brief just hasn't caught up.
- **Fix**: Update the brief's Open Risks bullet to state this is confirmed, with the two citations above, or drop the bullet entirely and fold the fact into "Starting Point."
- **Decision**: FIXED — plan-brief.md's Open Risks bullet updated to state this is confirmed, with citations

## Post-review scope change (not a formal finding)

During triage, the user clarified that `/api/ping` was always intended to be **deleted** in Phase 2, not merely cleaned up — the route's own code comment says "Remove once confirmed against a real deployed request (Phase 2)," which the original plan draft had missed. This is a larger, user-directed correction beyond F1-F3: Phase 2 now deletes `backend/src/routes/api/ping/`, its CDK route, and the CDK `HttpUserPoolAuthorizer` construct (with its now-unused `userPool`/`userPoolClient` variables and imports) instead of editing them in place. Both `plan.md` and `plan-brief.md` were updated throughout to reflect this — see Desired End State, What We're NOT Doing, Phase 2 Changes #2-3, Phase 3's test contract, Testing Strategy, References, and Progress.
