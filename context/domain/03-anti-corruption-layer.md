---
title: "InkLingo — the anti-corruption layer: a translator port over the model provider"
created: 2026-08-23
type: refactor-plan
author: KStrzechowski
git_commit: a873099
sources:
  - context/foundation/prd.md
  - context/foundation/tech-stack.md
  - context/foundation/lessons.md
  - context/domain/01-domain-distillation.md
  - context/domain/02-invariant-aggregate-refactor.md
  - context/changes/translation-pivot/{change,decision-brief,research}.md
  - context/changes/translation-pivot/measure-cost.mjs
  - backend/{src,test}/, extension/src/, frontend/src/, infra/lib/, .github/workflows/
method: discovery → identification → classification → diagnosis → design (steps 0–6)
scope: PLAN ONLY — no production code was modified while writing this
---

# The anti-corruption layer: a translator port over the model provider

A **refactor plan**, not an implementation. Every `file:line` below was opened
and read at commit `a873099`. Where the record is silent this document says so
rather than filling the gap, and where a claim rests on the SDK's own
documentation rather than on this repo, it is marked as such.

It follows `01-domain-distillation.md` (which mapped the domain) and
`02-invariant-aggregate-refactor.md` (which picked one invariant and designed
its guardian). This one asks a different question: **which external dependency
has escaped its layer**, and what single object should be the only thing in the
codebase that knows its shape.

---

## 0. Context discovered

### 0.1 What the documents declare about replaceability

The foundation documents — `prd.md`, `tech-stack.md`, `shape-notes.md`,
`roadmap.md` — contain **no replaceability claim at all**. A grep for
*wymien\* / swap / replace / pluggable / vendor / abstraction* across all four
returns one unrelated hit (`tech-stack.md:9`, `ci_provider`). The PRD is a
product document and deliberately captures no framework or vendor choices
(`.claude/CLAUDE.md` § "What the PRD captures (and what it does NOT)").

The declaration lives one level down, in the change record:

> `context/changes/translation-pivot/change.md:209-211`
> **"The translator is a provider-agnostic seam**, mirroring
> `generateWithTimeout`. This is what makes every provider decision above a
> config change rather than a re-plan."

> `context/changes/translation-pivot/decision-brief.md:85-87`
> "**MT behind a provider-agnostic seam, Azure as the default**, decided by a
> bake-off rather than reputation."

> `context/changes/translation-pivot/research.md:1020-1026`
> "Wire one narrow interface rather than calling a provider SDK from the route.
> The precedent already exists: `generateWithTimeout`
> (`backend/src/routes/api/collections/index.ts:50-66`) is exactly this shape
> for the Anthropic call."

That last quotation is the crux of this document, and it is **wrong on the
merits** — not maliciously, but because the seam it names is not one. § 3.2
shows what `generateWithTimeout` actually isolates (a timeout and an exception)
and what it lets straight through (the provider's data shape, its model id, its
retry policy, and its failure modes). The intent is on the record; the code does
not deliver it. That gap is the strongest single signal in this analysis.

The pivot is not hypothetical work. It is unparked and is the next architectural
change on the board (`change.md:217-228` records the parking; the work is now
live), which makes the cost of the leak a cost that is about to be paid.

### 0.2 Stack and external dependencies

Four independent npm projects, no workspace linking and no shared package
(`CLAUDE.md` § Project layout; `tech-stack.md:27-29` records the decoupling as a
deliberate, user-stated preference). Read from each `package.json`:

| Project | Runtime dependencies |
| --- | --- |
| `backend/` | `@anthropic-ai/sdk`, `@aws-sdk/client-ssm`, `@fastify/*`, `@neondatabase/serverless`, `@sinclair/typebox`, `aws-jwt-verify`, `dotenv`, `fastify`, `fastify-cli`, `fastify-plugin`, `node-pg-migrate`, `pg` |
| `frontend/` | `axios`, `oidc-client-ts`, `react`, `react-dom`, `react-router` |
| `extension/` | `react`, `react-dom` — **no HTTP or auth library at all** |
| `infra/` | `aws-cdk-lib`, `constructs` |

### 0.3 Layers

| Layer | Where |
| --- | --- |
| Infrastructure | `infra/lib/` — CDK stacks and constructs |
| Config | `backend/src/plugins/config.ts` — SSM in deployed envs, env vars locally |
| Provider clients | `backend/src/plugins/{anthropic,neon,auth}.ts` |
| Model contract | `backend/src/ai/translate.ts` |
| Application / HTTP | `backend/src/routes/api/collections/index.ts` (439 lines) |
| Wire contract | the route's return values; there is **no response schema** on the AI routes |
| Client transport | `frontend/src/api/client.ts` (axios); `extension/src/background.ts` (bare `fetch`) |
| Client types | `frontend/src/api/collections.ts:3-37`; `extension/src/types.ts:6-43` |
| UI | `frontend/src/pages/`; `extension/src/popup/App.tsx` (595 lines) |

There is **no `backend/src/domain/`** today. Doc 02 proposes creating it; this
plan puts its port in the same place, and § 6.3 notes the one ordering
constraint between the two plans.

---

## 1. Leaking dependencies identified

Five axes were measured. For each: every file that knows it today.

### L-1 — `@anthropic-ai/sdk`, and the tool-output shape it imposes

Two things leak, and they leak to different distances. The **package** stops at
the backend; the **data shape it produces** does not stop anywhere.

*Sites that import the package:*

| File | Lines | What it knows |
| --- | --- | --- |
| `backend/src/plugins/anthropic.ts` | `:2`, `:17` | Constructs the client; decorates it onto Fastify |
| `backend/src/fastify.d.ts` | `:4`, `:29` | Puts `Anthropic` on `FastifyInstance` — **every route in the app can reach the SDK** |
| `backend/src/ai/translate.ts` | `:1`, `:49`, `:126`, `:142`, `:155` | Tool schema, `messages.create`, `tool_use` unwrap, the client in two exported signatures |
| `backend/test/helpers/anthropic.ts` | `:1`, `:14`, `:29`, `:38` | Three hand-built SDK response envelopes |
| `backend/test/routes/api/entry-translations.test.ts` | `:4`, `:18-26` | A fourth, near-identical envelope |
| `context/changes/translation-pivot/measure-cost.mjs` | `:20-22` | Imports the SDK by absolute path out of `backend/node_modules` |

*Sites that know the tool-output shape without importing the package:*

| File | Lines | What it knows |
| --- | --- | --- |
| `backend/src/routes/api/collections/index.ts` | `:14`, `:55`, `:59`, `:241-249`, `:391-408` | Returns the model's object as the HTTP body; reaches into `languages[0].variants[0].sentences[0]` to persist |
| `backend/test/routes/api/translate.test.ts` | `:8`, `:44`, `:72`, `:105`, `:146`, `:175` | Parses response bodies as `TranslationResult` |
| `backend/test/routes/api/collections-rate-limit.test.ts` | `:7`, `:32` | Same stub payload shape |
| `extension/src/types.ts` | `:14-36` | Verbatim re-declaration of the four interfaces |
| `extension/src/messages.ts` | `:1`, `:43` | `translate: TranslationResult` in the popup↔background contract |
| `extension/src/background.ts` | `:4`, `:136` | `apiFetch<TranslationResult>` |
| `extension/src/popup/App.tsx` | `:5`, `:23`, `:85-89`, `:236-243`, `:288-290`, `:310-319` | Walks `languages[].variants[].sentences[]` in React state, and encodes **model-behaviour knowledge** (§ 3.4) |
| `context/changes/translation-pivot/measure-cost.mjs` | `:29-30`, `:38-81`, `:83-85`, `:90-104` | A second copy of the model id, tool name, tool schema, system prompt and unwrap |

