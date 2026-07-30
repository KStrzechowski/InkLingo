---
date: 2026-07-25T17:51:31Z
researcher: Claude Sonnet 5
git_commit: 455cc15b1ce7df09d0b6baa1a9cabd38ef2860d2
branch: main
repository: InkLingo
topic: "How should the AI translation/generation actually work for this feature"
tags: [research, codebase, ai-integration, capture-translate-save, s-03, anthropic, schema]
status: complete
last_updated: 2026-07-25
last_updated_by: Claude Sonnet 5
---

# Research: How should the AI translation/generation actually work for this feature

**Date**: 2026-07-25T17:51:31Z
**Researcher**: Claude Sonnet 5
**Git Commit**: 455cc15b1ce7df09d0b6baa1a9cabd38ef2860d2
**Branch**: main
**Repository**: InkLingo

## Research Question

How should the AI translation/generation actually work for the capture-translate-save (S-03) feature — provider, call shape, where it runs, and how its output maps onto what's already built?

## Summary

The provider decision is **already settled, not open**: `context/foundation/infrastructure.md` names Anthropic's Claude Haiku 4.5 explicitly, with cost/latency/timeout reasoning already worked through (Lambda's 15-min timeout was specifically chosen over App Runner's unconfigurable 30s cap *because of* the AI-translation NFR). The backend already has the secret plumbed end-to-end (`anthropicApiKey` in config, SSM parameter live in AWS) but **zero AI-calling code exists** — no SDK dependency, no client wrapper, no route. This is genuinely greenfield integration work, not a redesign.

Three real gaps surfaced that the plan needs to resolve, not just implement around:

1. **The persisted schema was never designed for "several variants shown before save."** `entry_translations` has `UNIQUE(entry_id, language_code)` — one row per language, built to support *multiple target languages per word*, not multiple *candidate readings* of an ambiguous word (FR-009). `entry_sentences` has no uniqueness constraint at all and no candidate/selected distinction. The archived minimal-database plan never discussed FR-009/010/011/012/015 — this wasn't a deliberate "candidates are ephemeral" tradeoff, it's an unaddressed gap between what the PRD needs and what got built.
2. **The extension doesn't exist, and the current auth model won't port to it as-is.** Zero scaffold anywhere in the repo. The web app's Cognito flow is full-page redirect + localStorage (`signinRedirect()`), which doesn't work inside a WebExtension popup. CORS on the API Gateway is a single hard-coded origin allowlist, not permissive — a `moz-extension://` origin isn't in it today.
3. **Cost/abuse protection on the AI-calling route is a named, unresolved risk in `infrastructure.md`'s own risk register** — a "denial-of-wallet" scenario where a request flood bills both AWS and Anthropic. `@fastify/rate-limit` is already a backend dependency but is registered nowhere in `src/` — the tool is sitting unused.

## Detailed Findings

### AI provider and call shape — already decided

- **Provider**: Anthropic API, Claude Haiku 4.5, for both translation and example-sentence generation (`context/foundation/infrastructure.md:11,16,121`).
- **Why Lambda over App Runner specifically hinged on this**: App Runner's hard, unconfigurable 30-second request timeout was called out as "a real risk against the AI-translation NFR if the provider ever has a slow moment" (`infrastructure.md:55`); Lambda's 15-minute Function URL timeout has "None" listed under that same risk row. This means the AI call is expected to run inside the same Lambda invocation as the HTTP request — no separate async/queue-based generation path was designed.
- **FR-015's own reasoning already assumes one combined call**: the PRD justifies including IPA phonetic transcription by saying it's "an additional field in the same AI call that already returns translation and sentences" (`context/foundation/prd.md:89`). So the intended shape is: **one Anthropic call per user submission, returning translation variants + IPA + several example sentences together** — not three separate calls.
- **Regeneration (FR-012) is scoped to sentences only.** Re-reading the FR text precisely: FR-012 is "the user can ask for other example sentences (regeneration)" (`prd.md:84`) — there's no equivalent FR for regenerating translation variants. The Business Logic section's "possibility of asking for more if none fit" (`prd.md:111`) also only mentions sentences. Translation variants are a one-shot result of the initial call; only sentences have a regenerate affordance.

### Nothing exists yet to build the AI call on — confirmed greenfield

