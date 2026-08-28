# Invariant Aggregate Refactor — Implementation Plan

## Overview

Make sense integrity representable and enforced. Today `UNIQUE(entry_id, language_code)`
on `entry_translations` physically forbids an entry from holding more than one meaning,
so when the model correctly returns `zamek` = *castle* / *lock* / *zipper*, the save keeps
one and silently discards the rest — measured on real data as `zamek` surviving only as
`lock` (`context/foundation/roadmap.md:183`). And because `entry_sentences` keys on
`(entry_id, language_code)` with no reference to a translation, the pairing between a
meaning and its example sentence exists only as a convention inside the popup.

This change introduces an `Entry` aggregate whose parts are entry-level `Sense`s, one
`SenseTranslation` per target language beneath each sense, and `Sentence`s beneath those —
with the AI tool schema, the wire contract, the database and both clients all reshaped to
`senses[].translations[].sentences[]`. It implements the design in
`context/domain/02-invariant-aggregate-refactor.md`, re-grounded against HEAD by
`context/changes/invariant-aggregate-refactor/research.md`. Tracked as **IL-41**
(tasks IL-42 … IL-45).

## Current State Analysis

**What exists at HEAD (`e88a449`).** The anti-corruption-layer change landed on 2026-08-23
and reshaped the backend: `backend/src/ai/translate.ts` is gone, replaced by a port
(`backend/src/domain/translator.ts`), a domain value object
(`backend/src/domain/translationDraft.ts`) and a provider adapter
(`backend/src/adapters/anthropicTranslator.ts`). Two response schemas are now declared
(`schemas.ts:47-60`, `:68-83`). There is still **no repository, no `Entry`, and no service
layer** — every persistence rule runs inline in
`backend/src/routes/api/collections/index.ts` (482 lines).

**Where the invariant is lost.** `extension/src/popup/App.tsx:334-349` builds `picks` as
`{ languageCode, variant, sentence }` — the pairing is correct there. The very next
expression (`:365-377`) maps it into two sibling arrays joined only by `languageCode`, and
`createEntryBodySchema` (`schemas.ts:96-114`) has no way to express anything else. The
route then runs two independent INSERT loops (`index.ts:353-372`). The database merely has
no way to record what the payload already stopped carrying.

**What the design could not have known**, from `research.md`:

- `backend/test/architecture/providerBoundary.test.ts:93-95` **asserts `src/ai` does not
  exist**, so the design's §5.1 and §5.3 rows 1-3 point at a file a test now forbids.
- The name `Sense` is taken: `DraftSense` (`translationDraft.ts:18-22`) is *language-scoped*
  and holds a target-language `meaningText` — the opposite of the design's entry-level sense.
- Phase 2's code footprint is far smaller than priced — the port carries no shape in its
  signature and `toWire()` (`translationDraft.ts:190-205`) is already the sole domain→wire
  rename site. The **live-verification cost is unchanged**.
- `backend/test/route-ownership.test.ts:67-72` is a **lexical** check: it requires the
  literal `fetchOwnedCollection(` / `fetchOwnedEntry(` inside each route's own source
  slice. A repository that hides ownership inside `loadEntry()` fails the test *even though
  it is correct*.
- `entry_translations` has **no index other than the PK and the one implicitly backing the
  unique constraint**. Dropping that constraint drops the only index led by `entry_id`, and
  three live paths depend on it.
- The print budget leaves only **~6.7pp (~46px)** genuinely free while a meaning column
  needs 12-16pp; `frontend/test/pages/printCssGeometry.test.ts:79-83` hard-asserts exactly
  five width declarations.

**Phase 0 is already complete** (2026-08-25, read-only, dev Neon branch; `phase0-probe.mjs`
in this folder, numbers in `research.md` §4). 23 entries, 85 translations, 84 sentences.
Zero ambiguous sentences, zero would-be uniqueness violations, one orphan sentence. The
migration is safe on this data.

## Desired End State

A word with several meanings keeps all of them, end to end:

- `POST /api/collections/:id/entries` accepts `senses[].translations[].sentences[]`, and
  `Entry.capture` rejects — with a **named domain error**, never a log line — a blank text,
  a duplicate meaning, a meaning with no word, a word with no sentence, or a language the
  collection does not teach.
- The database records the meaning as a row (`entry_senses`), ties each word to it
  (`entry_translations.sense_id NOT NULL`) and each sentence to a word
  (`entry_sentences.translation_id NOT NULL`). `UNIQUE(entry_id, language_code)` is gone;
  `UNIQUE(sense_id, language_code)` replaces it one level down.
- `GET /api/collections/:id` returns the same nesting, against a **declared response
  schema**.
- The popup asks which meanings to keep, then one sentence per (meaning, language).
- The printed sheet carries a `Znaczenie` column in place of `Language`, still five
  columns, with the word spanning its whole band and each meaning spanning its own rows.
- Adding a language to an existing entry translates **every meaning it already has**.

**Verification**: save `zamek` with two meanings in a `pl → en,de` collection; `GET` it
back with both meanings, each carrying its own words and its own sentences; print it and
see two `zamek` rows distinguished by their meaning.

### Key Discoveries:

- `backend/src/domain/translationDraft.ts:190-205` — `toWire()` is the single domain→wire
  projection point; the schema inversion has exactly one place to land.
- `backend/src/routes/api/collections/index.ts:349-353` — app-side id generation, and why:
  the Neon HTTP driver runs only *non-interactive* transactions, so no `RETURNING` value
  can feed the next statement. This is what makes a three-level insert possible in one
  round trip.
- `backend/src/routes/api/collections/schemas.ts:63-67` — Fastify **silently strips** any
  property a response schema does not declare. `POST /:id/entries` and `GET /:id` declare
  none today, so adding schemas changes stripping behaviour on routes where nothing is
  stripped now.
- `backend/src/adapters/anthropicTranslator.ts:154` — `MAX_TOKENS_PER_LANGUAGE *
  languages.length`; a meaning-first schema produces N senses × M translations, so the
  budget must be re-derived or `tool_use` JSON truncates mid-object.
- `extension/src/popup/App.tsx:508,547` — radio group names are per-language
  (`variant-${languageCode}`, `sentence-${languageCode}`). Under D-3 two meanings' sentence
  lists in one language would share a group and become mutually exclusive. **The feature is
  unbuildable as drawn until these are keyed per (meaning, language).**
- `backend/test/helpers/fixtures.ts` has helpers for users, collections and entries but
  **none for translations or sentences**, while `sense_id NOT NULL` / `translation_id NOT
  NULL` invalidate every hand-written INSERT in the suite.

## What We're NOT Doing

- **Cache-before-model / English-as-pivot (IL-24).** Decided this session: it stays a
  separate change. This plan is its prerequisite — you cannot key reuse on "the meaning"
  while the database has no concept of a meaning.
- **Backward-compatibility shims.** No `toLegacyLanguageShape()`, no save-payload adapter.
  The installed popup's translate flow breaks at Phase 2 and works again at Phase 5.
