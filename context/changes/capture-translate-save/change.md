---
change_id: capture-translate-save
title: Capture translate save
status: implementing
created: 2026-07-25
updated: 2026-07-30
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Phase 4 adaptations (approved during implementation)

- **Extension OAuth redirect URL.** The plan specified `moz-extension://<id>/callback`. Firefox's `identity.launchWebAuthFlow` only accepts the URL `identity.getRedirectURL()` returns — `https://<sha1(add-on id)>.extensions.allizom.org/` — and a `moz-extension://` UUID is regenerated per install, so it can never be registered in Cognito. Pinned `browser_specific_settings.gecko.id` to `inklingo@inklingo.app`; `infra/lib/stacks/auth-stack.ts` recomputes the same SHA-1 rather than hardcoding the result.
- **Missing API Gateway routes.** `infra/lib/constructs/api-construct.ts` registers routes explicitly (no `{proxy+}`), so `POST /api/collections/{id}/translate` and `POST /api/collections/{id}/entries` — added to Fastify in Phases 2 and 3 — were unreachable through the deployed API. Both registered as part of this phase, since Phase 4's manual verification depends on them.