- `backend/package.json` has no `@anthropic-ai/sdk`, no `axios`, no `undici`, no other AI or HTTP-client SDK — only Node's built-in `fetch` is available without adding a dependency.
- No file under `backend/src/` references "anthropic", "claude", "translat", or "generat" except the bare `anthropicApiKey` field in `backend/src/plugins/config.ts`.
- **Config is fully wired already**: `AppConfig.anthropicApiKey` (`config.ts:8-14`) is sourced from SSM parameter `/ink-lingo/anthropic-api-key` in Lambda (`config.ts:16-32`) or `process.env.ANTHROPIC_API_KEY` locally (`config.ts:34-43`), selected by `runningInLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME)`. Both paths throw if the value is missing — meaning the SSM parameter **must already exist and be populated in AWS today**, since account-auth and word-collections are both already deployed and would otherwise fail Lambda cold start. No `.env.example` documents `ANTHROPIC_API_KEY` locally; only the real (gitignored) `backend/.env` has it.
- **No CDK resource creates this parameter** — `infra/lib/**` grants the Lambda execution role a wildcard `ssm:GetParameter` on `arn:...:parameter/ink-lingo/*` (`infra/lib/constructs/api-construct.ts:97-100`), but the actual `anthropic-api-key` SecureString was pushed out-of-band via `aws ssm put-parameter` per `infrastructure.md:93,122` and the account-auth archive's own note that only non-secret values get a CDK `ssm.StringParameter` resource (`context/archive/2026-07-21-account-auth/change.md:19`). **Practical implication for the plan: no new IAM policy or CDK change is needed to call Anthropic — the wildcard grant already covers it.**
- **Established plugin pattern to follow** (`backend/src/plugins/neon.ts` whole file, `backend/src/plugins/auth.ts:16-24`): wrap the client in `fastify-plugin`, build it from `fastify.config.*` inside the plugin body, `fastify.decorate('<name>', instance)`, register with `{ name: '<pluginName>', dependencies: ['config'] }`. A new `anthropic.ts` plugin decorating e.g. `fastify.anthropicClient` would match this exactly. Type augmentation is centralized in `backend/src/fastify.d.ts` (not per-plugin `declare module` blocks) — a new decorator needs a new field there, following the existing `config`/`sql`/`jwtVerifier` entries (`fastify.d.ts:24-28`).
- **Route conventions already established** (`backend/src/routes/api/collections/index.ts`): inline JSON Schema on `body`/`params` (no response schemas currently declared anywhere), `@fastify/sensible` reply helpers (`reply.badRequest()`, `reply.conflict()`, `reply.notFound()`, `reply.unauthorized()`), and the auth cascade hook (`backend/src/routes/api/autohooks.ts`) that already populates `request.authUser` on every route under `api/` via `@fastify/autoload`'s `autoHooks`/`cascadeHooks` — a new `/api/translate`-style route gets auth for free, no per-route wiring needed.

### Schema gap: variants (FR-009/010) vs. what's persisted

Full schema (`backend/migrations/1784584360698_create-core-schema.ts`):

| Table | Key constraint | Cascade |
|---|---|---|
| `entry_translations` | `UNIQUE(entry_id, language_code)` (L52-54) | `entry_id → entries ON DELETE CASCADE` |
| `entry_sentences` | index on `entry_id` only — **no uniqueness constraint** | `entry_id → entries ON DELETE CASCADE` |