- **Replacing `senseKey`'s weak identity.** It stays `trim().toLowerCase()`, chosen for
  continuity and as the named seam IL-24 plugs into.
- **Server-side normalization of `wordOrPhrase` (INV-8).** Still supplied by the client;
  `Entry.capture` stamps and range-checks it but does not compute it.
- **New routes.** No `api-construct.ts` change (`lessons.md` — stated explicitly rather
  than left to inference).
- **Preserving legacy data as-is.** Per this session's decision, rows that violate the new
  invariants are repaired or dropped rather than accommodated.
- **A `docs/reference/contract-surfaces.md` registry.** `docs/` does not exist; the
  load-bearing names go in `change.md` instead.

## Implementation Approach

Follow the design's phase order, which exists so that no phase leaves a state where INV-12
can be violated silently. Two deviations from the design document, both decided this
session:

1. **The AI contract still goes second**, but its live verification moves to Phase 7. The
   design put verification at Phase 2 to buy an early exit; you asked for a single measured
   pass after the epic. The risk this creates is recorded under Open Risks in the brief.
2. **No shims**, so phases 4 and 5 are effectively coupled — the popup is non-functional
   between Phase 2 and Phase 5, and verification in that window is through tests and direct
   API calls.

Phases 1 and 3 are **test-first** (`/10x-tdd` fits both). Phases 5 and 6 are covered by the
per-edit gate (`.claude/hooks/post-edit-check.mjs` → oxlint + scoped `vitest related`),
which excludes backend by design.

### Decisions taken this session

| # | Decision | Source |
| --- | --- | --- |
| A1 | Read reconstruction uses the **same strict path** as writes; the four offending rows are repaired in Phase 3 | user |
| A2 | The printed sheet **swaps `Language` for `Znaczenie`** — five columns, not six | user |
| A3 | **No version-skew shims**; the popup breaks between Phase 2 and Phase 5 | user |
| A4 | **One live-verification pass after the epic** (Phase 7), covering both AI surfaces | user |
| A5 | **IL-24 (cache-first / EN pivot) stays a separate change** after this one | user |
| A6 | Migration has a free hand with legacy data; a **seeded demo collection** replaces the old print fixtures | user |
| A7 | The migration carries a **frozen inline copy** of `senseKey`, not an import from `src` | plan |
| A8 | `DraftSense` → `SenseTranslation` **renamed in Phase 2**, which rewrites that file anyway | plan |
| A9 | Backfill returns **the whole updated entry**, not a partial shape the client merges | plan |
| A10 | Both entry-shaped routes gain **declared response schemas** (the in-scope slice of C-01) | plan |

## Critical Implementation Details

**Ownership must stay lexically inside each route handler.**
`backend/test/route-ownership.test.ts:67-72` greps each `:id` route's own source slice for
the literal `fetchOwnedCollection(` and each `:entryId` route's for `fetchOwnedEntry(`. The
repository takes the already-fetched collection/entry as an argument; it must not "clean
up" by fetching them itself. Both floors sit exactly at their minimum
(`MIN_EXPECTED_ID_ROUTES = 4`, `MIN_EXPECTED_ROUTES = 9`).

**Dropping `UNIQUE(entry_id, language_code)` drops an index three live paths depend on.**
`entry_translations` carries no other index led by `entry_id`. The migration must add
`INDEX entry_translations(entry_id)` explicitly, or the collection-detail read
(`index.ts:196-200`), the FR-018 conflict check (`:427-430`) and the `ON DELETE CASCADE`
sweep all lose their index in the same statement.

**`down()` is a one-way door.** It must re-add `UNIQUE(entry_id, language_code)`, which
fails the first time any entry has two senses sharing a target language — i.e. the first
real use of the feature. The rollback rehearsal is only meaningful against pre-refactor
data, so it happens in Phase 3 and never again.

**The assertions in `providerBoundary.test.ts` must stay green.** D-2's second tool schema
must live **inside the adapter**: `@anthropic-ai/sdk` is importable from exactly two files
(`:64-72`), the strings `claude-haiku` and `return_translation` appear nowhere outside the
adapter (`:77-80`), and the needles `['anthropicClient','toolUse','tool_use',
'TranslationResult']` must not appear under `src/routes/` or `src/plugins/` (`:85-91`). A
second tool *name* typed into any other backend file turns this red.

**Every new backend `src` file reading an augmented property needs its own forcing
import** — `import type { AuthUser as _AuthUser } from '../fastify.d.ts'`, path adjusted.
`lessons.md` records this hitting three times, most recently when renaming a plugin changed
the autoload sort order and a route that had not been touched started failing 9 of 127
tests non-deterministically. `entryRepository.ts` reads `fastify.sql`.

**Response-schema stripping is a new hazard on routes that have none.** `POST /:id/entries`
and `GET /:id` hand-build their payloads today with no schema, so nothing is stripped.
Declaring schemas for them means a field missing from the schema vanishes from the body
**silently rather than erroring**. Each needs a full-body deep-equal assertion, which is the
only shape of test that catches it.

---

## Phase 1: Domain core

### Overview

The pure aggregate: no Fastify, no SQL, no Anthropic. Everything here is testable under
`node --test` with no database, which is what makes this phase genuinely test-first.

### Changes Required:

#### 1. Error taxonomy

**File**: `backend/src/domain/errors.ts` (new)

**Intent**: One named error per rule, so nothing logs-and-continues and the HTTP mapping
has a closed set to switch over.

**Contract**: `DomainError extends Error` with a readonly `code`, plus `BlankTextError`,
`EmptyEntryError`, `LanguageNotTaughtError`, `DuplicateSenseError`,
`DuplicateSenseLanguageError`, `SenseWithoutTranslationError`,
`TranslationWithoutSentenceError`, `LanguageAlreadyPresentError`. Each carries the
identifying detail its HTTP message needs (field name, sense key, language code).

#### 2. Sense identity

**File**: `backend/src/domain/senseKey.ts` (new)

**Intent**: The system's identity rule for a meaning, replacing `sameMeaning`
(`extension/src/popup/App.tsx:36-38`) as the authority. Deliberately the same weak
comparison, kept for continuity and as the IL-24 seam.

**Contract**: `senseKey(glossText: string): string` returning
`glossText.trim().toLowerCase()`. Its doc comment must state that Phase 3's migration
carries a frozen copy, and why.

#### 3. Language contract value object

**File**: `backend/src/domain/languageContract.ts` (new)

**Intent**: Make INV-9 structural. An `Entry` cannot be constructed without one, so no code
path exists that saves a translation into a language the collection does not teach —
collapsing the membership checks currently hand-written at `index.ts:342-347` and `:423-425`.

**Contract**: `LanguageContract` holding `collectionId`, `nativeLanguageCode`,
`targetLanguageCodes: readonly string[]` (lowercased on construction), with
`teaches(languageCode): boolean`.

#### 4. Sense, SenseTranslation, Sentence

**File**: `backend/src/domain/sense.ts` (new)

**Intent**: The parts beneath the root. Two structural moves carry the invariant without a
runtime check: `Sentence` has **no `languageCode`** (its language is its translation's, so
a cross-wired sentence is unrepresentable rather than merely rejected), and
`SenseTranslation` carries no meaning of its own beyond a word (the meaning lives one level
up, once).