Config and CI know the credential but not the shape: `backend/src/plugins/config.ts:10,16-42`,
`infra/lib/cdk-ssm-params.ts:5`, `.github/workflows/deploy.yml:125-126`,
`.github/workflows/pr-diff.yml:135-136`.

**Total: 13 files across 4 layers, plus one out-of-tree script.**

### L-2 — Amazon Cognito, reconstructed three different ways

The widest axis by file count — 32 files across all four projects — but with a
different character (§ 2).

| Layer | File | Library |
| --- | --- | --- |
| Infra | `infra/lib/constructs/auth-construct.ts`, `stacks/auth-stack.ts`, `constructs/api-construct.ts`, `stacks/frontend-stack.ts` | CDK |
| Backend | `backend/src/plugins/auth.ts:2`, `fastify.d.ts:3,6-10,28`, `routes/api/autohooks.ts` | `aws-jwt-verify` |
| Web UI | `frontend/src/auth/cognito.ts:1-22` | `oidc-client-ts` |
| Extension | `extension/src/auth.ts:1-182` | **hand-rolled** OAuth2 + PKCE against `/oauth2/authorize` and `/oauth2/token`, plus its own JWT `exp` decoder at `:59-73` |
| E2E | `frontend/e2e/support/session.ts:8,17-18` | Knows `oidc-client-ts`'s private localStorage key format |

Three implementations of one concept, and the provider's proprietary behaviour
is documented in-line at two of them: `frontend/src/auth/cognito.ts:82-86`
(Cognito does not implement RP-Initiated Logout, so `signoutRedirect()` is
replaced by a hand-built redirect) and `extension/src/auth.ts:27`
(refresh grants omit `refresh_token`).

### L-3 — `@neondatabase/serverless` in the application layer

Six files. Five are legitimate — the plugin, the type declaration, config, and
tests. One is a boundary break: `backend/src/routes/api/collections/index.ts:4`
imports `NeonDbError` and `:148` branches on `err instanceof NeonDbError &&
err.code === UNIQUE_VIOLATION`, where `UNIQUE_VIOLATION = '23505'` (`:17`) is a
raw Postgres SQLSTATE. A driver type and a wire-protocol error code decide an
HTTP status inside a route handler.

### L-4 — `axios` past its own boundary

`frontend/src/api/errors.ts:1-9` already **is** a small anti-corruption layer:
`extractErrorMessage(err: unknown)` is the one place that calls
`axios.isAxiosError`. Three pages use it. But two of those same pages also
import `axios` directly to answer one more question:

- `frontend/src/pages/CollectionDetailPage.tsx:3`, `:83`
- `frontend/src/pages/PrintCollectionPage.tsx:3`, `:39`

both `axios.isAxiosError(err) && err.response?.status === 404`. The ACL exists
and covers the message but not the status, so the library climbed back into the
view layer through the gap. Cheapest fix in this document; smallest blast radius.

### L-5 — the Web Speech API, duplicated rather than leaked

`frontend/src/speech.ts` (127 lines) and `extension/src/speech.ts` (120) are
near-identical, as are `useSpeech.ts` (121 / 117). The diffs are three comments
and the reporting call — `report()` in the web app,
`reportFromPopup()` in the popup. `frontend/src/speech.ts:8-11` says so
explicitly: *"Mirrors extension/src/speech.ts rather than sharing it: this repo
has no shared package between its apps."*

Recorded for completeness and then set aside: this is a **platform API**, not a
package. It appears in no manifest, cannot be swapped, and the duplication is a
consequence of the deliberate no-shared-package decision (`tech-stack.md:27-29`)
rather than a layering violation. Building an ACL against `window.speechSynthesis`
would buy nothing.

---

## 2. Classification, and the choice of #1

Three axes, scored on the criteria this analysis was set up with: reach,
cost-of-swap-today, and whether a document declares the thing replaceable.

| | Files / layers | Cost of swapping today | Declared replaceable? | Rank |
| --- | --- | --- | --- | --- |
| **L-1 model provider** | 13 files, 4 layers, + 1 script | **High and imminent** — the pivot is the next architectural change and its plan already assumes a seam that does not exist | **Yes, explicitly** (`change.md:209-211`, `decision-brief.md:85-87`, `research.md:1016-1032`) | **#1** |
| **L-2 Cognito** | 32 files, 4 layers, 3 implementations | High, but nothing is asking for it | No — no document mentions it | #2 |
| **L-3 Neon** | 6 files, 1 real break | Low — one `instanceof` and one SQLSTATE | No | #3 |
| **L-4 axios** | 3 files, ACL already exists | Very low | No | #4 |
| **L-5 Web Speech** | 4 files, ~250 duplicated lines | n/a — platform API | No | not an ACL problem |

### Why not L-2, which is bigger

Cognito touches more files, but on the axis that matters it is **already
contained where it counts**. Everything downstream of `plugins/auth.ts` sees
`AuthUser` (`backend/src/fastify.d.ts:12-16`) — `{ id, cognitoSub, email }` —
and every route reads only `request.authUser.id`. The provider's types never
reach a route handler, a query, or a response body. What is duplicated is the
*client-side login mechanics*, three times, because three runtimes genuinely
cannot share one (`extension/src/auth.ts:3-7` states why: the popup is torn down
on focus loss and has no `localStorage`). That is a real cost, but a
**deployment-shaped** one, not a domain-shaped one — no business rule is
expressed in Cognito's vocabulary anywhere. It also has no pending swap: nothing
in any document proposes leaving Cognito.

### Why L-1 wins

Three reasons, in increasing order of weight.

1. **Reach through the layer stack.** L-1 is the only axis whose leak crosses
   the client/server boundary. `TranslationResult` is defined at
   `backend/src/ai/translate.ts:37-40` as a cast over `toolUse.input` (`:148`),
   returned unchanged as the HTTP body (`index.ts:249`), redeclared verbatim in
   `extension/src/types.ts:33-36`, carried through the popup-to-background
   message contract (`messages.ts:43`), and finally walked field by field in
   React state (`popup/App.tsx:85-89`, `:310-319`). No other dependency in this
   repo reaches from a vendor SDK's response object into a UI component's state.

2. **The intent-vs-code divergence is documented and load-bearing.** The pivot's
   plan is explicitly built on the claim that a seam already exists
   (`research.md:1020-1026`). It does not. Every "this is a config change rather
   than a re-plan" statement in `change.md` inherits that error. This is the
   strongest signal available: a design decision recorded as *done* that the
   code does not implement, sitting on the critical path of the next change.

3. **The swap is scheduled.** `decision-brief.md:85-87` names Azure AI Translator
   as the intended default with a bake-off across three providers
   (`research.md:1059-1067`), and `research.md:1010-1014` adds a *fourth*
   requirement the seam must carry — a running character counter, because "a
   budget exhausted silently is the same class of failure as `lessons.md`'s
   'a quality gate that can silently not run'". A seam that must hold a
   provider, a fallback provider and a spend meter is being planned against a
   file that today exports the provider's client type in two public signatures.

**Pick: L-1 — the model provider.** The rest of this document designs its ACL.
L-3 and L-4 are one-line-each cleanups recorded in § 6.4 so they are not lost;
L-2 is left alone with its reasoning on the record.

---

## 3. Diagnosis

### 3.1 The provider's data shape *is* the wire contract

Follow one object:

```
translate.ts:130-139   client.messages.create({ ..., tools: [translationTool] })
translate.ts:141-143   message.content.find(b => b.type === 'tool_use' && b.name === ...)
translate.ts:148       const result = toolUse.input as TranslationResult   <- unchecked cast
translate.ts:149-152   { normalizedNativeText: result.normalizedNativeText, languages: align(...) }
index.ts:241-245       const result = await generateWithTimeout(...)
index.ts:249           return result                                       <- straight to the wire
```