- The archived minimal-database design (`context/archive/2026-07-20-minimal-database/plan-brief.md:19-25`) chose one `entry_translations` row per `(entry, language)` explicitly to "support multiple **target languages** per word" and packed multi-sense meanings into a single `/`-separated string within `meaning_text` — this is a different axis than FR-009's "several variants for ambiguous words." `entry_sentences` was deliberately made a *sibling* of `entry_translations` (not parent/child) so "which language gets example sentences is a runtime decision made later by S-03" (`plan-brief.md:24`; `plan.md:32,37`) — but that same plan explicitly states there is "no support for tying an example sentence to one specific translation/meaning" (`plan.md:32`).
- **A grep across the entire minimal-database archive for "wieloznaczn" (ambiguous), "warian" (variant), "regenerac" (regeneration), "IPA/fonetyczn" (phonetic), or FR-009/010/011/012/015 returned zero hits.** This confirms the schema was designed before — and independent of — the AI-variant requirements. It is not a considered "candidates are ephemeral, only the save is persisted" decision; that reconciliation was never made.
- **What the schema *can* physically hold**: `entry_translations` structurally blocks >1 row per language (only a slash-packed string in one field could approximate multiple variants). `entry_sentences` has no such cap and could hold multiple candidate sentence rows per entry/language today — but there's no `is_selected`/candidate flag, and `GET /:id` (`backend/src/routes/api/collections/index.ts:94-103,109-129`) returns every stored sentence row as a plain array with no selection semantics. If candidate sentences were ever persisted pre-save, they'd be indistinguishable from saved ones through the existing read path.
- **This needs an explicit decision in the plan, framed as a question, not asserted as settled**: are the several AI-returned variants/sentences purely ephemeral (held in frontend/extension state during the capture flow, with only the user's final pick reaching a `POST` that writes one `entry_translations` row + one `entry_sentences` row) — consistent with FR-013's exact wording, "save the word/phrase along with the translation and the chosen sentence" (`prd.md:94`) — or does something about regeneration/UX require any server-side persistence of candidates before save? The FR-013 wording and the schema's current shape both point toward "ephemeral until save," but this was never a deliberate call anyone made, so it shouldn't be waved through as obvious in the plan without saying so.

### Extension: 100% net-new, and the current auth model doesn't transfer

- **No browser-extension scaffold exists anywhere** — no WebExtension `manifest.json`, no `webextension-polyfill` or `web-ext` dependency, no `extension/` folder. Confirmed by direct search; matches the roadmap's own note (`context/foundation/roadmap.md:112`, Polish: "nowa wtyczka do przeglądarki (nie istnieje jeszcze w repo)").
- **CORS is a single-origin allowlist, not permissive**: `infra/lib/constructs/api-construct.ts:118-126` sets `corsPreflight.allowOrigins: [allowedOrigin]` where `allowedOrigin` defaults to the CloudFront frontend URL. A `moz-extension://<uuid>` origin isn't on this list and would fail preflight as-is. Two paths forward: add the extension's origin explicitly (its UUID is only stable if pinned via `browser_specific_settings.gecko.id` in the not-yet-written manifest), or have the extension's background script make the request (which isn't subject to page-level CORS the same way, given the right `host_permissions`).
- **The web app's Cognito auth is redirect + localStorage, and doesn't map onto a WebExtension popup as built**: `frontend/src/auth/cognito.ts` uses `oidc-client-ts`'s `UserManager` with `signinRedirect()` (full-page navigation) and `WebStorageStateStore` backed by `localStorage`; the callback is handled as a react-router page at `/callback` (`frontend/src/App.tsx`). A popup that loses focus or can't navigate away the same way breaks this model. Nothing in the current implementation uses `browser.identity.launchWebAuthFlow` or a PKCE flow suited to an extension context.
- **Cognito User Pool Client config has no extension entry**: `callbackUrls`/`logoutUrls` in `infra/lib/constructs/auth-construct.ts:38-51` (wired from `infra/lib/stacks/auth-stack.ts:23-26`) only register the localhost dev URL and the CloudFront prod URL. A `moz-extension://<extension-id>/callback` entry would need to be added, which requires deciding the extension's stable ID first.
- **What already works as-is**: backend JWT verification (`backend/src/routes/api/autohooks.ts` + `backend/src/plugins/auth.ts`) checks a Bearer Cognito ID token against one user pool/client — it doesn't care what kind of client presented the token. Once the extension has a valid ID token by whatever means, the existing auth cascade needs no changes to accept it.

### Cost/abuse protection: a named, still-open risk

- `context/foundation/infrastructure.md`'s risk register explicitly calls out "denial-of-wallet: request flood on `/translate` bills both AWS and the Anthropic API, with no automatic spend ceiling on either" (`infrastructure.md:113`), naming the mitigation as "an application-level per-user rate limit on `/translate` specifically (`@fastify/rate-limit`) — not yet implemented, tracked here as an open item" (`infrastructure.md:97,113`, Getting Started step 7 at `infrastructure.md:124`).
- `@fastify/rate-limit` **is already a `backend/package.json` dependency** (`^11.1.0`, confirmed in the full dependency list) but a repo-wide search of `backend/src/` for "rate-limit"/"rateLimit" returns **zero matches** — it's installed but not registered as a plugin or applied to any route anywhere. This is a pre-existing gap the AI-calling route will inherit unless the plan wires it in.
- Platform-level protections already exist independent of this (API Gateway throttling, Lambda reserved concurrency — `infrastructure.md:97`), but those only cap the AWS-side blast radius, not the per-call Anthropic billing.

## Code References

