---
date: 2026-08-22T15:53:54+02:00
researcher: KStrzechowski
git_commit: d0bd4cebbb826541d57a5e314a84f1e458d43955
branch: docs/repo-map
repository: InkLingo
topic: "Which recorded problems are worth fixing, in what target shape, in what order"
tags: [research, codebase, refactor-opportunities, technical-debt, ranking, intentionality, il-24, verified]
status: complete
last_updated: 2026-08-23
last_updated_by: KStrzechowski
source_analysis: context/changes/translate-flow-analysis/research.md (98ddef9, ast-grep-verified 2026-08-22)
method: three exploration sub-agents — current shape / history & intentionality / migration feasibility
verification: ast-grep 0.45.1, 2026-08-23, against d0bd4ce (unchanged since authoring) — see § Weryfikacja twierdzeń
verification_commit: d0bd4cebbb826541d57a5e314a84f1e458d43955
---

# Research: refactor opportunities

**Date**: 2026-08-22
**Researcher**: KStrzechowski
**Git Commit**: `d0bd4ce` (`docs(translation-pivot): provider research, decisions, decision brief`)
**Branch**: `docs/repo-map` (not pushed — local paths, no GitHub permalinks)
**Repository**: InkLingo

## Research Question

`context/changes/translate-flow-analysis/research.md` documents this repository's
technical debt and structural risks in its current state, and deliberately stops
short of proposing anything. This change answers the question it left open:
**which of those problems are worth fixing, in what target shape, and in what
order.**

Every recorded problem is enumerated and classified. Each candidate is then
examined along three axes — current shape in code, historical intentionality,
migration feasibility — and the document closes with a ranking.

**Exploration only.** No refactor happened and no decision was taken. The
ranking is a proposal for a separate planning session.

### Evidence base

The source analysis was written against `98ddef9` and verified with ast-grep
0.45.1 on 2026-08-22. `git diff --name-only 98ddef9..HEAD` touches
`context/changes/**` only — **no code has changed**, so every file:line anchor
in it is current [evidence]. Its findings are treated as collected evidence and
are not re-derived here; what follows is the structural, historical and
feasibility detail it does not carry.

Claims are tagged `evidence` (read in a file, or a command re-run), `inference`
(reasoned from evidence), `unknown` (the record does not say). Where the record
is silent this document writes `unknown` rather than supplying a plausible
reason.

---

# 1. Inventory and classification

Every problem the source analysis records, plus the structural risks in
`context/map/repo-map.md`, regardless of the label each carried.

**Classification rule:** a **candidate** is a problem whose fix would change
*code structure*. A missing test, a documentation gap, or a deliberate coverage
choice is **not** a candidate — those are retained as input to feasibility and
cost.

## 1.1 Candidates (13)

| ID | Candidate | Recorded as |
| --- | --- | --- |
| C-01 | Response contract undeclared server-side, hand-copied client-side | §5.1, blast #4/#5/#7, repo-map risk 1 |
| C-02 | AI output cast, never validated | §5.2 |
| C-03 | Extension HTTP client has no seam: `background.ts` monolith, no timeout, non-exhaustive dispatch | §5.4 (structural half), §5.5, blast #3 |
| C-04 | Route registration hand-kept backend ↔ infra; guard is a text comparison | §5.9, §3.4, repo-map risk 2 |
| C-05 | Ownership enforced by convention, tested by grep | §3.5 |
| C-06 | Data model invisible to every static tool | §5.10 |
| C-07 | Rate limiter is per-Lambda-instance | §5.8 |
| C-08 | Quality gate that passes vacuously | §5.4 (gate half) |
| C-09 | One sense survives the save — `UNIQUE(entry_id, language_code)` | §5.12, IL-41 |
| C-10 | Bootstrap conflates unreachable backend with logged-out | §5.15b |
| C-11 | Legacy uppercase codes and the workarounds they force | §5.15d |
| C-12 | Architectural boundaries no gate enforces | repo-map risk 5 |
| C-13 | `api-construct.ts` breadth | repo-map risk 4 |

## 1.2 Not candidates — retained as feasibility and cost input

| Item | Why not a candidate |
| --- | --- |
| §5.3 retry fires only on total failure (`isEmpty` = `.every`) | Policy/behaviour change inside one function; no structure moves |
| §5.6 AI request shape asserted nowhere | Missing test |
| §5.7 20s abort path unreachable under test | Missing test |
| §5.4 `background.ts` has no tests | Missing test (the *seam that makes it testable* is C-03; the *gate that hides it* is C-08) |
| §5.11 backend outside every local gate | Deliberate, measured coverage scope — see §3, Tier A |
| §5.13 FR-018's stated trigger cannot occur | Documentation mismatch; the code is correct for a different reason |
| §5.15a `POST /api/collections` not transactional | Localized correctness defect |
| §5.15c `POST /:id/entries` is unlimited | Configuration, not structure |
| §3.6 / repo-map risk 3 — `infra/` has no real tests | Missing test |
| No coverage thresholds in any app; `c8` unused | Missing test infrastructure |
| No E2E covers this flow | Recorded decision, `context/foundation/test-plan.md:131` |
| Open Questions 1–4 | Unknowns, not problems — carried to §7 |

## 1.3 Deferred by the hard boundary — named, and not ranked

**§5.14 / IL-24 `translation-pivot` is not a candidate.** Its real fix is a
redesign of business concepts, not of code structure: the unit of reuse moves
from the **word** to the **sense**, with English as a pivot language and four
new tables (`concepts`, `concept_translations`, `concept_sentences`,
`sentence_renderings`) [evidence: `context/changes/translation-pivot/change.md`
§ The architecture]. That is a domain-model decision — it is the subject of a
separate, later analysis, and this document stops at naming it.

It is **not discarded**. The same brief is an input to feasibility and cost, so
IL-24 appears on every candidate's feasibility axis as a rework-risk verdict:
**if IL-24 lands, is this fix subsumed, orphaned, or untouched?**

It is also **not treated as a decided fixed point to rank around.** It sits at
`status: preparing` with nothing built — *"the schema … is designed but
unwritten"* [evidence: `decision-brief.md` § Status] — and carries unresolved
questions of its own (the measured ILI-mapping rate, the sense-granularity
display rule, whether the model will reliably answer "none of these")
[evidence: `decision-brief.md` § Still open]. Its **direction** is decided; its
**execution** is not.

**A second item touches the same boundary: C-09.** Relaxing
`UNIQUE(entry_id, language_code)` is not a structural change to code — it
changes what an *entry* is, from one sense per language to many. The roadmap
already links it to the pivot for exactly this reason: IL-41 is *"related to
IL-24 because the pivot's unit of reuse is the sense"* [evidence:
`context/foundation/roadmap.md:183`]. It is classified as a candidate above on
the strength of its schema surface, but it is **excluded from the ranking on
the same boundary** and belongs in the same later analysis. See §5.2.

---

# 2. Per-candidate findings

Each entry: current shape (evidence), intentionality verdict, feasibility.
The four gate layers referenced throughout:

- **L1 per-edit** — `.claude/hooks/post-edit-check.mjs` → `checksFor()`; frontend/extension only
- **L2 pre-commit** — `.githooks/pre-commit`, same routing
- **L3 pre-push** — `heavyChecksFor()`: `tsc` for all four apps, **tests only for frontend/extension**
- **L4 CI** — `.github/workflows/{pr-diff,deploy}.yml`; backend `npm test` against an ephemeral Neon branch

**Dependency-cruiser runs in no layer at all.** `grep -rn depcruise .github/
.githooks/ scripts/quality/` → **no hits**, re-verified 2026-08-22, and
`AGENTS.md:63` says so outright: *"It is not wired into the hooks yet"*
[evidence].

## C-01 — Response contract undeclared server-side, hand-copied client-side

**Current shape.** The backend declares **zero** response schemas: six `schema:`
blocks exist (`collections/index.ts:101,156,219,253,359`,
`client-errors/index.ts:28`), all `body`/`params`; `grep -rn "response:"
backend/src` returns nothing [evidence]. `POST /:id/translate` returns the AI
layer's object verbatim (`index.ts:249`), so `TranslationResult`
(`ai/translate.ts:21-40`) is the public API shape by accident of implementation,
re-declared by hand at `extension/src/types.ts:14-36` [evidence]. The read path
is worse: `GET /api/collections/:id`'s shapes are declared **only** at
`frontend/src/api/collections.ts:3-37` — the repo's widest hub, 10 dependents —
with no backend counterpart to drift from [evidence].

`backend/src/ai/translate.ts` simultaneously owns the model config, the tool
JSON-Schema, **the wire type the HTTP API returns**, and response repair
(`alignToRequested:113-120`) [evidence].

**The tool to fix half of this is installed and unused.**
`@sinclair/typebox ^0.34.52` and `@fastify/type-provider-typebox ^6.1.0` are
runtime dependencies (`backend/package.json:32,34`); **2 of 5** (raport:
*every*) route plugins are annotated `FastifyPluginAsyncTypebox` — the two that
declare schemas (`collections/index.ts:68`, `client-errors/index.ts:13`);
`autohooks.ts:10`, `me/index.ts:3` and `health/index.ts:5` are plain
`FastifyPluginAsync`. But there is **no
`withTypeProvider()`, no `setValidatorCompiler`, no `setSerializerCompiler`
anywhere in `backend/src` or `backend/test`** [evidence]. The provider is in use
for request-side inference only.

Two refinements to the source analysis: the three `languages.ts` are **not
copies** — 4, 20 and 25 lines with different structures (codes only / a labels
record / a `SUPPORTED_LANGUAGES` array); only the eight-code vocabulary is
shared [evidence]. And the `targetText`→`sentenceText` rename is mapped
**twice**, at `App.tsx:382` and again server-side at `index.ts:413` [evidence].