`toolUse.input` is typed `unknown` by the SDK. `translate.ts:148` asserts it is
`TranslationResult` and nothing verifies that. The only field ever defended is
`languages` — via `?? []` at `:151` — and the only structural repair is
`alignToRequested` (`:113-120`), which rebuilds the language list against what
was requested. Everything below `languageCode` passes through untouched: if the
model returns `variants: [{ meaningText: 42 }]`, that number reaches the
extension's React state and is rendered.

The AI routes carry **no response schema**. `schemas.ts` (63 lines) defines
`translateBodySchema` and the rest as request bodies only; neither
`POST /:id/translate` (`index.ts:218-250`) nor the backfill (`:358-436`) declares
`schema.response`, so Fastify serializes whatever object it is handed. **There is
no point in the system where the model's output is checked against a contract we
own.**

### 3.2 What `generateWithTimeout` actually isolates

`research.md:1021-1024` names this function as the precedent for the
provider-agnostic seam. Read it (`index.ts:50-66`):

```ts
async function generateWithTimeout (
  fastify: FastifyInstance, log: FastifyBaseLogger, correlationId: string,
  params: Omit<GenerateTranslationParams, 'signal'>
): Promise<TranslationResult | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => { controller.abort() }, TRANSLATE_TIMEOUT_MS)
  try {
    return await generateTranslation(fastify.anthropicClient, { ...params, signal: controller.signal })
  } catch (err) {
    log.error({ err, requestId: correlationId }, 'anthropic translate call failed')
    return null
  } finally { clearTimeout(timeout) }
}
```

It isolates exactly two things, and its own comment (`:41-43`) claims only those:
a **timeout** and an **exception** ("turns any failure into null, so callers
reply with a clean error instead of leaking an SDK exception"). That comment is
accurate. What the function is *not* is a seam, because everything else crosses
it intact:

| Crosses | Evidence |
| --- | --- |
| The provider's client object | `fastify.anthropicClient` is read here and passed down (`:59`) |
| The provider's data shape | Return type is `TranslationResult` — the cast over `toolUse.input` |
| The provider's model id | `MODEL = 'claude-haiku-4-5-20251001'` (`translate.ts:3`) sits in the module the application layer imports |
| The provider's retry policy | Split in two and owned by nobody — § 3.5 |
| The provider's failure modes | `EMPTY_RESULT_RETRIES` (`translate.ts:19`) and the popup's degradation reporting (`App.tsx:236-243`) |
| The provider's log vocabulary | `'anthropic translate call failed'` (`:61`) — the string an operator greps for |

Swapping to Azure changes the return type, which changes the wire contract,
which changes `extension/src/types.ts`, `messages.ts` and `popup/App.tsx`.
`generateWithTimeout` does not stand between any of that and the provider. It
stands between the provider and one `try/catch`.

### 3.3 The duplication: two copies of one contract, four of one envelope

**The tool contract exists twice, in full.** `backend/src/ai/translate.ts:49-107`
and `context/changes/translation-pivot/measure-cost.mjs:38-81` are the same
schema. The system prompt is duplicated **byte for byte** — `translate.ts:133-135`
and `measure-cost.mjs:83-85` — as are the token formula (`translate.ts:132` /
`measure-cost.mjs:92`), the model id (`translate.ts:3` / `measure-cost.mjs:29`),
the tool name (`translate.ts:4` / `measure-cost.mjs:30`) and the unwrap
(`translate.ts:141-142` / `measure-cost.mjs:100`).

This copy is not dead. `lessons.md:33-38` requires measured rather than estimated
numbers for any LLM-calling change, and `change.md:252-254` names re-running this
exact script as a precondition for resuming the pivot. It had to be a copy
because `translate.ts` exports nothing the script can use: the schema and the
prompt are module-private, and `generateTranslation` demands an `Anthropic`
instance. **The cost-measurement instrument the project depends on is a fork of
the contract it measures, and nothing detects when the two diverge.**

**The SDK response envelope is reconstructed four times.**
`backend/test/helpers/anthropic.ts:7-15`, `:19-31`, `:33-39`, and a fourth
private copy at `backend/test/routes/api/entry-translations.test.ts:18-26`. All
four build `{ messages: { create: async () => ({ content: [{ type: 'tool_use',
name, input }] }) } }` and cast `as unknown as Anthropic`. The fourth exists even
though the helper module was already importable — a seam that tests route around
is one they will keep routing around.

### 3.4 The client knows things only the provider's behaviour explains

`extension/src/popup/App.tsx` encodes two facts about how this specific model
behaves:

- `:231-243` — counts languages whose `variants` array came back empty and
  reports a `DegradedAiResult`. The comment cites the measured rate: *"lessons.md
  measured this class at ~9% of live calls."*
- `:283-290` — pairs a regenerated response against the user's selection **by
  meaning rather than by position**, because *"Generation is non-deterministic,
  so a fresh response can order the senses differently or return a different set
  of them."*

Both are true and both are well reasoned. Neither is a UI concern. They are
statements about a model provider's output distribution, living in a React
component, in a separately installed browser extension, one HTTP boundary and two
type re-declarations away from the SDK call that produces them. Change provider
and both become unverifiable claims about a system that no longer exists — and
nothing in the extension's build or test suite would fail.

`lessons.md:34-39` is the same finding from the other direction: *"Stubbing the
Anthropic client tests our handling of a response we wrote ourselves… 65 green
tests coexisted with a live failure on roughly 1 in 11 captures."* That lesson
prescribes live verification. It does not address the structural cause, which is
that **no single object owns the question "is this draft usable?"** — the answer
is currently assembled from `isEmpty` (`translate.ts:122-124`), a `?? []`
(`:151`), a `variant === undefined` guard (`index.ts:398-402`) and two reports in
the popup.

### 3.5 Retry policy is split three ways and owned by nobody

`backend/src/plugins/anthropic.ts:17` constructs the client as
`new Anthropic({ apiKey: fastify.config.anthropicApiKey })` — no `maxRetries`,
no `timeout`. Per the SDK's documented TypeScript client defaults (`timeout`
10 minutes, **in milliseconds**; `maxRetries` 2, retrying 408/409/429/5xx and
connection errors), that means:

| Layer | Value | Set where | Visible to |
| --- | --- | --- | --- |
| SDK transport retries | **2, by default** | nowhere — never configured | nobody |
| SDK request timeout | **10 min, by default** | nowhere — never configured | nobody |
| Application empty-result retry | 1 | `translate.ts:19` | the `ai/` module |
| Route wall-clock abort | 20 s | `index.ts:21`, `:56-57` | the route |
| Lambda / API Gateway ceiling | 29 s | `infra/lib/constructs/api-construct.ts:75` | infra |

The `AbortController` does cap wall clock at 20 s, so the 10-minute default never
bites and the 29 s ceiling holds — **this is not a live bug**. But up to *six*
upstream calls can occur inside one request (two application attempts × three SDK
tries), while the comment at `translate.ts:12-19` reasons about cost and latency
as though there were at most two: *"the retry costs little and stays well inside
the route's timeout."* The `measure-cost.mjs` baseline was gathered through the
same unconfigured defaults. Nobody chose this policy; it is the residue of three
layers each solving their own problem separately.

### 3.6 The server library is *not* in a client bundle

Worth stating plainly, because it is the most dangerous form this class of leak
takes and it was checked. `@anthropic-ai/sdk` appears in **no** frontend or
extension import (§ 1, L-1); `extension/package.json` lists only `react` and
`react-dom` as runtime dependencies; the API key never leaves the backend
(`plugins/config.ts:16-30` reads it from SSM, `infra/lib/cdk-ssm-params.ts:5`
scopes the IAM grant). What crosses to the client is the provider's **data
shape**, not its code. That is a real leak with real cost, and a smaller one than
a bundled SDK would be.

### 3.7 The model id is pinned in two places

