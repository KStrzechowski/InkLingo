# Anti-corruption layer: a translator port over the model provider — Implementation Plan

## Overview

Seal `@anthropic-ai/sdk` behind a one-method `Translator` port and a
`TranslationDraft` value object, so the provider's data shape stops being
InkLingo's wire contract. Today `toolUse.input` is cast unchecked at
`backend/src/ai/translate.ts:148`, returned as the HTTP body at
`backend/src/routes/api/collections/index.ts:249` with no response schema,
redeclared verbatim in `extension/src/types.ts:14-36`, and walked field by field
in React state — so the tool schema the model fills in *is* this product's wire
contract.

This change is **structural only**. The tool schema, system prompt and model id
move byte-identical into the adapter, so no live API calls are required and the
existing `measure-cost.mjs` baseline stays valid. The two provider-contract
improvements the source analysis proposed (`strict: true`, a required
`detectedLanguageCode`) are deliberately deferred — see "What We're NOT Doing".

Source analysis: `context/domain/03-anti-corruption-layer.md`, written at
`a873099` and re-verified against `e1373f7` during planning.

## Current State Analysis

Verified at `e1373f7` (the only commit since the analysis is the analysis
document itself — `git diff --stat a873099..HEAD` touches one file).

**The grep baseline reproduces exactly.** `@anthropic-ai/sdk` is imported in
five files (`src/ai/translate.ts:1`, `src/fastify.d.ts:4`,
`src/plugins/anthropic.ts:2`, `test/helpers/anthropic.ts:1`,
`test/routes/api/entry-translations.test.ts:4`); `anthropicClient` appears seven
times across `backend/src` and `backend/test`; `claude-haiku` and
`return_translation` appear only at `translate.ts:3-4`. Neither
`backend/src/domain/` nor `backend/src/adapters/` exists.

**The leak crosses every layer.** `fastify.d.ts:29` decorates `anthropicClient:
Anthropic` onto `FastifyInstance`, so every route in the app can reach the SDK
with full type support and no import. `generateWithTimeout` (`index.ts:50-66`)
isolates a timeout and an exception — its own comment at `:41-49` claims only
that — while the provider's data shape, model id, retry policy and failure
vocabulary all pass through it intact. The backfill route reaches into
`result?.languages[0]?.variants[0]?.sentences[0]` (`index.ts:396-408`), trims
strings and blank-to-nulls the phonetics inline.

**Nothing validates the model's output.** `translate.ts:148` casts `unknown` to
`TranslationResult`. The only defences are `?? []` at `:151` and
`alignToRequested` (`:113-120`), which rebuilds the language list against what
was requested. Everything below `languageCode` passes through untouched. Neither
AI route declares `schema.response`, so Fastify serializes whatever object it is
handed.

**Retry policy is assembled from three layers and chosen by none.**
`plugins/anthropic.ts:17` constructs the client with no `maxRetries` and no
`timeout`, inheriting the SDK's documented defaults (2 retries, 10-minute
timeout). With `EMPTY_RESULT_RETRIES = 1` (`translate.ts:19`) that permits up to
six upstream calls per request. The route's 20 s `AbortController`
(`index.ts:21`, `:56-57`) caps wall clock under API Gateway's 29 s ceiling
(`infra/lib/constructs/api-construct.ts:75`), so this is not a live bug — but
`translate.ts:12-19` reasons about cost as though there were at most two calls.

**The contract exists twice and the test envelope four times.** The tool schema
and system prompt are duplicated byte for byte in
`context/changes/translation-pivot/measure-cost.mjs:38-85`, the instrument
`lessons.md:33-38` and `translation-pivot/change.md:252-254` both depend on. The
SDK response envelope is hand-rebuilt at `test/helpers/anthropic.ts:7-15`,
`:19-31`, `:33-39` and again privately at `entry-translations.test.ts:18-26`.

**Two findings from planning that the source analysis does not reconcile:**

1. *The doc's "phases 1–6 are wire-compatible by construction" is not quite
   true.* § 4.4 has the adapter throw `DegenerateDraftError` when every language
   comes back empty, which `draftWithTimeout` turns into a 502. Today that path
   returns **200 with empty variants** — `test/routes/api/translate.test.ts:151`
   asserts `statusCode 200` and `deepStrictEqual(body.languages[0].variants, [])`.
   Resolved as a deliberate behavior change (Decision 1 below).
2. *The doc's phases 3 and 4 cannot be separately green.*
   `test/helpers/anthropic.ts:3` imports `TRANSLATION_TOOL_NAME` from
   `src/ai/translate.ts`, and every translate test assigns `app.anthropicClient`.
   The moment the `fastify.d.ts` swap lands and `ai/translate.ts` is deleted, the
   suite cannot compile — so `npm test`, the phase gate, cannot pass between
   them. Keeping both decorators alive across the boundary would make the
   provider reachable from two places at once, which is what the doc's ordering
   exists to prevent. Merged into Phase 3 here.

## Desired End State

`backend/src/adapters/anthropicTranslator.ts` is the only file in `backend/src/`
that imports `@anthropic-ai/sdk`, and `backend/test/adapters/anthropicTranslator.test.ts`
is the only test that builds an SDK response envelope. Every route reaches a
one-method `Translator` port; no route can obtain a provider client. Provider
payloads enter the domain through exactly one total function,
`TranslationDraft.fromProviderPayload`, which either produces a valid draft or
raises `MalformedDraftError` — there is no cast and no third outcome.

Verified two ways, because neither substitutes for the other:

- **Mechanically**, by the three greps in the phase success criteria below,
  enforced as a committed test rather than a documented command.
- **Structurally**, by the claim that adding an Azure adapter would touch four
  files (`adapters/azureTranslator.ts`, `plugins/translator.ts`,
  `plugins/config.ts`, `infra/lib/cdk-ssm-params.ts`) and **no** migration, route
  handler, request or response schema, client type, or UI component.

### Key Discoveries:

- The doc's grep baseline reproduces exactly at `e1373f7` — 5 files, 7
  `anthropicClient` references, model id and tool name confined to
  `translate.ts:3-4`.
