<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Anti-corruption layer — a translator port over the model provider

- **Plan**: `context/changes/anti-corruption-layer/plan.md`
- **Scope**: Phases 0–6 of 6 (all automated criteria complete; manual pending)
- **Date**: 2026-08-24
- **Verdict**: NEEDS ATTENTION → all 7 findings resolved 2026-08-24
- **Findings**: 0 critical, 2 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Architecture is a clean PASS and is the point of the change: the SDK is
reachable from exactly two files, no route or plugin can obtain a provider
client, `src/ai/` is gone, and the boundary is enforced by a committed test
verified by deliberate breakage. Every automated criterion in all seven phases
re-ran green during this review; the backend suite is 129/129 across four
consecutive runs and the extension suite is 35/35.

## Findings

### F1 — `billableCharacters()` is dead code with unverified billing semantics

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `backend/src/domain/translationDraft.ts:196`
- **Detail**: The method has zero production callers — the only references in
  the repo are its own unit test (`test/domain/translationDraft.test.ts:265`,
  `:279`). The plan specified it as "`research.md:1010-1014`'s spend meter"
  without fixing its definition, and that research section is about DeepL and
  Azure character grants — providers that bill per character **submitted**, per
  target language. This implementation counts characters **produced** (meanings,
  phonetics, both halves of each sentence). Those are different numbers, and the
  draft cannot compute the former because it does not hold the submitted text.
  A future reader wiring up a budget alarm would get a plausible-looking figure
  that under-reports against a DeepL invoice.
- **Fix A ⭐ Recommended**: Delete the method and its test; reintroduce it in the
  provider-swap change, in the adapter, where the request is in scope.
  - Strength: Removes an unused public method whose semantics no consumer has
    validated. The ACL's own argument — that provider-metered concerns belong to
    the adapter — applies to the meter itself.
  - Tradeoff: The pivot's budget requirement loses its placeholder, so the
    follow-up must remember to add it.
  - Confidence: HIGH — zero call sites, verified by grep across `src` and `test`.
  - Blind spot: Have not checked whether `translation-pivot`'s plan references
    `billableCharacters` by name as a delivered artifact.
- **Fix B**: Keep it, rename to `producedCharacters()`, and document that it is
  not a billing figure.
  - Strength: Preserves the measurement; the name stops implying an invoice.
  - Tradeoff: Still dead code, and the plan's load-bearing-names table records
    `billableCharacters()`.
  - Confidence: MEDIUM — depends on whether anything downstream wants a
    produced-text metric at all.
  - Blind spot: None significant.
- **Decision**: FIXED via a revised Fix A — the review's original "delete it" recommendation was **withdrawn**: `03-anti-corruption-layer.md:1131` names `billableCharacters()` as the pivot's character counter, so deleting it would remove a depended-on artifact. Renamed to `producedCharacters()`, semantics documented, and the missing adapter-side half recorded as a follow-up in change.md.