`MODEL = 'claude-haiku-4-5-20251001'` (`translate.ts:3`) and again at
`measure-cost.mjs:29`. A provider configuration value, sitting in the module the
application layer imports, duplicated into the instrument that measures its cost.
*Where* it lives is the ACL question; *which value* it holds is not, and this
plan does not propose changing it. Flagged only, for whoever ends up owning the
adapter: current SDK guidance prefers the unsuffixed alias `claude-haiku-4-5`
over a date-suffixed id. That is a separate one-line decision, and it needs a
cost re-measurement per `lessons.md:33-38` rather than being folded into this
refactor.

---

## 4. The design

Three files, one of which is the only thing in the repository allowed to know
that a model provider exists.

```
backend/src/domain/
  translationDraft.ts     the value object — the single home for the draft's shape
  translator.ts           the port — one method, plus the error taxonomy
backend/src/adapters/
  anthropicTranslator.ts  the adapter — the ONLY importer of @anthropic-ai/sdk
backend/src/plugins/
  translator.ts           wiring; decorates fastify.translator: Translator
```

`backend/src/ai/translate.ts` and `backend/src/plugins/anthropic.ts` are deleted;
their content moves into the adapter (provider-shaped) or the value object
(domain-shaped), and the split between the two is the whole point.

### 4.1 A naming decision, taken here so the two plans compose

Doc 01 distilled **sense** as this domain's word for a distinct meaning; today's
code calls it `variants` (`translate.ts:26-30`) because that is the word in the
tool schema — the provider's word, not ours. Doc 02 § 5.10 already plans to
rename it across the wire contract.

This plan uses **`senses`** inside the domain and keeps **`variants`** on the
wire, produced by `toWire()`. Nothing outside the backend changes. When doc 02
lands, the rename happens in exactly one function instead of in three clients —
which is the clearest available demonstration of what the ACL buys. The two plans
do not collide; see § 6.3.

### 4.2 The value object — `TranslationDraft`

The one place that knows the draft's shape, how to build one from an untrusted
payload, whether it is usable, how to project it onto the wire, and how to
project one language onto the rows that get persisted.

```ts
// backend/src/domain/translationDraft.ts — no provider import anywhere in this file

export interface DraftSentence {
  readonly targetText: string
  readonly nativeGlossText: string
}

export interface DraftSense {
  readonly meaningText: string
  readonly phoneticTranscription: string | null
  readonly sentences: readonly DraftSentence[]
}

export interface DraftLanguage {
  readonly languageCode: string
  readonly senses: readonly DraftSense[]
}

// What was asked for. Owns alignment and the detected-language rule (§ 5.4, D-1).
export class RequestedLanguages {
  private constructor (
    readonly nativeLanguageCode: string,
    readonly targetLanguageCodes: readonly string[]
  ) {}

  static of (nativeLanguageCode: string, targetLanguageCodes: readonly string[]): RequestedLanguages
  accepts (languageCode: string): boolean   // native or one of the targets
}

// One language's first usable rendering, normalized for persistence.
export interface PersistableRendering {
  readonly languageCode: string
  readonly meaningText: string
  readonly phoneticTranscription: string | null   // already blank-to-null normalized
  readonly sentenceText: string
  readonly nativeGlossText: string
}

export class TranslationDraft {
  private constructor (
    readonly normalizedNativeText: string,
    readonly detectedLanguageCode: string,
    readonly languages: readonly DraftLanguage[]
  ) {}

  /** The ONLY entry point from provider data into the domain. Throws
   *  MalformedDraftError; never returns a partially-trusted object. */
  static fromProviderPayload (payload: unknown, requested: RequestedLanguages): TranslationDraft

  /** Every requested language came back with no sense at all. */
  isDegenerate (): boolean

  /** The subset that came back empty — the fact App.tsx:236 computes today. */
  degenerateLanguageCodes (): readonly string[]

  /** Replaces index.ts:398-408's reach into languages[0].variants[0].sentences[0]. */
  renderingFor (languageCode: string): PersistableRendering | null

  /** The wire contract, produced rather than inherited. Emits `variants`. */
  toWire (): TranslationResponseBody

  /** research.md:1010-1014's spend meter, per provider-billable character. */
  billableCharacters (): number
}
```

`fromProviderPayload` in pseudocode — this is the code that stops existing at
`translate.ts:148`:

```
fromProviderPayload(payload, requested):
    require payload is a non-null object                     else MalformedDraftError
    require payload.normalizedNativeText is a non-empty string  else MalformedDraftError
    detected := trim(lower(payload.detectedLanguageCode ?? ''))
    require requested.accepts(detected)                      else MalformedDraftError
       # D-1 in § 5.4: the model must state what it detected, and it must be a
       # language this collection actually teaches or is taught in.

    returned := payload.languages is an array ? payload.languages : []

    # alignToRequested (translate.ts:113-120) moves here unchanged in behaviour:
    # rebuild against what was asked for, so a skipped language is empty rather
    # than absent, and a reordered response is re-keyed rather than trusted.
    languages := for each code in requested.targetLanguageCodes:
        match := returned.find(l => trim(lower(l.languageCode)) === code)
        { languageCode: code, senses: parseSenses(match?.variants) }

    return new TranslationDraft(payload.normalizedNativeText, detected, languages)

parseSenses(raw):
    if raw is not an array: return []
    for each entry:
        skip unless meaningText is a non-empty string
        phoneticTranscription := (is string and non-blank after trim) ? trimmed : null
        sentences := parseSentences(entry.sentences)
        skip if sentences is empty        # a sense with no example teaches nothing
        yield { meaningText: trim(entry.meaningText), phoneticTranscription, sentences }
```

Two properties of this function are the whole reason it exists:

- **It is total.** Every provider payload either becomes a valid `TranslationDraft`
  or raises `MalformedDraftError`. There is no third outcome and no cast.
- **It is provider-shaped on the way in, domain-shaped on the way out.** The
  parameter is `unknown`. `payload.languages[].variants` is the last place in the
  codebase where the provider's word for a sense appears in a data path.

### 4.3 The port — `Translator`

One method. The narrowest interface that still lets the route do its job.

```ts
// backend/src/domain/translator.ts — no provider import

export interface TranslationRequest {
  readonly text: string
  readonly languages: RequestedLanguages
  readonly signal: AbortSignal
}

export interface Translator {
  draft (request: TranslationRequest): Promise<TranslationDraft>
}

/** The provider failed, timed out, or refused. Carries no provider type. */
export class TranslatorUnavailableError extends Error {
  constructor (readonly cause: unknown) { super('translator unavailable') }
}

/** The provider answered, but not in a shape the domain accepts. */
export class MalformedDraftError extends Error {}

/** The provider answered in shape, with nothing usable in it. */
export class DegenerateDraftError extends Error {
  constructor (readonly languageCodes: readonly string[]) { super('draft is degenerate') }
}
```

`AbortSignal` is a platform type, not a provider type, so it is allowed to appear
here — it is the same reason `RequestedLanguages` is allowed and `Anthropic` is
not. Everything else in the signature is domain vocabulary.

Note what is **absent**: no client parameter. `generateTranslation(client:
Anthropic, ...)` (`translate.ts:155`) has the provider in its public signature;
`draft(request)` does not. A caller of the port cannot obtain a provider client,
which is the structural difference between a seam and a passthrough.

### 4.4 The adapter — `anthropicTranslator.ts`

The only file in `backend/src/` that may import `@anthropic-ai/sdk`.