**Contract**: `Sense { id, glossText, senseKey, translations: SenseTranslation[] }`;
`SenseTranslation { id, languageCode, meaningText, phoneticTranscription, sentences:
Sentence[] }`; `Sentence { id, targetText, nativeGlossText }`.

Note: `DraftSense` in `translationDraft.ts` still means the *language-scoped* thing until
Phase 2 renames it. The two coexist under distinct names for one phase; add a comment at
the head of `sense.ts` naming the collision and pointing at Phase 2.

#### 5. The aggregate root

**File**: `backend/src/domain/entry.ts` (new)

**Intent**: The only guardian. Every precondition the route currently spreads across
`index.ts:250-347` becomes a constructor guard in one place.

**Contract**:

```ts
static capture (contract: LanguageContract, draft: EntryDraft): Entry
addLanguageToAllSenses (contract: LanguageContract, languageCode: string,
                        perSense: Map<SenseId, SenseTranslationDraft>): void
get sensesMissing (languageCode: string): Sense[]
toResponse (): EntryResponse
```

Precondition order is load-bearing (blank word → empty senses → per sense: blank gloss,
duplicate key, no translations → per translation: language taught, duplicate language,
blank meaning, no sentences → per sentence: blank halves). See the pseudocode at
`context/domain/02-invariant-aggregate-refactor.md:395-430`. Ids are generated here
(`randomUUID()`), not by column defaults — Phase 4 depends on that.

**This is a single strict path used for both writing and reading** (A1). There is no
lenient reconstruction; Phase 3 repairs the rows that would otherwise throw.

#### 6. Unit tests

**File**: `backend/test/domain/entry.test.ts` (new)

**Intent**: The specification of the invariant, written before the implementation.

**Contract**: covers design tests 1-3, 5 and 7-13 — two meanings each with two languages
each with its own sentence; three sentences under one translation; a sparse spoke; two
senses whose glosses differ only in case; and one test per named error. No database.

### Success Criteria:

#### Automated Verification:

- Backend suite passes: `cd backend && npm test`
- Type check passes: `cd backend && npm run build:ts`
- `backend/test/architecture/providerBoundary.test.ts` still green
- No file in `backend/src/domain/` reads an augmented property without its own forcing
  type-only import (none should need one this phase — verify rather than assume)

#### Manual Verification:

- Reading `entry.ts` top to bottom, each precondition maps to exactly one row of the
  design's §4.3 table and to one named error

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding.

---

## Phase 2: Invert the AI contract to meaning-first

### Overview

The tool schema stops asking for languages containing variants and starts asking for
meanings containing per-language translations. An entry-level sense cannot be assembled
from a language-first response — grouping after the fact would mean pairing across
languages by position, the exact failure the popup's own comment names as the thing the
nesting exists to prevent.

**The installed popup's translate flow breaks at the end of this phase and stays broken
until Phase 5** (A3).

### Changes Required:

#### 1. The tool schema

**File**: `backend/src/adapters/anthropicTranslator.ts`

**Intent**: Invert `:52-110` from `languages[].variants[]` to
`senses[].translations[].sentences[]`, so the model does the grouping once instead of
enumerating meanings independently inside each language.

**Contract**: `normalizedNativeText` plus `senses[] → { glossText, translations[] → {
languageCode, meaningText, phoneticTranscription, sentences[] → { targetText,
nativeGlossText } } }`. `glossText` is the meaning **in the collection's native language**.
The tool name stays `return_translation` — a second name would break
`providerBoundary.test.ts:77-80`.

**Also**: re-derive `max_tokens` at `:154`. The current `MAX_TOKENS_PER_LANGUAGE *
languages.length` no longer matches the output shape, and under-budgeting truncates
`tool_use` JSON mid-object — the failure mode named at `:22-23`. Budget on senses ×
languages, with the ceiling stated in a comment.

The comments at `:26-32` asserting the ~3-in-34 degenerate rate become false the moment the
schema inverts; mark them as measured against the previous schema and pending
re-measurement in Phase 7. Same for `translator.ts:51-53`.

#### 2. The draft value object

**File**: `backend/src/domain/translationDraft.ts`

**Intent**: Reshape to meaning-first, and resolve the name collision in the same edit since
these are the lines being rewritten anyway (A8).

**Contract**:

- Today's language-scoped `DraftSense` (`:18-22`) → **`DraftSenseTranslation`**
  `{ languageCode, meaningText, phoneticTranscription, sentences }`.
- A **new** entry-level `DraftSense { glossText, translations: DraftSenseTranslation[] }`.
- `DraftLanguage` (`:24-27`) disappears; `TranslationDraft` holds `senses: DraftSense[]`.
- `alignToRequested` (`:141-147`) becomes **`alignSenseTranslations`**: it aligns each
  sense's `translations[]` against the requested codes. A language the model skipped **for
  one sense** is a legitimate sparse spoke, not an error.
- `isDegenerate()` (`:155-157`) becomes "no senses at all"; `degenerateLanguageCodes()`
  becomes the set of requested languages absent from *every* sense.
- `renderingFor()` (`:172-185`) is superseded by Phase 4's D-2. Keep it until then so the
  backfill route keeps compiling, with a comment saying so.
- `toWire()` (`:190-205`) emits `senses[]`. The `variants` wire key dies with it.

#### 3. The wire schema

**File**: `backend/src/routes/api/collections/schemas.ts`

**Intent**: `translateResponseSchema` (`:47-60`) mirrors the new nesting so Fastify
serializes against it and `toWire()` stays compile-checked by it.

**Contract**: `{ normalizedNativeText, senses: [{ glossText, translations: [{ languageCode,
meaningText, phoneticTranscription, sentences: [{ targetText, nativeGlossText }] }] }] }`.
Update the comment at `:41-46`, which currently explains why the wire key stays `variants`
— that reasoning (an older side-loaded popup must keep parsing it) is exactly what A3
overrides. Say so at the line.

#### 4. The one route leak

**File**: `backend/src/routes/api/collections/index.ts:288`

**Intent**: `draft.languages.length` in a log field is the only language-first leak into a
route.

**Contract**: report sense and language counts derived from the new shape.

#### 5. Tests

**Files**: `backend/test/domain/translationDraft.test.ts` (rewritten — its header calls it
*"the specification of what the model may legally do to us"*, so it is the natural entry
point), `backend/test/adapters/anthropicTranslator.test.ts` (fixtures at `:33-55` inverted;
`:143-151` encodes the semantics sparse spokes change),
`backend/test/routes/api/translate.test.ts` (19 `variants` references; the deep-equal at
`:250-303` is the only shape that catches a silently-truncated response — keep it a
deep-equal).

**Contract**: design tests 22 and 23 — a response with a sense missing one requested
language leaves it absent rather than fabricated; a response with zero senses fires the
retry exactly once.

### Success Criteria:

#### Automated Verification:

- Backend suite passes: `cd backend && npm test`
- `backend/test/architecture/providerBoundary.test.ts` green — `src/ai` still absent, no
  provider needle under `src/routes/` or `src/plugins/`
- No occurrence of `variants` remains under `backend/src/`: `grep -rn "variants" backend/src/`
- Type check passes: `cd backend && npm run build:ts`

#### Manual Verification:

- `POST /api/collections/:id/translate` against `npm run dev` returns the nested `senses[]`
  shape — inspect the body directly, since the popup cannot render it from here on
- The `max_tokens` comment states the new budget derivation and its ceiling

---

## Phase 3: Schema migration

### Overview

Make the meaning a row and the pairings foreign keys. Test-first against
`backend/test/schema/core-schema.test.ts`, whose test at `:40-57` gets **inverted**: what it
currently proves is rejected is exactly what must now be accepted.

### Changes Required:

#### 1. Test fixtures first

**File**: `backend/test/helpers/fixtures.ts`

**Intent**: `sense_id NOT NULL` and `translation_id NOT NULL` invalidate every hand-written
INSERT in the suite — `core-schema.test.ts:47,53,66,70,88,92,117,129,133`,
`routes/api/collections.test.ts:240-252`, `routes/api/entries.test.ts:256`,
`routes/api/entry-translations.test.ts:50`. The helpers those tests need do not exist yet,
so they come first.

**Contract**: add `createSenseRow(app, entryId, glossText)`,
`createTranslationRow(app, entryId, senseId, languageCode, meaningText)` and
`createSentenceRow(app, entryId, translationId, sentenceText, nativeGlossText)`, following
the existing `createEntryRow` idiom (returns the new id; cleanup rides the `users` cascade).

#### 2. The migration

**File**: `backend/migrations/<timestamp>_add-entry-senses.ts` (new, via `npm run migrate:create`)

**Intent**: Create the meaning as a first-class row, tie words and sentences to it, and move
the uniqueness rule down one level.

**Contract**:

```
CREATE TABLE entry_senses (
  id uuid PK, entry_id uuid NOT NULL REFERENCES entries ON DELETE CASCADE,
  gloss_text text NOT NULL, sense_key text NOT NULL,
  UNIQUE (entry_id, sense_key), INDEX (entry_id))

entry_translations  + sense_id uuid NOT NULL REFERENCES entry_senses ON DELETE CASCADE
                    − UNIQUE (entry_id, language_code)
                    + UNIQUE (sense_id, language_code)
                    + INDEX (entry_id)          -- see Critical Implementation Details
entry_sentences     + translation_id uuid NOT NULL REFERENCES entry_translations ON DELETE CASCADE
                    + INDEX (translation_id)
                    -- language_code KEPT, stops being read; dropped in Phase 7
```

Order within `up()`: add columns nullable → backfill → `SET NOT NULL` → swap constraints.
`down()` reverses it and re-adds `UNIQUE(entry_id, language_code)`.

#### 3. The backfill

**File**: same migration

**Intent**: Every existing entry has exactly one meaning — that is what
`UNIQUE(entry_id, language_code)` guaranteed — so create **one** `entry_senses` row per
entry (not one per entry-language) and attach every existing translation to it. `gloss_text`
is the entry's own `word_or_phrase`: with a single meaning the native word *is* the meaning,
and INV-7 guarantees it is already in the native language.

**Contract**: a TypeScript loop over rows via `pgm.db.query`, carrying a **frozen inline
copy** of the normalization rather than importing `senseKey` from `src` (A7):

```ts
// Frozen copy of senseKey() as of this migration. Deliberately NOT imported from
// src/domain/senseKey.ts: a migration must keep producing what it produced the day
// it ran, and IL-24 will redefine that function.
const senseKeyAtMigrationTime = (gloss: string): string => gloss.trim().toLowerCase()
```

Sentences get their `translation_id` by joining on `(entry_id, lower(language_code))` —
`lower()` because legacy rows hold `PL`/`EN`. Phase 0 measured **zero** ambiguous matches,
so this join is unambiguous on today's data.

#### 4. Repair the rows the aggregate rejects

**File**: same migration

**Intent**: Phase 0 found four rows that satisfy today's schema but violate the new
constructor invariants, plus one orphan sentence. With a single strict construction path
(A1), these would throw on a plain `GET`. Repair the data; do not weaken the model.

**Contract**: delete the orphan sentence (`jedzenie`/`pl` in *"Nested contents test"*);
delete translations that have no sentence (`pies`/`en`, `jedzenie`/`ru`); delete sentences
whose `native_gloss_text IS NULL` (`jedzenie`/`en`, `/pl`). Each `DELETE` is written as a
predicate over the condition, not over specific ids, so it is a no-op where the data is
already clean — the same migration has to run against environments that were never probed.
Log the affected row counts.

#### 5. Seed a demo collection

**File**: `context/changes/invariant-aggregate-refactor/seed-demo.mjs` (new; a change-local
script, not shipped in `backend/`)

**Intent**: You asked for one good fixture collection that exercises every feature (A6).
The old print fixtures are single-meaning by construction and cannot exercise the new shape.

**Contract**: a standalone script (same `.env` parsing idiom as `phase0-probe.mjs`) creating
one `pl → en,de,fr,es,ru` collection holding: `zamek` with three meanings; a long-word entry
whose translation overflows its column (the `independence /ˌɪndɪˈpendəns/` case recorded at
`PrintDocument.tsx:168-173` measured 203.9px against a 118.9px column); an entry with a
deliberately long sentence and long native gloss; and a sparse spoke (a meaning present in
one language only). Idempotent — safe to re-run.

#### 6. Schema tests

**File**: `backend/test/schema/core-schema.test.ts`

**Contract**: design tests 16-21. `:40-57` inverts — a second **distinct meaning** for the
same `(entry_id, language_code)` is **accepted** (this is the test that proves `zamek` can
keep both *castle* and *lock*), while a second word inside **one meaning's** language is
rejected. Add: `translation_id` null/dangling rejected; `sense_id` null/dangling rejected;
duplicate `(entry_id, sense_key)` rejected; deleting an `entry_senses` row cascades its
translations and their sentences. The existing cascade test at `:123-146` keeps passing but
stops being complete — `entry_sentences.translation_id … ON DELETE CASCADE` is a second,
untested path.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `cd backend && npm run migrate:up`
- Backend suite passes: `cd backend && npm test`
- Type check passes: `cd backend && npm run build:ts`
- No `sense_id IS NULL` or `translation_id IS NULL` rows remain after `up()`

#### Manual Verification:

- **Rollback rehearsal**: `npm run migrate:down` one step against pre-refactor data, then
  `up()` again. This is the only moment it can be rehearsed — `down()` re-adds
  `UNIQUE(entry_id, language_code)` and fails permanently once any entry has two senses in
  one language
- `seed-demo.mjs` produces a collection with a three-meaning `zamek`, a long-word entry, a
  long-sentence entry and a sparse spoke
- The repair `DELETE`s report the counts Phase 0 predicted (1 orphan, 2 sentence-less
  translations, 2 null-gloss sentences)

---

## Phase 4: Repository, error mapping, and both routes

### Overview

