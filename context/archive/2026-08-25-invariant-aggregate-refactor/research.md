---
date: 2026-08-25T23:09:50+02:00
researcher: KStrzechowski
git_commit: e88a4496d37c64d7aa649d6a7045365bc7997257
branch: chore/archive-anti-corruption-layer
repository: InkLingo
topic: "Re-ground the Entry-aggregate / sense-integrity refactor design against HEAD after the anti-corruption-layer change"
tags: [research, codebase, domain, entry-aggregate, sense-integrity, migration, ai-contract, print]
status: complete
last_updated: 2026-08-25
last_updated_by: KStrzechowski
---

# Research: re-grounding the invariant-aggregate refactor at HEAD

**Date**: 2026-08-25T23:09:50+02:00
**Researcher**: KStrzechowski
**Git Commit**: `e88a449`
**Branch**: `chore/archive-anti-corruption-layer`
**Repository**: InkLingo

## Research Question

`context/domain/02-invariant-aggregate-refactor.md` designs an `Entry` aggregate
that guards sense integrity (INV-12 ∧ INV-14: *a saved entry keeps every meaning
the user chose, and every example sentence belongs to exactly one of them*). It
was written at commit `f6e3aab`. Since then the **anti-corruption-layer** change
(`5369a9c..8fd3b56`, archived at `context/archive/2026-08-23-anti-corruption-layer/`)
landed and reshaped the backend.

The design itself is taken as settled — entry-level senses, seven phases, product
decisions D-1/D-2/D-3. This research asks: **which of the doc's file:line claims
still hold, what did the ACL subsume, invalidate, or make cheaper, and what does a
plan have to account for that the doc could not have known?**

Scope confirmed with the user before starting: re-ground at HEAD (not re-open the
design); all four focus areas; read-only DB probes permitted, no Anthropic calls.

---

## Summary

**The design survives; its evidence base does not.** Every substantive claim about
the invariant holds — sense integrity is still unrepresentable in persistence, the
pairing is still destroyed at the save boundary, and `UNIQUE(entry_id,
language_code)` still forbids FR-009. But a large fraction of the doc's anchors are
stale, and in three places following them would now actively break the build.

Five findings change what a plan must say:

1. **`backend/src/ai/translate.ts` is gone, and its absence is asserted by a test.**
   `backend/test/architecture/providerBoundary.test.ts:93-95` asserts `src/ai` does
   not exist. The doc's § 5.1 and § 5.3 rows 1-3 are written against that file
   throughout. The tool schema now lives at
   `backend/src/adapters/anthropicTranslator.ts:52-110`; `alignToRequested` is the
   rebuild loop inside `TranslationDraft.fromProviderPayload`
   (`backend/src/domain/translationDraft.ts:141-147`).

2. **A domain layer already exists, and it has taken the name `Sense`.**
   `DraftSense` (`backend/src/domain/translationDraft.ts:18-22`) is a
   *language-scoped* sense holding `meaningText` in the **target** language. The
   doc's `Sense` is *entry-level* holding `glossText` in the **native** language.
   Two opposite things called "sense" in one directory. One must be renamed before
   Phase 1 writes `backend/src/domain/sense.ts`.

3. **The AI-contract inversion is cheaper than the doc priced it; the verification
   gate is not.** The port (`backend/src/domain/translator.ts:21-23`) has no shape
   in its signature, and `TranslationDraft.toWire()`
   (`translationDraft.ts:190-205`) is already the sole domain→wire rename site —
   exactly the slot the doc's `toLegacyLanguageShape()` was invented for. Phase 2's
   code footprint is ~2 backend `src` files plus one route line
   (`backend/src/routes/api/collections/index.ts:288`). The live-verification cost
   (`lessons.md` § "A stubbed AI client…") is unchanged and remains the real cost.

4. **The migration is safe on today's data — measured, not assumed.** The dangerous
   case (a `lower()` join matching two translations, silently mis-filing a
   sentence) returns **zero rows**. So do both would-be uniqueness violations. Only
   **three rows** need disposition before Phase 3.

5. **The proposed aggregate is stricter than existing data.** Two translations have
   no sentence and two sentences have a `NULL` native gloss. Reconstructing those
   rows through `Entry`'s constructor invariants would throw
   `TranslationWithoutSentenceError` / `BlankTextError` on a plain `GET`. The doc
   never separates *write* invariants from *read* reconstruction; it must.