```ts
// backend/src/adapters/anthropicTranslator.ts
import { Anthropic } from '@anthropic-ai/sdk'
import { TranslationDraft, type RequestedLanguages } from '../domain/translationDraft.ts'
import { type Translator, type TranslationRequest, TranslatorUnavailableError,
         DegenerateDraftError } from '../domain/translator.ts'

// Provider configuration. Exported so measure-cost.mjs stops copying them (§ 5.3).
export const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001'
export const TRANSLATION_TOOL_NAME = 'return_translation'
export const MAX_TOKENS_PER_LANGUAGE = 2048

// Provider retry/timeout policy, chosen here instead of inherited (§ 3.5).
const SDK_MAX_RETRIES = 1
const SDK_TIMEOUT_MS = 15_000
const EMPTY_DRAFT_RETRIES = 1

export const translationTool: Anthropic.Tool = { /* moved from translate.ts:49-107,
                                                    plus strict + detectedLanguageCode */ }
export function systemPrompt (languages: RequestedLanguages): string  // from translate.ts:133-135

export function createAnthropicTranslator (options: {
  apiKey: string
  log: { error: (o: object, msg: string) => void }
}): Translator
```

```
createAnthropicTranslator({ apiKey, log }):
    client := new Anthropic({
        apiKey,
        maxRetries: SDK_MAX_RETRIES,     # chosen, not defaulted
        timeout:    SDK_TIMEOUT_MS       # milliseconds, per the SDK's TS contract
    })

    return {
      draft(request):
          draft := await attempt(request)
          # The empty-draft retry stays a DOMAIN decision expressed here because
          # only the adapter knows a re-ask is cheap for this provider
          # (translate.ts:12-19 measured ~167 output tokens, ~1.3s).
          for i in 0..EMPTY_DRAFT_RETRIES while draft.isDegenerate():
              draft := await attempt(request)
          if draft.isDegenerate():
              throw new DegenerateDraftError(draft.degenerateLanguageCodes())
          return draft

      attempt(request):
          try:
              message := await client.messages.create({
                  model:       ANTHROPIC_MODEL,
                  max_tokens:  MAX_TOKENS_PER_LANGUAGE * max(len(targets), 1),
                  system:      systemPrompt(request.languages),
                  messages:    [{ role: 'user', content: request.text }],
                  tools:       [translationTool],
                  tool_choice: { type: 'tool', name: TRANSLATION_TOOL_NAME }
              }, { signal: request.signal })
          catch err:
              log.error({ err }, 'translator provider call failed')
              throw new TranslatorUnavailableError(err)

          block := message.content.find(b => b.type === 'tool_use'
                                          && b.name === TRANSLATION_TOOL_NAME)
          if block is undefined:
              throw new TranslatorUnavailableError(
                  new Error('response carried no tool_use block'))

          # The one crossing point. Everything above this line is provider-shaped;
          # everything below it is domain-shaped.
          return TranslationDraft.fromProviderPayload(block.input, request.languages)
    }
```

Two changes to the tool definition itself, both justified in § 5.4:

- **`strict: true`** with `additionalProperties: false` on every object node.
  Per the SDK's documented contract this makes `tool_use.input` validate against
  the schema, which retires the unchecked cast at `translate.ts:148` as the
  *first* line of defence. `fromProviderPayload` stays as the second — see D-2.
- **A required `detectedLanguageCode`** property, which is what makes PRD Open
  Question 3 answerable at all (D-1).

### 4.5 Wiring

```ts
// backend/src/plugins/translator.ts  (replaces plugins/anthropic.ts)
import fp from 'fastify-plugin'
import { createAnthropicTranslator } from '../adapters/anthropicTranslator.ts'
// lessons.md:19-24 — forcing import so ts-node loads the ambient augmentation
import type { AuthUser as _AuthUser } from '../fastify.d.ts'

export default fp(async (fastify) => {
  fastify.decorate('translator', createAnthropicTranslator({
    apiKey: fastify.config.anthropicApiKey,
    log: fastify.log
  }))
}, { name: 'translator', dependencies: ['config'] })
```

```ts
// backend/src/fastify.d.ts — the SDK import at :4 is deleted
import type { Translator } from './domain/translator.ts'

declare module 'fastify' {
  export interface FastifyInstance {
    translator: Translator      // was: anthropicClient: Anthropic
  }
}
```

That one-line diff is the load-bearing change in this whole plan. Today
`fastify.d.ts:29` puts an `Anthropic` instance on `FastifyInstance`, which means
**every route file in the application can reach the provider SDK** with full type
support and no import. After it, the widest thing any route can reach is a
one-method port.

### 4.6 The routes

```ts
// backend/src/routes/api/collections/index.ts — generateWithTimeout, rewritten
async function draftWithTimeout (
  fastify: FastifyInstance, log: FastifyBaseLogger, correlationId: string,
  text: string, languages: RequestedLanguages
): Promise<TranslationDraft | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => { controller.abort() }, TRANSLATE_TIMEOUT_MS)
  try {
    return await fastify.translator.draft({ text, languages, signal: controller.signal })
  } catch (err) {
    log.error({ err, requestId: correlationId }, 'translate failed')
    return null
  } finally { clearTimeout(timeout) }
}
```

Same shape as today, and still not a seam — but it no longer needs to be one,
because the thing it wraps is. The route keeps the 20 s wall-clock abort (that is
an *application* deadline, set by API Gateway's 29 s ceiling at
`api-construct.ts:75`, and it belongs to the route). What it stops owning is the
provider.

`POST /:id/translate` (`index.ts:218-250`) ends `return draft.toWire()` instead of
`return result`. The backfill (`:391-408`) replaces the eleven lines that reach
into `result?.languages[0]?.variants[0]?.sentences[0]`, trim strings and
blank-to-null the phonetics with:

```ts
const rendering = draft?.renderingFor(languageCode)
if (rendering === null || rendering === undefined) {
  return reply.badGateway('could not generate a translation — try again')
}
// rendering.meaningText / .phoneticTranscription / .sentenceText / .nativeGlossText
// are already trimmed and normalized — the value object did it, once.
```

Both routes should also gain a `schema.response` — the gap named in § 3.1 — with
`toWire()`'s return type as its source. That is cheap once one function produces
the body, and impossible while the body *is* the model's object.

---

## 5. Proof of isolation, and before/after

### 5.1 Who knows the provider, before and after

The package itself:

| File | Today | After | Why |
| --- | --- | --- | --- |
| `backend/src/adapters/anthropicTranslator.ts` | — | **imports it** | The adapter. This is the point. |
| `backend/test/adapters/anthropicTranslator.test.ts` | — | **imports it** | One file builds the SDK envelope, against the one file that consumes it |
| `backend/src/plugins/anthropic.ts` | `:2`, `:17` | *deleted* | Becomes `plugins/translator.ts`, which imports a factory |
| `backend/src/fastify.d.ts` | `:4`, `:29` | **no** | `translator: Translator` |
| `backend/src/ai/translate.ts` | `:1`, `:49`, `:126`, `:142`, `:155` | *deleted* | Split between the value object and the adapter |
| `backend/test/helpers/anthropic.ts` | `:1`, `:14`, `:29`, `:38` | **no** | Becomes `helpers/fakeTranslator.ts`, implementing the port |
| `backend/test/routes/api/entry-translations.test.ts` | `:4`, `:18-26` | **no** | Uses the fake |
| `measure-cost.mjs` | `:20-22` | **imports it** | It is a provider-measurement instrument; that is its job. It stops owning the *contract* (§ 5.3) |

The data shape, which is the leak that actually crosses layers:

| File | Today | After |
| --- | --- | --- |
| `backend/src/routes/api/collections/index.ts` | Returns the provider's object (`:249`); reaches into `languages[0].variants[0].sentences[0]` (`:398-408`) | Calls `draft.toWire()` and `draft.renderingFor(code)`; knows no field below `languageCode` |
| `backend/test/routes/api/translate.test.ts` | Casts bodies to `TranslationResult` (5 sites) | Casts to `toWire()`'s declared return type |
| `backend/test/routes/api/collections-rate-limit.test.ts` | Provider-shaped stub payload | Fake port |
| `extension/src/types.ts:14-36` | Mirrors the tool schema | Mirrors `toWire()` — **a contract we own**. Same JSON in phase 1; no client edit needed |
| `extension/src/popup/App.tsx:236-243` | Counts empty `variants` and reports `DegradedAiResult` | Deleted — the server raises `DegenerateDraftError`, which is where the count is complete across all users |
| `extension/src/popup/App.tsx:283-290` | Re-pairs by meaning after a regenerate | **Stays.** § 5.5 is honest about why |