Wire the aggregate in. The route stops being the model: it fetches ownership, loads the
contract, hands the body to `Entry.capture`, persists through the repository, and maps
domain errors to HTTP in one place.

### Changes Required:

#### 1. The repository

**File**: `backend/src/repositories/entryRepository.ts` (new)

**Intent**: The only place SQL knows about the aggregate. One transaction per write, three
levels deep, using app-side ids so the Neon HTTP driver's non-interactive transaction can
carry parent references without a `RETURNING` value feeding the next statement.

**Contract**: `loadContract(sql, collection)`, `loadEntry(sql, entryId, collectionId)`,
`loadEntries(sql, collectionId)`, `insert(sql, entry)`, `appendLanguage(sql, entry,
languageCode)`. Reconstruction goes through the **same** `Entry` construction path as
writes (A1) — Phase 3 guarantees the data satisfies it.

`insert` builds its statement array parent-first so every FK is satisfied inside the
transaction: the entry, then per sense its `entry_senses` row, then per translation its
`entry_translations` row carrying `sense_id`, then per sentence its `entry_sentences` row
carrying `translation_id`. `entry_id` stays on both lower tables alongside the parent
reference — redundant, but it keeps the cascade and the per-entry read one hop.

**Needs its own forcing type-only import** for `fastify.sql`.

#### 2. Domain → HTTP mapping

**File**: `backend/src/routes/api/collections/mapDomainError.ts` (new)

**Intent**: The single translation site from the error taxonomy to status codes; anything
unrecognized rethrows so `error-handler.ts:54-93` logs it with the correlation id.

**Contract**: 400 for `BlankTextError`, `EmptyEntryError`, `SenseWithoutTranslationError`,
`TranslationWithoutSentenceError` and `LanguageNotTaughtError` (reusing the existing wording
at `index.ts:346`); 409 for `DuplicateSenseError`, `DuplicateSenseLanguageError` and
`LanguageAlreadyPresentError` (existing wording at `index.ts:432`). Bodies come from
`@fastify/sensible`, so no client parsing an error body has to change.

#### 3. Request and response schemas

**File**: `backend/src/routes/api/collections/schemas.ts`

**Intent**: `createEntryBodySchema` (`:96-114`) becomes `senses[]`, and both entry-shaped
routes gain declared response schemas — the in-scope slice of C-01 that `research.md` §3.5
identifies (the ACL established the pattern on two routes; this extends it to the two that
still hand-build payloads) (A10).

**Contract**: body `{ wordOrPhrase, senses: [{ glossText, translations: [{ languageCode,
meaningText, phoneticTranscription, sentences: [{ sentenceText, nativeGlossText }] }] }] }`.
`MAX_TARGET_LANGUAGES` now bounds **a sense's** translations, not the entry's arrays. Add
`entryResponseSchema` (the nested entry) and `collectionDetailResponseSchema`; delete
`addEntryTranslationResponseSchema` (`:68-83`), which returns exactly one translation and
one sentence and is flatly incompatible with D-2. The `:63-67` stripping warning applies to
both new schemas.

#### 4. The capture route

**File**: `backend/src/routes/api/collections/index.ts`

**Intent**: Replace `:250-395` — the blank guards, the duplicate guard, the membership
check, the id generation and the two INSERT loops — with the aggregate.

**Contract**: fetch ownership (**the literal `fetchOwnedCollection(` stays in the handler
body**), load the contract, `Entry.capture(contract, toDraft(request.body))`,
`insert(fastify.sql, entry)`, `201` with `entry.toResponse()`, wrapped so `mapDomainError`
handles the throw. Delete the false comment at `:322-323` — the constraint is real now.

#### 5. The read model

**File**: `backend/src/routes/api/collections/index.ts:196-235`

**Intent**: `GET /:id` returns nested senses instead of two sibling arrays.

**Contract**: `loadEntries(sql, collectionId)` → `entries.map(e => e.toResponse())`,
serialized against the new declared response schema.

#### 6. Backfill: D-2's second tool schema

**Files**: `backend/src/adapters/anthropicTranslator.ts`,
`backend/src/domain/translator.ts`, `backend/src/routes/api/collections/index.ts:398-479`

**Intent**: Retire *"take the model's first one and its first sentence"* (`:439-442`).
Adding a language translates **every meaning the entry already has**, one word per meaning
— which is what makes both paths answer "how many meanings does an entry keep?" the same
way.

**Contract**: a second port method (`translateSense` or similar) taking a known `glossText`
plus one language code and returning one word with its phonetic and sentences. Its tool
schema lives **inside the adapter** and keeps the tool name `return_translation`
(`providerBoundary.test.ts:77-80`). The route calls it once per sense —
`entry.sensesMissing(languageCode)` — then `appendLanguage`, and returns **the whole updated
entry** (A9) rather than a partial shape the client merges by hand.
`LanguageAlreadyPresentError` replaces the ad-hoc query at `:427-430`.
`TranslationDraft.renderingFor()` is deleted here.

#### 7. Client shape copies

**File**: `frontend/src/api/collections.ts:47-51`

**Intent**: The backfill response shape is hand-copied there and changes to the entry shape.

**Contract**: `addEntryTranslation` returns the nested entry. Full rendering of nested
senses is Phase 6; this is the minimum to keep the build green.

#### 8. Route tests

**Files**: `backend/test/routes/api/entries.test.ts`,
`backend/test/routes/api/entry-translations.test.ts`,
`backend/test/routes/api/collections.test.ts`

**Contract**: design tests 1-15 and 28 at the HTTP level — the round trip (POST then GET
returns the same grouping), the sparse spoke, partial-failure atomicity (a payload whose
*last* sentence is blank leaves no rows behind), one test per named error with its status
code, and backfill adding `fr` to a two-meaning entry producing **two** French translations.
Both new response schemas get a full-body deep-equal.

### Success Criteria:

#### Automated Verification:

- Backend suite passes: `cd backend && npm test`
- Type check passes: `cd backend && npm run build:ts`
- `backend/test/route-ownership.test.ts` green — the lexical check still finds its literals
  in each route's own slice
- `backend/test/route-reachability.test.ts` green with no `api-construct.ts` change
- `backend/test/architecture/providerBoundary.test.ts` green with the second tool schema
  inside the adapter
- `entryRepository.ts` carries its own forcing type-only import

#### Manual Verification:

- Against `npm run dev`: POST a two-meaning `zamek`, GET the collection, confirm both
  meanings come back with their own words and sentences
- POST a payload whose last sentence is blank; confirm 400 and that no partial entry exists
  in the database
- Backfill `fr` onto the seeded two-meaning entry and confirm two French translations land

---

## Phase 5: Extension — meanings first (D-3)

### Overview

The popup asks which meanings to keep, then one sentence per (meaning, language). The
translate flow starts working again at the end of this phase.

### Changes Required:

#### 1. Types and message contract

**Files**: `extension/src/types.ts:14-36`, `extension/src/messages.ts:7-11`

**Intent**: Mirror the server's nesting. Per this repo's convention the copy is
hand-maintained and points at its source.