**Intentionality: accidental complexity for the response-contract half;
deliberate constraint for the four-app split.** The split is reasoned
(`tech-stack.md:29`, solo dev, user-stated preference for a decoupled
frontend/backend) [evidence]. The duplication's authority is **circular**:
`extension/src/types.ts:1-4` and `backend/src/languages.ts:1-3` were written the
same day and both cite CLAUDE.md's Architecture section — but the clause they
cite (*"…so response shapes are duplicated per client"*) was added to CLAUDE.md
**in the same commit** as the `types.ts` comment (`8da3a52`, 2026-07-30),
extending a line that had been pure `/init` description since the first commit
`4b25158` [evidence]. A *description* of the scaffolded state was cited as
*authority* (2026-07-30), cited back as proof it was *deliberate*
(`testing-frontend-extension-logic/plan.md:101-103`, 2026-08-11), and finally
hardened into an enforced lint rule (`1477298`, 2026-08-17) [evidence].

TypeBox was adopted **for request DTOs only** — `68f7d4b`'s commit body says so
verbatim: *"schema-derived request DTOs (collections/schemas.ts)"* [evidence].
Whether declaring response schemas was ever weighed: **unknown** — the record is
silent, and nothing anywhere discusses generating client types from a server
contract.

**Feasibility.** Five mechanisms assessed:

1. **Fastify response schemas via the installed provider** — no new dependency,
   per-route, additive, deletable [evidence]. Hazard: response schemas
   *serialize and strip*, so a wrong schema silently drops fields, caught only
   at L4 [inference].
2. **Generated OpenAPI** — `@fastify/swagger` is not installed [evidence], and
   with no `response:` keys the document would describe request bodies only. A
   successor to (1), not an alternative.
3. **Shared package** — forbidden by name: `.dependency-cruiser.cjs:41-48` says
   *"either duplicate it or raise extracting a real published package"*
   [evidence]. No workspace linking, no root `package.json`. Not incremental;
   reversible only by re-duplicating.
4. **Codegen** — needs (1)+(2). Has a home: `infra/scripts/` already runs as
   cross-app build glue in both workflows [evidence].
5. **A contract test that compares declarations without unifying them** —
   **the repo already has two working precedents**: `route-reachability.test.ts`
   and `route-ownership.test.ts` both read another file as plain text and
   set-compare [evidence]. Cheapest, most reversible, needs nothing new.

Guards today: for the read path, **nothing at any layer**. Note the trap —
`frontend/e2e` runs at L4 but *stubs* `/api/*`, so it re-encodes the frontend's
assumption rather than checking it [evidence].

**IL-24 rework risk: SPLIT.** Read path **untouched** — the concept tables land
*alongside*, and *"nothing saved in the meantime is stranded"* [evidence:
`change.md` § Why this is parked]. Translate leg **at risk** — advancing
`set_index` *"needs either a request field (contract + extension change)"*, and
the sense-granularity display rule is explicitly unresolved [evidence]. The
*mechanism* survives either way.

## C-02 — AI output cast, never validated

**Current shape.** `translate.ts:148` — `toolUse.input as TranslationResult`,
the only such cast in `backend/src`. A throw occurs only if the `tool_use` block
is *absent* (`:144-146`); the return at `:149-152` re-reads
`result.normalizedNativeText` unguarded and `result.languages ?? []` [evidence].
Two `??` fallbacks (`:118`, `:151`) prevent a throw rather than check a shape —
they convert malformed into empty, which `isEmpty` (`:122-124`) cannot
distinguish from a bad roll [evidence]. `generateWithTimeout`
(`collections/index.ts:50-66`) already catches everything and returns `null`, so
a validation throw **already has a landing site** [evidence].