**The claim, stated as a list.** Swapping to Azure AI Translator per
`decision-brief.md:85-87` requires editing:

1. `backend/src/adapters/azureTranslator.ts` — new file, implements `Translator`.
2. `backend/src/plugins/translator.ts` — one line, which factory to call.
3. `backend/src/plugins/config.ts` — the new credential, alongside the existing pattern at `:16-42`.
4. `infra/lib/cdk-ssm-params.ts` — the new SSM parameter.

It requires editing **no migration, no table, no route handler, no request or
response schema, no client type, and no UI component**. The reason is that the
draft the domain receives is a `TranslationDraft` either way, and the only code
that ever saw a provider payload is the adapter that produced it. That is the
sentence `change.md:209-211` already claims to be true and today is not.

### 5.2 Before / after at the four duplicated sites

**The unchecked cast**

```ts
// before — translate.ts:141-152
const toolUse = message.content.find(
  (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === TRANSLATION_TOOL_NAME
)
if (toolUse === undefined) { throw new Error('anthropic response did not include the expected tool_use block') }
const result = toolUse.input as TranslationResult          // unknown -> trusted, in one keyword
return { normalizedNativeText: result.normalizedNativeText,
         languages: alignToRequested(result.languages ?? [], targetLanguageCodes) }
```

```ts
// after — adapter, last line of attempt()
return TranslationDraft.fromProviderPayload(block.input, request.languages)
// unknown -> validated -> domain object, or MalformedDraftError. No cast anywhere.
```

**The four test envelopes**

```ts
// before — helpers/anthropic.ts:7-15, :19-31, :33-39, and again at
// entry-translations.test.ts:18-26 — each one hand-builds the provider's
// wire envelope and lies to the type system about it
app.anthropicClient = {
  messages: { create: async () => ({ content: [{ type: 'tool_use', name: TRANSLATION_TOOL_NAME, input }] }) }
} as unknown as Anthropic
```

```ts
// after — backend/test/helpers/fakeTranslator.ts, one file, no cast, no SDK import
export function fakeTranslator (drafts: TranslationDraft[]): Translator & { calls: () => number }
export function failingTranslator (err: Error): Translator
app.translator = fakeTranslator([germanDraft()])
```

The fake satisfies `Translator` structurally, so a change to the port is a
compile error in every test rather than a cast that keeps compiling. The three
behaviours the current helpers provide (success, sequence, failure) map one for
one; `stubAnthropicSequence`'s `calls()` counter survives as `calls()`.

**The route's reach into the model's shape**

```ts
// before — index.ts:396-408
const variant = result?.languages[0]?.variants[0]
const sentence = variant?.sentences[0]
if (variant === undefined || sentence === undefined) { return reply.badGateway(...) }
const phoneticTranscription = variant.phoneticTranscription?.trim()
// ...then, inline in the INSERT at :408:
//   phoneticTranscription === undefined || phoneticTranscription.length === 0 ? null : phoneticTranscription
```

```ts
// after
const rendering = draft?.renderingFor(languageCode)
if (rendering == null) { return reply.badGateway('could not generate a translation — try again') }
// trimming and blank-to-null already done, once, in the value object
```

**The UI's ready-made data.** The extension receives `toWire()`'s output, whose
guarantees are stated by the value object rather than hoped for: every requested
target language is present (alignment, moved verbatim from
`translate.ts:113-120`); every sense that survived has a non-empty
`meaningText` and at least one sentence; `phoneticTranscription` is a trimmed
string or `null`, never `''`. `App.tsx:85-89`'s `initialSelections` and
`:507-511`'s empty-state branch keep working unchanged — but they are now
handling a case the backend has explicitly declared possible, not a shape the
model happened to emit.

### 5.3 `measure-cost.mjs` stops being a fork

```js
// before — measure-cost.mjs:20-22, 29-30, 38-81, 83-85, 90-97
const { default: Anthropic } = await import(/* absolute path into backend/node_modules */)
const MODEL = 'claude-haiku-4-5-20251001'
const TOOL = 'return_translation'
const translationTool = { /* 44 lines, hand-copied from translate.ts:49-107 */ }
const systemPrompt = (native, targets) => `You are a translation assistant...`  // byte-identical copy
```

```js
// after
const { ANTHROPIC_MODEL, TRANSLATION_TOOL_NAME, MAX_TOKENS_PER_LANGUAGE,
        translationTool, systemPrompt } = await import('../../../backend/dist/adapters/anthropicTranslator.js')
```

The script still constructs its own `Anthropic` client and still calls the API
directly — that is what a cost instrument is for, and routing it through the port
would measure the wrong thing. What it stops doing is **defining the contract a
second time**. After this, a schema or prompt change cannot silently invalidate
the cost baseline that `lessons.md:33-38` and `change.md:252-254` both depend on.

It imports from `backend/dist/`, so it requires `npm run build:ts` first; note it
in the script's header comment. That is a real cost and a small one against a
44-line copy that nothing checks.

### 5.4 Open questions this library's contract settles

Four questions in the record turn on what the provider's API actually guarantees.
Each is answered here, with the place the answer gets encoded — **in the ACL, not
in the API layer**.

**D-1 — PRD Open Question 3: which language did the user type in?**
`prd.md:142` leaves it open, noting a collection can carry five target languages
plus its native one and the same word may exist in several. Today
`translate.ts:133` instructs the model *"detect which one, then respond only via
the provided tool call"* — and the answer is then **thrown away**: nothing in the
tool schema (`:52-106`) asks the model to report what it detected, so no layer can
see it, log it, act on it, or measure how often it is wrong. `normalizedNativeText`
is documented as the native-language base form (`:56-59`) and is trusted to be so
without evidence.

*Decision, taken from the tool-schema contract:* add a required
`detectedLanguageCode` property to the tool schema. A `strict` tool guarantees a
required property is present, so the detection stops being invisible. The
acceptance rule — the code must be the collection's native language or one of its
targets — goes in `RequestedLanguages.accepts()`, called from
`fromProviderPayload`. A payload naming a language the collection does not teach
is `MalformedDraftError`, not a 200 with a plausible-looking body.

*Where it is encoded:* the tool schema and `fromProviderPayload`, both inside the
ACL. **Not** in the route, which should never learn that detection is a thing the
provider does. The PRD's own fallback (*"start with the most likely match and let
the user correct it"*, `prd.md:142`) stays available: the field is now visible, so
a future UI can show it. This closes the "is it observable" half of the question
and leaves the product half — what the UI does about a low-confidence detection —
open, because no library contract answers that.

**D-2 — can the cast at `translate.ts:148` be retired?**
Partly, and the honest answer matters. The SDK documents **strict tool use** (no
beta header): setting `strict: true` on the tool definition, with `required` and
`additionalProperties: false` on every object node, guarantees `tool_use.input`
validates against the schema. That covers types, required properties, and stray
fields — the failure modes the current cast is blind to.

It does **not** cover the failure this project actually got burned by.
`translate.ts:73-75` already records that `minItems` is *"advisory on a tool
schema rather than enforced"*, and `lessons.md:34-39` measured the consequence:
structurally valid responses with all-empty `variants`, ~1 in 11 live calls, past
65 green tests. Nothing in the SDK's documented strict-mode contract promises
`minItems` enforcement.

*Decision:* set `strict: true` **and** keep `fromProviderPayload`'s validation
and `isDegenerate()`/`EMPTY_DRAFT_RETRIES`. Strict mode is a first line of
defence that lets the parser reject earlier and more cheaply; it is not a
replacement for the domain's own definition of "usable". A provider guarantee is
evidence, not a contract the domain may lean on — and the next provider will have
a different one.