- `fastify.d.ts:29` is the load-bearing line: removing `anthropicClient: Anthropic`
  from `FastifyInstance` is what makes the SDK unreachable from route code, and
  it is a one-line diff.
- **The frontend never consumes the translate shape.**
  `grep -rn "variants|TranslationResult|normalizedNativeText" frontend/src frontend/e2e`
  returns nothing, so the client cleanup is extension-only.
  `frontend/src/api/collections.ts` duplicates collection types, not translation
  types.
- `App.tsx:236-243` fires when **any** language is empty, not only when all are —
  so `isDegenerate()` (all-empty) does not cover it, and deleting the popup
  branch without a server-side replacement would silently drop the partial case.
- `reportFromPopup` (`extension/src/messages.ts:53`) already has a backend sink
  at `POST /api/client-errors` (`backend/src/routes/api/client-errors/index.ts`),
  so moving degradation reporting server-side moves it out of that table and into
  pino logs — a real change in where the number is queried.
- `backend/src/routes/api/collections/schemas.ts` already uses
  `Static<typeof schema>` for every request body (`:16`, `:20`), so typing the
  wire projection from a TypeBox schema follows the established pattern rather
  than introducing one.
- `alignToRequested` and the empty-result retry are tested through the HTTP layer
  today (`translate.test.ts:80`, `:115`, `:151`, `:180`). Those behaviours move
  down into the domain and the adapter, so the tests move with them.

## What We're NOT Doing

- **No tool-schema or system-prompt change.** `strict: true` (D-2) and a required
  `detectedLanguageCode` (D-1) are deferred. Both alter what we send the model,
  which triggers the live-API gate in `lessons.md:33-39` (≥12 varied captures, a
  fresh cost/latency measurement) and invalidates the `measure-cost.mjs`
  baseline. Keeping the schema byte-identical makes this entire change verifiable
  from the stubbed suite plus three greps — and lands the follow-up in one file,
  which is the ACL demonstrating its own value.
- **No live API calls at any point in this plan**, including Phase 0. The
  existing baseline stays valid precisely because nothing about the request
  changes.
- **No `TranslationDraft.detectedLanguageCode` field and no
  `RequestedLanguages.accepts()`.** Both exist in the source analysis only to
  serve D-1. Building an acceptance rule against a field the model is not asked
  to return would be dead code. `RequestedLanguages` still owns alignment.
- **No `senses` on the wire.** The domain uses `senses`; `toWire()` emits
  `variants`, exactly as `03-anti-corruption-layer.md` § 4.1 specifies, so
  nothing outside the backend changes shape. The rename lands in `toWire()` when
  `02-invariant-aggregate-refactor.md` is planned.
- **No change to `App.tsx:283-290`'s regenerate reconciliation.** Pairing a fresh
  response against the user's selection by meaning needs a stable sense identity,
  which belongs to doc 02's `senseKey()`. § 5.5 of the source analysis is honest
  about this and so is this plan.
- **No shared-types package.** The clients keep hand-copying the wire types
  (`tech-stack.md:27-29`). What changes is *what* they copy: a contract this
  codebase produces instead of a shape a vendor's model emitted.
- **No new or renamed routes**, therefore no `infra/lib/constructs/api-construct.ts`
  change (`lessons.md:26-32`). Stated so the next reader does not re-derive it.
- **The three smaller leaks are out of scope**: L-3 (`NeonDbError` +
  `UNIQUE_VIOLATION` in `index.ts:4,17,148`), L-4 (`axios.isAxiosError` in two
  frontend pages), L-5 (duplicated Web Speech wrappers). Recorded in § 6.4 of the
  source analysis.

## Implementation Approach

Six decisions taken during planning shape every phase below.

| # | Decision | Choice | Why |
| --- | --- | --- | --- |
| 1 | All-empty draft | **502**, via `DegenerateDraftError` | `lessons.md:37` — "a 200 that is useless to the user is invisible to every other layer". A 502 lands in the existing error path and is counted server-side across all users. Puts "is this draft usable?" in the one object that should own it. |
| 2 | Tool schema (D-1/D-2) | **Deferred**, schema moves byte-identical | Keeps the change verifiable without live API calls and preserves the cost baseline. Follow-up edits one file. |
| 3 | Scope | **All phases, including the extension** | Closes the leak end-to-end; the frontend is unaffected, so the client surface is one app. |
| 4 | Partial-empty reporting | **Server-side log**; `App.tsx:236-243` deleted | The count becomes complete — today it covers only popups that stayed open long enough to report. |
| 5 | Transport policy (D-3) | **`maxRetries: 1`, `timeout: 15_000`** in the adapter | A per-client transport setting, not a prompt change, so it needs no live gate. Worst case drops from six upstream calls to four inside the route's 20 s abort. |
| 6 | Wire type source of truth | **TypeBox schema**, `toWire(): TranslateResponseBody` | Drift becomes a compile error instead of a silently stripped field. Matches `schemas.ts:16,20`. |

The ordering guarantees the provider is never reachable from two places at once:
the domain is built and tested in isolation (Phase 1), the adapter is built
against it (Phase 2), and the swap plus the test migration happen in one atomic
phase (Phase 3) because the compiler will not permit them apart.

## Critical Implementation Details

**Type-only import across the layer boundary.** Decision 6 puts the response
schema in `routes/api/collections/schemas.ts` and has the domain's `toWire()`
return that type. Import it as `import type { TranslateResponseBody } from
'../routes/api/collections/schemas.ts'` — a type-only import is erased at
runtime, so the domain gains a compile-time dependency on the routes layer but no
runtime one. A value import here would invert the dependency direction the ACL
exists to establish.

**The forcing import is mandatory in the new plugin.** `lessons.md:19-24` records
this trap being hit twice, most recently in `plugins/anthropic.ts` itself, where
it failed 4–5 of 39 tests non-deterministically. `plugins/translator.ts` reads
`fastify.config` and must carry `import type { AuthUser as _AuthUser } from
'../fastify.d.ts'`.

