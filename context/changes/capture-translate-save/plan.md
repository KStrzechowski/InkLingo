# Capture, Translate, Save (S-03) Implementation Plan

## Overview

Implement the PRD's north-star flow: a Firefox extension where the user types a word/phrase, gets AI-generated translation variants + IPA phonetics + bilingual example sentences for whichever language(s) the active collection is configured to teach, picks one variant + one sentence, and saves it. This is the biggest slice in the roadmap — it introduces a browser extension (doesn't exist in the repo yet), a new external AI dependency (Anthropic Claude Haiku 4.5, provider already decided in `context/foundation/infrastructure.md`), and per-collection language configuration that extends the already-shipped `collections` schema from word-collections (S-02).

## Current State Analysis

- **Collections** (`backend/migrations/1784584360698_create-core-schema.ts:14-24`) are a bare `(id, user_id, name, created_at)` — no language association at all. `backend/src/routes/api/collections/index.ts` implements list/create/detail with no language fields anywhere in the contract.
- **Entries** anchor on `word_or_phrase` + `source_language_code` (`create-core-schema.ts:27-38`), with `entry_translations` (`UNIQUE(entry_id, language_code)`, no phonetic field) and `entry_sentences` (no uniqueness constraint, no native-language gloss field) as siblings under `entries`, cascade-deleted with their parent.
- **AI integration**: `backend/src/plugins/config.ts:8-14` already carries `anthropicApiKey`, sourced from SSM (`/ink-lingo/anthropic-api-key`) in Lambda or `.env` locally — the secret is already live in AWS (word-collections and account-auth are deployed and would fail cold start otherwise). No SDK dependency, no client wrapper, no route exists yet.
- **Auth**: `backend/src/routes/api/autohooks.ts` verifies a Cognito ID token and JIT-provisions `request.authUser` for every route under `api/` via `@fastify/autoload`'s cascade hooks — this works for any client presenting a valid token, extension included, with zero new backend auth code needed.
- **Frontend auth** (`frontend/src/auth/cognito.ts`) uses `oidc-client-ts`'s redirect-based flow (`signinRedirect()`) with tokens in `localStorage` — this model doesn't port to a WebExtension popup, which needs `browser.identity.launchWebAuthFlow` instead.
- **CORS** (`infra/lib/constructs/api-construct.ts:118-126`) is a single hard-coded origin allowlist (the CloudFront frontend URL) — a `moz-extension://` origin isn't on it and isn't the right fix anyway (see Implementation Approach).
- **Cognito User Pool Client** (`infra/lib/constructs/auth-construct.ts:38-51`, wired from `infra/lib/stacks/auth-stack.ts:23-26`) only registers the localhost-dev and CloudFront callback/logout URLs.
- **`@fastify/rate-limit`** is already a `backend/package.json` dependency but registered nowhere in `src/` — `context/foundation/infrastructure.md`'s own risk register flags the resulting denial-of-wallet exposure on any future AI-calling route as unresolved.
- No browser-extension scaffold, `manifest.json`, or extension build tooling exists anywhere in the repo.

## Desired End State

A user can: create a collection with a native language + 1 target language (the schema already supports up to 5, gated to 1 by validation until Phase 5); install/load the extension; log into it independently of the web app; click the extension icon on any page, type a word in either the collection's native or target language; see several translation variants (each with IPA and its own candidate example sentences, each sentence paired with a native-language gloss); pick one variant + one sentence; save it into the active (or a chosen) collection. The saved entry appears immediately in the existing web app's collection detail view (`GET /api/collections/:id`, already built in S-02).

Verification: the phase-by-phase automated/manual checks below, plus (end of Phase 4) a full manual run of the flow above end-to-end using a real Cognito login and a real Anthropic call.

### Key Discoveries