*Where it is encoded:* `strict: true` in the adapter's tool definition;
"usable" in the value object.

**D-3 — who owns retries and timeouts?** § 3.5 showed the policy is currently
assembled from an unconfigured SDK default nobody chose. The SDK's documented
TypeScript defaults are `maxRetries: 2` and `timeout: 10 minutes` (milliseconds),
with both configurable per client and per request, and retries applying to
408/409/429/5xx and connection errors.

*Decision:* the adapter sets both explicitly — `maxRetries: 1` and
`timeout: 15_000` in § 4.4 — so the worst case is four upstream calls inside the
route's 20 s abort rather than six, and every number is written down where
someone can change it. The route keeps its own `AbortController`, because 20 s is
an *application* deadline derived from API Gateway's 29 s ceiling
(`api-construct.ts:75`), not a provider setting.

*Where it is encoded:* transport policy in the adapter; the wall-clock deadline
stays in the route. Re-run `measure-cost.mjs` after this lands — the existing
baseline was measured through the old, unchosen defaults, and `lessons.md:33-38`
requires measured numbers.

**D-4 — `research.md:1084-1088`, Q10: provider terms on storing and
redistributing generated output.** Not answerable from an SDK reference; it is a
licensing question about whichever provider is active, and it stays open. What
*is* settled is where the machinery lives: `research.md:1010-1014` requires a
running character counter on the seam, so `TranslationDraft.billableCharacters()`
plus a per-call log line in the adapter is the place. When Q10 resolves, the
provenance stamp it implies goes on the adapter's output, not on the route's.

### 5.5 Honest limits of this design

- **`App.tsx:283-290` does not move.** The regenerate flow re-pairs a fresh
  response against the user's current selection by meaning, because the endpoint
  is stateless and only the client holds that selection. The ACL cannot take that
  over. What it takes over is the *degradation reporting* around it (`:291-301`)
  and the raw walk over `variants[]`. The real fix is a stable sense identity —
  doc 02's `senseKey()` (`02-invariant-aggregate-refactor.md` § 4.2) — and it
  belongs to that plan, not this one.
- **The clients still duplicate the wire types.** `extension/src/types.ts` and
  `frontend/src/api/collections.ts` remain hand-written copies. That is the
  no-shared-package decision (`tech-stack.md:27-29`), and this plan does not
  reopen it. The change is what they copy: a contract this codebase produces,
  instead of a shape a vendor's model emitted.
- **`toWire()` emitting `variants` is deliberate debt**, scoped to § 6.3's
  ordering. If doc 02 lands first, this plan's `toWire()` emits `senses` from day
  one and § 4.1 is moot.
- **This adds a layer.** Four files replace two, and a small backend gains a
  `domain/` and an `adapters/` directory. The justification is the four-item list
  in § 5.1 and nothing else; if the provider swap in `decision-brief.md` were
  cancelled, the honest recommendation would shrink to phases 1–2 (validate the
  payload, kill the `measure-cost.mjs` fork) and stop.
- **No live-API evidence was gathered for this document.** Every claim about the
  provider's behaviour is quoted from the code's own measured comments
  (`translate.ts:12-19`) or from `lessons.md:34-39`. Phase 2 carries the live
  verification gate that `lessons.md:38` requires, and it must be run before this
  is called done — a stubbed suite cannot tell you the adapter works.

---

## 6. Verification and plan

### 6.1 The success criterion, as a runnable command

```sh
# Must return ONLY files under backend/src/adapters/ and backend/test/adapters/
grep -rn "@anthropic-ai/sdk" backend/src backend/test

# Must return nothing at all
grep -rn "anthropicClient\|TranslationResult\|toolUse\|tool_use" backend/src/routes backend/src/plugins

# Must return nothing outside the adapter
grep -rn "claude-haiku\|return_translation" backend/src backend/test \
  | grep -v "backend/src/adapters/\|backend/test/adapters/"
```

Baseline at `a873099`, measured: the first command returns **5 matches in 5
files**; `anthropicClient` appears **7 times** across `backend/src` and
`backend/test`. Target after phase 4: **2 files** for the first command
(`src/adapters/anthropicTranslator.ts`, `test/adapters/anthropicTranslator.test.ts`),
**0** for the second and third.

This is a grep, so it is worth saying what it does not prove. It cannot see the
*shape* leak — the clients' hand-copied types are invisible to it, and a route
returning a provider-shaped object with no provider identifier in it would pass.
The shape criterion is the § 5.1 list instead: an Azure adapter can be added
without touching a migration, a route handler, a schema, a client type, or a
component. Both checks are needed; neither substitutes for the other.

A cheap mechanical backstop is available and worth adding in phase 4:
`backend/test/route-reachability.test.ts` already reads project source as plain
text to catch drift without AWS credentials (`lessons.md:30`). The same technique
gives a test that asserts the first grep's result set — a boundary that fails in
CI is worth more than one documented here.

### 6.2 Phases

Ordered so the provider is never reachable from two places at once, and so the
riskiest phase (the live contract change) runs before any wiring is sunk into it.
Phases 1 and 2 are test-first (`npm test` runs `node --test` with coverage over
`test/**/*.ts`, and `/10x-tdd` exists for exactly this). Backend is excluded from
the per-edit hook by design (`CLAUDE.md` § Local quality gates), so every backend
phase gates on `npm test` explicitly.

| Phase | Work | Test-first? | Gate |
| --- | --- | --- | --- |
| **0** | **Read-only baseline.** Record the three greps in § 6.1. Re-run `measure-cost.mjs` against the *current* unconfigured client for a like-for-like number to compare D-3 against. Nothing is written | n/a | `lessons.md:33-38` — measured, not estimated |
| **1** | `backend/src/domain/translationDraft.ts` + `translator.ts`. `RequestedLanguages`, `fromProviderPayload`, `isDegenerate`, `renderingFor`, `toWire`, `billableCharacters`, the three error classes. **Pure — no provider import, no Fastify import, no DB** | **Yes** — unit tests only; feed it the malformed payloads § 3.1 says reach the UI today (`meaningText: 42`, missing `languages`, a reordered language list, an unrequested language code) | `npm test` |
| **2** | `backend/src/adapters/anthropicTranslator.ts`. Moves the tool schema, system prompt, model id and token formula out of `ai/translate.ts`; adds `strict: true` (D-2) and `detectedLanguageCode` (D-1); sets `maxRetries`/`timeout` (D-3). `backend/test/adapters/` gets the one file allowed to build an SDK envelope | Partly | **Live-API verification, per `lessons.md:34-39`** — ≥12 varied captures, count *usable* results, record failure rate / cost / latency / token headroom. This phase changes the tool schema, so the old measurements do not carry over. Requires explicit permission before any real call |
| **3** | `backend/src/plugins/translator.ts` replaces `plugins/anthropic.ts`; `fastify.d.ts:4,29` drops the SDK for `translator: Translator` (keep the forcing import — `lessons.md:19-24`, a trap this repo has hit twice); both routes call `fastify.translator`; `generateWithTimeout` becomes `draftWithTimeout`; `renderingFor` replaces `index.ts:396-408`; `ai/translate.ts` is deleted. **No route added or renamed → no `api-construct.ts` change** (`lessons.md:26-32`) | No (integration) | `npm test`; `route-reachability.test.ts` backstops the infra claim |
| **4** | `backend/test/helpers/fakeTranslator.ts` replaces `helpers/anthropic.ts`; the private copy at `entry-translations.test.ts:18-26` is deleted; `translate.test.ts` and `collections-rate-limit.test.ts` move to the fake. Add the boundary test from § 6.1 | **Yes** — the tests *are* the deliverable | `npm test` + the three greps |
| **5** | `schema.response` on both AI routes, sourced from `toWire()`'s type (§ 3.1's gap) | Partly | `npm test` |
| **6** | `measure-cost.mjs` imports the adapter's exports instead of copying them (§ 5.3); header comment notes the `npm run build:ts` prerequisite | No | Run it — it is its own gate |
| **7** | Client cleanup: delete `App.tsx:236-243`'s degradation counting (the server now raises `DegenerateDraftError`); regenerate `extension/src/types.ts:14-36` from `toWire()`. **Optional and separable** — the wire JSON is unchanged through phase 6, so an already-installed popup keeps working | Partly | per-edit hook (oxlint + scoped `vitest related`); `npm run lint`; `extension/test/popup/App.test.tsx` |