**Where the empty-draft retry lives.** It stays in the adapter, not the route and
not the value object: only the adapter knows a re-ask is cheap *for this
provider* (`translate.ts:12-19` measured ~167 output tokens, ~1.3 s). A different
provider's adapter is free to choose differently. This means the retry tests move
from `translate.test.ts` down to the adapter test, where `calls()` can observe
them.

**Verify the boundary test by breaking it.** `lessons.md:62-67` — a gate verified
only in the happy case has been shown to run exactly once. Add an
`@anthropic-ai/sdk` import to a route file, watch the test go red, then remove
it. Do not merge on a green first run alone.

---

## Phase 0: Baseline

### Overview

Record the numbers this refactor is measured against, before anything is written.
Read-only. No live API calls — the request does not change in this plan, so the
existing `measure-cost.mjs` baseline carries over untouched.

### Changes Required:

#### 1. Record the baseline in the change folder

**File**: `context/changes/anti-corruption-layer/change.md`

**Intent**: Capture the three grep counts and the current backend test count
under `## Notes`, so the "after" numbers in Phase 3 have something to compare
against that is not this plan's prose.

**Contract**: Appends a short baseline block naming the measured values and the
commit they were taken at.

### Success Criteria:

#### Automated Verification:

- `grep -rl "@anthropic-ai/sdk" backend/src backend/test` returns 5 files
- `grep -rn "anthropicClient" backend/src backend/test | wc -l` returns 7
- `grep -rn "claude-haiku\|return_translation" backend/src backend/test` returns 2 hits, both in `translate.ts`
- `cd backend && npm test` passes, and the test count is recorded

#### Manual Verification:

- Confirm no live API call was made in this phase

---

## Phase 1: Domain core

### Overview

Create `backend/src/domain/` with the value object, the port and the error
taxonomy, plus the TypeBox response schema that types the wire projection. Pure —
no provider import, no Fastify import, no database. Nothing is wired up yet, so
the running application is unchanged.

### Changes Required:

#### 1. The wire contract, declared once

**File**: `backend/src/routes/api/collections/schemas.ts`

**Intent**: Declare the translate response as a TypeBox schema so it becomes the
single source of truth for both Fastify's serializer (Phase 4) and the domain's
`toWire()` return type. Decision 6.

**Contract**: Adds `translateResponseSchema` and
`export type TranslateResponseBody = Static<typeof translateResponseSchema>`,
following the existing pattern at `:16` and `:20`. The shape must match today's
response byte for byte —
`{ normalizedNativeText: string, languages: [{ languageCode: string, variants: [{ meaningText: string, phoneticTranscription: string | null, sentences: [{ targetText: string, nativeGlossText: string }] }] }] }`
— because the extension is side-loaded and an older popup must keep parsing it.

#### 2. The value object

**File**: `backend/src/domain/translationDraft.ts` (new)

**Intent**: The single home for a draft's shape, how to build one from an
untrusted payload, whether it is usable, how to project it onto the wire, and how
to project one language onto the rows that get persisted. This is the file that
makes the cast at `translate.ts:148` stop existing.

**Contract**: Exports `DraftSentence`, `DraftSense`, `DraftLanguage`,
`PersistableRendering`, `RequestedLanguages` (with `of()`, holding
`nativeLanguageCode` and `targetLanguageCodes`), and the `TranslationDraft` class
with a private constructor and the methods below. Internal vocabulary is
`senses`; `variants` appears only as an input key inside `fromProviderPayload`
and as an output key inside `toWire()`.

- `static fromProviderPayload(payload: unknown, requested: RequestedLanguages): TranslationDraft`
- `isDegenerate(): boolean` — every requested language came back with no sense
- `degenerateLanguageCodes(): readonly string[]` — the subset that came back empty
- `renderingFor(languageCode: string): PersistableRendering | null`
- `toWire(): TranslateResponseBody`
- `billableCharacters(): number` — `research.md:1010-1014`'s spend meter

`fromProviderPayload` is the one non-obvious function in this plan and the
contract other phases depend on, so its shape is fixed here:

```
fromProviderPayload(payload, requested):
    require payload is a non-null object                        else MalformedDraftError
    require payload.normalizedNativeText is a non-empty string  else MalformedDraftError
    returned := payload.languages is an array ? payload.languages : []

    # alignToRequested (translate.ts:113-120) moves here unchanged in behaviour:
    # rebuild against what was asked for, so a skipped language is empty rather
    # than absent and a reordered response is re-keyed rather than trusted.
    languages := for each code in requested.targetLanguageCodes:
        match := returned.find(l => trim(lower(l.languageCode)) === code)
        { languageCode: code, senses: parseSenses(match?.variants) }

    return new TranslationDraft(payload.normalizedNativeText, languages)

parseSenses(raw):
    if raw is not an array: return []
    for each entry:
        skip unless meaningText is a non-empty string
        phoneticTranscription := (is string and non-blank after trim) ? trimmed : null
        sentences := parseSentences(entry.sentences)   # same skip rules
        skip if sentences is empty        # a sense with no example teaches nothing
        yield { meaningText: trim(entry.meaningText), phoneticTranscription, sentences }
```