**Contract**: `TranslationSense { glossText, translations: SenseTranslation[] }`;
`SenseTranslation { languageCode, meaningText, phoneticTranscription, sentences }`.
`SavedEntry` unchanged. In `messages.ts`, `maxItems: MAX_TARGET_LANGUAGES` moves from the
two flat arrays onto **a sense's** translations.

#### 2. Selection state

**File**: `extension/src/popup/App.tsx:26-30,85-90,98,202-213`

**Intent**: `selections` is `Record<languageCode, Selection>` and its "open on the first
variant" default directly contradicts "ask which meanings to keep".

**Contract**: a checked-meaning set keyed by `senseKey`, plus sentence picks keyed by
`(senseKey, languageCode)`. `sameMeaning` (`:36-38`) is replaced by a local copy of
`senseKey()` over the **native gloss**. Unchecking a meaning drops its sentence picks — the
same rule `selectVariant` (`:202-206`) already applies when a variant changes, and for the
same reason.

#### 3. Radio groups and speak keys — the unbuildable-as-drawn part

**File**: `extension/src/popup/App.tsx:495,508,519,547,558`

**Intent**: Radio group names are per-language today (`variant-${languageCode}`,
`sentence-${languageCode}`). With two meanings showing sentence lists in the same language,
one group makes them mutually exclusive — the user could not pick a sentence for both
meanings.

**Contract**: group names keyed per `(senseKey, languageCode)`. `SpeakButton` keys at
`:519`/`:558` currently collide across meanings (`${languageCode}:variant:${index}`) — they
gain the sense key too, and the error filter at `:495` must match the new key shape.

#### 4. Save gate and payload

**File**: `extension/src/popup/App.tsx:337-377`

**Intent**: `readyToSave` restates as: at least one meaning is checked, and every checked
meaning has a sentence chosen in each language it carries a word for. A meaning the model
returned no word for in some language is a sparse spoke and must **not** block save.

**Contract**: `picks` becomes `senses[]` built straight from the checked meanings — the
pairing that exists correctly at `:346` now survives to the wire instead of being split into
two arrays at `:367-376`.

#### 5. Regeneration

**File**: `extension/src/popup/App.tsx:256-262,275-282,528-540`

**Intent**: `handleRegenerate` is per-language and gated on the single selected variant;
with several meanings checked, "the variant the user is looking at" has no referent.

**Contract**: regenerate per (meaning, language), re-pairing by `senseKey` — a sense is now
findable across languages, which is what the entry-level model buys. Preserve the existing
fail-fast when no matching sense comes back (`:283-296`, the sole client-side fail-fast site
anywhere).

#### 6. User-facing counts

**File**: `extension/src/popup/App.tsx:379,571-573`

**Contract**: strings count meanings, not languages.
`extension/test/popup/App.test.tsx:209` pins `'0 of 2 languages chosen'` verbatim and must
be updated with them.

#### 7. Tests

**File**: `extension/test/popup/App.test.tsx`

**Contract**: design test 25 — unchecking a meaning drops its sentence picks; `readyToSave`
is false while a checked meaning has a language whose sentence is unchosen; a checked
meaning with a sparse spoke does not block save. Existing tests at `:136`, `:144` (radio
semantics), `:151`, `:175-227` (the language-shaped save gate) and `:231-269` (**the pairing
test**) all change.

### Success Criteria:

#### Automated Verification:

- Extension tests pass: `cd extension && npm test`
- Lint passes: `cd extension && npm run lint`
- Build passes: `cd extension && npm run build`
- No radio `name` or `SpeakButton` key is keyed by language alone

#### Manual Verification:

- Load `dist/manifest.json` via `about:debugging`, capture `zamek` into a `pl → en,de`
  collection, check two meanings, pick a sentence for each in each language, save
- With two meanings checked, picking a sentence under one meaning does **not** clear the
  pick under the other in the same language
- Confirm both meanings persisted (via `GET` — the frontend still renders flat until Phase 6)

---

## Phase 6: Frontend and print (D-1)

### Overview

The review page groups by meaning, and the printed sheet gains a `Znaczenie` column **in
place of** `Language` (A2). That keeps the sheet at five columns — so
`printCssGeometry.test.ts:79-83` (exactly five width declarations) stays green instead of
being fought — and frees the whole 19pp the Language column held, against the ~6.7pp
otherwise available and the 12-16pp needed.

### Changes Required:

#### 1. API shape

**File**: `frontend/src/api/collections.ts:11-37`

