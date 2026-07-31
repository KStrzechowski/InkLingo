---
change_id: capture-translate-save
title: Capture translate save
status: impl_reviewed
created: 2026-07-25
updated: 2026-07-31
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Phase 4 adaptations (approved during implementation)

- **Extension OAuth redirect URL.** The plan specified `moz-extension://<id>/callback`. Firefox's `identity.launchWebAuthFlow` only accepts the URL `identity.getRedirectURL()` returns — `https://<sha1(add-on id)>.extensions.allizom.org/` — and a `moz-extension://` UUID is regenerated per install, so it can never be registered in Cognito. Pinned `browser_specific_settings.gecko.id` to `inklingo@inklingo.app`; `infra/lib/stacks/auth-stack.ts` recomputes the same SHA-1 rather than hardcoding the result.
- **Missing API Gateway routes.** `infra/lib/constructs/api-construct.ts` registers routes explicitly (no `{proxy+}`), so `POST /api/collections/{id}/translate` and `POST /api/collections/{id}/entries` — added to Fastify in Phases 2 and 3 — were unreachable through the deployed API. Both registered as part of this phase, since Phase 4's manual verification depends on them.

### Known limitation — the per-user rate limit is per-Lambda-instance

Surfaced by the Phase 4 implementation review (`reviews/impl-review-phase-4.md`, F1). Accepted for now; not a bug to fix in this change.

`backend/src/plugins/rate-limit.ts` registers `@fastify/rate-limit` with no `store`, so it falls back to the in-process `LocalStore`. Under Lambda every warm execution environment keeps its own counter, so the translate route's `20/minute` per-user budget holds exactly **only in local `npm run dev`**. Deployed, the effective ceiling is roughly `warm containers × 20/min` — up to ~200/min at this account's Lambda concurrency limit of 10 — and every cold start resets the count. That is looser than the denial-of-wallet cap `context/foundation/infrastructure.md`'s risk register asked for.

What bounds the exposure today:

- API Gateway's stage throttle (`infra/lib/constructs/api-construct.ts:132-135`) at 5 rps / burst 10 — global, not per-user, so it caps total spend rather than any one user's.
- The route is authenticated, so an attacker needs a valid Cognito account.
- **The Anthropic Console spend limit on the workspace holding this API key is the actual backstop** — it caps the bill at a chosen number regardless of container count. Set it; it costs nothing and no code change substitutes for it.

Options considered and rejected for this slice: ElastiCache (VPC-only — the Lambda has no VPC and needs internet egress for Anthropic/Neon/Cognito, so it would pull in a NAT Gateway; roughly $50–130/month) and Upstash (adds a vendor and a secret). If the exact 20/min ever matters, the cheap fix is a custom store against the existing Neon connection — `@fastify/rate-limit`'s store interface is just `incr(key, cb, timeWindow, max)` + `child(routeOptions)`.