Two properties are the reason this function exists, and the tests below assert
both: it is **total** (every payload becomes a valid draft or raises
`MalformedDraftError` — no third outcome, no cast), and it is **provider-shaped
in, domain-shaped out** (`payload.languages[].variants` is the last place in the
codebase where the provider's word for a sense appears in a data path).

`renderingFor` absorbs the trimming and blank-to-null normalization currently
inlined at `index.ts:404-408`, so the route never does string hygiene again.

#### 3. The port and the error taxonomy

**File**: `backend/src/domain/translator.ts` (new)

**Intent**: The narrowest interface that still lets a route do its job, plus the
three errors that carry no provider type.

**Contract**: `TranslationRequest { text, languages: RequestedLanguages, signal: AbortSignal }`;
`Translator { draft(request): Promise<TranslationDraft> }`;
`TranslatorUnavailableError` (carrying `cause: unknown`), `MalformedDraftError`,
`DegenerateDraftError` (carrying `languageCodes: readonly string[]`).

Note what is absent: no client parameter. `generateTranslation(client: Anthropic, …)`
(`translate.ts:155`) has the provider in its public signature; `draft(request)`
does not. A caller of the port cannot obtain a provider client — that is the
structural difference between a seam and a passthrough. `AbortSignal` is a
platform type, not a provider type, so it is allowed here for the same reason
`RequestedLanguages` is and `Anthropic` is not.

#### 4. Domain unit tests

**File**: `backend/test/domain/translationDraft.test.ts` (new)

**Intent**: Test-first. Feed `fromProviderPayload` the malformed payloads that
reach the extension's React state today, and assert each one is rejected or
normalized rather than passed through.

**Contract**: Covers, at minimum — `meaningText: 42`; a missing `languages` key;
`languages` present but not an array; a reordered language list; a response
containing an unrequested language code; a language the model skipped entirely;
`phoneticTranscription: ''` normalizing to `null`; a sense with an empty
`sentences` array being dropped; a non-object payload and a blank
`normalizedNativeText` both raising `MalformedDraftError`. Plus `isDegenerate()`
true for all-empty and false for partial, `degenerateLanguageCodes()` on a
partial draft, `renderingFor()` returning trimmed and normalized fields,
`renderingFor()` returning `null` for a language with no usable sense, and
`toWire()` emitting `variants` with today's exact shape.

The reordering and skipped-language cases are `alignToRequested`'s behaviour
moving down from `translate.test.ts:80`; assert them here so the route tests can
stop caring.

### Success Criteria:

#### Automated Verification:

- Backend suite passes: `cd backend && npm test`
- Type check passes: `cd backend && npm run build:ts`
- `grep -rn "@anthropic-ai/sdk" backend/src/domain` returns nothing
- `grep -rn "from 'fastify'" backend/src/domain` returns nothing

#### Manual Verification:

- The domain test file reads as a specification of "what the model may legally do
  to us" — someone unfamiliar with the change can see which failure modes are
  covered

---

## Phase 2: The adapter

### Overview

Create `backend/src/adapters/anthropicTranslator.ts` — the only file in
`backend/src/` permitted to import `@anthropic-ai/sdk`. The tool schema, system
prompt, model id and token formula move out of `ai/translate.ts`
**byte-identical** (Decision 2). Transport policy is chosen rather than inherited
(Decision 5). Still not wired up: `ai/translate.ts` remains in place and in use.

### Changes Required:

#### 1. The adapter

**File**: `backend/src/adapters/anthropicTranslator.ts` (new)

**Intent**: Implement `Translator` over the Anthropic SDK. Own the provider's
configuration, its transport policy, its failure modes and its retry — and hand
the domain nothing but a `TranslationDraft`.

**Contract**: Exports `ANTHROPIC_MODEL`, `TRANSLATION_TOOL_NAME`,
`MAX_TOKENS_PER_LANGUAGE`, `translationTool`,
`systemPrompt(languages: RequestedLanguages): string` — all five exported so
`measure-cost.mjs` can stop copying them in Phase 5 — and
`createAnthropicTranslator(options: { apiKey: string, log: { error: (o: object, msg: string) => void } }): Translator`.

`translationTool` is `translate.ts:49-107` moved verbatim, `minItems` advisory
comment and all. `systemPrompt` is `translate.ts:133-135` moved verbatim, with
the interpolation reading from `RequestedLanguages` instead of loose parameters.
Nothing about the bytes sent to the model changes in this phase — that is what
keeps the cost baseline valid and the live gate unnecessary.

The client is constructed with `maxRetries: 1` and `timeout: 15_000`
(milliseconds, per the SDK's TypeScript contract) instead of the unconfigured
defaults. Worst case becomes four upstream calls per request (two application
attempts × two SDK tries) inside the route's 20 s abort, down from six.

`draft()` calls the provider, finds the `tool_use` block by name, and passes
`block.input` to `TranslationDraft.fromProviderPayload` — the one crossing point.
It retries once while `isDegenerate()` (`EMPTY_DRAFT_RETRIES = 1`, the same
constant and the same reasoning as `translate.ts:19`), then throws
`DegenerateDraftError(draft.degenerateLanguageCodes())`. A thrown SDK exception
or a missing `tool_use` block becomes `TranslatorUnavailableError`. The log line
moves from `'anthropic translate call failed'` to a provider-neutral
`'translator provider call failed'` — the string an operator greps for should not
name a vendor the rest of the system cannot see.

#### 2. Adapter tests

**File**: `backend/test/adapters/anthropicTranslator.test.ts` (new)

**Intent**: The one test file allowed to build an SDK response envelope, tested
directly against the one file that consumes one.

**Contract**: Covers a successful call producing a valid draft; the
empty→populated sequence retrying exactly once (`calls()` observing 2 — this is
`translate.test.ts:115` moving down); an always-empty sequence stopping after two
attempts and throwing `DegenerateDraftError` with the right language codes (this
is `translate.test.ts:151` moving down, and where its 200-vs-502 question is now
answered); a partially-empty response **not** retrying and **not** throwing (from
`translate.test.ts:180`); a thrown SDK error becoming
`TranslatorUnavailableError`; and a response with no `tool_use` block becoming
`TranslatorUnavailableError`.

### Success Criteria:

#### Automated Verification:

- Backend suite passes: `cd backend && npm test`
- Type check passes: `cd backend && npm run build:ts`
- Tool schema and system prompt are byte-identical to `translate.ts:49-107` and `:133-135` (diff the moved literals against `git show HEAD:backend/src/ai/translate.ts`)
- `grep -rln "@anthropic-ai/sdk" backend/src` returns exactly `src/ai/translate.ts`, `src/fastify.d.ts`, `src/plugins/anthropic.ts`, `src/adapters/anthropicTranslator.ts`

#### Manual Verification:

- Read the moved tool schema and system prompt side by side with the originals
  and confirm no wording drifted — a single changed character here silently
  invalidates the cost baseline this decision was taken to protect

---

## Phase 3: Wiring, routes and test migration

### Overview

The atomic swap. `plugins/translator.ts` replaces `plugins/anthropic.ts`,
`fastify.d.ts` drops the SDK for the port, both routes call `fastify.translator`,
the test suite migrates to a fake, and `ai/translate.ts` is deleted. These cannot
be separate phases: the tests assign `app.anthropicClient` and import from
`ai/translate.ts`, so the moment either goes away the suite stops compiling.

This is the phase that changes user-visible behavior (Decision 1) and the phase
where the greps hit target.

### Changes Required:

#### 1. The plugin

**File**: `backend/src/plugins/translator.ts` (new), `backend/src/plugins/anthropic.ts` (deleted)

**Intent**: Decorate the port onto Fastify. The application's only knowledge of
which provider is active is the factory name on one line.

**Contract**: `fp(async (fastify) => { fastify.decorate('translator', createAnthropicTranslator({ apiKey: fastify.config.anthropicApiKey, log: fastify.log })) }, { name: 'translator', dependencies: ['config'] })`.
Must carry the forcing import
`import type { AuthUser as _AuthUser } from '../fastify.d.ts'` —
`lessons.md:19-24`, the trap this repo has hit twice, most recently in the very
file being deleted here.

#### 2. The type surface

**File**: `backend/src/fastify.d.ts`

**Intent**: The load-bearing one-line diff. Today `:29` puts an `Anthropic`
instance on `FastifyInstance`, so every route can reach the SDK with no import.
After this, the widest thing any route can reach is a one-method port.

**Contract**: Delete the `@anthropic-ai/sdk` import at `:4`; replace
`anthropicClient: Anthropic` at `:29` with `translator: Translator`, imported
from `./domain/translator.ts`.

#### 3. The capture route

**File**: `backend/src/routes/api/collections/index.ts`

**Intent**: Stop returning the model's object. Map the error taxonomy to HTTP in
one place, and log partial degradation server-side (Decision 4).

**Contract**: `generateWithTimeout` (`:50-66`) becomes `draftWithTimeout`,
returning `TranslationDraft | null` and calling `fastify.translator.draft(...)`.
The route keeps its own `AbortController` and `TRANSLATE_TIMEOUT_MS` — 20 s is an
*application* deadline derived from API Gateway's 29 s ceiling
(`api-construct.ts:75`), not a provider setting. The import of
`generateTranslation`/`TranslationResult` at `:14` is removed.

`POST /:id/translate` (`:218-250`) ends `return draft.toWire()` instead of
`return result`. `DegenerateDraftError` and `TranslatorUnavailableError` both
reach the caller as the existing 502 (`'could not generate a translation — try
again'`), so all-empty stops being a 200 — **this is the deliberate behavior
change from Decision 1**. Before returning a usable draft, if
`degenerateLanguageCodes()` is non-empty the route emits one structured log line
carrying the codes and the total language count, so the partial case is counted
across all users instead of only in popups that stayed open (Decision 4).

#### 4. The backfill route

**File**: `backend/src/routes/api/collections/index.ts`

**Intent**: Replace the reach into the model's shape with a domain projection.

**Contract**: `:396-408`'s eleven lines — `result?.languages[0]?.variants[0]`,
`variant?.sentences[0]`, the `undefined` guards, the `.trim()` calls and the
inline blank-to-null — collapse to
`const rendering = draft?.renderingFor(languageCode)` plus a null check returning
the existing 502. `rendering.meaningText`, `.phoneticTranscription`,
`.sentenceText` and `.nativeGlossText` go straight into the INSERT, already
trimmed and normalized by the value object.

#### 5. The test fake

**File**: `backend/test/helpers/fakeTranslator.ts` (new), `backend/test/helpers/anthropic.ts` (deleted)

**Intent**: One fake implementing the port, with no SDK import and no cast. A
change to the port becomes a compile error in every test, rather than a cast that
keeps compiling.

**Contract**: `fakeTranslator(drafts: TranslationDraft[]): Translator & { calls: () => number }`
returning each draft in turn then repeating the last, and
`failingTranslator(err: Error): Translator`. Maps the three existing behaviours
(success, sequence, failure) one for one; `stubAnthropicSequence`'s `calls()`
counter survives as `calls()`. Tests build their drafts via
`TranslationDraft.fromProviderPayload(payload, requested)` so fixtures stay
readable while still travelling the validated path.

#### 6. Test migration

**File**: `backend/test/routes/api/translate.test.ts`, `backend/test/routes/api/entry-translations.test.ts`, `backend/test/routes/api/collections-rate-limit.test.ts`

**Intent**: Move every test onto the fake, delete the private SDK envelope, and
push the retry/alignment cases down to the layers that now own them.

**Contract**: `entry-translations.test.ts` drops its `@anthropic-ai/sdk` import
(`:4`), its private `stubAnthropic` (`:18-26`) and its `ai/translate.js` import
(`:8`), using `fakeTranslator` instead. `collections-rate-limit.test.ts` swaps
`stubAnthropicSuccess` + `STUB_PAYLOAD` for a fake. In `translate.test.ts`: the
reorder/backfill case (`:80`) and the two retry cases (`:115`, `:151`) move to
Phases 1 and 2 respectively; `:151`'s route-level assertion becomes
**`statusCode 502`** with its comment rewritten to say why an all-empty draft is
now a failure rather than an answer; the partial-empty case (`:180`) stays at 200
and gains an assertion that the degradation log line was emitted; the remaining
cases (blank text 400, cross-user 404, provider failure 502) keep their current
assertions against the fake.

#### 7. Delete the old module

**File**: `backend/src/ai/translate.ts` (deleted)

**Intent**: Its contents now live in the value object (domain-shaped) or the
adapter (provider-shaped), and the split between the two is the whole point.

**Contract**: The directory `backend/src/ai/` is removed. No import of it may
remain anywhere.

#### 8. The boundary test

**File**: `backend/test/architecture/providerBoundary.test.ts` (new)

**Intent**: Turn the success criterion into a gate that fails in CI, rather than
a command documented in a plan nobody re-runs.

**Contract**: Reads project source as plain text — the technique
`backend/test/route-reachability.test.ts` already uses to catch drift without AWS
credentials (`lessons.md:30`). Asserts that the set of files under `backend/src`
and `backend/test` containing `@anthropic-ai/sdk` is exactly
`{src/adapters/anthropicTranslator.ts, test/adapters/anthropicTranslator.test.ts}`,
and that `claude-haiku` and `return_translation` appear nowhere outside those two
files. **Verify it by making it fail** (`lessons.md:62-67`): add an SDK import to
a route, confirm red, remove it.

### Success Criteria:

#### Automated Verification:

- Backend suite passes: `cd backend && npm test`
- Type check passes: `cd backend && npm run build:ts`
- `grep -rl "@anthropic-ai/sdk" backend/src backend/test` returns exactly `backend/src/adapters/anthropicTranslator.ts` and `backend/test/adapters/anthropicTranslator.test.ts`
- `grep -rn "anthropicClient\|TranslationResult\|toolUse\|tool_use" backend/src/routes backend/src/plugins` returns nothing
- `grep -rn "claude-haiku\|return_translation" backend/src backend/test | grep -v "backend/src/adapters/\|backend/test/adapters/"` returns nothing
- `backend/src/ai/` no longer exists
- `backend/test/route-reachability.test.ts` passes (no route added or renamed, so `api-construct.ts` needs no edit — `lessons.md:26-32`)
- The boundary test fails when an SDK import is added to a route file, and passes when it is removed

#### Manual Verification:

- `npm run dev` in `backend/`, capture a word through the extension against the
  local backend, confirm a normal translate still returns the same JSON the popup
  already renders
- Force the all-empty path (temporarily return an empty draft from the adapter)
  and confirm the popup shows a readable error rather than a blank or broken panel
- Confirm the partial-degradation log line appears in `npm run dev` output with
  the expected language codes

---

## Phase 4: Response schemas

### Overview

Attach `schema.response` to both AI routes, closing the gap where no point in the
system checks the response against a contract we own. Cheap now that one function
produces the body; impossible while the body *was* the model's object.

### Changes Required:

#### 1. Wire the schema onto the routes

**File**: `backend/src/routes/api/collections/index.ts`

**Intent**: Make Fastify serialize against the contract declared in Phase 1
rather than against whatever object it is handed.

**Contract**: `POST /:id/translate` gains `schema.response = { 200: translateResponseSchema }`.
The backfill route gains a `201` response schema matching its existing
`{ entryId, translation, sentence }` body. Because Fastify **strips** any
property the schema does not declare, both schemas must be verified field by
field against the current responses — a missing declaration silently drops a
field rather than erroring.

#### 2. Serialization tests

**File**: `backend/test/routes/api/translate.test.ts`, `backend/test/routes/api/entry-translations.test.ts`

**Intent**: Prove nothing was stripped.

**Contract**: Assert the full response body deep-equals the expected object for
one populated translate and one backfill — not just spot-checked fields, since
field-stripping is exactly the failure mode a spot check misses.

### Success Criteria:

#### Automated Verification:

- Backend suite passes: `cd backend && npm test`
- Type check passes: `cd backend && npm run build:ts`
- Removing a property from `translateResponseSchema` turns the deep-equal assertion red rather than passing silently

#### Manual Verification:

- Capture a word through the local extension after the schema lands and confirm
  every field the popup renders is still present — phonetics, glosses and
  sentence text included

---

## Phase 5: De-fork the cost instrument

### Overview

`context/changes/translation-pivot/measure-cost.mjs` carries a hand-copied second
copy of the tool schema, system prompt, model id, tool name and token formula. It
is the instrument `lessons.md:33-38` and `translation-pivot/change.md:252-254`
both depend on, and nothing detects when the two copies diverge.

### Changes Required:

#### 1. Import the contract instead of copying it

**File**: `context/changes/translation-pivot/measure-cost.mjs`

**Intent**: The script keeps constructing its own client and calling the API
directly — that is what a cost instrument is for, and routing it through the port
would measure the wrong thing. What it stops doing is defining the contract a
second time.

**Contract**: Replaces `:29-30`, `:38-81`, `:83-85` and `:90-97` with a single
import of `ANTHROPIC_MODEL`, `TRANSLATION_TOOL_NAME`, `MAX_TOKENS_PER_LANGUAGE`,
`translationTool` and `systemPrompt` from
`backend/dist/adapters/anthropicTranslator.js`. Since it reads from `dist/`, add
a header comment noting `npm run build:ts` in `backend/` as a prerequisite. The
SDK import at `:20-22` stays — it is a provider-measurement instrument, and that
is its job.

### Success Criteria:

#### Automated Verification:

- `cd backend && npm run build:ts`, then `node --check context/changes/translation-pivot/measure-cost.mjs` passes
- `grep -n "return_translation\|claude-haiku\|You are a translation assistant" context/changes/translation-pivot/measure-cost.mjs` returns only the import line

#### Manual Verification:

- Confirm the script resolves its imports to the point of needing an API key,
  without a `MODULE_NOT_FOUND` or undefined-export error. **Do not run a live
  measurement** — this change alters nothing about the request, so the existing
  baseline stands, and live calls need explicit permission

---

## Phase 6: Extension cleanup

### Overview

Remove the last place where knowledge of one provider's output distribution lives
in a React component, and re-point `extension/src/types.ts` at a contract this
codebase owns. Client-only — the wire bytes have not changed since Phase 1, so an
already-installed popup keeps working throughout.

### Changes Required:

#### 1. Delete the degradation counting

**File**: `extension/src/popup/App.tsx`

**Intent**: `:231-243` counts languages with empty `variants` and reports a
`DegradedAiResult`. The all-empty half is now a 502 the existing `catch` already
handles, and the partial half is logged server-side as of Phase 3 (Decision 4).
Keeping it would count one condition twice in two systems.

**Contract**: Delete `:231-243` including its comment. `setCapture` and
`setSelections` on the following lines stay untouched. The empty-language render
branch (`:507-511`, "Nothing came back for this language") **stays** — a partial
response still needs it. The regenerate reconciliation at `:283-301`, including
its own `DegradedAiResult` report at `:298`, **also stays**: it depends on a
stable sense identity that doc 02 owns.

#### 2. Confirm the 502 path reads well

**File**: `extension/src/popup/App.tsx`

**Intent**: All-empty now arrives as a 502 rather than a 200 with empty sections,
so it flows through `catch` → `errorText(err)` instead of the empty-language
copy. That message is now user-facing for a case it was never written for.

**Contract**: Verify `errorText` renders the backend's `'could not generate a
translation — try again'` legibly, and adjust the copy only if it reads as a
generic network failure. No new error state or component.

#### 3. Re-source the wire types

**File**: `extension/src/types.ts`

**Intent**: The interfaces at `:14-36` mirror the tool schema today. Re-point
them at `toWire()`'s contract so a future change to the wire type has one
upstream definition to trace, not a vendor's tool schema.

**Contract**: The declarations stay hand-written (`tech-stack.md:27-29` — no
shared package) and the JSON shape is unchanged, so this is a comment and
provenance change: the block comment at `:31-33` should name
`backend/src/routes/api/collections/schemas.ts`'s `translateResponseSchema` as
the source, and note that an all-empty response now arrives as a 502 rather than
as empty `variants` arrays.

### Success Criteria:

#### Automated Verification:

- `cd extension && npm run lint` passes
- `cd extension && npm run build` succeeds
- `cd extension && npx vitest run test/popup/App.test.tsx` passes
- `grep -n "DegradedAiResult" extension/src/popup/App.tsx` returns only the regenerate report (one hit)

#### Manual Verification:

- Load `extension/dist/manifest.json` via `about:debugging`, capture a word
  against a local backend, confirm the normal flow is unchanged
- Force the all-empty path in the backend and confirm the popup shows the error
  message rather than five empty sections
- Force a partial-empty response and confirm the "Nothing came back for this
  language" copy still renders for the affected language while the others display
  normally

---

## Testing Strategy

### Unit Tests:

- **Domain (Phase 1)** — `fromProviderPayload` against every malformed payload
  the extension can receive today: wrong types below `languageCode`, missing or
  non-array `languages`, reordered and skipped languages, unrequested codes, blank
  phonetics, senses with no sentences. Plus `isDegenerate` /
  `degenerateLanguageCodes` across all-empty, partial and populated drafts,
  `renderingFor`'s normalization, and `toWire()`'s exact output shape.
- **Adapter (Phase 2)** — retry behaviour observed through `calls()`, the
  `DegenerateDraftError` throw, `TranslatorUnavailableError` for both a thrown SDK
  error and a missing `tool_use` block. The only place an SDK envelope is built.

### Integration Tests:

- **Routes (Phase 3)** — both AI endpoints against `fakeTranslator`: success,
  ownership 404, blank-text 400, provider-failure 502, and the new all-empty 502.
  The partial-empty case asserts a 200 **and** that the degradation log line
  fired.
- **Serialization (Phase 4)** — full-body deep-equal on one translate and one
  backfill response, so a stripped field cannot pass.
- **Boundary (Phase 3)** — `providerBoundary.test.ts` asserts the SDK import set
  as plain text, verified by deliberate breakage.

### Manual Testing Steps:

1. `cd backend && npm run dev`; load the extension from `extension/dist` via `about:debugging`.
2. Capture a word into a multi-language collection — confirm the response renders exactly as before.
3. Back-fill an existing entry with a newly added language — confirm the saved translation and sentence are trimmed and correct.
4. Temporarily make the adapter return an all-empty draft; confirm a 502 and a readable popup error.
5. Temporarily make it return a partially-empty draft; confirm 200, the per-language empty copy, and the server-side degradation log line.
6. Add `import { Anthropic } from '@anthropic-ai/sdk'` to a route file; confirm `providerBoundary.test.ts` goes red; remove it.

## Performance Considerations

The transport change (Decision 5) reduces the worst case from six upstream calls
per request to four, all still bounded by the route's unchanged 20 s
`AbortController` and API Gateway's 29 s ceiling. The 15 s per-request SDK
timeout sits below the route's 20 s abort, so a hung provider call now fails
inside the adapter rather than being killed by the route — a slightly cleaner
failure with the same wall-clock ceiling.

`fromProviderPayload` adds a full structural walk of a payload that was
previously cast. The payload is at most five languages of a handful of senses, so
this is immaterial against a multi-second network call.

Phase 4's response schemas make Fastify serialize through a compiled serializer
instead of generic `JSON.stringify`, which is a small win rather than a cost.

## Migration Notes

No database migration, no schema change, no new environment variable, no SSM
parameter, and no infra edit — `plugins/config.ts`'s `anthropicApiKey` is read by
the adapter factory exactly as it was read by the deleted plugin.

**Deployment order and version skew.** The backend is a single deployable unit
and Phases 1–5 leave the wire JSON byte-identical, so any installed popup keeps
working across them. The one exception is the all-empty path, which changes from
200-with-empty to 502 in Phase 3: a pre-Phase-6 popup handles that through its
existing `catch`, showing an error message instead of five empty sections —
degraded copy, not a break. Phase 6 is client-only and the extension is
side-loaded manually (`extension/README.md`), so it can follow whenever
convenient.

**Rollback.** Every phase is a revertible commit. Phase 3 is the only one that
changes behavior; reverting it restores `plugins/anthropic.ts`, `ai/translate.ts`
and the old test helpers together, since they were deleted together for exactly
this reason.

## References

- Source analysis: `context/domain/03-anti-corruption-layer.md` (written at `a873099`, verified against `e1373f7`)
- Preceding domain work: `context/domain/01-domain-distillation.md`, `context/domain/02-invariant-aggregate-refactor.md`
- The declaration this plan makes true: `context/changes/translation-pivot/change.md:209-211`, `decision-brief.md:85-87`
- The claim this plan corrects: `context/changes/translation-pivot/research.md:1020-1026` names `generateWithTimeout` as an existing provider-agnostic seam; it is not one, and that sentence should be corrected once this lands
- Binding lessons: `context/foundation/lessons.md:19-24` (forcing import), `:26-32` (no new routes here), `:33-39` (stubbed AI clients), `:62-67` (verify a gate by breaking it)
- Prior art for the boundary test: `backend/test/route-reachability.test.ts`

### Load-bearing names introduced

`docs/reference/contract-surfaces.md` does not exist in this repo (re-checked at
`e1373f7`; `docs/` is absent), so these are recorded here and in `change.md`:

| Name | Kind |
| --- | --- |
| `Translator` | Port — `backend/src/domain/translator.ts` |
| `TranslationDraft` | Value object — the only home for the draft's shape |
| `TranslationDraft.fromProviderPayload` | The single crossing point from provider data into the domain |
| `RequestedLanguages` | Value object — owns alignment |
| `PersistableRendering` | Projection replacing `index.ts:396-408`'s reach-in |
| `toWire()` / `TranslateResponseBody` | The wire contract, produced rather than inherited |
| `billableCharacters()` | Spend meter for the pivot's budget requirement |
| `TranslatorUnavailableError`, `MalformedDraftError`, `DegenerateDraftError` | Error taxonomy carrying no provider type |
| `createAnthropicTranslator` | Adapter factory — the only exported function constructing a provider client |
| `backend/src/adapters/` | Directory forming the enforced grep boundary |

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 0: Baseline

#### Automated

- [x] 0.1 `grep -rl "@anthropic-ai/sdk" backend/src backend/test` returns 5 files — 5369a9c
- [x] 0.2 `grep -rn "anthropicClient" backend/src backend/test | wc -l` returns 7 — 5369a9c
- [x] 0.3 `grep -rn "claude-haiku\|return_translation" backend/src backend/test` returns 2 hits, both in `translate.ts` — 5369a9c
- [x] 0.4 `cd backend && npm test` passes and the test count is recorded — 5369a9c

#### Manual

- [ ] 0.5 Confirm no live API call was made in this phase

### Phase 1: Domain core

#### Automated

- [x] 1.1 Backend suite passes: `cd backend && npm test` — 5369a9c
- [x] 1.2 Type check passes: `cd backend && npm run build:ts` — 5369a9c
- [x] 1.3 `grep -rn "@anthropic-ai/sdk" backend/src/domain` returns nothing — 5369a9c
- [x] 1.4 `grep -rn "from 'fastify'" backend/src/domain` returns nothing — 5369a9c

#### Manual

- [ ] 1.5 The domain test file reads as a specification of the model's legal failure modes

### Phase 2: The adapter

#### Automated

- [x] 2.1 Backend suite passes: `cd backend && npm test` — 224e2f5
- [x] 2.2 Type check passes: `cd backend && npm run build:ts` — 224e2f5
- [x] 2.3 Tool schema and system prompt are byte-identical to `translate.ts:49-107` and `:133-135` — 224e2f5
- [x] 2.4 `grep -rln "@anthropic-ai/sdk" backend/src` returns exactly the four expected files — 224e2f5

#### Manual

- [ ] 2.5 Side-by-side read of the moved schema and prompt confirms no wording drift

### Phase 3: Wiring, routes and test migration

#### Automated

- [x] 3.1 Backend suite passes: `cd backend && npm test` — 9980860
- [x] 3.2 Type check passes: `cd backend && npm run build:ts` — 9980860
- [x] 3.3 `grep -rl "@anthropic-ai/sdk" backend/src backend/test` returns exactly the adapter and its test — 9980860
- [x] 3.4 `grep -rn "anthropicClient\|TranslationResult\|toolUse\|tool_use" backend/src/routes backend/src/plugins` returns nothing — 9980860
- [x] 3.5 `grep -rn "claude-haiku\|return_translation" backend/src backend/test | grep -v "adapters/"` returns nothing — 9980860
- [x] 3.6 `backend/src/ai/` no longer exists — 9980860
- [x] 3.7 `backend/test/route-reachability.test.ts` passes — 9980860
- [x] 3.8 Boundary test goes red on an SDK import added to a route, green when removed — 9980860

#### Manual

- [ ] 3.9 Local capture through the extension returns the same JSON the popup already renders
- [ ] 3.10 Forced all-empty path shows a readable popup error, not a blank panel
- [ ] 3.11 Partial-degradation log line appears with the expected language codes

### Phase 4: Response schemas

#### Automated

- [x] 4.1 Backend suite passes: `cd backend && npm test` — 7a62f42
- [x] 4.2 Type check passes: `cd backend && npm run build:ts` — 7a62f42
- [x] 4.3 Removing a property from `translateResponseSchema` turns the deep-equal assertion red — 7a62f42

#### Manual

- [ ] 4.4 Every field the popup renders is still present after the schema lands

### Phase 5: De-fork the cost instrument

#### Automated

- [x] 5.1 `cd backend && npm run build:ts`, then `node --check context/changes/translation-pivot/measure-cost.mjs` — a942ca1
- [x] 5.2 `grep -n "return_translation\|claude-haiku\|You are a translation assistant" context/changes/translation-pivot/measure-cost.mjs` returns only the import line — a942ca1

#### Manual

- [ ] 5.3 Script resolves its imports without `MODULE_NOT_FOUND` or an undefined export (no live measurement)

### Phase 6: Extension cleanup

#### Automated

- [x] 6.1 `cd extension && npm run lint` — e44a272
- [x] 6.2 `cd extension && npm run build` — e44a272
- [x] 6.3 `cd extension && npx vitest run test/popup/App.test.tsx` — e44a272
- [x] 6.4 `grep -n "DegradedAiResult" extension/src/popup/App.tsx` returns only the regenerate report — e44a272

#### Manual

- [ ] 6.5 Loaded popup capture flow is unchanged
- [ ] 6.6 Forced all-empty shows the error message, not five empty sections
- [ ] 6.7 Forced partial-empty still renders the per-language empty copy