---

## Detailed Findings

### 1. What the anti-corruption-layer changed

`git diff --stat f6e3aab..HEAD` over the app directories: 21 files, +1529/−357.

| Gone | Arrived |
| --- | --- |
| `backend/src/ai/translate.ts` (164 ln) | `backend/src/adapters/anthropicTranslator.ts` (205 ln) |
| `backend/src/plugins/anthropic.ts` | `backend/src/plugins/translator.ts` |
| `backend/test/helpers/anthropic.ts` | `backend/src/domain/translationDraft.ts` (236 ln), `backend/src/domain/translator.ts` (62 ln) |
| — | `backend/test/architecture/providerBoundary.test.ts`, `backend/test/domain/translationDraft.test.ts`, `backend/test/adapters/anthropicTranslator.test.ts`, `backend/test/helpers/fakeTranslator.ts` |

`backend/src/routes/api/collections/index.ts` went 439 → **483** lines;
`schemas.ts` gained 52.

**The doc's § 0.2 is now false where it matters most.** It states *"There is **no
domain layer and no service layer**… none is named for a domain concept except
`ai/translate.ts`"* (`02-invariant-aggregate-refactor.md:63-65`). A domain layer
exists — but it covers **only the translation draft**. There is still no
repository, no `Entry`, and every persistence rule is still inline in the route.
The doc's thesis holds for the save path; the sentence stating it does not.

This is the mirror image of the defect commit `e88a449` was written to correct in
`context/changes/translation-pivot/research.md:1020-1031` — a planning document
asserting a seam that did not exist. Here the assertion is that a layer does not
exist when it does. **§ 0.2, § 3.1 rows 1-3, § 5.1, § 5.3 rows 1-3 and § 5.10 need
the same dated block-quote correction treatment before anyone plans off them.**

### 2. The doc's evidence base, repointed to HEAD

Verified against `git show f6e3aab:<file>` first, so each old line is confirmed to
have said what the doc says it said.

**Route file** (`backend/src/routes/api/collections/index.ts`) — the ACL shifted
everything down and rewrote the backfill's projection step:

| Doc's claim (at `f6e3aab`) | Now | Status |
| --- | --- | --- |
| `:111-116` supported language codes | `:132-137` | moved |
| `:121-123` duplicate targets | `:142-144` | moved |
| `:124-126` native ≠ target | `:145-147` | moved |
| `:148-150` unique-name → 409 | `:169-171` | moved |
| `:160, 230, 288, 367, 372` ownership | `:181, 255, 331, 411, 416` | moved, 5 sites unchanged |
| `:175-213` read model, two sibling arrays | SELECTs `:196-205`, response `:213-235` | moved |
| `:225-228 / :258-261 / :273-278` blank guards | `:250-253 / :301-304 / :316-321` | moved |
| `:279-280` the false comment | `:322-323`, **verbatim** | moved; the doc's truth-analysis **confirmed** |
| `:281-286` per-language duplicate guard | `:324-329` | moved |
| `:293-304` membership | `:336-347` | moved |
| `:306-310` app-side id generation + rationale | `:349-353`, **verbatim** | moved |
| `:311-329` two INSERT loops, one transaction | `:354-372` | moved |
| `:312-316` source language forced to native | `:355-361` (interpolation `:359`) | moved |
| `:383-389` "already has a translation" query | `:427-430` | moved |
| `:385` `lower(language_code)` | `:429` | moved |
| `:388` conflict message | `:432`, **verbatim** | moved |
| **`:391-399` `variants[0]` / `sentences[0]`** | **code GONE** → `:443` `draft?.renderingFor(languageCode)`; rule now lives in `backend/src/domain/translationDraft.ts:172-185`; comment reworded at `:439-442` | **changed by ACL** |
| **`:367-399` backfill route** | `:398-479`, **plus a new `response:` schema at `:405`** | **changed by ACL** |

**One doc claim is misclassified, not merely moved.** § 3.2 / § 4.7 / the Summary
count *three* hand-written copies of the target-language membership check
(`:299-304`, `:379-381`, `:385`). The third — now `index.ts:429` — is
`WHERE entry_id = … AND lower(language_code) = …`, a **uniqueness** query, not a
membership check. There are **two** membership guards (`:342-347`, `:423-425`).
What genuinely appears three times is the *load-and-lowercase target codes* idiom
(`:260-261`, `:340-341`, `:421-422`). A plan repeating "three copies" will not
survive review.