**Version skew.** The extension is side-loaded manually (`extension/README.md`),
so a popup built before phase 7 can be running against a backend at phase 6. This
is why `toWire()` emits today's JSON verbatim: phases 1–6 are wire-compatible by
construction, and phase 7 is a client-only cleanup that changes no bytes on the
wire. That is a deliberate difference from doc 02, which *does* change the
contract and therefore needs adapters.

### 6.3 Relationship to doc 02 and to the pivot

**Doc 02 changes the contract; this plan changes who owns it.** They touch the
same files and do not conflict, but order matters:

- **This first (recommended).** Doc 02's tool-schema inversion
  (`02-…md` § 5.1, named as "the plan's main cost") then happens inside the
  adapter, and its `variants[] → senses[]` wire rename happens in `toWire()` —
  one function instead of three clients plus the schema. § 4.1's naming
  compromise pays for itself immediately.
- **Doc 02 first.** Also fine; this plan then inherits `senses` throughout and
  § 4.1 is deleted. The cost is that doc 02 pays the three-client rename it could
  have avoided.
- **Both at once.** Not recommended. Doc 02's phase 2 and this plan's phase 2
  both carry the live-API verification gate on a changed tool schema; running
  them together means one measurement cannot tell you which change caused what.

**For the pivot** (`translation-pivot/change.md`), this plan supplies the thing
its design already assumes. Concretely: `research.md:1028-1032` specifies the
plugin shape it wants (`fp<Options>`, decorator declared only in `fastify.d.ts`,
the defensive type-only import) — § 4.5 is exactly that. `research.md:1010-1014`
requires a character counter on the seam — `billableCharacters()` is it. And the
sentence at `research.md:1021-1024` naming `generateWithTimeout` as the existing
precedent should be corrected in that document once this lands, or the next
person to read it will inherit the same wrong premise.

### 6.4 The three smaller leaks, recorded so they are not lost

Not part of this plan's phases. Each is a single sitting.

- **L-3.** Move `NeonDbError` and `UNIQUE_VIOLATION = '23505'` out of
  `index.ts:4,17,148` into a `isUniqueViolation(err): boolean` helper next to
  `plugins/neon.ts`. One import removed from a route handler.
- **L-4.** Add `isNotFound(err): boolean` to `frontend/src/api/errors.ts`
  alongside the `extractErrorMessage` that is already there, and delete the
  `axios` imports at `CollectionDetailPage.tsx:3` and `PrintCollectionPage.tsx:3`.
  The ACL exists; it is two lines short.
- **L-5.** Left alone deliberately (§ 1, L-5).

### 6.5 Lessons that bind this plan

| Lesson | Binds |
| --- | --- |
| `lessons.md:19-24` — ts-node/esm plugin files need a forcing import for `fastify.d.ts` augmentations; *"hit twice"*, most recently in `anthropic.ts` itself | Phase 3. `plugins/translator.ts` reads `fastify.config` and must carry `import type { AuthUser as _AuthUser } from '../fastify.d.ts'` |
| `lessons.md:26-32` — every new backend route needs an `api-construct.ts` entry | Phase 3 adds no route, so nothing is needed. Stated so the next reader does not have to re-derive it |
| `lessons.md:33-39` — a stubbed AI client cannot tell you the model's output is usable | Phase 2's gate. This plan *increases* the amount of stubbing (that is what a port is for), which makes the live check more necessary, not less |
| `lessons.md:62-67` — a quality gate that can silently not run is worse than no gate | § 6.1's boundary test. Verify it by making it **fail** — add an SDK import to a route and watch it go red — not by watching it pass |

### 6.6 Load-bearing names to register

`docs/reference/contract-surfaces.md` — the registry `.claude/CLAUDE.md`
describes as scaffolded by `/10x-init` — **still does not exist in this repo**
(re-checked at `a873099`; `docs/` is absent). Doc 02 § 5.10 made the same finding.
Until it exists these belong in the change's `change.md`.

| Name | Kind | Note |
| --- | --- | --- |
| `Translator` | Port (`backend/src/domain/translator.ts`) | One method. The seam `change.md:209-211` claims already exists |
| `TranslationDraft` | Value object | The only home for the draft's shape |
| `TranslationDraft.fromProviderPayload` | Factory | The single crossing point from provider data into the domain |
| `RequestedLanguages` | Value object | Owns alignment and the `detectedLanguageCode` acceptance rule |
| `PersistableRendering` | Projection | Replaces `index.ts:396-408`'s reach-in |
| `toWire()` | Projection | The wire contract, produced rather than inherited. Where doc 02's `variants → senses` rename lands |
| `billableCharacters()` | Domain method | `research.md:1010-1014`'s spend meter |
| `TranslatorUnavailableError`, `MalformedDraftError`, `DegenerateDraftError` | Error taxonomy | Mapped to HTTP in one place; carry no provider type |
| `createAnthropicTranslator` | Adapter factory | The only exported function that constructs a provider client |
| `detectedLanguageCode` | Tool-schema + draft field | Makes PRD Open Question 3 observable (D-1) |
| `backend/src/adapters/` | Directory | The grep boundary in § 6.1. Nothing outside it imports a provider SDK |

---

## Summary

InkLingo's worst leaking dependency is its model provider, and the evidence that
settles it is not the file count but a documented promise the code does not keep:
`translation-pivot/change.md:209-211` records "the translator is a
provider-agnostic seam", `research.md:1020-1026` names `generateWithTimeout` as
that seam, and `generateWithTimeout` (`index.ts:50-66`) isolates only a timeout
and an exception while the provider's data shape, model id, retry policy and
failure modes all pass straight through it. The shape crosses further than
anything else in the repo: `toolUse.input` is cast unchecked at
`translate.ts:148`, returned as the HTTP body at `index.ts:249` with no response
schema, redeclared verbatim in `extension/src/types.ts:14-36`, and finally walked
field by field in React state — so the tool schema Anthropic's model fills in is,
today, this product's wire contract. The duplication follows from that: the tool
schema and system prompt exist a second time, byte for byte, in the
`measure-cost.mjs` instrument the project relies on for cost baselines, and the
SDK's response envelope is hand-rebuilt in four test sites. The fix is a
`TranslationDraft` value object that is the single place knowing the draft's
shape, a one-method `Translator` port, and an `anthropicTranslator` adapter that
is the only file in `backend/src/` importing `@anthropic-ai/sdk` — measured by a
grep that must return two files instead of today's five, and by the list in § 5.1
showing an Azure swap touching four files and no migration, route, schema, client
type or component. Three questions the record left open are settled from the
SDK's own contract and encoded inside the ACL rather than in the API layer:
`strict: true` retires the unchecked cast as a first line of defence while the
domain keeps owning "usable" (`minItems` is not guaranteed, and
`lessons.md:34-39` measured what that costs); a required `detectedLanguageCode`
makes PRD Open Question 3 observable at all; and explicit `maxRetries`/`timeout`
replace an SDK default nobody chose, under which a single request could reach six
upstream calls. What this plan does **not** fix is stated in § 5.5 — the popup's
regenerate reconciliation stays client-side until doc 02's stable sense key
exists, the clients still hand-copy the wire types, and no live-API evidence was
gathered here, so phase 2's verification gate is a precondition for calling any
of it done.