- `backend/src/plugins/config.ts:8-14,16-59` — `AppConfig` shape, SSM vs env sourcing for `anthropicApiKey`
- `backend/src/plugins/neon.ts` (whole file) — the plugin-wrapping-third-party-client pattern to mirror
- `backend/src/plugins/auth.ts:16-24` — `CognitoJwtVerifier` construction, same plugin pattern
- `backend/src/fastify.d.ts:23-33` — centralized `FastifyInstance` type augmentation
- `backend/src/routes/api/autohooks.ts:11-39` — auth cascade hook, populates `request.authUser` for every route under `api/`
- `backend/src/routes/api/collections/index.ts:67-131` — existing route/schema/error-handling conventions; `GET /:id`'s translation/sentence query and response shaping
- `backend/migrations/1784584360698_create-core-schema.ts:41-68` — `entry_translations`/`entry_sentences` exact constraints
- `backend/test/schema/core-schema.test.ts:40-93` — tests confirming the uniqueness/null behaviors above
- `backend/package.json` — full dependency list; no AI/HTTP-client SDK present, `@fastify/rate-limit` present but unused
- `infra/lib/constructs/api-construct.ts:97-100,118-126` — wildcard SSM IAM grant; CORS `allowOrigins` single-origin allowlist
- `infra/lib/constructs/auth-construct.ts:38-51` — Cognito User Pool Client OAuth config, `callbackUrls`/`logoutUrls`
- `frontend/src/auth/cognito.ts` (whole file) — redirect + localStorage auth flow
- `frontend/src/App.tsx:10-24,56` — `/callback` page route

## Architecture Insights

- **One Anthropic call per submission is the intended shape**, not per-field calls — FR-015's own PRD reasoning and the Lambda-timeout research both assume translation + IPA + sentences come back together.
- **Fastify's plugin/decorator/autoload conventions are consistent enough across `neon.ts`/`auth.ts` that a new `anthropic.ts` plugin has an unambiguous template to follow** — this is a low-risk, well-paved part of the work.
- **The auth cascade hook means a new AI route is auth-protected for free** — no new auth wiring needed at the route level, only at the extension-client level (getting a token into the extension in the first place).
- **The real architectural risk in this slice isn't the AI call itself — it's the two things around it**: reconciling the "several variants before save" UX against a schema that was never built for it, and standing up an entirely new client (browser extension) with an auth flow that doesn't reuse the web app's redirect model.

## Historical Context (from prior changes)

- `context/archive/2026-07-20-minimal-database/plan-brief.md:19-25` and `plan.md:32,37` — schema design rationale for `entry_translations`/`entry_sentences`, and explicit confirmation that FR-009/010/011/012/015 were never part of that design discussion.
- `context/archive/2026-07-21-account-auth/change.md:19` — the non-secret vs. secret SSM convention (`/ink-lingo-cdk/*` vs `/ink-lingo/*`) that the AI integration should follow if it ever needs its own parameter.
- `context/foundation/infrastructure.md` — the actual source of the AI provider decision (Anthropic Claude Haiku 4.5), the Lambda-timeout-vs-AI-latency reasoning, and the still-open denial-of-wallet risk on the AI-calling route.

## Related Research

- No prior `research.md` exists for `minimal-database` (only `plan-brief.md`/`plan.md`) or `account-auth`/`word-collections` beyond what's cited above.

## Open Questions

1. **Are AI-returned translation variants and candidate sentences ephemeral (never persisted) until the user picks and saves, or does any part of the flow need them to survive a page/popup reload before save?** The schema and FR-013's wording both point toward "ephemeral," but this was never a deliberate decision — the plan should say so explicitly rather than assume it.
2. **Extension auth strategy**: `browser.identity.launchWebAuthFlow` + PKCE against the existing Cognito User Pool Client (extending `callbackUrls`), a dedicated second App Client for the extension, or reusing a token the web app already obtained some other way? Needs a decision before extension auth work can be scoped.
3. **CORS approach for the extension**: explicit origin allowlisting (requires a pinned extension ID via `browser_specific_settings.gecko.id`) vs. routing calls through a background script with `host_permissions` (sidesteps page-level CORS). Affects both the CDK CORS config and the extension's manifest.
4. **Per-user rate limiting on the AI-calling route** — `@fastify/rate-limit` is already a dependency; does this ship in the same phase as the AI call itself, or as a fast-follow? `infrastructure.md`'s own risk register treats it as unresolved, so the plan should at least make the sequencing decision explicit rather than silently deferring it again.