**Intentionality: deliberate-but-stale.** The premise is on record:
`capture-translate-save/plan.md:159` — tool-use was chosen because it *"is the
reliable way to get a fixed JSON shape back from Claude"* [evidence]. That
premise has since been **contradicted in writing twice**:
`translate.ts:69-71` (*"minItems is advisory on a tool schema rather than
enforced"*) and `testing-ai-usability…/plan.md:11` (*"Anthropic tool schemas
don't enforce it"*) [evidence]. The response was two hand-written defences for
the two *observed* failure shapes — `alignToRequested` and the empty-result
retry — not validation of the class. Whether runtime validation was ever
weighed: **unknown**; no document mentions it.

**Feasibility.** `@sinclair/typebox`'s `./value` subpath export is present in
the installed package, so `Value.Check` is available with **zero new
dependencies** [evidence]. Confined to one function. Two frictions:
`translate.ts:84` uses a JSON-Schema type array (`type: ['string','null']`)
where TypeBox emits `anyOf`, and whether the Anthropic tool-schema subset treats
those equivalently is **unknown**; whether a `TSchema` satisfies
`Anthropic.Tool['input_schema']` without a cast is **unknown**.

Guards: `translate.test.ts` (9 cases), **L4 only** — and the stub is blind, a
zero-argument arrow that never inspects what it was called with [evidence].

**IL-24 rework risk: CONTENT ORPHANED, SEAM UNTOUCHED.** The pivot replaces this
tool schema outright (*"the English-only tool schema does not exist yet"*;
922 of 1,238 input tokens exist purely to describe five languages) [evidence].
But it **adds a second unvalidated model boundary** — the ILI-picking call — and
its own open question is literally whether the model reliably answers *"none of
these"* [evidence: `decision-brief.md` § The decision, § Still open]. A boundary
validator is the instrument that answers that question.

## C-03 — Extension HTTP client has no seam

**Current shape.** `background.ts`, 176 lines, **zero importers** and **zero
tests** [evidence]. `apiFetch` (`:55-121`) bundles token fetch and
session-expiry error, header construction, method inference, URL construction, a
self-exclusion flag, network-error reporting, HTTP-error reporting, the 429
special case, WeakSet dedupe marking, the flush trigger and JSON parsing — 67
lines, one `Promise<T>` cast [evidence]. `run()` has **7 cases for 7 `Message`
variants, no `default`, return type `Promise<unknown>`** — a new variant compiles
and returns `undefined` at runtime [evidence]. **No `AbortController` anywhere in
`extension/src`** (one comment mentions it); the frontend has a fully reasoned
two-tier scheme at `client.ts:27-48` [evidence].

The existing test helper does **not** reach it: `extension/test/helpers/webext.ts`
*re-implements* the background envelope from the popup side — its own comment
warns *"Getting this wrong would let every error-path test pass against a
contract the real background script does not honor"* [evidence].

**Intentionality: split three ways.**
*Background-script routing* = **deliberate constraint**: raised as an open
question in research, decided in `plan.md:47` (*"solved architecturally rather
than by widening the API's origin allowlist"*), later encoded as a lint rule
[evidence]. *Untested* = **deliberate constraint**, risk-ranked out three times
(`testing-frontend-extension-logic/plan.md:91-93`: *"none of the top-7 risks
name it"*) [evidence]. *No client timeout* = **accidental complexity, never
examined** — a grep across `context/archive/` and `context/foundation/` for
`AbortController`/deadline/timeout finds **zero** documents discussing the
extension's client; every hit is backend- or frontend-side, including
`testing-auth-resilience`, which spent two named fix commits (`16fa594` *"stop
the client out-waiting the model route"*, `d359bae` *"size the AI deadline to
the route, not the cap"*) tuning the *frontend's* deadline against **the very
same backend route** [evidence]. Why the question was never asked of the
extension: **unknown**.

**Feasibility.** Smallest seam: extract `apiFetch` into its own module taking an
injected token-getter and `fetch`. `background.ts` stays the MV3 entry point and
is already whitelisted in `.dependency-cruiser.cjs`'s `no-orphans` exceptions,
so an imported sibling needs no config change [evidence]. Exhaustiveness needs
no new abstraction — `messages.ts:38-46` already carries `MessageResults` keyed
by `type`; narrowing `run()`'s return plus a `never` assertion turns a runtime
failure into a compile error [evidence]. Three independently revertible commits.

**This is the only candidate covered by all four gate layers** — `checks.mjs:47`
routes all of `extension/src/` into L1+L2, `heavyChecksFor` runs the full suite
at L3, L4 runs test+lint+build [evidence]. Today that L1/L2 routing is vacuous
for this file — see C-08.

**IL-24 rework risk: UNTOUCHED, AND IT APPRECIATES.** Nothing in the pivot docs
touches `background.ts`. But the set-cursor *"needs … a request field (contract
+ extension change)"* [evidence] — IL-24 is precisely the change that would add
a `Message` field, which is the failure mode the exhaustiveness fix prevents.

## C-04 — Route registration hand-kept backend ↔ infra

**Current shape.** 8 `addRoutes` calls covering 9 method+path keys
(`api-construct.ts:149-208`) against 9 backend routes [evidence]. The backend
extractor is factored into `backend/test/helpers/routes.ts`; the gateway parser
is inline regex in the test (`route-reachability.test.ts:56-73`) [evidence].
`MIN_EXPECTED_ROUTES = 9` equals the actual count — the tripwire has zero slack
[evidence].

**Intentionality: deliberate constraint.** The reason is at the line:
`api-construct.ts:145-146` — *"Explicit paths, not a `{proxy+}` catch-all —
simpler to verify each route individually as they're added"* [evidence].
`{proxy+}` was **named and rejected** as a live option:
`testing-backend-ci-safety-net/research.md:44` — *"this is a deliberate
structural choice, not an oversight, so any fix should work with explicit-path
registration rather than propose replacing it"* [evidence]. The text comparison
was **forced by a hard constraint**: `backend/test/tsconfig.json`'s `include`
does not cover `infra/`, so the check must read the construct as plain text
rather than import it [evidence]. The blind spot is documented **inside the
guard** and appended to `lessons.md` as the 2026-08-18 update [evidence].

**Feasibility.** The extractor cannot be promoted to a generator directly —
`api-construct.ts` importing it would violate **two** live cruiser rules
(`no-test-code-in-production-code`, `no-cross-app-imports`) [evidence]. The
reachable path is `infra/scripts/`, which both workflows already run before
every `cdk diff`. First step would be a *shadow* manifest asserted equal to what
the existing extractor produces. The blind spot is **latent, not active**: zero
`fastify.route({...})` call sites exist [evidence].

**IL-24 rework risk: UNTOUCHED** — the pivot's route consequences are about
behaviour on existing routes, not new route keys [evidence].

## C-05 — Ownership by convention, tested by grep

**Current shape.** `ownership.ts:19-38`, called at `index.ts:160,230,288,367`
and `:372`; each of four routes repeats the same three-line `if (undefined)
return reply.notFound()` block [evidence]. The helper doubles as the collection
*fetcher* — the same row's `native_language_code` feeds the AI call and the entry
insert — so ownership and data loading are one operation [evidence].
`route-ownership.test.ts:68` does `handlerSource.includes('fetchOwnedCollection(')`
[evidence].

A carrier already exists: `routes/api/autohooks.ts:10-43` is an `onRequest` hook
cascaded to everything under `routes/api/` and already performs verify → query →
decorate [evidence].

**Intentionality: deliberate constraint.** What the guard claims is stated
precisely and is *not* correctness:
`testing-ai-usability…/plan.md:9` — *"What's missing is not coverage — it's a
guarantee that the next ID-accepting route added won't skip this pattern"*
[evidence]. Stronger enforcement was **explicitly declined** (`:38`: *"Not
building the ownership convention as a lint rule, ESLint plugin, or
compile-time check"*), the slicing heuristic's fragility was pre-flagged in the
plan, and the guard was verified by a deliberate break [evidence].

**Feasibility — with a sharp edge the blast-radius table does not list.**
Hoisting the call into a hook **deletes the literal string the test greps for**,
so the refactor that makes the convention unnecessary fails the test that
enforces it [evidence]. An `api/`-level hook also fires for id-less routes
(`GET /api/me`, `POST /api/client-errors`) and must no-op without params
[evidence]. First step is therefore to make the guard hook-aware *before*
anything moves. Whether a folder-scoped `collections/autohooks.ts` cascades in
addition to the parent: **unknown**.

**IL-24 rework risk: UNTOUCHED** — the pivot's four tables carry no `user_id`;
they are a shared global cache, which is the point of sense-level reuse
[inference from `change.md` § The architecture].

## C-06 — Data model invisible to every static tool

**Current shape.** 18 SQL call sites across `backend/src`; **only 3 carry a type
assertion** (`ownership.ts:24,36`, `index.ts:34`) [evidence]. Four separate
hand-written row→DTO mappers for overlapping shapes (`index.ts:88-96`,
`192-214`, `339-351`, `422-434`) [evidence]. `fastify.sql` is typed once as
`NeonQueryFunction<false,false>` (`fastify.d.ts:27`) with no per-query type
parameter [evidence]. Migrations use node-pg-migrate builder calls, not raw SQL,
and `backend/migrations/` is absent from `scripts/depcruise.mjs`'s `SOURCES`
[evidence].

**Intentionality: split.** *No ORM* = **deliberate constraint**,
`minimal-database/plan-brief.md:21` — *"No ORM, minimal deps, mature/popular —
matches the stack's existing quality bar without adding a query-builder
abstraction"* [evidence]. *Migrations outside the cruise* = **unknown, reading
as oversight**: `SOURCES` is a hand-curated list, and the 2026-08-19 audit
(`4deae85`) that swept for uncruised first-party trees accounted in detail for
`infra/scripts/` and `scripts/` and **never mentions migrations**; zero hits
repo-wide [evidence].

**Feasibility.** Four options, none requiring an ORM. The strongest has a
precedent already built and running: `backend/test/schema/core-schema.test.ts`
asserts constraints empirically against the migrated Neon branch, using the
harness both workflows already wire up [evidence]. Extending it to assert column
names is purely additive. Constraint to respect: the Neon HTTP driver's
`transaction([...])` is non-interactive — the route generates the entry UUID
client-side because *"the driver can't feed a RETURNING value from one statement
into the next"* (`index.ts:306-310`) [evidence]. Guards: **L4 only** — backend
gets `tsc --noEmit` at L3 but no tests, so a bad column rename is invisible
until a push reaches CI [evidence].

**IL-24 rework risk: UNTOUCHED, ARGUABLY PREREQUISITE.** Tables land alongside,
so no SQL site is deleted; and two pivot requirements land straight into this
harness — `concept_translations.source` is *"the one schema requirement the
licensing gate imposes regardless of which posture wins"*, and `UNIQUE(ili)`
invokes `lessons.md`'s pre-existing-duplicates rule [evidence].

## C-07 — Rate limiter is per-Lambda-instance

**Current shape.** `plugins/rate-limit.ts` is 14 lines; the entire config is
`register(rateLimit, { global: false })` [evidence]. Two per-route opt-ins on
this flow (`index.ts:223`, `:363`, 20/min keyed on `authUser.id`) plus
`client-errors/index.ts:28` at 60/min [evidence].

**Intentionality: deliberate constraint — the best-documented accepted trade-off
in the repo.** `capture-translate-save/change.md` carries a dedicated section
naming the mechanism, quantifying the exposure (*"up to ~200/min at this
account's Lambda concurrency limit of 10"*), naming the real backstop (*"The
Anthropic Console spend limit … is the actual backstop"*), and **pricing the
rejected alternatives**: ElastiCache (VPC-only → NAT Gateway, *"roughly
$50–130/month"*) and Upstash (vendor + secret). It even pre-scopes the cheap
future fix: *"a custom store against the existing Neon connection"* with the
interface quoted [evidence]. The review that triaged it recorded the decision
explicitly as *"Rejected as disproportionate for a single-user PoC whose
exposure requires an authenticated caller"* [evidence].

**Feasibility.** No Redis, no DynamoDB, no ElastiCache exists — enumerated
across `infra/lib/**`, the only services are Lambda/HttpApi/Cognito/S3/
CloudFront/SSM/IAM/Logs [evidence]. API Gateway usage plans are a **REST API v1**
feature and unavailable on `HttpApi`; what v2 offers is stage-level throttling,
already in use at 5 rps / burst 10, which is per-API and cannot express a
per-principal key [evidence]. The only zero-new-resource option is a
Neon-backed store. First step: `plugins/rate-limit.ts` declares **no dependency
on `plugins/neon.ts`**; establishing that ordering is a standalone
behaviour-neutral change [evidence].

**Unknown:** whether the Anthropic Console spend limit — the named actual
backstop — was in fact set. The record instructs it and never confirms it.

**IL-24 rework risk: UNTOUCHED, ADJACENT** — the pivot adds a second metered
spend surface and asks for a running character counter at its seam, calling its
absence *"the same class of failure as lessons.md's 'a quality gate that can
silently not run'"* [evidence].

## C-08 — Quality gate that passes vacuously

**Current shape, re-verified today.** In `extension/`:

```
vitest related src/background.ts --run                          → exit 0   "No test files found, exiting with code 0"
vitest related src/background.ts --run --passWithNoTests=false  → exit 1   "No test files found, exiting with code 1"
```

[evidence — both re-run 2026-08-22, exit codes captured directly]. `checks.mjs`
builds the check as a single array literal `['related', ...related, '--run']`,
and `runCheck:189` derives `ok` purely from the exit status [evidence]. The file
already ships the escape hatch for legitimate no-test files — `EXPLICIT_TESTS`,
whose one entry exists for exactly this class of problem [evidence].

**Intentionality: deliberate-but-stale.** The vacuous-pass mode was **known at
authoring time** — the word appears in `checks.mjs`'s own comment (`:53-57`):
*"Route it by hand, or the check that guards the A4 geometry passes vacuously on
every CSS edit"* [evidence]. But only one of two shapes was addressed: the
handled case is *file outside the module graph*; the unhandled case is *file
inside the graph that no test imports*. And the general rule now on the record
contradicts the survivor — `lessons.md`'s *"A quality gate that can silently not
run is worse than no gate"* was written **the day after** `checks.mjs`
(2026-08-11 → 2026-08-12) and says *"Prefer a gate that is noisy when it cannot
run over one that exits 0 when it finds nothing to do."* `checks.mjs` has not
been touched since [evidence]. Whether the in-graph-but-untested shape was
considered and judged different: **unknown**.

The backend/infra exclusion is a separate and clean **deliberate constraint** —
measured (~20s `tsc`, live Neon), dated, stated in four places, with an explicit
*"don't add them without re-measuring"* [evidence].

**Feasibility.** One flag, maximally reversible, with `EXPLICIT_TESTS`
absorbing legitimate exceptions. The blast radius is behavioural and **has never
been enumerated** — it is verbatim Open Question 2. First step is therefore pure
measurement: run the flag across every path matching the two `riskAreas`
regexes and count. Zero code change; converts an open question into a number.

**IL-24 rework risk: UNTOUCHED** — and it protects every other candidate's work.

## C-09 — One sense survives the save

**Current shape.** `UNIQUE(entry_id, language_code)` at
`1784584360698_create-core-schema.ts:52-54` [evidence]. **`entry_sentences` has
no such constraint** — only an index (`:68`) — yet the duplicate-guard comment
at `collections/index.ts:279-280` claims both tables hit it [evidence]. Two
silent client-side collapses: `CollectionDetailPage.tsx:192-193` builds a `Set`
(duplicates vanish from gap detection) and `printRows.ts:55-60` uses `.find()`
per language (the sheet shows one of N) [evidence].

**Intentionality: deliberate-but-stale, and the staleness is itself now
recorded and accepted.** The cardinality was chosen on a *different axis* —
`minimal-database/plan-brief.md:21` picked one row per (entry, language) to
support *multiple target languages*, with multi-sense to be packed as a
`/`-separated string [evidence]. A grep of that entire archive for "variant",
"regenerac", FR-009/010/011/012/015 returned **zero hits**: the schema was
designed before and independent of the AI-variant requirements [evidence]. The
consequence is now measured on real data and tracked — IL-41, Low priority,
*"verified against the dev database: `zamek` is stored only as `lock`"*
[evidence: `roadmap.md:183`].

**Excluded from the ranking — see §1.3.** Its fix redefines what an entry is.
**IL-24 rework risk: SUBSUMED IN INTENT, ORPHANED IN MECHANISM — the highest in
the set.**

## C-10 — Bootstrap conflates unreachable backend with logged-out

**Current shape.** `App.tsx:127-140`: one `.catch` sets both `setError(...)` and
`setStatus('anonymous')` for *any* failure, including a `browser.storage.local`
rejection inside `loadCollections` [evidence]. `Status` is a 3-value union with
no `error` state [evidence].

**Intentionality: deliberate constraint whose handoff silently lapsed.** The
follow-up doc is precise — *"It is `loadCollections()` that rejects, and the one
`.catch` covering the whole bootstrap treats any failure as anonymity"* — and
defers explicitly: *"Recorded here rather than fixed because it is cosmetic in
production terms"*, to be folded into the next slice touching the popup shell,
*"S-05 is the likely candidate"* [evidence]. **S-05 shipped and archived with
zero mentions of it**; two further changes edited the same file; it has **no
Jira ticket and no roadmap row** [evidence]. The deferral has no carrier left.
Whether it was consciously re-declined during S-05 or forgotten: **unknown**.

**Feasibility.** Fully local; `App.test.tsx` already has the mechanism (the
fake turns a throwing handler into `{ ok: false }`, so "auth succeeds,
collections fail" is one handler assignment) [evidence]. All four layers.
**IL-24: UNTOUCHED.**

## C-11 — Legacy uppercase codes and their workarounds

**Current shape.** The source analysis says two guards compare
case-insensitively; there are **three** on the backend read path alone
(`index.ts:236,298,378`), plus write-time lowering at `:109-110,264,269,365`, one
SQL-side `lower()` at `:385`, and at least four client-side sites [evidence].

**Intentionality: write-time normalization deliberate (`68f7d4b`); absence of a
backfill unknown.** The rows were queried and counted: *"only `PL` (one
collection's native code) and `EN` (one target row) … **There is no `ENss`** —
that code appears nowhere in the data, and earlier references to it in this plan
were wrong"* [evidence: `printable-export/plan.md:30`, 2026-08-03]. Tolerance was
then baked into three apps' read paths **and into permanent test fixtures**
[evidence]. **No document anywhere proposes, costs, or rejects a normalizing
`UPDATE`** — `unknown`, and this document declines to supply the
obvious-sounding reason.

**Feasibility.** First step is a read-only count of
`language_code <> lower(language_code)` — closes Open Question 3 with no code
change. **IL-24: UNTOUCHED.**

## C-12 — Architectural boundaries no gate enforces

**The premise is half stale.** `.dependency-cruiser.cjs` **already encodes both
boundaries repo-map risk 5 names**: `extension-popup-stays-off-the-network`
(`:59-71`, error) and `backend-plugins-are-below-routes` (`:86-94`, error), plus
`no-cross-app-imports`, `backend-no-cross-route-imports`,
`frontend-api-is-below-pages`, `observability-stays-a-leaf`,
`no-test-code-in-production-code` and stock hygiene — all at `severity: error`
[evidence]. Every rule was **verified by deliberate break**, which caught two
real config bugs [evidence: `1477298`].

**The actual gap is that nothing runs them** — no hits in `.github/`,
`.githooks/` or `scripts/quality/`, and `AGENTS.md:63` states it [evidence].
Deliberate at the time: *"promote to pre-push if it starts catching things"*
[evidence]. What genuinely cannot be encoded is the *runtime* contract:
`routes → plugins` is 0 import edges and 20 (raport: 22) decorator calls
(`fastify.sql` ×18, `fastify.anthropicClient` ×1, `fastify.jwtVerifier` ×1;
38 if the request decorators `authUser`/`correlationId` are counted too);
`popup → background`
is `sendMessage`, where *"absence of an edge is the architecture working"*
[evidence]. Whether anything was considered for those: **unknown**.

Residual real gaps: no rule constrains `routes/ → ai/`
(`collections/index.ts:14` imports it unconstrained), and the popup rule lists
three files by name, so a new network-capable module is uncovered until added
[evidence].

**Feasibility.** One workflow step, deletable; the cruise must see all four apps
in one pass and needs each app's `node_modules`, all of which have been
installed by the time `pr-diff.yml`'s extension step finishes; ~17s [evidence].
**IL-24: UNTOUCHED, APPRECIATING** — the pivot adds a `fastify.translator`
plugin shaped after `plugins/anthropic.ts`, exactly the layering that rule
polices [evidence].

## C-13 — `api-construct.ts` breadth

**Current shape.** 210 lines, 12 imports — **11 of which are AWS-CDK or Node
core**; exactly one points at first-party code (`../cdk-ssm-params`) [evidence].
So the fan-out measures AWS surface area, not module coupling.

**Intentionality: deliberate constraint, corroborated three ways.**
`repo-map.md:109-111` argues it directly; `artifact-2-dependencies.md:168-182`
measures it (8 of the 12 distinct AWS service modules used by all of
`infra/lib`) and concludes *"splitting the file into smaller modules would move
the risk, not reduce it"*; `artifact-1-territory.md` corroborates from churn
[evidence]. Constructs are 1:1 stack wrappers with **zero construct-to-construct
edges**, so no decomposition seam exists [evidence].

**Feasibility.** Exactly one incremental split exists, and it is C-04's first
step: lifting the route block into a data table *inside the same construct*.
Splitting into separate constructs changes construct paths, and CDK logical IDs
derive from them — a rename would replace resources on deploy [inference].
**IL-24: UNTOUCHED.**

---

# 3. Intentionality summary — accepted trade-offs vs. never examined

This is the distinction that drives the ranking. **A documented, reasoned
acceptance is not the same problem as an oversight, and ranking them alike would
be a mistake.**

**Tier A — deliberately accepted, alternatives named and costed. Do not
re-litigate without new information.**

| Item | Where the acceptance lives | What was weighed |
| --- | --- | --- |
| C-07 rate limiter | `capture-translate-save/change.md` + `impl-review-phase-4.md` F1 | Two alternatives **priced** ($50–130/mo NAT; vendor+secret), real backstop named, cheap future fix pre-scoped |
| C-04 explicit routes | `api-construct.ts:145-146`, `testing-backend-ci-safety-net/research.md:44` | `{proxy+}` rejected by name; guard built; guard's blind spot documented in the guard |
| C-05 ownership grep | `testing-ai-usability…/plan.md:9,38-39,48` | Lint rule / compile-time check explicitly declined; claim narrowed in writing; verified by deliberate break |
| C-13 construct breadth | `repo-map.md:109-111` + two map artifacts | Measured, argued, corroborated three ways, ranked *below* infra's missing tests |
| C-03a background routing | `background.ts:8-14`, `plan.md:47,269` | Open question → decision → enforced lint rule |
| C-06a no ORM | `minimal-database/plan-brief.md:21` | Chosen against a query builder on a stated quality bar |
| C-08b backend outside local gates | `checks.mjs:25-31`, `AGENTS.md:59`, `CLAUDE.md` | **Measured** and dated, with "don't add them without re-measuring" |
| C-03c `background.ts` untested | `testing-frontend-extension-logic/plan.md:91-93` | Risk-ranked out three separate times |

**Tier B — decided once, then the premise moved.**

| Item | Original reason | What broke it |
| --- | --- | --- |
| C-02 | Tool-use is *"the reliable way to get a fixed JSON shape"* | Repo has since written down **twice** that tool schemas are advisory; ~3/34 observed |
| C-08a | Vacuous pass handled for the *asset* case | `lessons.md`'s **next-day** rule demands gates be noisy; `checks.mjs` untouched since |
| C-10 | Cosmetic; fold into the next slice touching the popup | S-05 shipped without it; no ticket, no roadmap row — no carrier left |
| C-09 | One row per (entry, language) for multi-*language* support | FR-009 arrived later; now knowingly re-accepted as IL-41 → back to Tier A |

**Tier C — never examined. Nothing was traded away because nothing was weighed.**

| Item | State of the record |
| --- | --- |
| C-01a no response contract | TypeBox adopted **for request DTOs only**; response schemas noted absent and never discussed again. The tool has been installed and unused since 2026-07-30 |
| C-01b nothing guards the duplication | Ratified — but on a **circular citation** (comments cite CLAUDE.md; the clause was written in the same commit, extending pure `/init` description). A contract test was never proposed |
| C-03b no extension timeout | **Zero** documents mention it — including the change that spent two commits tuning the frontend's deadline against the same route |
| C-06b migrations outside the cruise | The 2026-08-19 audit that swept for uncruised trees never mentions them |
| C-11b no backfill | Data counted; tolerance baked into three apps and permanent fixtures; no proposal, cost or rejection anywhere |
| C-12b runtime boundaries | Import-direction rules are Tier A; the runtime holes are named unenforceable, with no alternative ever considered |

**The method observation that matters.** Tier A items share a signature: an
alternative is *named*, a cost is *quantified*, and the acceptance is written
where the next reader will hit it. Tier C items share the opposite: the fact is
*observed* in a research document and never converted into a decision.
**Observation-without-disposition is this repo's characteristic failure mode** —
it is what separates C-07 (exemplary) from C-01a and C-03b (invisible).

---

# 4. Step zero — the shared prerequisite

**C-08 is not ranked as a refactor** — its fix is one flag, not a change of
structure. But it is the prerequisite for anything test-bearing, so it is named
here rather than buried.

`vitest related` reports green having run nothing, at L1 and L2 — the two layers
that decide what an agent believes about its own edit. Any work under C-03 lands
a new test file whose *absence* would otherwise keep reporting green.

- **First step (pure measurement, zero code change):** run
  `vitest related <file> --run --passWithNoTests=false` across every path
  matching `checks.mjs`'s two `riskAreas` regexes and count the failures. This
  converts Open Question 2 into a number and sizes the blast radius before
  anything is flipped.
- **Then:** add the flag; route the legitimate exceptions through the
  `EXPLICIT_TESTS` map that already exists for this purpose.

A companion of the same size: **C-12's rules run in no layer at all.** One step
in `pr-diff.yml`'s `diff` job, after the extension step, ~17s, no credentials, no
DB, no browsers. Both are already-built machinery that is switched off.

---

# 5. Refactor opportunities

Ranked by risk of silent production failure, leverage for the coming pivot, and
value as an Architect-module refactor narrative — with feasibility, including
IL-24 rework risk, as the qualifying axis.

## 5.1 The ranking

### #1 — C-01: give the response contract a declared source of truth

**Current shape.** The backend declares no response schema anywhere. The AI
layer's return type is the API contract by accident (`translate.ts:21-40` →
returned verbatim at `index.ts:249`), hand-copied into
`extension/src/types.ts:14-36`. The read path has no server-side declaration at
all — its shapes exist only in `frontend/src/api/collections.ts:3-37`, the
repo's widest hub at 10 dependents.

**Target shape.** One declared response schema per route, owned by the route's
existing `schemas.ts`, with the AI module consuming an app-owned type rather
than defining the wire format — and a contract test comparing each client's
declaration against it without unifying the four apps.

**Why first.** It is the only candidate where **no guard exists at any of the
four layers**, and the failure is silent by construction: a backend field rename
compiles cleanly in all four apps and fails at runtime in whichever client was
forgotten. The E2E suite does not help — it stubs `/api/*`, so it re-encodes the
frontend's guess rather than checking it. `repo-map.md` independently ranks this
risk #1. On the second axis, IL-24 leaves the read path **untouched** (tables
land alongside; nothing saved is stranded), so the larger half of the work
cannot be wasted. On the third, its history is the strongest Architect material
in the repo: the duplication's authority is a **circular citation** — an
`/init`-generated description became a code comment's justification in the same
commit that wrote the clause, was cited back as proof of deliberateness eleven
days later, and hardened into an enforced lint rule three weeks after that. And
the tool that fixes half of it has been an installed, unused dependency since
2026-07-30, adopted in a commit whose own body scopes it to *request* DTOs.

**Cost of debt vs cost of change.** Debt: unbounded and silent, on the repo's
widest hub. Change: additive and per-route — response schemas need no new
dependency and no import; the contract test has two working precedents in the
repo. The expensive option (a shared package) is forbidden by name in
`.dependency-cruiser.cjs` and is explicitly **not** what this proposes.

**Blast radius.** Blast group 4 (`frontend/src/api/collections.ts` ↔
`extension/src/types.ts` ↔ the backend's actual JSON — no guard of any kind),
group 5 (tool schema ↔ `createEntryBodySchema`, where `targetText`→`sentenceText`
is already renamed across the seam and mapped twice), group 7 (the three
`languages.ts`, which are three different structures encoding one list, not
copies). `frontend/src/api/collections.ts` has 10 dependents.

**Incremental path.** (1) Declare `response:` on one read route. (2) Extend to
the remaining read routes, watching for fast-json-stringify field stripping —
the one real hazard, caught only at L4. (3) Add a contract test comparing the
client declarations to the server schemas, modelled on
`route-reachability.test.ts`. (4) Only then consider generating anything. Each
step is deletable; none requires touching the four-app split.

**First prerequisite step.** Declare a response schema on
**`GET /api/collections`** (`collections/index.ts:76`) — today the one route with
no `schema` block at all. That single declaration is the artifact every later
step needs, and reverting it reverts everything.

**IL-24 rework risk: SPLIT.** Read path untouched. Translate leg at risk — the
`set_index` cursor *"needs … a request field (contract + extension change)"* and
the sense-granularity display rule is unresolved. **Sequence the read path
first**; leave the translate leg's response schema until IL-24's shape is known.

---

### #2 — C-03: give the extension's HTTP client a seam

**Current shape.** `background.ts` is 176 lines with zero importers and zero
tests. `apiFetch` bundles ten responsibilities in 67 lines. `run()` dispatches 7
message variants with no `default` and returns `Promise<unknown>`, so a new
variant compiles and yields `undefined` at runtime. Nothing in `extension/src`
constructs an `AbortController`.

**Target shape.** A testable request module separate from the message
dispatcher, with the deadline and `fetch` injectable, and a dispatcher whose
return type is narrowed per variant.

**Why second.** This is the entire HTTP client for the guiding-star flow, and it
is the repo's largest wholly untested source file. On the pivot axis it does not
merely survive — **it appreciates**: IL-24's set-cursor is explicitly the change
that adds a request field, i.e. exactly the `Message`-variant edit whose failure
mode is today a runtime `undefined`. Doing the exhaustiveness work before that
change turns a class of runtime bug into a compile error precisely when it is
about to be exercised. And it is **the only candidate covered by all four gate
layers**, so the work is verifiable in the fast loop rather than after a push.
Narratively, the timeout half is the cleanest Tier C finding in the repo: the
frontend's deadline was tuned against this same backend route in two named fix
commits, with the reasoning written out at `client.ts:27-41`, and the identical
question was never once asked of the extension.

**Cost of debt vs cost of change.** Debt: no coverage of token attachment, URL
construction, error mapping or the 429 path, plus an unbounded wait. Change:
three independent, individually revertible commits, no new dependency, and the
`no-orphans` whitelist already accommodates an imported sibling.

**Blast radius.** Blast group 3 — `messages.ts` (8 dependents) ↔ `App.tsx` ↔
`background.ts`. The popup↔background hop carries no import edge, so nothing
today observes it.

**Incremental path.** (1) Extract `apiFetch` into its own module with an
injected token-getter and `fetch`, plus its first test. (2) Narrow `run()`'s
return against `MessageResults` and add a `never` assertion. (3) Add the
deadline, sized against the route the way `client.ts:27-41` reasons.

**First prerequisite step.** **Step zero (§4) first, for this file specifically**
— otherwise the new test file's absence keeps reporting green and the extraction
cannot be verified in the loop it is supposed to protect.

**IL-24 rework risk: UNTOUCHED.** Nothing in the pivot docs touches
`background.ts`.

---

### #3 — C-02: validate the model's output at the boundary

**Current shape.** `translate.ts:148` casts `toolUse.input as TranslationResult`
with no runtime check. Two `??` fallbacks convert malformed into empty, which
the retry cannot distinguish from a bad roll, so a structurally broken response
is a 200 that parses.

**Target shape.** One schema declared once, serving both as the Anthropic tool
`input_schema` and as a runtime validator applied at the cast.

**Why third.** Its premise is demonstrably dead: tool-use was trusted because it
was recorded as *"the reliable way to get a fixed JSON shape back from Claude"*,
and the repo has since written down **twice** that tool schemas are advisory,
and measured a schema-permitted-but-unusable response at roughly 3 in 34 live
calls. The two mitigations added cover the observed shapes, not the class. On
the pivot axis the *content* is orphaned — the English-only tool schema replaces
this one — but the **seam is reused and the instrument is exactly what IL-24
needs**: the pivot adds a second unvalidated model boundary (the ILI-picking
call) whose own open question is whether the model reliably answers *"none of
these."* A validator built now is how that question gets measured. It ranks
third rather than higher only because the orphaning is real: the schema it
validates should be expected to be rewritten.

**Cost of debt vs cost of change.** Debt: a silent degraded result the backend
logs as a clean 200, visible only through a client-side report nothing
aggregates. Change: confined to one function; `Value.Check` ships in the already
installed `@sinclair/typebox`; `generateWithTimeout` already provides the
landing site for a throw.

**Blast radius.** Blast group 1 — `collections/index.ts` ↔ `schemas.ts` ↔
`ai/translate.ts`. This is the one group the compiler already enforces, which is
why it is the safest of the three to move in.

**Incremental path.** (1) Validate in **observe-only** mode: check, log the
errors against `request.correlationId`, return the value unchanged. (2) Read the
measured malformation rate. (3) Only then decide whether a failure retries,
falls back, or errors — a decision with data behind it, as `lessons.md` requires
for anything under `backend/src/ai/`.

**First prerequisite step.** Add the observe-only check at `translate.ts:148`.
It changes no behaviour and produces the number the real decision needs.

**IL-24 rework risk: CONTENT ORPHANED, SEAM UNTOUCHED.** Build the validator;
expect to rewrite the schema it validates.

## 5.2 Considered and not ranked

| Candidate | Why not |
| --- | --- |
| **C-09** one sense per save | **Hard boundary.** Relaxing the cardinality redefines what an *entry* is — a business-concept change, not a structural one — and the roadmap already links IL-41 to IL-24 for exactly that reason. Highest IL-24 rework risk in the set: subsumed in intent, orphaned in mechanism. Belongs in the same later analysis as the pivot |
| **C-08** vacuous gate | Real and cheap, but one flag is not a refactor. Promoted out of the ranking into **Step zero** (§4), where it gates #2 |
| **C-12** boundary rules | Same shape: the rules are already written and verified by deliberate break; what is missing is one CI step. Named alongside Step zero |
| **C-04** route registration | **Tier A.** `{proxy+}` was rejected by name with reasoning at the line, the text comparison was forced by a real tsconfig constraint, and the guard documents its own blind spot — which is **latent, not active** (zero `fastify.route({...})` call sites). Re-litigating a costed acceptance without new information is precisely what §3 warns against |
| **C-05** ownership by grep | **Tier A**, with the claim narrowed in writing to a convention-drift guard rather than a correctness proof, and stronger enforcement explicitly declined. Carries a nasty edge: hoisting into a hook deletes the string the guard greps for, so the refactor fails the test enforcing it. Worth doing eventually; the guard must be made hook-aware first |
| **C-06** SQL invisible to tooling | Split verdict. "No ORM" is **Tier A** and not up for re-litigation; the genuine opportunity — typed rows plus column assertions in the existing `core-schema.test.ts` — is additive test work rather than a refactor. Note it is *prerequisite-ish* for IL-29, which needs the same harness |
| **C-07** rate limiter | **Tier A**, the best-documented accepted trade-off in the repo: alternatives priced, exposure quantified, backstop named, cheap future fix pre-scoped. One thing genuinely worth confirming: whether the Anthropic Console spend limit was actually set — the record instructs it and never confirms it |
| **C-10** bootstrap conflation | Small, local, all four layers, and worth doing — but a one-branch change, not a refactor. Its real finding is procedural: its named carrier (S-05) shipped without it, and it has no ticket and no roadmap row, so nothing will pick it up on its own |
| **C-11** legacy codes | Cheap and worth closing, but blocked on an unknown. First step is a read-only count, not a refactor |
| **C-13** construct breadth | **Tier A**, measured and corroborated three ways. 11 of 12 imports are AWS packages, so the metric reflects configuration surface, not coupling. The only incremental split available is C-04's first step |

---

# 6. Corrections to the source analysis

Carried so the next reader does not re-derive them.

1. **repo-map risk 5 is half stale.** Both "silent boundaries" it names are
   already encoded as error-severity dependency-cruiser rules. The real gap is
   that **the cruise runs in no gate layer at all**.
2. **The three `languages.ts` are not copies** — 4/20/25 lines, three different
   structures encoding one shared eight-code vocabulary.
3. **`entry_sentences` has no unique constraint**, only an index — yet the
   duplicate-guard comment at `collections/index.ts:279-280` claims both tables
   hit `UNIQUE(entry_id, language_code)`.
4. **Three case-insensitive guards on the backend read path**, not two
   (`index.ts:236,298,378`), plus at least four client-side.
5. **`ENss` does not exist in the data.** `printable-export/plan.md:30`
   (2026-08-03) verified by querying every code in use: only `PL` and `EN`, and
   *"earlier references to it in this plan were wrong."*
6. **The `targetText`→`sentenceText` rename is mapped twice** — `App.tsx:382`
   and `index.ts:413`.
7. **TypeBox is installed but barely wired** — no `withTypeProvider()`, no
   validator or serializer compiler anywhere in `backend/src`.

## Smaller current-state findings not in the source analysis

- `backend/src/plugins/support.ts:9-19` is dead scaffold, and holds the only
  remaining per-plugin `declare module 'fastify'` block, contradicting
  `fastify.d.ts:18-23`'s stated single-home rule.
- `plugins/rate-limit.ts`, `plugins/sensible.ts` **and `plugins/support.ts`**
  are the only three (raport: two) plugins without `{ name, dependencies }`;
  `sensible.ts:10` does not `await` its `register`.
- `errorMessage` is called twice per failed request in `background.ts:100`
  (on a clone) and `:109` — two body reads for one failure.
- `MIN_EXPECTED_ROUTES = 9` and `MIN_EXPECTED_ID_ROUTES = 4` both equal today's
  actual counts: the tripwires have zero slack.

---

# 7. Open questions

**Closed here:**

- Open Question 2 is now *sized*, not answered: `--passWithNoTests=false` turns
  the vacuous pass into `exit 1` (re-verified 2026-08-22, exit codes captured
  directly). Enumerating the affected files remains the first step of §4.

**Still open:**

1. Is the ~9% degraded-result rate still current? Nothing aggregates the
   `DegradedAiResult` reports collected since 2026-08-14.
2. How many files under the two `riskAreas` regexes pass vacuously today?
   Never enumerated.
3. Do the two legacy-uppercase rows still exist? `unknown` — first step is a
   read-only count.
4. Is `frontend/src/api/collections.ts`'s `getCollection`/`createCollection`
   intended to have real-implementation coverage, or is `client.test.ts`
   considered to cover the layer?
5. **Was the Anthropic Console spend limit actually set?** It is named as the
   real backstop for C-07's accepted trade-off; the record instructs it and
   never confirms it.
6. Does a folder-scoped `collections/autohooks.ts` cascade *in addition to* the
   parent hook, or replace it? Governs C-05's feasibility.
7. Does Anthropic's tool-schema subset accept `anyOf` equivalently to a
   JSON-Schema type array? Governs whether C-02's schema can be single-sourced.

---

---

## Weryfikacja twierdzeń (ast-grep)

Every **structural** claim the ranking rests on — response/schema counts,
"only here" / "X but not Y", call-site counts, mirror-type pairs, variant
arity — was re-derived mechanically with `ast-grep 0.45.1` on **2026-08-23**,
against the same commit the document was written from (`d0bd4ce`;
`git diff --name-only d0bd4ce..HEAD` is empty, so every anchor is still
current). Patterns ran over the same `SOURCES` set `scripts/depcruise.mjs`
cruises. Every zero returned by ast-grep was re-confirmed with a classic
`grep`, since a zero can equally mean "the pattern does not match this node
shape".

Non-structural claims — intentionality verdicts, git archaeology, IL-24
rework risk, cost arguments — are **out of scope** and were not re-derived.

**Result: 6 claims moved, the rest held.** Four are corrected in place above
(in `§ 2` and `§ 6`, in the format `20 (raport: 22)`); two sit inside
`§ 5 Refactor opportunities`, which this pass does not edit — they are
recorded below only, annotated **do decyzji na etapie planowania**.

### Obalone / doprecyzowane

| # | Twierdzenie | Werdykt | Dowód (plik:linia) | Metoda (wzorzec/reguła) |
| --- | --- | --- | --- | --- |
| V-1 | C-01: *"every route plugin is already annotated `FastifyPluginAsyncTypebox`"* | **doprecyzowane** → **2 of 5** | `collections/index.ts:68` and `client-errors/index.ts:13` are Typebox; `autohooks.ts:10`, `me/index.ts:3`, `health/index.ts:5` are plain `FastifyPluginAsync` | `grep -rn 'FastifyPluginAsync'` over `backend/src/routes` — the annotation is a type position, not a call node, so no pattern applies |
| V-2 | §5.1 #1: *"`GET /api/collections` (`collections/index.ts:76`) — today the one route with no `schema` block at all"* | **doprecyzowane** → line **77**, and **3** such routes repo-wide | `collections/index.ts:77`, `me/index.ts:4`, `health/index.ts:6`. It is the one *on this flow* | `$F.get($$$A)` / `$F.post($$$A)` over `backend/src` (9 routes), cross-referenced against rule `kind: pair` + key `^schema$` (6 blocks) |
| V-3 | C-01 / §5.1 #1: *"`frontend/src/api/collections.ts` — the repo's widest hub, 10 dependents"* | count **potwierdzone** (10 files / 11 edges); superlative **obalone** | `frontend/src/observability/reporter.ts` has **12** dependent files — `src/speech.ts:13`, `src/useSpeech.ts:3`, `src/api/client.ts:6`, `src/auth/AuthContext.tsx:5`, `src/auth/cognito.ts:2`, `src/observability/ErrorBoundary.tsx:2`, `src/observability/globalHandlers.ts:1`, plus 5 test files | rule `kind: import_statement` + `field: source` regex, run for **both** `TypeScript` and `Tsx`, then re-run as a resolving regex sweep to catch the two dynamic `await import(...)` edges the rule cannot see (`CollectionDetailPage.test.tsx:28`, `CollectionsListPage.test.tsx:24`) |
| V-4 | §5.1 #2: *"`background.ts` … the repo's largest wholly untested source file"* | **obalone** | `extension/src/auth.ts` is **182** lines and equally untested — no test file imports it; `background.ts` is 176. `infra/lib/constructs/api-construct.ts` is 210, and infra has no real tests (§3.6) | resolving import sweep from every file under the six test roots, differenced against `frontend/src` + `extension/src` + `backend/src` + `infra/lib`, then `wc -l` |
| V-5 | C-12: *"`routes → plugins` is 0 import edges and **22** decorator calls"* | 0 edges **potwierdzone**; count **doprecyzowane** → **20** | `fastify.sql` ×18, `fastify.anthropicClient` ×1, `fastify.jwtVerifier` ×1 (`autohooks.ts`). 38 if the request decorators `authUser` (13) and `correlationId` (5) are counted too | `grep -rn "from '.*plugins"` over `backend/src/routes` → 0 hits (classic-grep confirmation of the zero); per-decorator `grep -rno` counts. 22 is not reproducible under any grouping tried |
| V-6 | §6: *"`rate-limit.ts` and `sensible.ts` are the only **two** plugins without `{ name, dependencies }`"* | **doprecyzowane** → **three** | `plugins/support.ts:9-13` closes its `fp<SupportPluginOptions>(...)` with no options object either | read of all nine files in `backend/src/plugins/` |

**V-3 and V-4 fall inside `§ 5`, which this pass leaves untouched — do decyzji
na etapie planowania.** Neither disturbs a ranking position on the reasoning
actually given:

- **#1 (C-01)** rests on *"no guard exists at any of the four layers"*, which
  held (V-7, V-11, V-14). `collections.ts` is still the widest hub **carrying a
  cross-app response contract**, which is the property the argument uses —
  `reporter.ts` is a leaf with a dependency-cruiser rule of its own
  (`observability-stays-a-leaf`, `.dependency-cruiser.cjs:106`, severity error),
  and it crosses no app boundary.
- **#2 (C-03)** rests on *"the entire HTTP client for the guiding-star flow"*
  and *"the only candidate covered by all four gate layers"*, both of which
  held (V-28). Only the size superlative fails — and `auth.ts`, the file that
  beats it, is the module `background.ts` imports at `:2`, so it sits on the
  same seam rather than competing with it.

### Potwierdzone

Each row is a claim the pattern reproduced exactly.

| # | Twierdzenie | Werdykt | Dowód (plik:linia) | Metoda (wzorzec/reguła) |
| --- | --- | --- | --- | --- |
| V-7 | C-01: the backend declares **zero** response schemas | potwierdzone | 0 matches | rule `kind: pair` + key regex `^response$` over `backend/src`+`backend/test`; zero re-confirmed with `grep -rn "response:"` → no hits |
| V-8 | C-01: **six** `schema:` blocks, all `body`/`params` | potwierdzone | `collections/index.ts:101,156,219,253,359`, `client-errors/index.ts:28` | rule `kind: pair` + key `^schema$`; each block then read — only `body` and `params` keys present |
| V-9 | C-01: `POST /:id/translate` returns the AI object **verbatim** | potwierdzone | `collections/index.ts:249` — `return result` | read of the handler; no mapping, no reshaping |
| V-10 | C-01: mirror type pair `TranslationResult` | potwierdzone | `ai/translate.ts:21-40` (family; the interface itself `:37-40`) ↔ `extension/src/types.ts:14-36` (interface `:33-36`) — field-for-field identical | `grep -n '^export interface\|^}'` on both files, then diff of the two families |
| V-11 | C-01: **no** `withTypeProvider()` / `setValidatorCompiler` / `setSerializerCompiler` | potwierdzone | 0 hits | classic `grep -rn` over `backend/src`+`backend/test` — the zero *is* the claim |
| V-12 | C-01: the three `languages.ts` are **not copies** — 4 / 20 / 25 lines, three structures | potwierdzone | `backend/src/languages.ts` 4 (codes array), `extension/src/languages.ts` 20 (labels record + `languageLabel()`), `frontend/src/languages.ts` 25 (`SUPPORTED_LANGUAGES`) | `wc -l` + read; the eight-code vocabulary is the only shared part |
| V-13 | C-01: `targetText`→`sentenceText` is mapped **twice** | potwierdzone | `extension/src/popup/App.tsx:382` (popup → request body) and `collections/index.ts:413` (backfill route → `sentence_text` column) | `grep -rn targetText` across all three apps — 9 occurrences, exactly 2 of them renames |
| V-14 | §5.1 #1: `frontend/e2e` **stubs** `/api/*` | potwierdzone | `E2E-RULES.md:36` states it outright; `page.route(...)` / `route.fulfill(...)` at `printRoute.spec.ts:65-66`, `reauthPrompt.spec.ts:45,71-72,98,108,122` | `grep -rn 'page.route\|fulfill'` over `frontend/e2e` |
| V-15 | C-02: the cast is the **only** one of its kind in `backend/src` | potwierdzone | `ai/translate.ts:148`; the other 5 are in `translate.test.ts:44,72,105,146,175` | `$X as TranslationResult`; widened to rule `kind: as_expression` → only 4 in `backend/src`, the other 3 being C-06's SQL row assertions |
| V-16 | C-02: throw only when `tool_use` is absent; unguarded re-read; two `??` | potwierdzone | throw `:144-146`; `alignToRequested` `:113-120`; `isEmpty` `:122-124`; `??` at `:118` and `:151`; return `:149-152` | read against the pattern's ranges |
| V-17 | C-02: `generateWithTimeout` already catches everything and returns `null` | potwierdzone | `collections/index.ts:50-66` — `catch { log.error(…); return null }` at `:60-63` | read; the landing site for a validation throw is real |
| V-18 | C-02: `translate.ts:84` uses a JSON-Schema **type array** | potwierdzone | `type: ['string', 'null']` at `:84` | read of the tool schema |
| V-19 | C-02: `Value.Check` needs **zero** new dependencies | potwierdzone | `@sinclair/typebox@0.34.52` installed; `./value` present in `exports`; `build/cjs/value/index.js` on disk | read of the installed `package.json` + `ls` |
| V-20 | C-02: `translate.test.ts` has **9** cases | potwierdzone | `:18,50,80,115,151,180,205,220,240` | `test($NAME, $$$REST)` |
| V-21 | C-03: `background.ts` — 176 lines, **zero** importers, **zero** tests | potwierdzone | 176 lines; no file in the repo imports it; `extension/test/` holds 6 files, none referencing it | `wc -l`; repo-wide resolving import sweep; `find extension/test` |
| V-22 | C-03: `apiFetch` is `:55-121`, 67 lines, one `Promise<T>` cast | potwierdzone | opens `:55`, closes `:121`; `return await response.json() as T` at `:120` | `grep -n 'async function apiFetch\|^}'`; rule `kind: as_expression` → 2 in the file, the other (`:20`) outside `apiFetch` |
| V-23 | C-03: `run()` — **7** cases for **7** `Message` variants, **no `default`**, `Promise<unknown>` | potwierdzone | cases `:125,127,130,133,135,140,145`; signature `:123`; the `Message` union (`messages.ts:24-36`) has 7 members and `MessageResults` 7 keys | rule `kind: switch_case` (7) and rule `kind: switch_default` (**0**, re-confirmed by classic grep) |
| V-24 | C-03: **no** `AbortController` anywhere in `extension/src` | potwierdzone | 0 hits | `grep -rn 'AbortController\|AbortSignal\|signal:'` over `extension/src` → exit 1 (classic-grep confirmation of the zero) |
| V-25 | C-03: the frontend's two-tier scheme exists at `client.ts:27-48` | potwierdzone | `AI_REQUEST_TIMEOUT_MS = 25_000` at `:41`, `timeout: 8000` at `:48`, reasoning in the comment `:27-40` | read |
| V-26 | C-03: `MessageResults` is already keyed by `type` at `messages.ts:38-46` | potwierdzone | `:38-46`, 7 keys matching the 7 variants — a `never` assertion needs no new abstraction | read |
| V-27 | C-03: `checks.mjs:47` routes all of `extension/src/` into L1+L2 | potwierdzone | `riskAreas: [/^src\//, /^test\//]` at `:47` | read |
| V-28 | C-03: covered by **all four** gate layers | potwierdzone | L1/L2 `checks.mjs:47`; L3 `heavyChecksFor` `:168-171` runs the full extension suite; L4 `pr-diff.yml:188` | read of `scripts/quality/checks.mjs` and `.github/workflows/pr-diff.yml` |
| V-29 | C-04: **8** `addRoutes` calls covering **9** method+path keys, against **9** backend routes | potwierdzone | `api-construct.ts:149,160,166,172,181,187,195,204` (`/api/collections` carries GET+POST); backend: 4 `get` + 5 `post` | `$O.addRoutes($$$A)`; `$F.get($$$A)` / `$F.post($$$A)` — the two sides balance |
| V-30 | C-04: the tripwires have **zero slack** | potwierdzone | `MIN_EXPECTED_ROUTES = 9` (`route-reachability.test.ts:83`), `MIN_EXPECTED_ID_ROUTES = 4` (`route-ownership.test.ts:57`) — both equal today's actual counts | read, against V-29's and V-33's counts |
| V-31 | C-04: the reason is **at the line**; the gateway parser is inline regex | potwierdzone | `api-construct.ts:145-146` — *"Explicit paths, not a {proxy+} catch-all"*; parser `route-reachability.test.ts:56-73` | read |
| V-32 | C-04: the blind spot is **latent, not active** — zero `fastify.route({...})` call sites | potwierdzone | 0 matches | `$F.route($$$A)` over `backend/src`; zero re-confirmed with `grep -rn '\.route('` → exit 1 |
| V-33 | C-05: `fetchOwnedCollection` ×4 + `fetchOwnedEntry` ×1, one per `:id` route | potwierdzone | `collections/index.ts:160,230,288,367` and `:372`; helper `ownership.ts:19-38` | `fetchOwnedCollection($$$A)`, `fetchOwnedEntry($$$A)` |
| V-34 | C-05: four routes repeat the same `if (undefined) return reply.notFound()` block | potwierdzone | `:162,232,290,369`, plus `:374` for the entry check | `grep -n 'notFound()'` |
| V-35 | C-05: the guard is string containment, and the refactor would delete the string | potwierdzone | `route-ownership.test.ts:68` — `!route.handlerSource.includes('fetchOwnedCollection(')` | read; hoisting into a hook removes this literal from every handler |
| V-36 | C-05: a carrier already exists | potwierdzone | `routes/api/autohooks.ts:10-43` — `onRequest` hook, cascaded, already doing verify → query → decorate | read |
| V-37 | C-06: **18** SQL call sites, **only 3** with a type assertion | potwierdzone | 16 tagged templates + 2 `sql.transaction` = 18; assertions at `ownership.ts:24,36` and `collections/index.ts:34` | `` $O.sql`$$$A` `` (16) + `$O.sql.transaction($$$A)` (2); rule `kind: as_expression` over `backend/src` (4 total, 1 being C-02's cast) |
| V-38 | C-06: **four** hand-written row→DTO mappers for overlapping shapes | potwierdzone | `collections/index.ts:88-96, 192-214, 339-351, 422-434` | read at each anchor — all four are hand-listed `row.snake_case` → `camelCase` |
| V-39 | C-06: `fastify.sql` is typed once, with no per-query type parameter | potwierdzone | `fastify.d.ts:27` — `sql: NeonQueryFunction<false, false>;` | read |
| V-40 | C-06: `backend/migrations/` is **absent** from `depcruise.mjs`'s `SOURCES` | potwierdzone | `SOURCES` (`scripts/depcruise.mjs:36-53`) lists 13 trees, none of them `backend/migrations` | read; `grep -n migrations scripts/depcruise.mjs` → exit 1 |
| V-41 | C-07: `rate-limit.ts` is 14 lines; the entire config is `register(rateLimit, { global: false })` | potwierdzone | `plugins/rate-limit.ts:1-14`, register at `:13` | read |
| V-42 | C-07: two opt-ins on this flow at 20/min, plus `client-errors` at 60/min | potwierdzone | `collections/index.ts:223,363` (`TRANSLATE_RATE_LIMIT_MAX = 20`, `:22`); `client-errors/index.ts:28` (`REPORT_RATE_LIMIT_MAX = 60`, `:11`) — **3** `config:` pairs repo-wide | rule `kind: pair` + key `^config$` over `backend/src` |
| V-43 | C-07: `rate-limit.ts` declares **no** dependency on `plugins/neon.ts` | potwierdzone | `:12-14` — `fp<RateLimitPluginOptions>(...)` closes with no options object at all | read; establishing that ordering is the standalone first step, as stated |
| V-44 | C-08 / Step zero: the gate passes **vacuously** | potwierdzone (re-run 2026-08-23) | `vitest related src/background.ts --run` → *"No test files found, exiting with code 0"*, **exit 0**; the same command with `--passWithNoTests=false` → **exit 1** | both re-run in `extension/`, exit codes read from `$?` directly, not from stdout |
| V-45 | C-08: `runCheck` derives `ok` purely from exit status; `EXPLICIT_TESTS` has one entry | potwierdzone | `checks.mjs:189` — `ok: result.status === 0`; `EXPLICIT_TESTS` `:59-61`, single entry `frontend/src/pages/print.css`; the *"passes vacuously"* comment `:53-57` | read |
| V-46 | C-09: `UNIQUE(entry_id, language_code)` exists; `entry_sentences` has **only an index** | potwierdzone | constraint `1784584360698_create-core-schema.ts:52-54` (on `entry_translations`); `pgm.createIndex('entry_sentences', 'entry_id')` at `:68`, no `addConstraint` | read of all four migrations — the only other `unique` is `users.cognito_sub` (`:10`) |
| V-47 | C-09: the duplicate-guard comment claims **both** tables hit it | potwierdzone | `collections/index.ts:279-280` — *"Without this the duplicate hits UNIQUE(entry_id, language_code)"*, guarding `translations` **and** `sentences` | read; the comment is wrong for `entry_sentences`, as §6 correction 3 records |
| V-48 | C-09: two silent client-side collapses | potwierdzone | `CollectionDetailPage.tsx:192-193` (`new Set(...)` for gap detection); `printRows.ts:55-60` (`.find()` per language, once for the translation and once for the sentence) | read |
| V-49 | C-10: one `.catch` sets both `setError` and `setStatus('anonymous')`; `Status` has no error state | potwierdzone | `extension/src/popup/App.tsx:136-139`, inside the `:127-140` bootstrap; `type Status = 'loading' \| 'anonymous' \| 'ready'` at `:12` | read |
| V-50 | C-11: **three** case-insensitive guards on the backend read path, not two | potwierdzone | `collections/index.ts:236,298,378`; write-time lowering `:109-110,264,269,365`; SQL `lower()` at `:385` | `grep -rn 'toLowerCase()\|lower('` over `backend/src` |
| V-51 | C-11: at least four client-side sites | potwierdzone | `frontend/src/languages.ts:23`, `printLabels.ts:82`, `printRows.ts:55,57,60`, `CollectionDetailPage.tsx:192-193`, `extension/src/languages.ts:19`, `extension/src/popup/App.tsx:37` — 7 language-code sites | `grep -rn 'toLowerCase()'` over `frontend/src`+`extension/src`, minus two BCP-47 splitters and one HTTP-method lower |
| V-52 | C-12: both boundaries repo-map risk 5 names are **already encoded**, at `severity: error` | potwierdzone | `extension-popup-stays-off-the-network` `.dependency-cruiser.cjs:59-71`; `backend-plugins-are-below-routes` `:86-94`; plus `no-cross-app-imports:39`, `backend-no-cross-route-imports:73`, `frontend-api-is-below-pages:96`, `observability-stays-a-leaf:106`, `no-test-code-in-production-code:116` — all `error` | read of every rule's `name`/`severity` pair |
| V-53 | C-12: **nothing runs them** | potwierdzone | 0 hits across `.github/`, `.githooks/`, `scripts/quality/`; `AGENTS.md:63` — *"It is not wired into the hooks yet"* | `grep -rn 'depcruise\|dependency-cruiser'` over the three gate trees → exit 1 (classic-grep confirmation of the zero) |
| V-54 | C-12: no rule constrains `routes/ → ai/`; the popup rule names three files | potwierdzone | `collections/index.ts:14` imports `../../../ai/translate.ts` unconstrained; `grep -n 'ai/' .dependency-cruiser.cjs` → exit 1; the popup rule's `to.path` is `^extension/src/(auth\|config\|background)\.ts$` (`:70`) | read + classic grep |
| V-55 | C-13: 210 lines, 12 imports, **11** AWS-CDK/Node-core, exactly **1** first-party | potwierdzone | `api-construct.ts:1-12`; the first-party import is `../cdk-ssm-params` at `:12` | `wc -l` + read of the import block |
| V-56 | C-13: **zero** construct-to-construct edges | potwierdzone | 4 files in `infra/lib/constructs/`, none importing a sibling | `grep -rn "from './\|from '../constructs"` over `infra/lib/constructs/*.ts` → exit 1 |
| V-57 | C-13: *"8 of the 12 distinct AWS service modules used by all of `infra/lib`"* | potwierdzone under the artifact's reading | `api-construct.ts` uses 9 of the 13 `aws-cdk-lib/*` modules `infra/lib` touches — **8 of 12** once `aws-cdk-lib/core` is excluded as not a service module | `grep -rho 'aws-cdk-lib/[a-z0-9-]*' infra/lib \| sort -u` |
| V-58 | §6: `support.ts` holds the **only** remaining per-plugin `declare module 'fastify'` | potwierdzone | `plugins/support.ts:16-20`; the only other is the sanctioned `fastify.d.ts:24` | `grep -rn "declare module 'fastify'"` over `backend/src` → exactly 2 |
| V-59 | §6: `errorMessage` is called **twice** per failed request | potwierdzone | `background.ts:100` (on `response.clone()`) and `:109` — two body reads for one failure | `grep -n errorMessage` |
| V-60 | §2 L3: `heavyChecksFor` runs `tsc` for all four apps, tests only for frontend/extension | potwierdzone | `checks.mjs:159-171` — `tsc` pushed unconditionally per app, the `vitest` push gated on `app.name === 'frontend' \|\| app.name === 'extension'` | read |

### Czego ast-grep nie rozstrzyga

Stated explicitly, because the verification does **not** extend to it. Every
intentionality verdict in `§ 2` and every tier in `§ 3` rests on git-and-document
evidence — commit bodies, plan lines, `lessons.md` dates — and was not
re-derived here; nor were the IL-24 rework-risk verdicts, which rest on reading
`context/changes/translation-pivot/`. A pattern can count the `case` clauses in
`run()`; it cannot tell you whether the missing `default` was ever considered.
It can prove `TranslationResult` is declared twice; it cannot prove either
declaration matches a JSON body the backend never types — which is exactly
C-01's point, and exactly why the tool cannot close it.

Two method notes worth carrying, both learned on V-3:

- **`.tsx` is a different ast-grep language than `.ts`.** A rule declared
  `language: TypeScript` silently skips every `.tsx` file. Any fan-in or
  import-shape claim in this repo must be run for `TypeScript` **and** `Tsx`,
  or it under-counts by exactly the React surface.
- **`kind: import_statement` does not see `await import(...)`.** Dynamic
  imports are `call_expression`s. Two of `frontend/src/api/collections.ts`'s
  eleven in-edges are dynamic, in `vi.mock`-style test setup — an
  import-statement rule alone reports 9 dependents and would have "refuted" a
  claim that is correct.

`ast-grep` is not a repo dependency and is not installed by any app's
`package.json`; this pass ran `@ast-grep/cli@0.45.1` from a scratch install
outside the working tree, matching the version the source analysis used.

## Related research

- `context/changes/translate-flow-analysis/research.md` — the source analysis
  (2026-08-20, ast-grep-verified 2026-08-22). Anchors current at `d0bd4ce`.
- `context/changes/translation-pivot/{change.md,research.md,decision-brief.md}`
  — IL-24, deferred by the hard boundary; read as feasibility input only.
- `context/map/repo-map.md` — risk ordering and the
  `[import]`/`[git]`/`[unknown]` convention.
- `context/foundation/lessons.md` — nine entries; four earned on this path, and
  two of them (the vacuous gate, the stubbed AI client) are cited by candidates
  above as rules the repo wrote and has not applied back to itself.