- Since a collection's native language is fixed at creation with no edit path planned, `entries.source_language_code` becomes redundant with its parent collection's native language. Rather than removing the column (touches an already-shipped, tested contract) or joining for it on every read, Phase 3 just always writes the parent collection's native language code into it at entry-creation time — zero API-shape change, zero extra query.
- FR-009 (translation variants for ambiguous words) and FR-010 (example sentences) read together imply sentences belong to a *specific* variant, not the word generically — a sentence demonstrating "bank" as a riverbank is irrelevant to the "bank" (financial) variant. The AI response and the UI nest candidate sentences under each translation variant, and the user's final pick is one variant + one sentence from within it. This is an inference from the FRs, not something asked of the user directly during planning — flagged here for visibility.
- FR-012 (sentence regeneration) doesn't require a second endpoint: Anthropic's Claude Haiku 4.5 call always returns the full shape (variants + phonetics + sentences) per FR-015's own "same call" reasoning, so "regenerate" is just calling `POST /api/collections/:id/translate` again with the same text and keeping only the sentences from the fresh response — the previously-shown variants/phonetics stay as originally displayed.
- Phases 1-4 constrain a collection to exactly 1 target language (`targetLanguageCodes` schema `maxItems: 1`), but the underlying schema (a junction table, not a single column) is built for up to 5 from Phase 1 onward — Phase 5 only has to relax validation and loop the AI-call/capture UI over N languages, not migrate data.
- `collections`/`entries`/etc. hold effectively zero real rows in any environment today (same reasoning already used for word-collections' uniqueness migration) — new `NOT NULL` columns on `collections` are safe without a backfill step.

## What We're NOT Doing

- Chrome/other browser support — Firefox only, per the PRD's NFR.
- FR-008 (auto-capture via mouse selection) — explicitly deferred to v2 in the PRD.
- Printable export (S-04) and pronunciation playback (S-05) — separate roadmap slices.
- Editing a collection's native/target language(s) after creation — no FR covers this; a collection's language config is immutable once set, for this plan.
- A dedicated "override the detected input language" control — if Anthropic misdetects which language the typed text is in, the user sees an unhelpful result and can just retype; no manual-correction UI is built (matches the PRD's Open Question #3, which explicitly doesn't block on this).
- Automatic retroactive backfill of a newly-added target language into existing entries — FR-018's manual, per-entry, user-triggered action instead, and even that lands in Phase 5, not earlier.
- Any Playwright/e2e tooling for the extension — that's Module 4 lesson territory per this repo's `.claude/CLAUDE.md`, not something this plan introduces.
- A "supported languages" database table — the language picker is a small hardcoded list of ISO 639-1 codes + display names in the frontend/extension; Anthropic handles the actual translation regardless of which codes are offered.
- Partial-failure-per-language UI (some languages succeed, one times out) — irrelevant while every collection has exactly 1 target language; it's designed in Phase 5 when N > 1 becomes possible.

## Implementation Approach

Backend-first, mirroring how word-collections (S-02) sequenced its own rollout: schema and API land and get manually verified (via `npm run dev` + curl/Postman) before the much riskier, entirely-new extension client is built on top. The extension's CORS problem is solved architecturally rather than by widening the API's origin allowlist: all of its network calls run from the background script under explicit `host_permissions`, which isn't subject to page-level CORS preflight the way a popup-page `fetch()` would be — so `infra/lib/constructs/api-construct.ts`'s CORS config needs no change at all. The only infra touch is one new Cognito callback URL for the extension's own OAuth flow, and that's scoped into the extension phase since it depends on the extension's manifest existing first (the callback URL embeds the extension's `moz-extension://<id>` origin, which comes from a stable ID pinned in `manifest.json`).

## Critical Implementation Details

**Atomic multi-table writes on save.** The save endpoint (Phase 3) inserts into `entries`, then `entry_translations`, then `entry_sentences` — three related writes that should succeed or fail together (a save that creates an orphan `entries` row with no translation if the second insert fails would violate the "zero loss of saved words" guardrail in a different way: a broken, homeless-looking entry). `@neondatabase/serverless`'s `neon()` HTTP driver may or may not expose a multi-statement transaction/batch helper in the installed version (`^1.1.0`) — verify this against the actual package (`node_modules/@neondatabase/serverless`'s types/README) before implementing Phase 3, rather than assuming. If no atomic batch API is available, wrap the three inserts in an explicit rollback-on-failure sequence (delete the `entries` row if either follow-up insert throws) instead of leaving a partial write.