**Schemas** (`backend/src/routes/api/collections/schemas.ts`, now 116 lines):
`createEntryBodySchema` moved `:44-62` → **`:96-114`**, body byte-identical; its
*"One translation + one sentence per target language"* comment survives verbatim at
`:94-95`. Two response schemas are **new**: `translateResponseSchema:47-60` and
`addEntryTranslationResponseSchema:68-83`.

**Ownership** (`ownership.ts:19-38`) — untouched, claim confirmed exactly.

**Extension** — only `e44a272` touched it (net −8 lines in `App.tsx`, +11 in
`types.ts`). Mechanical rule: every `App.tsx` claim **< 228 is unmoved**; every
claim **≥ 244 is exactly −8**. Every `types.ts` claim **≥ 33 is exactly +11**. So
`sameMeaning` is still `:36-38`; `selectVariant` still `:202-206`; the regeneration
guard moved `:283-290` → `:275-282`; `readyToSave` `:345-358` → `:337-350`; **the
loss** `:375-384` → **`:367-376`**.

One extension claim is **gone**: the partial-degradation report the doc cites at
`App.tsx:236-243` was deleted by the ACL; `App.tsx:231-235` is now a comment
explaining that the all-empty case is a 502 and the partial case is logged
server-side. The doc's § 3.5 enumeration is one item too long — which *strengthens*
its argument, since `App.tsx:283-296` is now the sole client-side fail-fast site
anywhere.

**Frontend** — untouched by the ACL. `collections.ts:11-37`,
`CollectionDetailPage.tsx:192` and `:199-226`, `printRows.ts:51-78` (the `.find()`s
at `:56-58` and `:59-61`), `PrintDocument.tsx:148-149`/`:158-161`/`:168-173`, and
`printLabels.ts:12-18`/`:20-77` all confirmed at the cited lines. One correction:
the `<th>` block is `:131-138`, with the five `<th>` at `:133-137`.

### 3. Constraints the doc could not have known

**3.1 `providerBoundary.test.ts` is now an architectural gate, not a guideline.**
Four assertions the refactor must respect:

- `:64-72` — `@anthropic-ai/sdk` is importable from exactly two files, the adapter
  and its test. **D-2's second tool schema (gloss + language → word) must live
  inside the adapter or be added to this list.**
- `:77-80` — `claude-haiku` and `return_translation` appear nowhere outside the
  adapter. A second tool *name* typed into any other backend `.ts`/`.mjs` turns
  this red.
- `:85-91` — needles `['anthropicClient','toolUse','tool_use','TranslationResult']`
  must not appear under `src/routes/` or `src/plugins/`.
- `:93-95` — `src/ai` must not exist.

**3.2 The `Sense` name is taken.** `DraftSense` (`translationDraft.ts:18-22`) is
language-scoped with a target-language `meaningText`; the doc's `Sense` (§ 4.1,
§ 5.10) is entry-level with a native-language `glossText`. The natural resolution is
to rename `DraftSense` → `SenseTranslation` (the doc's own name for the per-language
level) and let the entry-level sense take the free name.

**3.3 `route-ownership.test.ts` constrains where ownership may be called from.**
The check is **lexical**: `:67-72` requires the literal string
`fetchOwnedCollection(` to appear inside each `:id` route's own source slice, and
`fetchOwnedEntry(` for the `:entryId` route. A repository that hides ownership
inside `loadEntry(sql, entryId, collectionId)` **fails the test even though it is
correct**. The doc's thin-route sketch (§ 4.6) satisfies this by keeping the call on
line 2 of the handler; a plan must not "clean it up". Both floors sit exactly at
their minimum: `MIN_EXPECTED_ID_ROUTES = 4` (`:57`) and `MIN_EXPECTED_ROUTES = 9`
(`route-reachability.test.ts:83`).

**3.4 Response-schema stripping is a new hazard on routes that have none.**
`schemas.ts:63-67` warns that Fastify **silently strips** any property a response
schema does not declare. `POST /:id/entries` and `GET /:id` declare **no** response
schema (`index.ts:295-299`, `:176-179`) and hand-build their payloads. Introducing
`entry.toResponse()` alongside a new response schema therefore changes stripping
behaviour on routes where nothing is stripped today — a silent-truncation failure
mode, not an error. Separately, `addEntryTranslationResponseSchema:68-83` returns
exactly **one** translation and **one** sentence, which is flatly incompatible with
D-2 ("backfill translates every meaning").