**Contract**: `EntrySense { id, glossText, translations: EntryTranslation[] }`, each
translation carrying its own `sentences[]`. `EntrySentence` loses `languageCode` (it is its
translation's). This shape is hand-copied in three more places —
`frontend/browser-tests/harness/fixtures.ts:12-38`, `frontend/e2e/printRoute.spec.ts:24-56`
and the test helpers — and all four move together.

#### 2. Collection detail

**File**: `frontend/src/pages/CollectionDetailPage.tsx:192,199-226`

**Intent**: Two flat lists rendered side by side with no pairing become meanings, each with
its per-language words and sentences.

**Contract**: gap detection at `:192` (`new Set(entry.translations.map(...))`) still works —
it is per *language*, and the set now draws from every sense's translations.

#### 3. Print rows

**File**: `frontend/src/pages/printRows.ts:25-28,51-78`

**Intent**: The `.find()`s at `:56-58` and `:59-61` return the first match, printing one of
N meanings with no signal anywhere. That behaviour is what this whole change exists to
remove.

**Contract**: `PrintRow` gains `glossText`; one row per (sense, language), ordered by sense
then by the collection's target-language order. `PrintBand` (`:25-28`) is `{ entry, rows }`
with no grouping information and **cannot express nesting** — it gains per-sense row counts
so `PrintDocument` can compute the inner `rowSpan`.

#### 4. Print document

**File**: `frontend/src/pages/PrintDocument.tsx:131-137,148-149,158-173`

**Contract**: the five `<th>` at `:133-137` become Word · **Znaczenie** · Translation ·
Sentence · Sentence (translated); `labels.language` is gone. The empty-band `colSpan` at
`:148-149` stays `4`. The word `<th>` keeps its `rowSpan` over the whole band, and a
**second, nested** `rowSpan` cell carries each gloss over its own languages. The language
name (`languageName(row.languageCode)`) leaves the row; the language code prefixes the
translation instead, as in the design's mockup (`EN castle`).

`print.css:186-199`'s left-border reasoning is written around the current single-`rowSpan`
band shape and is invalidated by nesting — `harness.spec.ts:91-129` is the test that catches
it.

#### 5. Labels

**File**: `frontend/src/pages/printLabels.ts:12-18,20-77`

**Contract**: `PrintLabels.language` → `PrintLabels.meaning`, across all 8 native languages.
`printLabels.test.ts:15`'s loop asserts the field for all 8 automatically, so it fails until
every row is written — which is the right failure.

#### 6. Column widths

**File**: `frontend/src/pages/print.css:240-244,250-263`

**Contract**: five widths still summing to exactly 100%
(`printCssGeometry.test.ts:165-172`), with columns 4+5 above 40% (`:174-181`). The 19pp
freed by dropping Language goes to the gloss column; Translation must stay above ~16.3% so
`independence` (94.0px) stays on one line (`columns.spec.ts:98-106`). The `.print-language`
`white-space: nowrap` rule and its comment go with the column.

#### 7. Browser tests

**Files**: `frontend/browser-tests/languageColumn.spec.ts` (deleted),
`harness.spec.ts:25-29,91-129`, `columns.spec.ts:42-107`

**Contract**: `languageColumn.spec.ts` (8 tests × 2 engines) is deleted with its subject.
`harness.spec.ts:25-29` expects the new header set; `:91-129` is rewritten for nested
`rowSpan`. Design test 27: five columns still fit A4 with no mid-word break, and a band
whose meanings span several rows still does not split across a page fold —
`printPagination.test.ts:79`'s "band taller than a page" path goes from theoretical to
routine.

Run these through `/10x-e2e`, per the project's E2E workflow.

### Success Criteria:

#### Automated Verification:

- Frontend tests pass: `cd frontend && npm test`
- Lint passes: `cd frontend && npm run lint`
- Build passes: `cd frontend && npm run build`
- `printCssGeometry.test.ts` green — still exactly five width declarations, summing to 100%,
  columns 4+5 above 40%
- Browser tests pass on both engines

#### Manual Verification:

- Print the seeded demo collection to PDF: `zamek`'s three meanings each own their rows, the
  word spans the whole band, no sheet spills onto an unexpected second page
- The long-word entry's translation does not break mid-word in either engine
- The sheet's furniture reads in the collection's native language, `Znaczenie` included

---

## Phase 7: Cleanup and live verification

### Overview

Drop what the refactor made dead, then discharge `lessons.md`'s real-API gate over both AI
surfaces in one measured pass — the timing you asked for (A4).

### Changes Required:

#### 1. Drop the dead column

**File**: `backend/migrations/<timestamp>_drop-sentence-language-code.ts` (new)

**Contract**: `entry_sentences.language_code` is dropped; it has been unread since Phase 4.
`down()` re-adds it nullable and backfills from the sentence's translation.

#### 2. Remove the false statements

**Files**: `backend/src/adapters/anthropicTranslator.ts:26-32`,
`backend/src/domain/translator.ts:51-53`

**Contract**: both comments assert the ~3-in-34 degenerate rate measured against the
language-first schema. Replace with the numbers this phase measures.

#### 3. Live verification — capture surface

**File**: `context/changes/invariant-aggregate-refactor/measure-capture.mjs` (new, modelled
on `context/changes/translation-pivot/measure-cost.mjs`)

**Intent**: `lessons.md` — a stubbed AI client cannot tell you the model's output is usable.
65 green tests once coexisted with a ~9% live failure rate on exactly this prompt. The
question this answers is whether the model groups meanings **well across languages**, which
no stub can.

**Contract**: ≥12 varied captures (ambiguous words, unambiguous words, a phrase, 1 target
language and 5) against the real API. Count *usable* results, not merely parseable ones.
Record failure rate, cost, latency and token headroom in `change.md`. Re-measure the
empty-result rate the retry's justification rests on, and decide on that number whether the
retry still pays for itself.

**Requires explicit authorization before running** — standing rule: no Anthropic calls
without it.

#### 4. Live verification — backfill surface

**File**: `context/changes/invariant-aggregate-refactor/measure-backfill.mjs` (new)

**Contract**: the same treatment for D-2's gloss + language → word schema, which is a
different prompt and therefore a different place the model can fail. It writes to the
database with nobody reviewing the result, so a bad roll lands silently. Same authorization
gate.

#### 5. Deliberate-break check

**Intent**: `lessons.md` — a gate verified only in the happy case has been shown to run
exactly once.

**Contract**: remove the `LanguageNotTaughtError` precondition from `Entry.capture` and
confirm the corresponding test **fails**; restore it. Repeat for
`TranslationWithoutSentenceError`. Record both in `change.md`.

#### 6. Register the load-bearing names

**File**: `context/changes/invariant-aggregate-refactor/change.md`

**Contract**: the design's §5.10 table, minus `toLegacyLanguageShape` (never built).
`docs/reference/contract-surfaces.md` does not exist in this repo, so `change.md` is the
home.

### Success Criteria:

#### Automated Verification:

- Full backend suite passes: `cd backend && npm test`
- Frontend and extension suites pass
- Final migration applies and reverses: `npm run migrate:up` / one step down / up
- No read of `entry_sentences.language_code` remains: `grep -rn "language_code" backend/src/`

#### Manual Verification:

- ≥12 live capture calls run; usable-result rate, cost, latency and token headroom recorded
  in `change.md`
- ≥12 live backfill calls run; same numbers recorded
- The retry's continued existence is justified by the re-measured rate, or it is removed
- Both deliberate-break checks confirmed failing, then restored
- End to end in the real apps: capture `zamek` with three meanings in the extension, see it
  in the frontend grouped by meaning, print it, backfill a sixth language onto it

---

## Testing Strategy

### Unit Tests:

- `Entry.capture` preconditions — one test per named error, plus the legal shapes
  (multi-meaning, multi-sentence, sparse spoke, case-differing glosses across entries)
- `senseKey` normalization, including that Phase 3's frozen copy agrees with it today
- `TranslationDraft` meaning-first parsing: a sense missing a requested language stays
  absent rather than fabricated; zero senses fires the retry once
- `printRows` grouping: a two-meaning entry produces rows grouped by sense, each carrying
  its `glossText`. **No existing test constructs a second meaning**, so this has nothing to
  grow from and is written fresh

### Integration Tests:

- HTTP round trip: POST a two-meaning entry, GET it back with identical grouping
- Partial-failure atomicity: a blank last sentence leaves no rows
- Backfill: `fr` onto a two-meaning entry writes two French translations; a language already
  covered is a 409
- Schema level: both FK chains reject null and dangling references; both unique constraints
  behave at their new level; cascades reach three levels
- Both new response schemas asserted with a full-body deep-equal — the only shape that
  catches a silently stripped field

### Manual Testing Steps:

1. Capture `zamek` in the extension into a `pl → en,de` collection; check two meanings; pick
   a sentence for each meaning in each language; save
2. Confirm in the frontend that both meanings appear, each with its own words and sentences
3. Print the seeded demo collection; confirm the `Znaczenie` column, nested row spans, no
   mid-word breaks and no unexpected page break
4. Backfill a new language onto the two-meaning entry; confirm two words arrive
5. Attempt a save with a checked meaning whose sentence is unchosen; confirm the gate holds
6. Run both live measurement scripts and record the numbers

## Performance Considerations

- Dropping `UNIQUE(entry_id, language_code)` removes the only index led by `entry_id` on
  `entry_translations`; the migration adds `INDEX(entry_id)` explicitly to keep the
  collection-detail read, the conflict check and the cascade sweep indexed.
- `max_tokens` must be re-derived for the meaning-first schema (N senses × M translations);
  under-budgeting truncates `tool_use` JSON mid-object rather than erroring.
- The read path goes from two flat queries to three; `loadEntries` keeps the one-round-trip
  shape by selecting all three levels with `entry_id = ANY(...)` and assembling in memory,
  as the route does today.
- D-2 issues **one model call per meaning** when backfilling a language. A three-meaning
  entry costs three calls. Transport policy (`PROVIDER_MAX_RETRIES = 1`,
  `PROVIDER_TIMEOUT_MS = 15_000`) sits under the route's `TRANSLATE_TIMEOUT_MS = 20_000`,
  which sits under API Gateway's 29s — sequential calls can exceed that. Run them
  concurrently or cap the per-request sense count, and state which in the code.

## Migration Notes

- Phase 0 is complete; its numbers are the dev branch only. **Re-run `phase0-probe.mjs`
  against any other environment before applying Phase 3 there.**
- The repair `DELETE`s must be no-ops on clean data — the migration has to run against
  environments that were never probed.
- `down()` is a one-way door: it re-adds `UNIQUE(entry_id, language_code)` and fails the
  first time an entry has two senses sharing a language. Rehearse it in Phase 3, once.
- The old print fixtures are single-meaning by construction; `seed-demo.mjs` replaces them
  with a collection that exercises multi-meaning, long words, long sentences and a sparse
  spoke.

## References

- Design: `context/domain/02-invariant-aggregate-refactor.md`
- Research (re-grounds the design at HEAD): `context/changes/invariant-aggregate-refactor/research.md`
- Phase 0 probe and numbers: `context/changes/invariant-aggregate-refactor/phase0-probe.mjs`, `research.md` §4
- Lineage: `context/domain/01-domain-distillation.md`, `context/domain/03-anti-corruption-layer.md`
- Prior art for the seam: `context/changes/translation-pivot/` (IL-24), `context/changes/refactor-opportunities/research.md` (C-01)
- Rules that bind: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 0: Read-only survey

#### Automated

- [x] 0.1 Row counts, orphan/ambiguous sentence probes, would-be uniqueness violations — run 2026-08-25, `research.md` §4

### Phase 1: Domain core

#### Automated

- [x] 1.1 Backend suite passes (`cd backend && npm test`) — 2683a9c
- [x] 1.2 Type check passes (`cd backend && npm run build:ts`) — 2683a9c
- [x] 1.3 `providerBoundary.test.ts` still green — 2683a9c
- [x] 1.4 Forcing type-only imports verified for any domain file reading an augmented property — 2683a9c

#### Manual

- [x] 1.5 Each `entry.ts` precondition maps to one design §4.3 row and one named error — 76a9d69

### Phase 2: Invert the AI contract to meaning-first

#### Automated

- [x] 2.1 Backend suite passes — 6805187
- [x] 2.2 `providerBoundary.test.ts` green (no `src/ai`, no provider needle in routes/plugins) — 6805187
- [x] 2.3 No `variants` remains under `backend/src/` — 6805187
- [x] 2.4 Type check passes — 6805187

#### Manual

- [x] 2.5 `POST /:id/translate` returns the nested `senses[]` shape against `npm run dev` — 76a9d69
- [x] 2.6 `max_tokens` comment states the new budget derivation and its ceiling — 76a9d69

### Phase 3: Schema migration

#### Automated

- [x] 3.1 Migration applies cleanly (`npm run migrate:up`) — 3f8590b
- [x] 3.2 Backend suite passes — 3f8590b
- [x] 3.3 Type check passes — 3f8590b
- [x] 3.4 No `sense_id IS NULL` / `translation_id IS NULL` rows remain after `up()` — 3f8590b

#### Manual

- [x] 3.5 Rollback rehearsal: one step down against pre-refactor data, then up again — 3f8590b
- [x] 3.6 `seed-demo.mjs` produces the multi-meaning / long-word / long-sentence / sparse-spoke collection — 3f8590b
- [x] 3.7 Repair `DELETE`s report the counts Phase 0 predicted — 3f8590b

### Phase 4: Repository, error mapping, and both routes

#### Automated

- [x] 4.1 Backend suite passes — 6a7f470
- [x] 4.2 Type check passes — 6a7f470
- [x] 4.3 `route-ownership.test.ts` green (lexical check finds its literals in each route slice) — 6a7f470
- [x] 4.4 `route-reachability.test.ts` green with no `api-construct.ts` change — 6a7f470
- [x] 4.5 `providerBoundary.test.ts` green with the second tool schema inside the adapter — 6a7f470
- [x] 4.6 `entryRepository.ts` carries its own forcing type-only import — 6a7f470

#### Manual

- [x] 4.7 POST a two-meaning `zamek`, GET it back with both meanings intact — 76a9d69
- [x] 4.8 Blank last sentence → 400 and no partial entry in the database — 76a9d69
- [x] 4.9 Backfill `fr` onto a two-meaning entry writes two French translations — 76a9d69

### Phase 5: Extension — meanings first (D-3)

#### Automated

- [x] 5.1 Extension tests pass — 71463b3
- [x] 5.2 Lint passes — 71463b3
- [x] 5.3 Build passes — 71463b3
- [x] 5.4 No radio `name` or `SpeakButton` key is keyed by language alone — 71463b3

#### Manual

- [x] 5.5 Capture `zamek`, check two meanings, pick sentences in each language, save — 76a9d69
- [x] 5.6 Picking a sentence under one meaning does not clear the other meaning's pick in the same language — 76a9d69
- [x] 5.7 Both meanings confirmed persisted via `GET` — 76a9d69

### Phase 6: Frontend and print (D-1)

#### Automated

- [x] 6.1 Frontend tests pass — 03caf71
- [x] 6.2 Lint passes — 03caf71
- [x] 6.3 Build passes — 03caf71
- [x] 6.4 `printCssGeometry.test.ts` green — five widths, sum 100%, columns 4+5 above 40% — 03caf71
- [x] 6.5 Browser tests pass on both engines — 03caf71

#### Manual

- [x] 6.6 Printed PDF: three meanings own their rows, word spans the band, no unexpected page break — 76a9d69
- [x] 6.7 Long-word translation does not break mid-word in either engine — 76a9d69
- [x] 6.8 Sheet furniture reads in the native language, `Znaczenie` included — 76a9d69

### Phase 7: Cleanup and live verification

#### Automated

- [x] 7.1 Full backend suite passes — 76a9d69
- [x] 7.2 Frontend and extension suites pass — 76a9d69
- [x] 7.3 Final migration applies and reverses — 76a9d69
- [x] 7.4 No read of `entry_sentences.language_code` remains under `backend/src/` — 76a9d69

#### Manual

- [x] 7.5 ≥12 live capture calls run; rate, cost, latency, token headroom recorded in `change.md` — 76a9d69
- [x] 7.6 ≥12 live backfill calls run; same numbers recorded — 76a9d69
- [x] 7.7 Retry justified by the re-measured rate, or removed — 76a9d69
- [x] 7.8 Both deliberate-break checks confirmed failing, then restored — 76a9d69
- [x] 7.9 End-to-end pass across extension, frontend, print and backfill — 76a9d69