**Collection must be resolved before generation.** Because native/target languages now live on the collection, not the account, the AI-generation call (Phase 2) needs to know which collection is active *before or during* typing, not just at save time — this is why FR-013's "default to last-used collection" is load-bearing earlier in the flow than a simple save-time convenience, and why the extension (Phase 4) must resolve/display an active collection before the input box is usable.

**Extension ID must exist before the CDK callback-URL change.** `manifest.json`'s `browser_specific_settings.gecko.id` (Phase 4) has to be decided/pinned first; only then can `infra/lib/stacks/auth-stack.ts`'s `additionalCallbackUrls` reference the real `moz-extension://<id>/callback` origin. Sequence the manifest write before the CDK change within Phase 4, not the other way around.

## Phase 1: Backend + Frontend — Collection language configuration

### Overview

Extend the already-shipped `collections` resource with a native language and 1-5 target languages (validated to exactly 1 for now), and update the one existing frontend surface that creates collections so it doesn't break against the new required fields.

### Changes Required:

#### 1. Migration — collection language config

**File**: `backend/migrations/<timestamp>_add-collection-languages.ts` (generate via `npm run migrate:create add-collection-languages` in `backend/`)

**Intent**: Add a native language to `collections`, and a normalized multi-row table for its target language(s) — built for up to 5 from the start so Phase 5 needs no further migration.

**Contract**:
- `ALTER TABLE collections ADD COLUMN native_language_code text NOT NULL` (safe today — see Key Discoveries; no existing rows in any environment).
- New table `collection_target_languages`: `id uuid PK default gen_random_uuid()`, `collection_id uuid NOT NULL REFERENCES collections ON DELETE CASCADE`, `language_code text NOT NULL`, `UNIQUE(collection_id, language_code)`. Index on `collection_id`.
- `down()` reverses both in dependency order (drop `collection_target_languages` before altering `collections`).

#### 2. Backend route — collections language fields

**File**: `backend/src/routes/api/collections/index.ts`

**Intent**: `POST /` accepts and persists the new language config; `GET /` and `GET /:id` return it.

**Contract**: `POST /`'s body schema gains `nativeLanguageCode: { type: 'string', minLength: 2, maxLength: 10 }` and `targetLanguageCodes: { type: 'array', items: { type: 'string', minLength: 2, maxLength: 10 }, minItems: 1, maxItems: 1 }` (both required alongside the existing `name`). The insert becomes two statements: insert the `collections` row with `native_language_code`, then insert one `collection_target_languages` row per code in `targetLanguageCodes` (exactly one for now). `GET /` and `GET /:id` join/aggregate `collection_target_languages` and add `nativeLanguageCode` + `targetLanguageCodes: string[]` to each collection object in the response, alongside the existing `id`/`name`/`createdAt` fields.

#### 3. Frontend API client — collections types

**File**: `frontend/src/api/collections.ts`

**Intent**: Mirror the extended backend contract so the rest of the frontend can consume the new fields.

**Contract**: `Collection` interface gains `nativeLanguageCode: string` and `targetLanguageCodes: string[]`. `createCollection` signature changes from `(name: string)` to `(name: string, nativeLanguageCode: string, targetLanguageCodes: string[])`, passing all three in the POST body.

#### 4. Frontend — collection creation form

**File**: `frontend/src/pages/CollectionsListPage.tsx`

**Intent**: The existing inline create form (name only) must collect the new required language fields, or every collection creation breaks against Phase 1's now-required backend fields.

**Contract**: Add two `<select>` inputs — native language and (for now) a single target language — sourced from a small hardcoded list of common ISO 639-1 codes + display names (new small constant, e.g. `frontend/src/languages.ts`, exporting `SUPPORTED_LANGUAGES: Array<{ code: string, label: string }>`). `handleSubmit` passes the selected codes to `createCollection`.

### Success Criteria:

#### Automated Verification:

- Migration applies and reverses cleanly: `cd backend && npm run migrate:up` then `npm run migrate:down` then `npm run migrate:up` again
- Backend type checking passes: `cd backend && npm run build:ts`
- Backend test suite passes (existing `collections.test.ts` updated for the new required body fields): `cd backend && npm test`
- Frontend build passes: `cd frontend && npm run build`
- Frontend lint passes: `cd frontend && npm run lint`

#### Manual Verification:

- `cd backend && npm run dev`, then via curl/Postman with a real Cognito test token: creating a collection without `nativeLanguageCode`/`targetLanguageCodes` returns 400; creating one with them returns 201 with both fields echoed back
- `GET /api/collections` and `GET /api/collections/:id` include `nativeLanguageCode`/`targetLanguageCodes` on each collection
- In the running web app, creating a collection through the updated form works end-to-end and the new collection appears with its language pair intact after a page reload

---

## Phase 2: Backend — AI translation/generation endpoint

### Overview

Stand up the Anthropic integration itself: a new Fastify plugin wrapping the Claude Haiku 4.5 client, and a route that takes free text + a collection and returns translation variants (each with phonetics and its own candidate sentences), normalized to the collection's native language, with per-user rate limiting.

### Changes Required:

#### 1. Anthropic plugin

**File**: `backend/src/plugins/anthropic.ts` (new)

**Intent**: Wrap the Anthropic SDK client following this codebase's established plugin pattern (`neon.ts`, `auth.ts`) — construct from `fastify.config.anthropicApiKey`, decorate the instance.

**Contract**: `fp<AnthropicPluginOptions>(async (fastify) => { ... fastify.decorate('anthropicClient', client) }, { name: 'anthropic', dependencies: ['config'] })`. Add `@anthropic-ai/sdk` to `backend/package.json` dependencies. Add `anthropicClient: Anthropic` to `backend/src/fastify.d.ts`'s `FastifyInstance` interface (alongside `config`/`sql`/`jwtVerifier`), matching the centralized-augmentation convention already established there.

#### 2. Rate limiting

**File**: `backend/src/plugins/rate-limit.ts` (new) or registered directly on the route in `collections/index.ts` — implementer's call, since `@fastify/rate-limit` supports both global registration and per-route `config.rateLimit` overrides

**Intent**: Cap per-user request rate specifically on the AI-calling route, closing the denial-of-wallet gap `context/foundation/infrastructure.md`'s risk register already flags as unresolved.

**Contract**: Key the limiter by `request.authUser.id` (not IP — this is an authenticated route, and per-user is the correct dimension for a personal-multi-language-learner product). A starting budget of a low double-digit count per minute is reasonable for a single-user PoC; exact numbers aren't load-bearing enough to fix here — pick something conservative and note it in the route's schema/comment.

#### 3. Translate route

**File**: `backend/src/routes/api/collections/index.ts`

**Intent**: `POST /:id/translate` takes free text, resolves the collection's native/target language codes, calls Anthropic once, and returns a normalized, structured result — never persisting anything (variants/sentences are ephemeral until the user saves, per the "ephemeral until save" decision made during planning).

**Contract**: Body `{ text: string }` (schema: `minLength: 1`, and reject via `reply.badRequest()` if trimmed empty — mirrors the existing blank-name guard in `POST /`). Response shape:
```
{
  normalizedNativeText: string,
  variants: Array<{
    meaningText: string,
    phoneticTranscription: string | null,
    sentences: Array<{ targetText: string, nativeGlossText: string }>
  }>
}
```
The Anthropic call must be given the collection's native + target language codes (from `collection_target_languages`, singular for now) as part of its instructions, and must return machine-parseable structured output — use Anthropic's tool-use (function-calling) mechanism for this rather than parsing free-form prose, since that's the reliable way to get a fixed JSON shape back from Claude. Apply a request timeout (an `AbortController` in the ~15s range, comfortably under the NFR's "few seconds" feel and the Lambda function's own 29s API-Gateway-imposed ceiling — see `api-construct.ts:75`) and return a clean error (not a raw Anthropic SDK exception) if it fires, so the extension can show a generic "couldn't generate — try again" state. A 404 (`reply.notFound()`) if the collection doesn't belong to `request.authUser.id`, matching the existing pattern in `GET /:id`.

### Success Criteria:

#### Automated Verification:

- Backend type checking passes: `cd backend && npm run build:ts`
- Backend test suite passes (new tests for the translate route, using a mocked/stubbed Anthropic client rather than live API calls in CI): `cd backend && npm test`

#### Manual Verification:

- Via curl/Postman with a real token against a real collection: `POST /api/collections/:id/translate` with `{ "text": "dog" }` (native→target collection) returns several variants, each with phonetics and its own sentence candidates paired with native-language glosses
- Typing the same word again ("regenerate") returns a fresh set of sentences (non-deterministic output confirms a real call is happening, not a cached/stubbed response)
- Exceeding the configured rate limit within a minute returns a 429, not a 500 or a hang
- An artificially short timeout (temporarily lower the AbortController value) demonstrates the clean-error path without crashing the process

---

## Phase 3: Backend — Save endpoint & entry schema extensions

### Overview

Persist the user's final pick (one translation variant + one sentence, per target language) into the existing `entries`/`entry_translations`/`entry_sentences` tables, extended with the two new fields this feature needs.

### Changes Required:

#### 1. Migration — phonetics and sentence gloss

**File**: `backend/migrations/<timestamp>_add-entry-phonetics-and-sentence-gloss.ts` (generate via `npm run migrate:create` in `backend/`)

**Intent**: Add the two new fields FR-015 (phonetics) and the bilingual-sentence-pair decision require, without touching either table's existing columns.

**Contract**: `ALTER TABLE entry_translations ADD COLUMN phonetic_transcription text` (nullable — best-effort field, not every generation is guaranteed to produce one). `ALTER TABLE entry_sentences ADD COLUMN native_gloss_text text` (nullable for the same reason, though the application always populates it going forward).

#### 2. Save route

**File**: `backend/src/routes/api/collections/index.ts`

**Intent**: Persist a completed capture as one atomic unit — see Critical Implementation Details for the transaction/rollback requirement.