**3.5 The doc's C-01 prerequisite is half-satisfied.** `refactor-opportunities`
recorded **zero** declared response schemas backend-wide (its V-7). There are now
**two** — `index.ts:246` and `:405` — both on the routes the ACL touched. So "C-01
should land first or alongside" (§ 5.7) narrows to: *extend the pattern the ACL
established to the two entry-shaped routes*, which is inside this change's scope
rather than a prerequisite outside it.

**3.6 `max_tokens` is computed per-language and the formula stops matching.**
`anthropicTranslator.ts:154` uses `MAX_TOKENS_PER_LANGUAGE * languages.length`. A
meaning-first schema produces N senses × M translations, so the budget must be
re-derived or `tool_use` JSON truncates mid-object — the failure mode named at
`:22-23`. Transport policy `PROVIDER_MAX_RETRIES = 1` /
`PROVIDER_TIMEOUT_MS = 15_000` (`:45-46`) sits under the route's
`TRANSLATE_TIMEOUT_MS = 20_000` (`index.ts:32`), under API Gateway's 29s.

**3.7 `measure-cost.mjs` now imports the live adapter** (`:44-46`), so Phase 0's
baseline run must happen **before** the adapter is edited — afterwards there is no
"old" schema to measure against without a git-stash dance.

**3.8 Two live comments assert the ~3-in-34 degenerate rate** —
`anthropicTranslator.ts:26-32` and `translator.ts:51-53`. Both become false
statements the moment the schema inverts.

### 4. Phase 0 — measured, not projected

Run 2026-08-25 against the dev Neon branch, read-only
(`SET default_transaction_read_only = on`), via the `pg` client. `psql` is blocked
by the sandbox; the probe script follows
`context/changes/translation-pivot/measure-cost.mjs:33-36` for `.env` parsing.

**Volume**: 189 users · 12 collections · 18 target-language rows · **23 entries** ·
**85 translations** · **84 sentences**.

| Probe | Result | Consequence |
| --- | --- | --- |
| Non-lowercase codes | `entry_translations` **0**, `entry_sentences` **0**; `collection_target_languages` 1 (`EN`), `collections.native_language_code` 1 (`PL`), `entries.source_language_code` 3 | **The two tables the migration joins are already clean.** Legacy casing survives only on the collection/entry side |
| `ENss` | **not present anywhere** | The `MEMORY.md` note on legacy codes is partly stale — `PL`/`EN` remain, `ENss` does not |
| **Orphan sentences** | **1** — `jedzenie` / `pl` in *"Nested contents test"* | One row needs an explicit disposition before Phase 3 |
| **Ambiguous sentences** (`lower()` join matches >1 translation) | **0 rows** | **The silent mis-attribution hazard does not exist in this data.** This is the check the doc's Phase-0 list omits and the only one that fails invisibly |
| Would-be `UNIQUE(sense_id, language_code)` violations | **0 rows** | The constraint swap applies cleanly |
| Would-be `UNIQUE(entry_id, sense_key)` violations | **0** (no duplicate words in any collection) | Vacuous, as § 5.5 predicts — but it also means pre-existing "same word saved twice" rows would **not** be merged into one multi-sense entry. None exist, so the question is moot today |
| Multiple sentences per (entry, language) | **0 rows** | INV-11 currently holds in fact; retiring it costs nothing |
| Entries with zero translations | **0** | — |

**Verdict: the migration is safe on today's data.** `lessons.md`'s
uniqueness-migration rule is discharged — with the caveat that this is the *dev*
branch, and the same probes must run against any other environment before Phase 3.

### 5. The aggregate is stricter than the data it will load

Follow-up probes found rows that satisfy today's schema and would **violate the
proposed aggregate's constructor invariants**:

| Row | Violates |
| --- | --- |
| `pies` / `en` / *"dog"* in *"Empty generation test"* — a translation with no sentence | `TranslationWithoutSentenceError` (§ 4.3) |
| `jedzenie` / `ru` / *"eda"* in *"Nested contents test"* — same | `TranslationWithoutSentenceError` |
| `jedzenie` / `en` and `jedzenie` / `pl` — `native_gloss_text IS NULL` | `BlankTextError('sentence')` (§ 4.3 requires both halves non-blank) |
| `jedzenie` / `pl` — a sentence in the collection's **native** language | **INV-9**, which § 1 lists as ENFORCED |

