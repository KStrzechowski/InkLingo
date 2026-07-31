---
change_id: capture-translate-save
title: Capture translate save
status: implementing
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

### Phase 5 adaptations (approved during implementation)

- **One Anthropic call for all target languages, not one per language.** The plan's Phase 5 section asks for both "the translate route's Anthropic call is instructed with all of the collection's target language codes" (one call) and per-language failure isolation — "a language whose generation fails or times out shows its own inline retry affordance without blocking the languages that succeeded". Those can't both hold: a single call fails as a unit. Chose the single call for cost (~$0.008 per capture instead of ~$0.04 at five languages). Two knock-on changes it forced: `MAX_TOKENS_PER_LANGUAGE` in `backend/src/ai/translate.ts` scales the output ceiling with the language count, because five languages in one response overruns the old flat 1536 and truncates the `tool_use` JSON mid-object; and `TRANSLATE_TIMEOUT_MS` went 15s → 20s, still clear of the 29s API Gateway ceiling.
- **Criterion 5.5 is not verifiable as written.** It reads "Deliberately breaking one language's generation (e.g. an invalid language code) shows that language's section in an error/retry state while the others render normally" — behaviour the single-call design cannot have. What replaces it: a failed generation blanks the whole capture and the popup shows one error line plus one retry, and the model returning *nothing for one language* (as opposed to failing) renders that language's section with "Nothing came back for this language" while the others render normally. The second half is covered automatically by `alignToRequested` in `translate.ts` and by the `reorders and backfills what the model returns` test.
- **Empty-variants failure found by testing against the real API, and retried.** Verification against live Anthropic (not the stubbed suite) turned up a response the schema permits but the app can't use: a structurally-valid result whose `variants` arrays are *all* empty, at roughly **3 in 34** five-language calls, clustered rather than uniform. The language codes matched fine — `alignToRequested` wasn't dropping anything, there was genuinely nothing to align. Two hypotheses were tested and disproved: identical repeated requests (16/16 fine, so the regenerate button is not the trigger) and schema/prompt weakness alone (6/6 fine on the unmodified baseline). No request-side property distinguishes a good roll from a bad one, so `generateTranslation` now **retries once when every language comes back empty**, backed by `minItems: 1` on the tool schema's arrays and an explicit prompt line. The empty response is also the cheap fast one (~167 output tokens, ~1.3s), so the retry costs little and stays inside the route timeout. **This predates Phase 5** — the single-language path shipped in Phase 2 has the same failure (observed 1 in 5 during a parallel comparison), and criterion 2.3's one-shot manual check happened to get a good roll. The fix is in the shared function, so it covers both.
- **Measured against live Anthropic, 5-language collection** (`pl` → `en/de/fr/es/it`, 10 captures): 10/10 fully populated after the fix, **$0.0063 per capture**, 4.7–10.0s per capture against the 20s route timeout, peak output 1,721 tokens against the 10,240 budgeted. `MAX_TOKENS_PER_LANGUAGE = 2048` is roughly 6× what's actually used — sized for headroom, and `max_tokens` is a ceiling rather than a charge. Worth noting for the NFR: five languages takes 5–10s, which is longer than "a few seconds"; one language was ~3.7s.
- **FR-018's stated trigger is unreachable.** The plan describes the per-entry backfill as filling in "a target language added to the collection after that entry was created", but *What We're NOT Doing* rules out editing a collection's languages after creation — so no collection can ever gain one. The endpoint and the web app's "Add ⟨lang⟩" button are still useful, just for a different reason: an entry ends up missing a target language when that language returned no variants at capture time (the empty-variants failure above), so the button repairs a partial save rather than backfilling a newly-added language. Left as built; the alternative is either an unplanned collection-edit feature or dropping FR-018 entirely, and neither belongs in this phase. Reaching the state deliberately for a manual test needs a SQL delete — see `follow-ups/pending-manual-checks.md` step 5.
- **Two new guards on `POST /api/collections`.** Duplicate target codes and the native language appearing among the targets both became reachable only once a collection could hold more than one target. The first would otherwise trip `UNIQUE(collection_id, language_code)` and surface as the name-conflict 409, which tells the caller the wrong thing. Same reasoning for the duplicate-language guard on `POST /:id/entries`, which would otherwise 500 mid-transaction.