### F2 — Every translator failure logs twice, and the provider-detail line has no correlation id

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `backend/src/adapters/anthropicTranslator.ts:176`, `backend/src/routes/api/collections/index.ts:64`
- **Detail**: A single failed translation now emits two lines: the adapter's
  `'translator provider call failed'` through `fastify.log`, and the route's
  `'translator draft failed'` through `request.log` with `requestId`. The
  adapter's line is the one carrying provider detail, and it is the one **without**
  a correlation id — which is precisely the failure mode the comment at the old
  `index.ts:41-49` documented ("the id the user could quote pointed at the
  useless half of the pair and the informative half was unfindable"). The route's
  line already carries the full error including `cause`, so the adapter's line is
  also largely redundant. Separately, `MalformedDraftError` is logged under the
  message "provider call failed" even though the call itself succeeded.
- **Fix A ⭐ Recommended**: Drop the adapter's `log.error` and the `log` option
  from `createAnthropicTranslator`; let the route's correlated line be the single
  record, since it already carries `cause`.
  - Strength: One line per failure, always correlated. Removes a parameter that
    now does nothing useful and shrinks the adapter's constructor surface.
  - Tradeoff: Deviates from the plan's specified factory signature
    (`{ apiKey, log }`), and `plugins/translator.ts` loses a line.
  - Confidence: MEDIUM — depends on pino's error serializer emitting `cause` in
    the deployed config; verified that the object is attached, not that the
    deployed transport renders it.
  - Blind spot: Have not checked the Lambda log pipeline's serializer settings.
- **Fix B**: Keep both lines but pass the request logger through, so the adapter's
  line is correlated too.
  - Strength: Preserves provider-level detail as its own greppable event.
  - Tradeoff: Requires threading a logger into `TranslationRequest` or the
    `draft()` call, widening the port the change exists to narrow.
  - Confidence: MEDIUM.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — adapter's `log.error` and the `log` option removed. Confidence upgraded MEDIUM→HIGH after empirically confirming pino serializes the `cause` chain, so the route's single correlated line loses nothing.

### F3 — The 502's blast radius is wider than the plan describes

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `backend/src/domain/translationDraft.ts:101`
- **Detail**: The plan frames the behavior change as "an all-empty response now
  fails loudly". The implementation is broader, because `parseSenses` drops any
  sense with a blank `meaningText` or an empty `sentences` array before
  `isDegenerate()` is evaluated. A response where the model returned variants
  that are all individually unusable — previously a 200 rendering variants with
  no examples — is now indistinguishable from an all-empty response and becomes a
  502 plus a retry. This is a defensible reading of the plan (it specifies both
  the drop rule and the degenerate rule) and is arguably the better behavior, but
  it is a second user-visible change that the plan's Migration Notes do not
  mention when they say only the all-empty path changes.
- **Fix**: Add a line to the plan's Migration Notes recording that a
  wholly-unusable response also collapses to 502, so the next reader does not
  re-derive it from the code.
- **Decision**: FIXED — recorded in the plan's Migration Notes.

### F4 — Unplanned test-infrastructure changes

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `backend/test/helper.ts:24`, `backend/test/helpers/logs.ts`
- **Detail**: Two files changed that appear in no phase's "Changes Required".
  `build(t)` gained an optional `serverOptions` parameter, and `helpers/logs.ts`
  is new. Both exist to satisfy Phase 3's requirement that the partial-empty test
  "gains an assertion that the degradation log line was emitted" — the plan
  specified the assertion without specifying the capture mechanism, and pino
  child loggers cannot be spied on by reassigning `app.log`. The change is
  backward compatible: every existing `build(t)` call is untouched.
- **Fix**: Note both files in the plan's Phase 3 "Changes Required" as discovered
  scope, so the plan stays usable as ground truth for later reviews.
- **Decision**: FIXED — recorded in the plan as Phase 3 § 7b, discovered scope.

### F5 — Two unplanned production additions, both defensible

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `backend/src/adapters/anthropicTranslator.ts:149`, `backend/src/routes/api/collections/index.ts:247`
- **Detail**: (a) `anthropicTranslatorOver(client, log)` is exported alongside the
  planned `createAnthropicTranslator`, because the planned factory builds its own
  client and nothing could otherwise stub it; the provider type stays out of the
  plugin. (b) The translate route re-checks `draft.isDegenerate()` even though the
  adapter already raises `DegenerateDraftError`, so "all-empty is a 502" holds for
  any `Translator` rather than for one adapter — the port's type cannot express
  non-degenerate. Both are additive and covered by tests.
- **Fix**: Record both in the plan as discovered scope; no code change.
- **Decision**: FIXED — recorded in the plan as Phase 3 § 7b, discovered scope.

### F6 — Success criterion 3.3's literal grep returns three files, not two

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/anti-corruption-layer/plan.md` (Phase 3, criterion 3.3)
- **Detail**: `grep -rl "@anthropic-ai/sdk" backend/src backend/test` returns the
  adapter, its test, **and** `test/architecture/providerBoundary.test.ts` — the
  gate necessarily contains the string it searches for. The criterion's intent is
  met and is enforced more strongly than the grep: the committed test asserts
  exactly two files and excludes itself from its own walk, verified red by adding
  an SDK import to a route. Only the criterion's literal wording is wrong.
- **Fix**: Amend criterion 3.3 to exclude `test/architecture/`, matching what the
  boundary test actually enforces.
- **Decision**: FIXED — criterion 3.3 amended in both the phase block and the Progress row.

### F7 — `lessons.md`'s forcing-import entry now cites a deleted property

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `context/foundation/lessons.md` (§ "ts-node/esm plugin files need a forcing import")
- **Detail**: The entry lists `fastify.anthropicClient` as an augmented property
  and cites `anthropic.ts` as the second place the trap was hit. Both are now
  deleted. More usefully, this change surfaced a mechanism the entry does not
  capture: renaming `plugins/anthropic.ts` to `plugins/translator.ts` moved its
  forcing import from **first** to **last** in `@fastify/autoload`'s alphabetical
  order, which is what made `routes/api/collections/index.ts` — a file that had
  never carried its own — start failing 9 of 127 tests non-deterministically. The
  general rule is that a file's safety depended on another file's name.
- **Fix**: Update the entry to cite `fastify.translator`, and add the ordering
  mechanism: any file reading an augmented property needs its own forcing import,
  because relying on another plugin's is a dependency on that plugin's filename.
- **Decision**: FIXED — lessons.md now cites `fastify.translator`, records the third occurrence, and captures the autoload-ordering mechanism.

## Verification performed during this review

- All automated criteria for phases 0–6 re-run: every one passes.
- Backend suite 129/129 (four consecutive runs, including three run
  back-to-back specifically to confirm the forcing-import fix removed the
  non-determinism). Extension suite 35/35, lint clean, build clean.
- Moved tool schema diffed against `git show HEAD:backend/src/ai/translate.ts`
  — byte-identical. System prompt identical after normalizing the one mandated
  interpolation change (`nativeLanguageCode` → `languages.nativeLanguageCode`).
- Boundary test verified by adding an SDK import to a route file (red) and
  removing it (green).
- Field-stripping verified by removing `phoneticTranscription` from
  `translateResponseSchema` (deep-equal red) and restoring it (green).
- `createdAt` wire format probed with and without the new 201 response schema:
  identical ISO-8601 (`2026-08-24T17:03:58.565Z`), so Phase 4 introduced no
  serialization regression on the one field where fast-json-stringify could have
  differed from `JSON.stringify`.
- Scope guardrails from "What We're NOT Doing" all held: no prompt or schema
  change, no live API call, no `detectedLanguageCode`, no `senses` on the wire,
  no change to the regenerate reconciliation, no shared-types package, no route
  added or renamed (`route-reachability.test.ts` passes), and the three smaller
  leaks (Neon, axios, Web Speech) untouched.