The last one is the sharpest: INV-9 (*every saved sentence is in one of the
collection's target languages*) is recorded as ENFORCED, and real data violates it.
That is the doc's own honest limit — *"Enforcement statuses were read from source,
not exercised at runtime"* (§ 5.9) — landing on a concrete row.

**What a plan has to decide.** The doc's design has one construction path,
`Entry.capture`, applying every precondition. A repository that rebuilds an `Entry`
from rows through those same preconditions will throw a 500 on a plain `GET` for two
existing entries. The options are (a) migrate/repair the four rows in Phase 3 and
keep one strict path, (b) give the repository a separate lenient reconstruction path
that does not re-assert write-time invariants, or (c) relax the invariants to
warnings on load. **(a) is cheapest at this data volume** — four rows, all in test
collections — but the write/read invariant asymmetry is a modelling decision that
outlives the row count and should be stated explicitly either way.

### 6. Persistence and migration reality

Schema confirmed unchanged since `f6e3aab` (`git diff` over `backend/migrations` and
`backend/test/schema` is empty). All four doc claims verified:
`UNIQUE(entry_id, language_code)` at
`backend/migrations/1784584360698_create-core-schema.ts:52-54`; `entry_sentences`
with `entry_id`/`language_code` and **no** `translation_id` (`:56-68`);
`phonetic_transcription` on `entry_translations`
(`1785433311673_add-entry-phonetics-and-sentence-gloss.ts:9-11`).

Three corrections and one addition:

- **Table name.** It is `collection_target_languages`
  (`1785419841325_add-collection-languages.ts:10`), not `collection_languages`.
- **"An index, not a constraint"** (§ 1 INV-11, § 3.2) reaches the right conclusion
  by the wrong picture. `1784584360698:68` is
  `pgm.createIndex('entry_sentences', 'entry_id')` — a **non-unique, single-column**
  index that does not mention `language_code` at all. It is not a unique index that
  merely isn't a constraint. The conclusion is if anything understated.
- **`UNIQUE(entry_id, language_code)` is case-SENSITIVE.** The doc never says so. It
  is why the ambiguous-sentence probe was worth running (it came back clean).
- **A real index regression § 4.5 misses.** `entry_translations` has **no index
  other than the PK and the one implicitly backing the unique constraint**. Dropping
  that constraint drops the only index led by `entry_id`, and three live paths depend
  on it — the collection-detail read (`index.ts:196-200`), the FR-018 conflict check
  (`:427-430`), and the `ON DELETE CASCADE` sweep. **§ 4.5 must add
  `INDEX entry_translations(entry_id)` explicitly.**

Two further points for the plan:

- **`sense_key`'s authority is self-contradictory as specified.** § 4.5 argues the
  column must be stored so the TS `senseKey()` is the sole authority and no
  `lower(btrim(...))` expression can diverge. But the Phase-3 backfill can only
  populate it with inlined SQL — reintroducing exactly that divergence. Either the
  migration loops in TS importing `senseKey`, or the plan states the two are asserted
  equal and pins it with a test.
- **Rollback is a one-way door.** `down()` must re-add
  `UNIQUE(entry_id, language_code)`, which fails the first time any entry has two
  senses sharing a target language — i.e. the first real use of the feature. The
  rehearsal § 5.4 prescribes is only meaningful against pre-refactor data.

**Test-fixture blast radius is larger than "extend `core-schema.test.ts`".**
`sense_id NOT NULL` and `translation_id NOT NULL` invalidate every hand-written
INSERT in the suite — `core-schema.test.ts:47,53,66,70,88,92,117,129,133`,
`routes/api/collections.test.ts:240-252`, `routes/api/entries.test.ts:256`,
`routes/api/entry-translations.test.ts:50` — and `backend/test/helpers/fixtures.ts`
has helpers for users, collections and entries but **none** for
senses/translations/sentences. Those come first.

The test to invert is `backend/test/schema/core-schema.test.ts:40-57`. Note also
that the cascade test at `:123-146` keeps passing but stops being complete: the new
`entry_sentences.translation_id … ON DELETE CASCADE` is a second, untested path.

### 7. Client surfaces

**The loss is confirmed, and is structural.** `App.tsx:338-349` builds `picks` where
`sentence` is read from `variant?.sentences[...]` — an index into the chosen
variant's own list, so a pick **cannot physically** hold a sentence from another
variant. `App.tsx:365-377` then maps `picks` twice into sibling arrays joined only by
`languageCode`. The wire contract cannot express the pairing even if the popup wanted
to: `extension/src/messages.ts:7-11` and `schemas.ts:96-114` both carry
`maxItems: MAX_TARGET_LANGUAGES` on **each** array.

**Four popup mechanics D-3 breaks that the doc does not list:**

- **Radio-group names are per-language** — `App.tsx:508` `variant-${languageCode}`,
  `:547` `sentence-${languageCode}`. Under D-3 two meanings' sentence lists in the
  same language would share one group and become mutually exclusive. **The feature is
  unbuildable as drawn until these are keyed per (meaning, language).**
- **`SpeakButton` keys collide across meanings** — `:519`/`:558` use
  `${languageCode}:variant:${index}`, and the error filter at `:495` matches on the
  language prefix.
- **`selections` is `Record<languageCode, Selection>`** (`:98`, seeded `:85-90`), and
  its "open on the first variant" default (`:88`) directly contradicts "ask which
  meanings to keep".
- **`handleRegenerate` is per-language and gated on the single selected variant**
  (`:256-262`, header `:528-540`). With several meanings checked, "the variant the
  user is looking at" has no referent.

Two user-facing strings also become false — `:379` and `:571-573` count languages,
and `App.test.tsx:209` pins `'0 of 2 languages chosen'` verbatim.

**The print width budget is tighter than § 5.9 says.** Working from
`print.css:240-244` (16/19/20/22.5/22.5 %) over a 680.3px text width, 1pp = 6.80px.
Two committed assertions bound redistribution: widths must sum to exactly 100%
(`printCssGeometry.test.ts:165-172`) and columns 4+5 must exceed 40% (`:174-181`).
The widest observed language name is **104.9px** on Linux `system-ui`
(`print.css:226-229`), so column 2 cannot go below ≈17.2%. That leaves:

```
100 − 40.1 (sentences, min) − 17.2 (Language, min) = 42.7
current Word + Translation                          = 36.0
genuinely free                                      =  6.7pp ≈ 46px
```

**~46px is about seven characters.** The doc's own example gloss *"urządzenie do
zamykania"* is ~150px and would wrap three or four lines, multiplying band height
straight into the vertical budget — the condition `harness/fixtures.ts:51-57` records
as having once made every sheet spill onto a second PDF page on a Linux runner.
Taking width from Translation is bounded at ~16.3% by `columns.spec.ts:98-106`, which
requires `independence` (94.0px) to stay on one line.

**§ 5.9's "the Language column is the most compressible thing on the sheet" is
refuted as stated.** That column has been *widened twice* (10% → 17% → 19%) under
live re-measurement and sits ~8px from failing; it is the only column re-derived on
every CI run and the only one with `white-space: nowrap` chosen so overflow is
visible rather than quiet (`print.css:250-263`). It is not compressible — it is
**droppable**, which is a different and stronger move: it frees the whole 19pp at
once and is the only mitigation that buys enough. The price is concrete:
`languageColumn.spec.ts` (8 tests × 2 engines) is deleted, `PrintLabels.language` and
8 label rows lose a field, and `harness.spec.ts:91-129` loses its subject.

**The hardest single gate on D-1** is `printCssGeometry.test.ts:79-83`, which
hard-asserts exactly five width declarations (`.toEqual([1,2,3,4,5])`). It fails the
moment a sixth column lands.

**`PrintBand` cannot express nesting.** `printRows.ts:25-28` is `{ entry, rows }`
with no grouping information; nested `rowSpan` (item 20c) needs rows-per-gloss
counts. The doc says `PrintRow` gains `glossText` but does not say `PrintBand`
changes too. Related: `print.css:186-199`'s left-border reasoning is written around
the current single-`rowSpan` band shape and is invalidated by nesting —
`harness.spec.ts:91-129` is the test that catches it.

**A fourth hand-copy exists.** `GET /api/collections/:id` has **no response schema**
and is duplicated in four places: `frontend/src/api/collections.ts:11-37`,
`frontend/browser-tests/harness/fixtures.ts:12-38`,
`frontend/e2e/printRoute.spec.ts:24-56`, plus the test helpers. It is the endpoint
D-1/D-3 change most and has zero coupling to the server in any direction.

### 8. Test surface

| Suite | Scale | Fate |
| --- | --- | --- |
| `backend/test/domain/translationDraft.test.ts` | 291 ln | **Rewritten** — its header calls it *"the specification of what the model may legally do to us"*, so it is the natural TDD entry point for Phase 2 |
| `backend/test/adapters/anthropicTranslator.test.ts` | fixtures `:33-55` | Inverted; `:143-151` encodes the semantics sparse spokes change |
| `backend/test/architecture/providerBoundary.test.ts` | 4 assertions | **Must stay green** — see § 3.1 |
| `backend/test/routes/api/translate.test.ts` | 19 `variants` refs; deep-equal `:250-303` | The deep-equal is the only shape that catches a silently-truncated response |
| `backend/test/schema/core-schema.test.ts` | 9 tests | `:40-57` inverted; a translation-cascade test added |
| `extension/test/popup/App.test.tsx` | 20 tests | Heavily — `:136`/`:144` (radio semantics), `:151`, `:175-227` (language-shaped save gate), `:231-269` (**the pairing test**) |
| `frontend/test/pages/printRows.test.ts` | 14 tests | Every "which rows exist" assertion; **no existing test constructs a second meaning**, so doc test 26 has nothing to grow from |
| `frontend/test/pages/printCssGeometry.test.ts` | 9 tests | `:79-83` is the hard gate on the sixth column |
| `frontend/test/pages/printLabels.test.ts` | 18 tests | `:15`'s loop asserts the new `meaning` field for all 8 languages automatically — fails until all 8 are written, which is the right failure |
| `frontend/browser-tests/` | 26/engine × 2 = 51 executed | `columns.spec.ts:42-107` trips first on width; `harness.spec.ts:25-29` needs a sixth header and `:91-129` breaks structurally on nested `rowSpan` |
| `frontend/test/pages/printPagination.test.ts` | 9 tests | Logically unaffected, but far more load-bearing: `:79`'s "band taller than a page" path goes from theoretical to routine |

`backend/test/helpers/fakeTranslator.ts` survives structurally — `draftFrom:17-22`
routes fixtures through the real parser on purpose — but every caller's payload
literal changes.

---

## Code References

- `backend/src/domain/translationDraft.ts:18-27` — `DraftSense` / `DraftLanguage`: the language-first nesting, and the name collision
- `backend/src/domain/translationDraft.ts:141-147` — the old `alignToRequested`, moved unchanged (says so at `:140`)
- `backend/src/domain/translationDraft.ts:190-205` — `toWire()`, the sole domain→wire rename site; the `toLegacyLanguageShape` slot
- `backend/src/domain/translator.ts:21-23` — the port; no shape in its signature
- `backend/src/adapters/anthropicTranslator.ts:52-110` — the tool schema, language-first
- `backend/src/adapters/anthropicTranslator.ts:154` — `MAX_TOKENS_PER_LANGUAGE * languages.length`
- `backend/test/architecture/providerBoundary.test.ts:64-95` — four architectural assertions
- `backend/test/route-ownership.test.ts:67-72` — lexical ownership check
- `backend/src/routes/api/collections/index.ts:288` — `draft.languages.length`, the only language-first leak into a route
- `backend/src/routes/api/collections/index.ts:349-353` — app-side id generation and why
- `backend/src/routes/api/collections/index.ts:443` — `renderingFor`, replacing `variants[0]`
- `backend/src/routes/api/collections/schemas.ts:63-67` — Fastify strips undeclared response fields
- `backend/migrations/1784584360698_create-core-schema.ts:52-54,56-68` — the constraint that forbids FR-009, and the sentence table
- `extension/src/popup/App.tsx:338-349` — the pairing
- `extension/src/popup/App.tsx:365-377` — where it is destroyed
- `extension/src/popup/App.tsx:508,547` — per-language radio group names
- `frontend/src/pages/printRows.ts:56-61` — the `.find()` that drops N−1 senses
- `frontend/test/pages/printCssGeometry.test.ts:79-83` — exactly five columns

## Architecture Insights

- **The ACL built the seam the doc assumed it would have to work around.** The port
  isolates the routes from the provider so completely that inverting the tool schema
  touches one route line. The doc's "main cost" framing was right about the *risk*
  and wrong about the *code*.
- **Structural enforcement has spread.** Three static tests now encode architectural
  rules as source-text assertions — provider boundary, route reachability, ownership.
  Each has a floor set exactly at today's count. This is the same "make it
  unrepresentable rather than merely rejected" instinct the doc's § 4.1 applies to
  `Sentence`, applied to file layout.
- **The repo's convention is deliberate duplication with a named owner.** No shared
  package; instead a response schema owns the shape server-side and each client
  hand-copies it, with the copy pointing at its source
  (`extension/src/types.ts:34-38`). The two entry-shaped routes are the remaining
  places with no owner at all.
- **Write invariants and read reconstruction are not the same thing.** § 5 is the
  first place this repo's data has pushed back on a domain design.

## Historical Context (from prior changes)

- `context/domain/01-domain-distillation.md:259-300` — ranked this same invariant #1
  and named the target shape as *"`entry_translations` becomes the sense-bearing
  relation"*, i.e. a **per-language** sense. `02` § 4.0 explicitly corrects that to
  entry-level. The lineage matters: the per-language shape is the one the AI
  contract's grain pushes you toward, and both documents have now walked into it.
- `context/archive/2026-08-23-anti-corruption-layer/change.md:16-19` — the ACL was
  *"structural only"*, keeping the tool schema byte-identical so the
  `measure-cost.mjs` baseline stayed valid and no live calls were needed. This
  refactor is the change that spends that baseline.
- Same file `:31` — `strict: true` and a required `detectedLanguageCode` were
  deferred as follow-ups. Inverting the schema is the natural moment.
- `context/changes/refactor-opportunities/research.md:1039` (V-7) — zero response
  schemas backend-wide. Now two. See § 3.5.
- `context/changes/translation-pivot/research.md:1020-1031` — the
  `generateWithTimeout` correction (commit `e88a449`): a planning document asserted a
  seam that was a passthrough. § 1 above is the same failure mode pointed the other
  way.
- `context/foundation/roadmap.md:179,183` — IL-41, with the loss measured on real
  data (`zamek` → only `lock`). IL-24 (`:176`) keys reuse on the *sense*, so the two
  must agree on shape.
- `context/foundation/lessons.md` — four lessons bind: the uniqueness-migration check
  (discharged in § 4), the `fastify.d.ts` forcing import (hit a **third** time by the
  ACL, and any new `domain/` or `plugins/` file needs its own), the `api-construct.ts`
  rule (no route added — verified in § 3.3), and the stubbed-AI lesson, whose
  `**Applies to**` trigger still names the deleted `backend/src/ai/` and needs
  re-anchoring to `backend/src/adapters/`.

## Related Research

- `context/domain/02-invariant-aggregate-refactor.md` — the design this re-grounds
- `context/domain/01-domain-distillation.md` — the distillation that named the candidate
- `context/domain/03-anti-corruption-layer.md` — the analysis behind the ACL
- `context/changes/refactor-opportunities/research.md` — C-01, the response contract
- `context/changes/translation-pivot/research.md` — IL-24, and the seam correction

## Open Questions

1. **Read-path leniency (§ 5).** Repair the four rows, or give the repository a
   lenient reconstruction path? This is a modelling decision, not a data cleanup.
2. **The `Znaczenie` column has ~6.7pp and needs 12-16 (§ 7).** Drop the `Language`
   column, accept gloss wrapping and the band-height risk, or something else? The doc
   lists this as a Phase-6 mitigation to "weigh"; the measured budget says it is a
   decision that has to be taken **before** Phase 6 is planned.
3. **`sense_key` authority in the migration (§ 6)** — TS loop or asserted-equal SQL?
4. **Does `DraftSense` become `SenseTranslation`, and when?** Renaming it in Phase 1
   touches the ACL's brand-new tests; deferring it means two `Sense`s coexist.
5. **D-2's response shape.** `addEntryTranslationResponseSchema` returns one
   translation and one sentence. Plural changes a declared, serialized contract — and
   `frontend/src/api/collections.ts:47-51` mirrors it.
6. **Does the empty-draft retry still pay for itself?** Its justification is a
   measurement against the language-first schema. Re-measuring needs live API calls,
   which were out of scope here.
7. **Other environments.** § 4's numbers are the dev branch only.