**Contract**: `POST /:id/entries`. Body:
```
{
  wordOrPhrase: string,
  translations: Array<{ languageCode: string, meaningText: string, phoneticTranscription: string | null }>,
  sentences: Array<{ languageCode: string, sentenceText: string, nativeGlossText: string }>
}
```
(`translations`/`sentences` arrays validated to `minItems: 1, maxItems: 1` for now, matching the collection's single target language — Phase 5 relaxes this). Insert `entries` with `source_language_code` set to the collection's `native_language_code` (see Key Discoveries — this is always the collection's native code, never taken from the request body). Then insert the `entry_translations` and `entry_sentences` rows. Return the created entry in the same shape `GET /:id` already uses, extended with `phoneticTranscription`/`nativeGlossText`.

#### 3. Extend GET /:id response

**File**: `backend/src/routes/api/collections/index.ts`

**Intent**: Surface the two new fields on already-existing reads, not just newly-created entries.

**Contract**: The `translations`/`sentences` SELECT statements (`collections/index.ts:94-103` today) add `phonetic_transcription`/`native_gloss_text` to their column lists; the response-shaping `.map()` calls add `phoneticTranscription`/`nativeGlossText` alongside the existing fields.

### Success Criteria:

#### Automated Verification:

- Migration applies and reverses cleanly: `cd backend && npm run migrate:up` then `npm run migrate:down` then `npm run migrate:up` again
- Backend type checking passes: `cd backend && npm run build:ts`
- Backend test suite passes (new save-endpoint tests, plus updated `core-schema.test.ts`/fixtures if the new columns need covering): `cd backend && npm test`

#### Manual Verification:

- Saving a captured word via curl/Postman creates one `entries` row, one `entry_translations` row (with phonetics), and one `entry_sentences` row (with native gloss) — confirmed directly against Postgres
- `GET /api/collections/:id` in the existing web app now shows phonetics and the bilingual sentence pair for a freshly-saved entry
- Deleting the parent collection still cascades cleanly through entries → translations/sentences (re-run the existing cascade test manually if not already covered by the automated suite)

---

## Phase 4: Extension — scaffold, auth, capture UI

### Overview

The actual new client: a Firefox extension (Manifest V3) that authenticates independently of the web app, lets the user pick/confirm an active collection, capture a word, review AI results, pick a variant + sentence, and save — wired end-to-end against Phases 1-3.

### Changes Required:

#### 1. Extension scaffold

**File**: `extension/manifest.json` (new top-level project, sibling to `backend/`/`frontend/`/`infra/`)

**Intent**: Establish the extension as an independent project with a stable identity.

**Contract**: Manifest V3, `browser_specific_settings.gecko.id` set to a chosen, stable extension ID (needed before the CDK change below — see Critical Implementation Details), `host_permissions` covering the deployed API Gateway origin, a background script, and a popup/action pointing at the capture UI.

#### 2. Extension auth

**File**: `extension/src/auth.ts` (new)

**Intent**: Obtain a Cognito ID token without the redirect+localStorage model the web app uses, which doesn't work in a popup context.

**Contract**: `browser.identity.launchWebAuthFlow` driving the existing Cognito User Pool Client's authorization-code + PKCE flow (no new Cognito App Client — reuses the one thing already deployed), redirecting to `https://<hosted-ui-domain>/oauth2/authorize?...&redirect_uri=moz-extension://<id>/callback`. Store the resulting ID token (and refresh token) in `browser.storage.local` (not `localStorage` — isolated per-extension, the WebExtension-safe choice), with a refresh check before each API call based on the token's `exp` claim.

#### 3. CDK — extension callback URL

**File**: `infra/lib/stacks/auth-stack.ts`

**Intent**: Register the extension's OAuth callback so Cognito accepts it.

**Contract**: Add `moz-extension://<the pinned id from manifest.json>/callback` to `additionalCallbackUrls` passed into `AuthConstruct` (`auth-stack.ts:23-26`), alongside the existing CloudFront URL — no change needed to `additionalLogoutUrls` unless the extension implements an explicit logout affordance.

#### 4. Background script — API calls

**File**: `extension/src/background.ts` (new)

**Intent**: Route all backend calls (translate, save, collections list) through the background script so they run under `host_permissions` rather than page-level CORS — the architectural choice that avoids touching `api-construct.ts`'s CORS config at all.

**Contract**: Message-passing handlers for `translate`, `save-entry`, `list-collections` (or similar), each attaching the stored Cognito ID token as an `Authorization: Bearer` header, matching exactly what `backend/src/routes/api/autohooks.ts` expects.

#### 5. Popup capture UI

**File**: `extension/src/popup/` (new)

**Intent**: The actual capture flow — resolve/display the active collection (default: last-used, with the ability to switch, per FR-013), text input, variants+sentences display, save action.

**Contract**: On open, fetches the collection list via the background script and resolves an active collection (persisted "last used" in `browser.storage.local`). Typing and submitting calls `translate` via the background script; results render each variant with its phonetics and its nested sentence candidates; a "regenerate" affordance re-calls `translate` and replaces only the sentences shown (see Key Discoveries); selecting a variant + sentence and clicking Save calls `save-entry`.

### Success Criteria:

#### Automated Verification:

- No new backend/frontend regressions: `cd backend && npm test`, `cd frontend && npm run build && npm run lint`
- CDK synthesizes cleanly with the new callback URL: `cd infra && npx cdk synth InkLingo-AuthStack -c stack=AuthStack`

#### Manual Verification:

- Loading the unpacked extension in Firefox (`about:debugging`) succeeds with no manifest errors
- Clicking the extension icon and logging in completes the `launchWebAuthFlow` round trip and lands back in the popup authenticated, without a redirect through the main web app
- Typing a native-language word and a target-language word (both against the same collection) each produce a normalized, correct result
- Capturing, picking a variant + sentence, and saving creates a real entry, visible immediately afterward in the existing web app's collection detail page
- Regenerating sentences replaces only the sentences shown, not the previously-displayed translation variants/phonetics
- A deliberately-triggered rate-limit (rapid repeated submits) shows a clean, non-crashing error state in the popup

---

## Phase 5: Multi-language expansion (deferred)

### Overview

Extend collections from exactly 1 target language to up to 5, and add FR-018's manual per-entry "add a language" action — both explicitly deferred from earlier phases per the ~11-day-deadline phasing decision made during planning.

### Changes Required:

#### 1. Relax target-language validation

**File**: `backend/src/routes/api/collections/index.ts`

**Intent**: Allow up to 5 target languages per collection instead of exactly 1 — no schema change needed, `collection_target_languages` was already built for this in Phase 1.

**Contract**: `POST /`'s `targetLanguageCodes` schema changes `maxItems` from `1` to `5`. Same relaxation on the save endpoint's `translations`/`sentences` array `maxItems`.

#### 2. Multi-language AI call and capture UI

**File**: `backend/src/routes/api/collections/index.ts`, `extension/src/popup/`

**Intent**: One capture now produces variants/phonetics/sentences for every target language the collection has, not just one; the user picks a variant + sentence per language before saving.

**Contract**: The translate route's Anthropic call is instructed with all of the collection's target language codes and returns a per-language wrapper around the existing variants shape. The popup UI renders one section per target language, each with its own variant/sentence picker, and — per the partial-failure design deferred from Phase 4 — a language whose generation fails or times out shows its own inline retry affordance without blocking the languages that succeeded.

#### 3. Retroactive per-entry language addition (FR-018)

**File**: `backend/src/routes/api/collections/index.ts` (new endpoint), frontend/extension UI touch

**Intent**: Let the user backfill one already-saved entry with a translation in a target language added to the collection after that entry was created — explicitly not automatic/bulk (see PRD Non-Goals).

**Contract**: A new endpoint (e.g. `POST /:id/entries/:entryId/translations`) taking a single target language code, calling Anthropic for just that entry's `word_or_phrase` + that one language, and inserting one new `entry_translations` (+ `entry_sentences`) row pair — reusing the same generation logic as the main translate route, scoped to one language instead of all of the collection's.

### Success Criteria:

#### Automated Verification:

- Backend type checking passes: `cd backend && npm run build:ts`
- Backend test suite passes: `cd backend && npm test`

#### Manual Verification:

- Creating a collection with 3-5 target languages succeeds; a capture against it returns results for all configured languages in one action
- Saving persists one translation+sentence pair per target language
- Deliberately breaking one language's generation (e.g. an invalid language code) shows that language's section in an error/retry state while the others render normally
- Adding a new target language to an existing collection, then using the per-entry "add language" action on an older entry, adds exactly that one entry's translation without touching any other entry in the collection

---

## Testing Strategy

### Unit Tests:

- Anthropic plugin: constructs correctly from config, decorates the instance (mirroring `neon.ts`'s existing test coverage pattern if any, or a minimal smoke test)
- Rate-limit configuration: per-user (not per-IP) keying

### Integration Tests:

- Full collection-with-languages create → translate → save → read-back cycle (Phases 1-3), using a stubbed/mocked Anthropic client so CI doesn't make live paid API calls
- Cascade deletes still work with the new columns/tables in place

### Manual Testing Steps:

1. Create a collection with a native + target language pair through the web app
2. Load the extension, log in independently, confirm the collection appears as active
3. Capture a word in either language, review variants/phonetics/bilingual sentences, regenerate sentences, pick one, save
4. Confirm the entry appears in the web app's collection detail page with all the new fields populated
5. Repeat with a second collection using a different language pair, confirming the two don't interfere

## Performance Considerations

The NFR requires a "few seconds" response for translation/generation. The Anthropic call happens synchronously inside the Lambda request (matching the infra research's Lambda-over-App-Runner reasoning, which specifically chose Lambda's longer timeout over App Runner's hard 30s cap for this exact NFR) — apply the ~15s `AbortController` timeout from Phase 2 so a slow Anthropic response fails cleanly well before Lambda's own 29s API-Gateway-imposed ceiling (`api-construct.ts:75`), rather than the request just hanging until Lambda itself times out.

## Migration Notes

Both new migrations (Phase 1: collection languages; Phase 3: phonetics/gloss) are additive (`ADD COLUMN`, `CREATE TABLE`) against tables holding effectively zero real rows in any environment today, so no backfill step is needed — consistent with the same reasoning already used for word-collections' own uniqueness migration.

## References

- Related research: `context/changes/capture-translate-save/research.md`
- AI provider decision: `context/foundation/infrastructure.md:11,16,55,113`
- Existing collections route conventions: `backend/src/routes/api/collections/index.ts`
- Existing plugin pattern: `backend/src/plugins/neon.ts`, `backend/src/plugins/auth.ts`
- Existing schema: `backend/migrations/1784584360698_create-core-schema.ts`
- Existing Cognito/CORS infra: `infra/lib/constructs/api-construct.ts`, `infra/lib/constructs/auth-construct.ts`, `infra/lib/stacks/auth-stack.ts`
- Existing web-app auth flow (does not port to the extension as-is): `frontend/src/auth/cognito.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend + Frontend — Collection language configuration

#### Automated

- [x] 1.1 Migration applies and reverses cleanly: `cd backend && npm run migrate:up` then `npm run migrate:down` then `npm run migrate:up` again — 68f7d4b
- [x] 1.2 Backend type checking passes: `cd backend && npm run build:ts` — 68f7d4b
- [x] 1.3 Backend test suite passes: `cd backend && npm test` — 68f7d4b
- [x] 1.4 Frontend build passes: `cd frontend && npm run build` — 68f7d4b
- [x] 1.5 Frontend lint passes: `cd frontend && npm run lint` — 68f7d4b

#### Manual

- [x] 1.6 Creating a collection without language fields returns 400; with them returns 201 with fields echoed back — 68f7d4b
- [x] 1.7 GET endpoints include nativeLanguageCode/targetLanguageCodes on each collection — 68f7d4b
- [x] 1.8 Creating a collection through the updated web app form works end-to-end and survives a reload — 68f7d4b

### Phase 2: Backend — AI translation/generation endpoint

#### Automated

- [x] 2.1 Backend type checking passes: `cd backend && npm run build:ts` — 3b2ed69
- [x] 2.2 Backend test suite passes: `cd backend && npm test` — 3b2ed69

#### Manual

- [x] 2.3 POST /api/collections/:id/translate returns several variants with phonetics and nested sentence candidates with native glosses — 3b2ed69
- [x] 2.4 Re-calling translate ("regenerate") returns a fresh set of sentences — 3b2ed69
- [x] 2.5 Exceeding the rate limit returns 429 — 3b2ed69
- [x] 2.6 An artificially short timeout demonstrates the clean-error path — 3b2ed69

### Phase 3: Backend — Save endpoint & entry schema extensions

#### Automated

- [x] 3.1 Migration applies and reverses cleanly: `cd backend && npm run migrate:up` then `npm run migrate:down` then `npm run migrate:up` again
- [x] 3.2 Backend type checking passes: `cd backend && npm run build:ts`
- [x] 3.3 Backend test suite passes: `cd backend && npm test`

#### Manual

- [x] 3.4 Saving via curl/Postman creates entries + entry_translations (with phonetics) + entry_sentences (with native gloss) rows, confirmed against Postgres
- [x] 3.5 GET /api/collections/:id in the web app shows phonetics and the bilingual sentence pair for a freshly-saved entry
- [x] 3.6 Deleting the parent collection still cascades cleanly through entries → translations/sentences

### Phase 4: Extension — scaffold, auth, capture UI

#### Automated

- [ ] 4.1 No new backend/frontend regressions: `cd backend && npm test`, `cd frontend && npm run build && npm run lint`
- [ ] 4.2 CDK synthesizes cleanly with the new callback URL: `cd infra && npx cdk synth InkLingo-AuthStack -c stack=AuthStack`

#### Manual

- [ ] 4.3 Loading the unpacked extension in Firefox succeeds with no manifest errors
- [ ] 4.4 Logging in completes launchWebAuthFlow and lands back in the popup authenticated
- [ ] 4.5 Typing a native-language word and a target-language word each produce a normalized, correct result
- [ ] 4.6 Capturing, picking a variant + sentence, and saving creates a real entry visible in the web app
- [ ] 4.7 Regenerating sentences replaces only the sentences shown, not the variants/phonetics
- [ ] 4.8 A deliberately-triggered rate-limit shows a clean, non-crashing error state in the popup

### Phase 5: Multi-language expansion (deferred)

#### Automated

- [ ] 5.1 Backend type checking passes: `cd backend && npm run build:ts`
- [ ] 5.2 Backend test suite passes: `cd backend && npm test`

#### Manual

- [ ] 5.3 Creating a collection with 3-5 target languages succeeds; a capture returns results for all of them
- [ ] 5.4 Saving persists one translation+sentence pair per target language
- [ ] 5.5 Breaking one language's generation shows that language in an error/retry state while others render normally
- [ ] 5.6 The per-entry "add language" action adds exactly one entry's translation without touching other entries
