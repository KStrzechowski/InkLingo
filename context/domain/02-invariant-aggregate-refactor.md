---
title: "InkLingo — the invariant guard: an Entry aggregate for sense integrity"
created: 2026-08-23
type: refactor-plan
author: KStrzechowski
git_commit: f6e3aab
sources:
  - context/foundation/prd.md
  - context/foundation/roadmap.md
  - context/foundation/lessons.md
  - context/domain/01-domain-distillation.md
  - context/changes/translation-pivot/{change,decision-brief}.md
  - context/changes/refactor-opportunities/research.md
  - backend/migrations/, backend/src/, extension/src/, frontend/src/
method: discovery → identification → classification → diagnosis → design (steps 0–5)
scope: PLAN ONLY — no production code was modified while writing this
---

# The invariant guard: an Entry aggregate for sense integrity

This is a **refactor plan**, not an implementation. Every `file:line` below was
opened and read at commit `f6e3aab`. Where the record is silent, this document
says so rather than filling the gap.

It follows `context/domain/01-domain-distillation.md`, which mapped the domain
and stopped deliberately at naming aggregate *candidates*. This one picks a
single invariant, proves how weakly it is held today, and designs the aggregate
that becomes its only guardian.

---

## 0. Context discovered

### 0.1 Requirement documents

`context/foundation/prd.md` (142 lines) is the authority: vision (`:20-22`),
success criteria (`:30-38`), US-01 (`:42-53`), FR-001…FR-018 (`:55-105`),
`## Business Logic` (`:113-121`), access control (`:123-125`), non-goals
(`:127-136`), open questions (`:138-142`). `roadmap.md` carries the slice
history and the post-MVP board. `tech-stack.md` records the stack decision.
`lessons.md` carries nine recurring rules, four of which bind this plan (§ 5.8).

The PRD is written in Polish and the code in English, so every rule below
crosses a translation boundary. Quotations keep the original.

### 0.2 Stack, and the layers business logic lives in

Four independent npm projects, no shared package (`CLAUDE.md` § Project layout).
The backend is Fastify + TypeScript on Neon Postgres via the **HTTP** serverless
driver (`backend/src/plugins/neon.ts:12-16`), deployed behind an HTTP API whose
routes are hand-registered (`infra/lib/constructs/api-construct.ts:149-208`).

| Layer | File | Domain content it holds today |
| --- | --- | --- |
| Model contract | `backend/src/ai/translate.ts:49-107` | The richest domain shape in the repo: word → language → **sense** → sentence |
| Request contract | `backend/src/routes/api/collections/schemas.ts:44-62` | Two parallel flat arrays keyed by language |
| Application | `backend/src/routes/api/collections/index.ts` (439 lines) | **Every business rule that actually runs** |
| Ownership | `backend/src/routes/api/collections/ownership.ts:19-38` | The one rule that already has a single source of truth |
| Persistence | `backend/migrations/` (4 files) | The only place the model is *declared* |
| Capture UI | `extension/src/popup/App.tsx` (595 lines) | Sense identity, sense-preserving regeneration, save gating |
| Review / print UI | `frontend/src/pages/` | Gap detection, print projection |

There is **no domain layer and no service layer**. `find backend/src -type f`
returns 23 files; none is named for a domain concept except `ai/translate.ts`.
The route handler is the model.

---

## 1. Invariants identified

Rules that must always be true in this domain, pulled from the documents **and**
from the code. Status is read from source: **ENFORCED** = some code path rejects
a violation; **DECLARED** = written down, nothing checks; **IGNORED** = the model
cannot express it.

| # | Invariant | Source | Where it lives | Status |
| --- | --- | --- | --- | --- |
| INV-1 | A collection's name is unique per user, case-insensitively | `prd.md:66` | `1784819058952:6-9`; `index.ts:148-150` | ENFORCED (DB + 409) |
| INV-2 | A collection teaches 1–5 target languages | `prd.md:70` (FR-017) | `schemas.ts:11-14` | ENFORCED at the edge only — **no DB constraint** |
| INV-3 | The native language is never also a target language | *Implied* by `prd.md:92`; stated nowhere | `index.ts:124-126` | ENFORCED at creation |
| INV-4 | Target languages carry no duplicates | Code-only | `index.ts:121-123`; `1785419841325:20-22` | ENFORCED (code + DB) |
| INV-5 | Every language code is one of the eight supported | Code-only (`languages.ts:4`) | `index.ts:111-116` | ENFORCED on create |
| INV-6 | A collection's language contract is immutable after creation | **Contradicted** by `prd.md:100` | No update route exists (9 routes: 4 GET, 5 POST) | ENFORCED BY ACCIDENT |
| INV-7 | An entry's source language is always its collection's native language | `prd.md:46,117` | `index.ts:312-316` | ENFORCED, and stated at the line |
| INV-8 | The stored word is the **normalized base form in the native language** | `prd.md:46,117`; asked of the model at `translate.ts:56-59` | Applied at `App.tsx:244,374`; backend checks only non-blank ≤200 (`schemas.ts:45`, `index.ts:258-261`) | **DECLARED, NOT ENFORCED** |
| INV-9 | Every saved translation and sentence is in one of the collection's target languages | *Implied* by `prd.md:52,98` | `index.ts:299-304`, `:379-381`, `:385` — **three hand-written copies**, no DB constraint | ENFORCED, scattered |
| INV-10 | An entry holds at most one translation per target language | **Contradicts** `prd.md:82` | `1784584360698:52-54`; `index.ts:281-286` | ENFORCED — and it is the wrong rule |
| INV-11 | An entry holds at most one sentence per target language | Nowhere in any document | `index.ts:281-286` only; `1784584360698:68` is an **index, not a constraint** | HALF-ENFORCED; the comment at `index.ts:279-280` claims otherwise |
| **INV-12** | **Every example sentence belongs to exactly one sense** — never to a language in general | Structural in the AI contract (`translate.ts:26-30,87-98`); named as a correctness property at `App.tsx:283-287` | Nothing. `entry_sentences` keys on `(entry_id, language_code)` (`1784584360698:56-67`) with no reference to a translation | **IGNORED IN PERSISTENCE** |
| INV-13 | A sense is identified by its meaning, not by its position | `App.tsx:283-290` | `App.tsx:36-38` — `trim().toLowerCase()` string equality | ENFORCED IN ONE CLIENT ONLY |
| **INV-14** | **A word with several meanings keeps them all** | `prd.md:82` (FR-009, *"dla słów wieloznacznych"*) | Nowhere | **IGNORED** — measured at `roadmap.md:183`: *"`zamek` zapisany jest wyłącznie jako `lock`"* |
| INV-15 | A saved entry never disappears without an explicit user action | `prd.md:37` (guardrail) | No DELETE route exists anywhere | ENFORCED BY ABSENCE |
| INV-16 | Blank text is never saved and never reaches the AI | `prd.md:51` | `index.ts:225-228,258-261,273-278`; `schemas.ts:30` | ENFORCED |
| INV-17 | A user reaches only their own collections and entries | `prd.md:125` | `ownership.ts:19-38`, called at `index.ts:160,230,288,367,372`; statically checked by `backend/test/route-ownership.test.ts` | ENFORCED |
| INV-18 | IPA is produced for target languages only, never the native one | `prd.md:92` (FR-015) | Structural — `phonetic_transcription` hangs off `entry_translations` (`1785433311673:9-11`), which only ever holds target-language rows | ENFORCED structurally |

---

## 2. Classification, and the choice of #1

Three axes, as the brief requires: how **core** to the product's reason for
existing; how **smeared** across layers; how **enforced** in fact.

| # | (a) Core-ness | (b) Layers it lives in | (c) Enforcement | Net |
| --- | --- | --- | --- | --- |
| **INV-12 ∧ INV-14** | **Core.** FR-009 is the differentiator the vision names (`prd.md:22`) | **7** — tool schema, AI adapter, popup memory, save payload, route, DB, two read projections | **Unrepresentable.** The schema actively forbids it | **#1** |
| INV-8 | **Core.** It is what makes an entry addressable and printable | 3 — model, popup, DB | Declared only; any client may save any string | #2 |
| INV-9 | Core-adjacent; every downstream behaviour reads from it | 3 copies in one file | Enforced, but by hand, three times, with no DB backstop | #3 |
| INV-2 | Supporting | 1 | Edge only | #4 |
| INV-6 | Supporting; blocks a shipped must-have (FR-018) | 0 — enforced by a missing route | Needs a *product* decision before a model one | #5 |
| INV-1, 4, 5, 7, 16, 17, 18 | Supporting / Generic | 1–2 | Already enforced, most with a DB backstop | — |

### The pick

> **INV-12 ∧ INV-14 — sense integrity.**
> *A saved entry preserves every meaning the user chose, and every example
> sentence belongs to exactly one of those meanings.*

**Why this one and not INV-8.** INV-8 is core and enforced in the least
trustworthy layer, which is bad. INV-12/14 is worse in kind: it is not enforced
in the *wrong place*, it **cannot be expressed at all**. `UNIQUE(entry_id,
language_code)` (`1784584360698:52-54`) does not merely fail to protect FR-009 —
it forbids it. The product generates several meanings correctly
(`translate.ts:71-77`: *"The distinct meanings of the word in this target
language"*), displays them correctly, guards their identity correctly in the
popup (`App.tsx:283-290`), and then throws all but one away at the save
boundary. On the axis the brief asks for — most core **and** least enforced —
nothing else in the table is close.

**Why it is also the most dangerous thing to leave alone.** INV-12 holds today
*only as a side effect* of INV-10. `entry_sentences` links a sentence to
`(entry_id, language_code)`; with exactly one sense per language, "the sentence
for this language" and "the sentence for this sense" happen to name the same
row. **Anyone who relaxes the uniqueness constraint to satisfy FR-009 without
first giving sentences a sense reference silently cross-wires meanings and
sentences**, and no layer in the system would detect it — the popup's own
comment names that exact failure as the thing the AI contract's nesting exists
to prevent (`App.tsx:285-287`). That trap is already on the board as IL-41
(`roadmap.md:179,183`), whose stated scope is *"wiele znaczeń i wiele zdań na
wpis"*. It is why this plan fixes the **pairing** before, or at the same time
as, the **cardinality** — never after.

**What comes along for free.** INV-8 and INV-9 are *preconditions of the same
save operation*. Once an aggregate owns that operation they become constructor
guards on the same object rather than three more hand-written `if`s, so they get
an enforcement site without needing an aggregate of their own. Stated here so
§ 4 does not read as scope creep.

---

## 3. Diagnosis — where the rule lives today

### 3.1 The rule's full itinerary

Follow one capture of the Polish word `zamek` into a `pl → en` collection.

| Step | Site | What happens to the sense↔sentence link |
| --- | --- | --- |
| 1 | `translate.ts:60-104` | **Correct and explicit.** `languages[].variants[].sentences[]` — sentences are *nested inside* a variant, and the schema calls variants *"The distinct meanings of the word"* (`:77`) |
| 2 | `translate.ts:113-120` | Preserved. `alignToRequested` rebuilds the language list against what was asked for; the nesting is untouched |
| 3 | `index.ts:241-249` | Preserved. The route returns the model's shape verbatim |
| 4 | `App.tsx:244-245` | Preserved in popup memory (`Capture.languages`, `:15-24`) |
| 5 | `App.tsx:202-206` | **Guarded.** Switching variant drops the sentence pick *"rather than carrying an index into a different list"* |
| 6 | `App.tsx:283-290` | **Guarded.** Regeneration re-finds the sense by `sameMeaning` (`:36-38`), *"never by position"* |
| 7 | `App.tsx:346-357` | **Still intact.** `picks` is a list of `{ languageCode, variant, sentence }` — the pairing exists, correctly, at `:355` |
| 8 | `App.tsx:375-384` | **DESTROYED.** The very next expression maps `picks` into two sibling arrays — `translations.map(...)` and `sentences.map(...)` — joined only by `languageCode` |
| 9 | `schemas.ts:44-62` | The wire contract has no way to express it: `translations[]` and `sentences[]` are independent arrays |
| 10 | `index.ts:311-329` | Two independent `INSERT` loops. Correct as a transaction, blind as a model |
| 11 | `1784584360698:56-67` | `entry_sentences(entry_id, language_code, sentence_text, …)` — **no `translation_id`** |
| 12 | `index.ts:197-213` | Read back as two sibling arrays again |
| 13 | `printRows.ts:56-61` | `.find()` per language — with N senses it prints **one of N, silently** |
| 14 | `CollectionDetailPage.tsx:199-226` | Two flat lists rendered side by side; no pairing attempted at all |

The pattern § 4 of `01-domain-distillation.md` named holds precisely: the
structure is right at the model boundary and is flattened one step at a time on
the way to storage. **Step 8 is where the loss actually happens** — the save
payload, not the database. The database merely has no way to record what the
payload no longer carries.

### 3.2 Which layers do not enforce it

- **Persistence** — no `translation_id` on `entry_sentences`
  (`1784584360698:56-67`), so the relation is unrepresentable. Worse, the only
  thing keeping duplicate *sentences* out is the route guard at
  `index.ts:281-286`: `1784584360698:68` creates an **index**, not a constraint.
  The comment at `index.ts:279-280` — *"the duplicate hits UNIQUE(entry_id,
  language_code)"* — is true for translations and **false for sentences**. A
  second writer would find nothing in its way.
- **Request contract** — `createEntryBodySchema` (`schemas.ts:44-62`) cannot
  express a sentence's sense. Its own comment (`:42-43`) states the assumption
  as a fact: *"One translation + one sentence per target language"*.
- **Route handler** — validates blankness (`:273-278`), per-language duplicates
  (`:281-286`) and language membership (`:299-304`), and never asks which
  meaning a sentence illustrates, because nothing in its input says.
- **Read model** — `index.ts:197-213` re-emits the flat pair.

### 3.3 Where the client is the only guardian

`extension/src/popup/App.tsx` holds three rules with **no server-side
counterpart**:

- `sameMeaning` (`:36-38`) — sense identity, a `trim().toLowerCase()` string
  comparison. This is the de-facto primary key of a sense in the whole system.
- `selectVariant` (`:202-206`) — switching sense drops the sentence pick.
- `readyToSave` (`:345-358`) — every language that produced variants must be
  fully picked before save.

A payload assembled by anything other than this popup is bound by none of them.

### 3.4 Where the same question gets two answers

FR-011 (`prd.md:86`) says the user chooses the sentence. The backfill route
chooses by array position, and says so:

> `index.ts:396-397` — *"Unlike the capture flow there's no user picking a
> variant here, so take the model's first one and its first sentence."*

Consistent with FR-018's own wording, but it means the domain's answer to *"how
many meanings does a saved entry keep?"* is **one** on both paths for two
entirely unrelated reasons — a schema constraint on the capture path, a `[0]` on
the backfill path.

### 3.5 Where a violation is swallowed rather than stopping the operation

- `printRows.ts:56-61` — `.find()` returns the first match. With several senses
  the sheet prints one and drops the rest **with no signal anywhere**.
- `CollectionDetailPage.tsx:192` — `new Set(entry.translations.map(...))` for
  gap detection; duplicates vanish into the set.
- `App.tsx:291-303` — regeneration that finds no matching sense *does* report
  (`DegradedAiResult`) and *does* stop. It is the one fail-fast site in the
  whole flow, and it is client-side.

Nothing in the backend can currently observe an INV-12 violation, because a
violation is not expressible in its input.

---

## 4. The guardian aggregate

### 4.0 The level the sense belongs at

A first pass at this design put the sense **under the language** — one `Sense`
per `(entry, targetLanguage)`, keyed on its target-language word. That is wrong,
and it is worth recording why, because it is the shape the existing AI contract
pushes you into.

`translate.ts:60-77` is language-first: `languages[].variants[]`. Senses are
enumerated **independently inside each language**, and nothing in the response
says that the English `castle` variant and the German `Schloss` variant are the
same meaning of `zamek`. `alignToRequested` (`:113-120`) aligns *languages*.
`Selection` (`App.tsx:26-30`) is *"One pick per target language"*. Follow that
grain and a `pl → en,de,fr` entry for `zamek` becomes **nine unrelated senses**,
with no record that castle / Schloss / château are one meaning and lock /
Schloss / serrure another.

That fails the requirement it claims to serve. FR-009 (`prd.md:82`) is about the
word being *wieloznaczny* — having several meanings. A meaning is a property of
the word, not of the target language; the target language only supplies a *word
for* that meaning. So:

> **The sense is entry-level. Languages hang off it.**
> The mapping unit is the meaning, never the word text.

This also fixes something the first pass got wrong about `UNIQUE(entry_id,
language_code)` (`1784584360698:52-54`). That constraint is not a bad rule — it
is a **correct rule attached one level too high**. "At most one word per
language" is right *per meaning*, and wrong *per entry*. It is not deleted
below; it moves down to `UNIQUE(sense_id, language_code)`.

### 4.1 Boundary decision

**`Entry` is its own aggregate root.** Its parts are `Sense`, beneath each sense
one `SenseTranslation` per target language, and beneath each translation its
`Sentence`s. `Collection` stays a separate root, referenced by identity.

Rejected alternative: making `Collection` the root with entries as parts. It
would put INV-9 inside one boundary, but every single-entry save would then have
to load every entry in the collection. The trade-off § 5 of
`01-domain-distillation.md` deliberately left open is settled here, on that
ground.

INV-9 therefore spans two aggregates. It is enforced by making the collection's
language contract a **required constructor input** — an `Entry` cannot be
constructed without one, so no code path exists that saves a translation into a
language the collection does not teach.

```
Entry (aggregate root)                     backend/src/domain/entry.ts
├─ id, collectionId
├─ wordOrPhrase          ← normalized native base form (INV-8)
├─ sourceLanguageCode    ← always the contract's native language (INV-7)
└─ senses: Sense[]                         backend/src/domain/sense.ts
   ├─ id
   ├─ glossText          ← THE MEANING, written in the collection's NATIVE language
   ├─ senseKey           ← normalize(glossText); unique within the entry
   └─ translations: SenseTranslation[]     ← at most one per target language
      ├─ languageCode, meaningText, phoneticTranscription
      └─ sentences: Sentence[]             (targetText, nativeGlossText)  ← no languageCode

LanguageContract (value object)            backend/src/domain/languageContract.ts
└─ collectionId, nativeLanguageCode, targetLanguageCodes[]
```

Two structural moves carry the invariant, and neither is a runtime check:

1. **`Sentence` has no `languageCode`.** Its language is its translation's. An
   orphaned or cross-wired sentence becomes *unrepresentable in the type system*
   rather than merely rejected — the bug class INV-12 protects against turns
   into a compile error.
2. **`SenseTranslation` has no `meaning` of its own beyond a word.** The meaning
   lives one level up, once, so there is exactly one place that can answer *"how
   many meanings does this entry have?"*

**Sparse spokes are legal.** A sense may have no translation in some target
language — `translation-pivot/change.md` § Known gaps already names this
(*"Some concepts have no single-word equivalent in a given language"*). What is
illegal is a sense with **no** translations at all, and a translation with no
sentences.

### 4.2 Sense identity — the meaning, not the word

`senseKey = glossText.trim().toLowerCase()`, unique within an entry.

`glossText` is the meaning written **in the collection's native language** — for
`zamek` in a `pl → en,de` collection: *"budowla obronna"*, *"urządzenie do
zamykania"*, *"suwak"*. Three reasons it is the native language and not a target
one:

- It is the only language guaranteed to exist for every collection, and the only
  one the learner is certain to read. The PRD already leans on exactly this: every
  example sentence is paired with a native gloss *"tak by zdanie było zrozumiałe
  niezależnie od poziomu zaawansowania"* (`prd.md:119`, FR-010). Extending the
  same device from the sentence to the sense uses vocabulary the domain already
  has.
- Keying on a target-language word would re-introduce the bug § 4.0 describes:
  with five target languages there would be five candidate keys and no reason to
  prefer one.
- It survives a language being added to the collection (FR-018 / INV-6), because
  it does not mention any target language.

This replaces `sameMeaning` (`App.tsx:36-38`) as the system's identity rule, and
is the same weak `trim().toLowerCase()` comparison — chosen for continuity, not
because it is right. It is the **named seam** where IL-24 plugs in: the pivot
keys concepts on an Interlingual Index (`translation-pivot/change.md`
§ Decisions: *"Concept identity: Open English WordNet, keyed on the ILI"*), and
`entry_senses` is precisely the per-entry projection of what becomes a global
`concepts` row. See § 5.5.

### 4.3 Domain methods and their preconditions

Named errors, one per rule, all extending `DomainError`. **Nothing here logs and
continues.**

```ts
// backend/src/domain/errors.ts
export class DomainError extends Error { readonly code: string }
export class BlankTextError               extends DomainError {}  // INV-16
export class EmptyEntryError              extends DomainError {}  // ≥1 sense
export class LanguageNotTaughtError       extends DomainError {}  // INV-9
export class DuplicateSenseError          extends DomainError {}  // INV-13/14
export class DuplicateSenseLanguageError  extends DomainError {}  // INV-10, relocated
export class SenseWithoutTranslationError extends DomainError {}  // ≥1 language
export class TranslationWithoutSentenceError extends DomainError {}  // INV-12
export class LanguageAlreadyPresentError  extends DomainError {}  // backfill

// backend/src/domain/entry.ts
export class Entry {
  static capture (contract: LanguageContract, draft: EntryDraft): Entry
  addLanguageToAllSenses (contract: LanguageContract, languageCode: string,
                          perSense: Map<SenseId, SenseTranslationDraft>): void
  get sensesMissing (languageCode: string): Sense[]
  toResponse (): EntryResponse
}
```

`Entry.capture` — pseudocode, preconditions first:

```
capture(contract, draft):
  word := draft.wordOrPhrase.trim()
  if word is empty          -> throw BlankTextError('wordOrPhrase')       # INV-16
  if draft.senses is empty  -> throw EmptyEntryError()

  entry := new Entry(uuid(), contract.collectionId, word,
                     contract.nativeLanguageCode)                         # INV-7, INV-8

  seenSenses := {}
  for each s in draft.senses:
     if s.glossText.trim() is empty  -> throw BlankTextError('glossText')
     key := senseKey(s.glossText)
     if key in seenSenses            -> throw DuplicateSenseError(key)    # INV-13/14
     seenSenses += key
     if s.translations is empty      -> throw SenseWithoutTranslationError(key)

     sense := Sense(uuid(), s.glossText.trim(), key)

     seenLanguages := {}
     for each tr in s.translations:
        code := tr.languageCode.trim().lowercase()
        if code not in contract.targetLanguageCodes                       # INV-9
           -> throw LanguageNotTaughtError(code)
        if code in seenLanguages
           -> throw DuplicateSenseLanguageError(key, code)                # INV-10, per sense
        seenLanguages += code
        if tr.meaningText.trim() is empty -> throw BlankTextError('meaningText')
        if tr.sentences is empty          -> throw TranslationWithoutSentenceError(key, code)  # INV-12

        t := SenseTranslation(uuid(), code, tr.meaningText.trim(),
                              trimOrNull(tr.phoneticTranscription))
        for each x in tr.sentences:
           if x.targetText.trim() empty or x.nativeGlossText.trim() empty
              -> throw BlankTextError('sentence')
           t.sentences += Sentence(uuid(), x.targetText.trim(),
                                   x.nativeGlossText.trim())              # INV-12 by construction
        sense.translations += t
     entry.senses += sense

  return entry
```

**Everything above is pure.** No Fastify, no SQL, no Anthropic — testable under
`node --test` with no database, which is what makes Phase 1 of § 5.3 genuinely
test-first.

### 4.4 Repository

```ts
// backend/src/repositories/entryRepository.ts
loadContract (sql, collection): Promise<LanguageContract>
loadEntry    (sql, entryId, collectionId): Promise<Entry | undefined>
loadEntries  (sql, collectionId): Promise<Entry[]>
insert       (sql, entry): Promise<void>              // ONE transaction
appendLanguage (sql, entry, languageCode): Promise<void>  // ONE transaction
```

Two constraints the design must respect, both already visible in the code:

1. **Ownership stays in `ownership.ts`.** `fetchOwnedCollection` /
   `fetchOwnedEntry` (`ownership.ts:19-38`) are already the single source of
   truth for INV-17, statically enforced by
   `backend/test/route-ownership.test.ts`. The repository calls them; it does not
   re-implement them.
2. **Ids are generated in the application, not by the column default.** The Neon
   HTTP driver runs only *non-interactive* transactions — an array of statements,
   with no value fed from one `RETURNING` into the next. The route already does
   this for `entryId` and says why (`index.ts:306-310`). The refactor extends the
   same trick down three levels, which is what makes `entry_translations.sense_id`
   and `entry_sentences.translation_id` fillable inside one round trip:

```
insert(sql, entry):
  statements := [ INSERT INTO entries (id, collection_id, word_or_phrase, source_language_code) ... ]
  for each sense in entry.senses:
     statements += INSERT INTO entry_senses (id, entry_id, gloss_text, sense_key)
                   VALUES (sense.id, entry.id, ...)
     for each t in sense.translations:
        statements += INSERT INTO entry_translations
                        (id, entry_id, sense_id, language_code, meaning_text, phonetic_transcription)
                      VALUES (t.id, entry.id, sense.id, ...)
        for each x in t.sentences:
           statements += INSERT INTO entry_sentences
                           (id, entry_id, translation_id, sentence_text, native_gloss_text)
                         VALUES (x.id, entry.id, t.id, ...)
  await sql.transaction(statements)      # atomic: the whole entry, or none of it
```

Atomicity is preserved exactly as today (`index.ts:311-329`), so the guardrail at
`prd.md:37` (*"Zero utraty zapisanych słówek"*) is unaffected. `entry_id` is kept
on the two lower tables alongside the parent reference so the cascade and the
per-entry read stay one hop; it is redundant but cheap, and dropping it would
turn every read into a two-level join.

### 4.5 Schema

```
-- entry_senses  (NEW)
  id uuid PK
  entry_id uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE
  gloss_text text NOT NULL                    -- the meaning, in the native language
  sense_key  text NOT NULL
  UNIQUE (entry_id, sense_key)                -- INV-13/14 becomes a key
  INDEX (entry_id)

-- entry_translations
+ sense_id uuid NOT NULL REFERENCES entry_senses(id) ON DELETE CASCADE
- CONSTRAINT entry_translations_entry_id_language_code_key   -- the rule that forbade FR-009
+ UNIQUE (sense_id, language_code)            -- INV-10, moved one level down (§ 4.0)

-- entry_sentences
+ translation_id uuid NOT NULL REFERENCES entry_translations(id) ON DELETE CASCADE  -- INV-12 as a foreign key
+ INDEX (translation_id)
- language_code                               -- derivable; dropped in the final phase
```

`sense_key` is stored rather than computed as an expression index, because the
domain function that produces it (§ 4.2) has to be the authority — a
`lower(btrim(...))` index would quietly diverge the day `senseKey` stops being a
lowercase trim, which is exactly what IL-24 will do to it.

**INV-11 dies here, on purpose.** "At most one sentence per language" appears in
no document (§ 1) and is the other half of what IL-41 asks to remove. It is
replaced by "at least one sentence per (sense, language)", enforced in the
aggregate.

### 4.6 The thin route

```ts
fastify.post('/:id/entries', { schema: { params: collectionParamsSchema, body: createEntryBodySchema } },
  async (request, reply) => {
    const collection = await fetchOwnedCollection(fastify, request.params.id, request.authUser.id)
    if (collection === undefined) return reply.notFound()

    const contract = await loadContract(fastify.sql, collection)
    try {
      const entry = Entry.capture(contract, toDraft(request.body))  // every rule, one place
      await insert(fastify.sql, entry)                              // one transaction
      return await reply.code(201).send(entry.toResponse())
    } catch (err) {
      return mapDomainError(reply, err)                             // never swallowed
    }
  })
```

`mapDomainError` is the only new cross-cutting piece:

| Domain error | HTTP | Message |
| --- | --- | --- |
| `BlankTextError` | 400 | names the field that was blank |
| `EmptyEntryError` | 400 | an entry needs at least one meaning |
| `SenseWithoutTranslationError` | 400 | a meaning needs at least one language |
| `TranslationWithoutSentenceError` | 400 | every meaning needs an example sentence in each of its languages |
| `LanguageNotTaughtError` | 400 | the existing wording at `index.ts:303` |
| `DuplicateSenseError` | 409 | this meaning is already saved for this word |
| `DuplicateSenseLanguageError` | 409 | this meaning already has a word in that language |
| `LanguageAlreadyPresentError` | 409 | the existing wording at `index.ts:388` |
| anything else | rethrow | `error-handler.ts:54-93` logs it at `error` with the correlation id |

`@fastify/sensible`'s helpers already produce that body shape, and
`error-handler.ts:87-92` stamps `requestId` on every one — so **no client parsing
an error body has to change**.

### 4.7 Enforcement moves from client to server

| Rule | Today | After |
| --- | --- | --- |
| Sense identity | `App.tsx:36-38`, one client, keyed on a target-language word | `domain/senseKey.ts`, keyed on the native gloss + `UNIQUE(entry_id, sense_key)` |
| A meaning is one thing across languages | **Nowhere** — the concept does not exist | `entry_senses`, one row per meaning |
| Sentence belongs to one sense **and** one language | popup convention (`App.tsx:283-290`) | a `NOT NULL` FK chain, and a `Sentence` type with no `languageCode` |
| One word per language | `UNIQUE(entry_id, language_code)` — wrong level | `UNIQUE(sense_id, language_code)` — right level |
| Complete pick before save | `App.tsx:345-358`, one client | `EmptyEntryError` / `SenseWithoutTranslationError` / `TranslationWithoutSentenceError`; `readyToSave` stays as UX only |
| Language membership | three copies in `index.ts` | `LanguageContract`, required to construct an `Entry` |
| Normalized native base form | `App.tsx:244,374` | still supplied by the client, now stamped and range-checked by `Entry.capture` — see the honest limit in § 5.7 |

---

## 5. Before/after, phases, tests

### 5.1 The AI contract has to change — and that is the plan's main cost

An earlier draft of this document claimed `backend/src/ai/translate.ts` was
untouched by the refactor and presented that as a de-risking property. **That is
no longer true, and the correction is the most important thing in this section.**

An entry-level sense (§ 4.0) cannot be assembled from a language-first response.
Grouping `languages[].variants[]` into meanings after the fact would mean pairing
across languages by position — the exact failure `App.tsx:283-287` names as the
thing the nesting exists to prevent. The model has to do the grouping, so the
tool schema inverts:

*Before* (`translate.ts:60-104`):

```
normalizedNativeText
languages[] → { languageCode, variants[] → { meaningText, phoneticTranscription, sentences[] } }
```

*After*:

```
normalizedNativeText
senses[] → { glossText,                                  // the meaning, in the NATIVE language
             translations[] → { languageCode, meaningText, phoneticTranscription,
                                sentences[] → { targetText, nativeGlossText } } }
```

Consequences that must be planned for, not assumed away:

- **`alignToRequested` (`:113-120`) becomes `alignSenseTranslations`** — it now
  aligns each sense's `translations[]` against the requested codes. A language the
  model skipped **for a given sense** is a legitimate sparse spoke (§ 4.1), not an
  error; a language skipped for *every* sense is a degradation worth reporting, as
  `App.tsx:236-243` already does.
- **The empty-result retry (`:12-19`) must be re-characterized.** Its measured
  rate — *"roughly 3 in 34 calls"* — was taken against the old schema. `isEmpty`
  becomes "no senses", and the rate has to be re-measured.
- **`lessons.md:34-39` now binds hard.** This change touches `backend/src/ai/`, so
  it needs real-API verification before it is called done: a dozen-plus varied
  calls, counting how many produce a *usable* result, with failure rate, cost,
  latency and token headroom recorded. The lesson exists because 65 green stubbed
  tests once coexisted with a ~9% live failure rate on this exact file.
- **Cost is unknown and must be measured, not projected.** `measure-cost.mjs` in
  `context/changes/translation-pivot/` is the instrument, and `lessons.md:33-38`
  requires measured numbers over estimates. There is a plausible argument that a
  meaning-first schema is *cheaper* — one sense list instead of N independent
  enumerations — but this document does not assert it.

**What the change buys, beyond correctness.** The model currently enumerates
senses independently in each language, which is why sense counts differ per
language and nothing lines up. Asking for meanings once and then translating each
is a strictly easier task, and it is the same shape IL-24 arrives at.

### 5.2 Wire contract

*Before* (`schemas.ts:44-62`):

```jsonc
{ "wordOrPhrase": "zamek",
  "translations": [ { "languageCode": "en", "meaningText": "castle", "phoneticTranscription": "/ˈkɑːsl/" } ],
  "sentences":    [ { "languageCode": "en", "sentenceText": "…", "nativeGlossText": "…" } ] }
```

*After*:

```jsonc
{ "wordOrPhrase": "zamek",
  "senses": [
    { "glossText": "budowla obronna",
      "translations": [
        { "languageCode": "en", "meaningText": "castle", "phoneticTranscription": "/ˈkɑːsl/",
          "sentences": [ { "sentenceText": "…", "nativeGlossText": "…" } ] },
        { "languageCode": "de", "meaningText": "Schloss", "phoneticTranscription": "/ʃlɔs/",
          "sentences": [ { "sentenceText": "…", "nativeGlossText": "…" } ] } ] },
    { "glossText": "urządzenie do zamykania",
      "translations": [
        { "languageCode": "en", "meaningText": "lock", "phoneticTranscription": "/lɒk/",
          "sentences": [ { "sentenceText": "…", "nativeGlossText": "…" } ] } ] }
  ] }
```

The second sense shows a sparse spoke: the user kept the *lock* meaning in
English only. The `GET /:id` read model mirrors the same nesting.

### 5.3 Every site the rule lives at today

| # | Site | Before | After |
| --- | --- | --- | --- |
| 1 | `translate.ts:49-107` | Language-first: `languages[].variants[]` | **Inverted** to `senses[].translations[]` — § 5.1 |
| 2 | `translate.ts:113-120` | `alignToRequested` over languages | `alignSenseTranslations` per sense; sparse spokes legal |
| 3 | `translate.ts:12-19,122-124` | `isEmpty` = no variants anywhere; rate measured at ~3/34 | `isEmpty` = no senses; **rate re-measured** |
| 4 | `App.tsx:36-38` | `sameMeaning` on a target-language word | Duplicated from `domain/senseKey.ts`, on the native gloss, per this repo's no-shared-package convention (`languages.ts:1-3`) |
| 5 | `App.tsx:26-30,85-90,202-213` | `Selection { variant, sentence }`, *"One pick per target language"* | Pick **meanings** first, then one sentence per (meaning, language) — **decision D-3** |
| 6 | `App.tsx:283-290` | Regenerate re-pairs by meaning within one language | Re-pairs by `senseKey`; a sense is now findable across languages |
| 7 | `App.tsx:345-358` | `readyToSave` gates save | Kept, as UX only; the server is now authoritative |
| 8 | `App.tsx:375-384` | Two arrays keyed by `languageCode` | `senses[]` built straight from the picks — the pairing at `:355` survives to the wire |
| 9 | `schemas.ts:44-62` | `translations[]` + `sentences[]` | `senses[]` nested two levels; `MAX_TARGET_LANGUAGES` bounds a *sense's* translations, not the entry's arrays |
| 10 | `index.ts:258-286` | Blank + per-language duplicate guards | `Entry.capture` preconditions |
| 11 | `index.ts:279-280` | A comment that is false for sentences | Deleted — the constraint is real now |
| 12 | `index.ts:293-304` | Membership, hand-written | `LanguageContract`, one place |
| 13 | `index.ts:306-329` | Two insert loops in one transaction | `entryRepository.insert` — same transaction, three levels |
| 14 | `index.ts:175-213` | Two sibling arrays read back | `entryRepository.loadEntries` returns nested senses |
| 15 | `index.ts:391-399` | Backfill takes `variants[0]` / `sentences[0]` | Translates **each existing sense** into the new language — **decision D-2** |
| 16 | `index.ts:383-389` | Ad-hoc "already has a translation" query | `LanguageAlreadyPresentError` from the aggregate |
| 17 | `1784584360698:52-54` | `UNIQUE(entry_id, language_code)` | Moved down to `UNIQUE(sense_id, language_code)` (§ 4.0) |
| 18 | `1784584360698:56-68` | `entry_sentences(entry_id, language_code, …)`, index only | `+ translation_id NOT NULL FK`, `− language_code` |
| 19 | — | No table for a meaning | `entry_senses`, `UNIQUE(entry_id, sense_key)` |
| 20 | `printRows.ts:51-78` | `.find()` per language → one of N | `PrintRow` gains `glossText`; one row per (sense, language), grouped by sense — **D-1** |
| 20a | `PrintDocument.tsx:131-137` | Five `<th>`: Word · Language · Translation · Sentence · Sentence (translated) | Six — `Znaczenie` inserted after Word |
| 20b | `PrintDocument.tsx:148-149` | Empty band prints `<td colSpan={4} />` | `colSpan={5}` |
| 20c | `PrintDocument.tsx:158-161` | One `rowSpan` on the word cell, over all the entry's rows | **Nested** `rowSpan`: word spans the whole band, each gloss spans its own languages |
| 20d | `printLabels.ts:12-18,20-77` | Five label fields × 8 native languages | Six — a `meaning` field added to all 8 |
| 21 | `CollectionDetailPage.tsx:199-226` | Two flat lists | Meanings, each with its per-language words and sentences; the `Set` at `:192` still works, since gap detection is per *language* |
| 22 | `core-schema.test.ts:40-57` | Asserts `UNIQUE(entry_id, language_code)` rejects a second meaning | Asserts a second **meaning** is accepted, and a second **word in one meaning's language** is rejected |
| 23 | `extension/src/types.ts:14-36` | `TranslationLanguage / TranslationVariant` | `TranslationSense / SenseTranslation`; `SavedEntry` (`:38-43`) unchanged |
| 24 | `frontend/src/api/collections.ts:11-37` | `EntryTranslation` / `EntrySentence` siblings | `EntrySense { glossText, translations[] }` |

### 5.3.1 Product decisions — taken 2026-08-23

All three were put to the user with worked alternatives; these are the answers,
not recommendations.

**D-1 — the printed sheet gains a `Znaczenie` column.** Meanings become a
column, not silent extra rows, so a learner reading the sheet can tell why
`zamek` has two English rows.

```
Słowo   │ Znaczenie         │ Tłum.      │ Zdanie
────────┼───────────────────┼────────────┼──────────────────────
zamek   │ budowla obronna   │ EN castle  │ The castle stood on…
        │                   │ DE Schloss │ Das Schloss ist alt.
        │ urządz. do zamyk. │ EN lock    │ The lock is broken.
kot     │ zwierzę           │ EN cat     │ The cat sleeps.
```

**A correction to how this decision was framed.** It was put to the user as
"four columns instead of FR-014's three". That understated the existing sheet:
`PrintDocument.tsx:133-137` already renders **five** columns — Word · Language ·
Translation · Sentence · Sentence (translated) — with all five labels translated
into the native language (`printLabels.ts:12-18`). The FR-014 three-column
wording (`prd.md:104`) was therefore already stretched during S-04, and this
change takes the sheet from five columns to **six**. That makes the decision less
of a departure than it was presented as, and the width pressure more of one —
see § 5.9.

**D-2 — backfill translates every meaning the entry already has.** An entry with
two meanings gains two words in the newly added language, one per meaning. This
retires *"take the model's first one and its first sentence"*
(`index.ts:396-397`) and resolves the § 3.4 inconsistency: both paths now answer
"how many meanings does an entry keep?" the same way. It needs a **different
prompt** — the model is handed a known `glossText` and asked for a word in one
language, rather than handed a word and asked to enumerate meanings. That is a
second tool schema, and it inherits the same real-API verification gate as the
first (§ 5.1).

**D-3 — the popup asks for meanings first, then sentences.** Check which
meanings to keep; then, inside each kept meaning, one sentence per language.

```
┌─ zamek ─────────────────────────┐
│ Which meanings do you want?     │
│  ☑ budowla obronna              │
│  ☑ urządzenie do zamykania      │
│  ☐ suwak                        │
├─ budowla obronna ───────────────┤
│ EN  castle  /ˈkɑːsl/            │
│   ◉ The castle stood on a hill. │
│   ○ We toured an old castle.    │
│ DE  Schloss /ʃlɔs/              │
│   ◉ Das Schloss ist alt.        │
├─ urządzenie do zamykania ───────┤
│ EN  lock  /lɒk/                 │
│   ◉ The lock is broken.         │
└─────────────────────────────────┘
         [ Save 2 meanings ]
```

Two consequences for the popup's own logic:

- `readyToSave` (`App.tsx:345-358`) restates as: **at least one meaning is
  checked, and every checked meaning has one sentence chosen in each language it
  carries a word for.** A meaning the model returned no word for in some language
  is a sparse spoke (§ 4.1) and does not block save — the same shape as today's
  `pickable` rule, one level down.
- Unchecking a meaning must drop its sentence picks, exactly as `selectVariant`
  (`:202-206`) already drops a sentence pick when the variant changes, and for
  the same reason.

**Scope decision.** All seven phases run as one change, tracked as **IL-41**
(tasks IL-42…IL-45). IL-24 stays a separate, later epic; § 5.7 records why the
two are compatible rather than competing.

### 5.4 Phases

Ordered so that no phase leaves the system in a state where INV-12 can be
violated silently, and so the **riskiest phase runs second** rather than after
schema work is sunk. Phases 1 and 3 are **test-first** (the project runs
`node --test` with coverage over `test/**/*.ts`, and `/10x-tdd` exists for
exactly this); 5 and 6 are covered by the per-edit gate
(`.claude/hooks/post-edit-check.mjs` → oxlint + scoped `vitest related`), which
excludes backend by design.

| Phase | Work | Test-first? | Gate |
| --- | --- | --- | --- |
| **0** | **Read-only survey.** Count rows where `language_code <> lower(language_code)`; count `entry_sentences` rows whose `(entry_id, lower(language_code))` matches **no** `entry_translations` row (the orphans the backfill must resolve); count entries. Re-run `measure-cost.mjs` for a current AI baseline. Nothing is written | n/a | `lessons.md:12-17` — check for pre-existing violations *before* a uniqueness migration; `lessons.md:33-38` — measured, not estimated |
| **1** | `backend/src/domain/` — `entry.ts`, `sense.ts`, `languageContract.ts`, `senseKey.ts`, `errors.ts`. Pure, no wiring | **Yes** — unit tests only, no DB | `npm test` |
| **2** | **AI contract inverted** (§ 5.1): meaning-first tool schema, `alignSenseTranslations`, `isEmpty` re-defined, retry re-characterized. Ships with a `toLegacyLanguageShape()` adapter so the already-installed popup keeps working | Partly | **Real-API verification** (`lessons.md:34-39`): ≥12 varied captures, count *usable* results, record failure rate / cost / latency / token headroom in the change notes |
| **3** | Migration: create `entry_senses`; one sense per existing entry, `gloss_text = word_or_phrase` (§ 5.5); add `sense_id` and backfill; add `translation_id`, backfill by `(entry_id, lower(language_code))`, resolve Phase-0 orphans, `SET NOT NULL`; swap the unique constraints. `entry_sentences.language_code` is **kept** and stops being read | **Yes** — extend `backend/test/schema/core-schema.test.ts` | `npm test` + a rollback rehearsal of `down()` |
| **4** | `entryRepository.ts`, `mapDomainError`, both routes rewired, `createEntryBodySchema` → `senses[]`, read model nested. **Plus D-2's second tool schema** — gloss + language → word — carrying the same live-verification gate as Phase 2 | No (integration) | `npm test`; **no `api-construct.ts` change** — no route added or renamed (`lessons.md:26-32`), and `route-reachability.test.ts` backstops it |
| **5** | Extension (D-3): meaning checkboxes, per-meaning sentence groups, `readyToSave` restated, `senses[]` payload, `types.ts:14-36`. Existing suite: `extension/test/popup/App.test.tsx` | Partly | per-edit hook; `npm run lint` |
| **6** | Frontend (D-1): `EntrySense`, `CollectionDetailPage` grouping, `buildBands` per sense, `PrintRow.glossText`, sixth column and nested `rowSpan` in `PrintDocument.tsx`, `meaning` label × 8 in `printLabels.ts`, column widths in `print.css`. Existing suites: `frontend/test/pages/{printRows,printLabels,printPagination,printCssGeometry}.test.ts`, plus the Playwright column/pagination specs under `frontend/browser-tests/` | Partly | per-edit hook; `npm run lint`; **`/10x-e2e` for the print specs** |
| **7** | Cleanup: drop `entry_sentences.language_code`, delete `toLegacyLanguageShape`, remove the false comment sites | No | `npm test` |

**Version skew.** The extension is side-loaded manually
(`extension/README.md`), so a popup built before Phase 5 can still be running
after Phase 4 ships. Phase 2's `toLegacyLanguageShape` covers the translate
response; the save payload needs the mirror of it — an adapter that maps a flat
`translations[]`/`sentences[]` body into a single-sense entry and **rejects
rather than guesses** when a language carries more than one translation. Both
adapters are backward-compatibility shims spanning two versions of this project's
own contract — **not** anti-corruption layers, which sit against someone else's
model. They belong to Phase 4 and die in Phase 7; they are named here so the
version skew is not discovered in the field.

### 5.5 Migrating the data that exists

Today's schema forbids more than one meaning per entry, so **every existing
entry has exactly one meaning** — that is what `UNIQUE(entry_id, language_code)`
guaranteed. The migration therefore creates **one** `entry_senses` row per entry,
not one per (entry, language), and attaches every existing translation to it.

`gloss_text` for those rows is the entry's own `word_or_phrase` — the normalized
native base form. That is not a placeholder: with a single meaning, the native
word *is* the meaning, and it is already in the right language (INV-7 guarantees
`source_language_code` is the collection's native language). `sense_key` is
`senseKey(word_or_phrase)`.

Two data hazards, both from Phase 0:

- **Uppercase legacy codes.** Project notes record `PL`/`EN` rows created before
  write-time normalization, only partially re-verified since. Every join in the
  migration compares `lower(language_code)`, as `index.ts:385` already does.
- **Orphan sentences.** Any `entry_sentences` row with no matching translation
  cannot be given a `translation_id`. The Phase-0 count decides the disposition —
  attach to the language's single translation, or drop — and it must be written
  down before Phase 3 is coded, not discovered while running it.

### 5.6 Test cases for the invariant

Legal — must be accepted and read back identically:

1. `zamek` with two meanings, each with an English and a German word, each word
   with its own sentence → both meanings persist, all four sentences land under
   the right (meaning, language).
2. A sense whose translation carries three sentences → all three persist.
3. A **sparse spoke**: a meaning present in English only, in a `pl → en,de`
   collection → accepted.
4. Round trip: `POST` then `GET /:id` returns the same grouping — same meanings,
   same words under each, same sentences under each word.
5. Two meanings whose glosses differ only in case/whitespace **in different
   entries** → accepted (the key is `(entry, senseKey)`).
6. Backfill adds `fr` to an entry with two meanings → **two** French translations
   appear, one per meaning, and no existing language is touched.

Illegal — must throw a **named** domain error and persist nothing:

7. Two senses with the same `senseKey` in one entry → 409 `DuplicateSenseError`.
8. Two translations in the same language under one sense → 409
   `DuplicateSenseLanguageError`.
9. A translation in a language the collection does not teach → 400
   `LanguageNotTaughtError`.
10. A sense with zero translations → 400 `SenseWithoutTranslationError`.
11. A translation with zero sentences → 400 `TranslationWithoutSentenceError`.
12. Blank `glossText`, `meaningText`, `sentenceText`, `nativeGlossText` or
    `wordOrPhrase` → 400 `BlankTextError`.
13. An entry with zero senses → 400 `EmptyEntryError`.
14. Backfill into a language an entry's senses already cover → 409
    `LanguageAlreadyPresentError`.
15. **Partial-failure atomicity:** a payload whose *last* sentence is blank leaves
    **no** rows behind — the guardrail at `prd.md:37`.

Schema-level (`core-schema.test.ts` idiom, `assert.rejects` against a direct
`INSERT`):

16. `entry_sentences` with `translation_id = NULL`, or a non-existent one →
    rejected.
17. `entry_translations` with `sense_id = NULL`, or a non-existent one → rejected.
18. Duplicate `(entry_id, sense_key)` → rejected.
19. Duplicate `(sense_id, language_code)` → rejected.
20. A second *distinct* meaning for the same `(entry_id, language_code)` →
    **accepted**. This is `core-schema.test.ts:40-57` inverted, and it is the test
    that proves `zamek` can keep both *castle* and *lock*.
21. Deleting an `entry_senses` row cascades its translations and their sentences.

AI contract (Phase 2, `lessons.md:34-39`):

22. Stubbed: a response with a sense missing one requested language →
    `alignSenseTranslations` leaves it absent, not fabricated.
23. Stubbed: a response with zero senses → the retry fires exactly once.
24. **Live**: ≥12 varied captures against the real API, counting *usable* results
    and recording the numbers. Not a pass/fail assertion — a measurement, per the
    lesson.

Clients, from the decisions in § 5.3.1:

25. **D-3, popup** (`extension/test/popup/App.test.tsx`): unchecking a meaning
    drops its sentence picks; `readyToSave` is false while a checked meaning has
    a language whose sentence is unchosen; a checked meaning with a sparse spoke
    (no word in one language) does **not** block save.
26. **D-1, print rows** (`frontend/test/pages/printRows.test.ts`): a two-meaning
    entry produces rows grouped by sense, each carrying its `glossText`; the
    `.find()`-drops-N behaviour is gone.
27. **D-1, print layout** (`frontend/browser-tests/columns.spec.ts`,
    `pagination.spec.ts`): six columns fit A4 without the meaning or transcription
    column forcing a mid-word break, and a band whose meanings span several rows
    still does not split across a page fold.
28. **D-2, backfill**: adding `fr` to a two-meaning entry issues one
    gloss-plus-language call per meaning and writes two French translations; an
    entry whose senses already cover `fr` is rejected with
    `LanguageAlreadyPresentError`.

Migration and gate:

29. An entry saved before Phase 3 reads back as one meaning whose gloss is its
    native word, with its sentence under its word.
30. **Deliberate-break check** — remove the `LanguageNotTaughtError` precondition
    and confirm test 9 fails. `lessons.md:62-67` is explicit that a gate verified
    only in the happy case has been shown to run exactly once.

### 5.7 Relationship to work already on the board

- **IL-41** (`roadmap.md:179,183`, tasks IL-42…IL-45) *is* this change. Its
  framing — *"wiele znaczeń i wiele zdań na wpis"* — is the cardinality half; this
  plan adds the grouping half and puts it first.
- **IL-24 / `translation-pivot`** (`status: preparing`, nothing built) is now
  **much closer to this than the first draft implied**. `entry_senses` is the
  per-entry projection of the pivot's `concepts` table; `senseKey` is what the ILI
  replaces; `entry_senses` later grows a nullable `concept_id`. The pivot's tables
  land *alongside* the existing schema (`decision-brief.md` § Status), so nothing
  here is stranded by it. `refactor-opportunities/research.md` §1.3 judged the
  naive version of this change *"SUBSUMED IN INTENT, ORPHANED IN MECHANISM"*; that
  verdict applies to the **cache mechanism**, not to the aggregate — the pivot
  changes where meanings *come from*, this change fixes where they are *guarded*.
  The two now agree on shape, which §1.3 said they must.
- **`refactor-opportunities` #1 (C-01, the undeclared response contract)** should
  land **first or alongside**. This change alters response shapes that three
  clients hand-copy (`frontend/src/api/collections.ts:11-37`,
  `extension/src/types.ts:14-36`, `printRows.ts`); C-01 is the instrument that
  makes that safe.

### 5.8 Lessons that bind this plan

- `lessons.md:12-17` — check for pre-existing violations before a uniqueness
  migration. **This is Phase 0**, and it is not optional: `UNIQUE(entry_id,
  sense_key)` and `UNIQUE(sense_id, language_code)` can both fail to apply against
  real data.
- `lessons.md:19-24` — any new file under `backend/src/` reading a
  `fastify.d.ts`-augmented property needs the forcing type-only import.
  `entryRepository.ts` will.
- `lessons.md:26-32` — every new route needs an `api-construct.ts` entry. **This
  plan adds no route**, worth stating explicitly rather than leaving to inference.
- `lessons.md:33-39` — measured numbers over estimates, and real-API verification
  for anything touching `backend/src/ai/`. **This now binds** (§ 5.1). It is the
  single largest change from the first draft of this document, and Phase 2 exists
  to discharge it.

### 5.9 Honest limits of this design

- **The AI contract change is the real risk.** Everything else here is
  refactoring behind tests; § 5.1 is a live behavioural change to the one file
  `lessons.md:34-39` was written about. If the model turns out to group meanings
  badly across languages, the plan needs a fallback — most likely generating
  meanings first in the native language, then a second call per language — and
  that fallback should be sketched before Phase 2, not during it.
- **A sixth print column is the tightest constraint in the plan (D-1).** The
  sheet is already five columns on A4, and the width pressure is documented at the
  line: `PrintDocument.tsx:168-173` records `independence /ˌɪndɪˈpendəns/`
  measuring 203.9px against a 118.9px column, with Firefox breaking the word
  itself to fit. A `Znaczenie` column takes width from columns that are already
  short, and glosses are phrases, not words — *"urządzenie do zamykania"* is
  longer than most entries in the Translation column. Mitigations to weigh in
  Phase 6: let the gloss column wrap freely, abbreviate nothing, and consider
  dropping the `Language` column, whose content (`printLanguageNamer`, an
  `Intl.DisplayNames` full language name) is the most compressible thing on the
  sheet now that a language code already prefixes each translation in the mockup.
  The Playwright column specs exist precisely to catch this and should be run
  before the layout is called done, not after.
- **`senseKey` is a weak identity.** *"budowla obronna"* and *"budowla"* are two
  meanings under it. Chosen for continuity with `App.tsx:36-38` and as an explicit
  seam for IL-24, not because it is right.
- **D-2 adds a second AI surface, and therefore a second place the model can
  fail.** The backfill prompt is handed a gloss and asked for a word in one
  language. That is a narrower task than the capture call, so it should be more
  reliable — but "should be" is what `lessons.md:34-39` exists to refuse, and it
  needs its own measured pass, not the capture call's.
- **Phrases have no meanings to enumerate.** `wordOrPhrase` accepts up to 200
  chars (`schemas.ts:45`), and a captured phrase will usually yield exactly one
  sense whose gloss restates it. Legal under this model, but the sense layer earns
  nothing there — the same observation `translation-pivot/change.md` records as
  *"Phrases have no lexical sense"*.
- **INV-8 is improved, not solved.** `Entry.capture` stamps `sourceLanguageCode`
  and range-checks `wordOrPhrase`, but the *normalization itself* still happens in
  the model response and is adopted by the popup (`App.tsx:244`). A hostile or
  buggy client can still save a non-normalized word. Genuinely fixing it means the
  server calling the model at save time, or holding the translate result
  server-side between the two calls — a different shape of change, out of scope
  here.
- **Enforcement statuses in § 1 were read from source, not exercised at runtime.**
  "Enforced" means a code path rejects a violation, not that a test proves it.
- **No `context/archive/` change was mined** for the origin of INV-10 beyond what
  `refactor-opportunities/research.md` § C-09 already records (the cardinality was
  chosen on a different axis, before the AI-variant requirements existed).

### 5.10 Load-bearing names to register

`docs/reference/contract-surfaces.md` — the registry `.claude/CLAUDE.md`
describes as scaffolded by `/10x-init` — **does not exist in this repo** (`docs/`
is absent). Creating it is the cheapest way to record the following; failing
that, they belong in the change's `change.md`.

| Name | Kind | Note |
| --- | --- | --- |
| `Entry`, `Sense`, `SenseTranslation`, `Sentence` | Domain types (`backend/src/domain/`) | `Sense` is **entry-level**; `Sentence` deliberately has no `languageCode` |
| `glossText` | Domain field | The meaning, in the collection's **native** language |
| `senseKey()` | Domain function | The identity rule; the IL-24 seam |
| `LanguageContract` | Value object | Required to construct an `Entry` — this *is* INV-9 |
| `DomainError` + the eight named subclasses | Error taxonomy | Mapped to HTTP in one place |
| `mapDomainError` | Application helper | The only domain→HTTP translation site |
| `entryRepository.{loadContract,loadEntry,loadEntries,insert,appendLanguage}` | Repository surface | Non-interactive transactions only |
| `entry_senses` (`gloss_text`, `sense_key`) | Table | The meaning as a first-class row; later grows `concept_id` for IL-24 |
| `entry_translations.sense_id` | Column | Ties a word to the meaning it expresses |
| `entry_sentences.translation_id` | Column | INV-12 as a foreign key |
| `entry_senses_entry_id_sense_key_idx` | Unique index | INV-13/14 as a database key |
| `entry_translations_sense_id_language_code_idx` | Unique index | INV-10, one level down |
| `senses[]` (AI tool schema, request, response) | Wire contract | Replaces `languages[].variants[]` and the `translations[]`/`sentences[]` pair, in three clients and the tool schema |
| `alignSenseTranslations`, `toLegacyLanguageShape` | AI adapter surface | The second is temporary — deleted in Phase 7 |

---

## Summary

The domain's most core rule is also its least enforced: FR-009 exists
specifically for ambiguous words (`prd.md:82`), the model returns *"the distinct
meanings of the word"* correctly (`translate.ts:71-77`), the popup guards their
identity correctly (`App.tsx:283-290`) — and `UNIQUE(entry_id, language_code)`
(`1784584360698:52-54`) permits exactly one to be saved, which was measured on
real data as `zamek` surviving only as `lock` (`roadmap.md:183`). The chosen
invariant is therefore sense integrity: **a saved entry keeps every meaning the
user chose, and every example sentence belongs to exactly one of them**. The
decisive modelling question is what level the meaning sits at, and the answer is
that the sense is **entry-level, not per-language** — a meaning is a property of
the word, and a target language only supplies a word *for* it, so the mapping key
is the meaning (`glossText`, written in the collection's native language) and
never a word text. That also reframes the constraint that caused the loss:
`UNIQUE(entry_id, language_code)` is a correct rule attached one level too high,
and it moves down to `UNIQUE(sense_id, language_code)` rather than being deleted.
The guardian is an `Entry` aggregate root whose parts are senses, per-language
translations beneath them, and sentences beneath those; `Sentence` carries no
`languageCode` so a cross-wired sentence is unrepresentable rather than merely
rejected, `LanguageContract` is a required constructor input so three
hand-written membership checks collapse into one, every precondition throws a
named domain error instead of logging and continuing, and the whole entry still
saves in the single non-interactive transaction the Neon HTTP driver requires.
The cost, corrected from this document's first draft, is that
`backend/src/ai/translate.ts` **is** in scope: a language-first response cannot
be regrouped into meanings without pairing across languages by position, so the
tool schema inverts to `senses[].translations[]`, which re-arms `lessons.md:34-39`
and makes real-API verification a gate rather than a nicety. Seven phases carry
it, with the read-only data survey first, the AI-contract change second so the
riskiest work happens before schema effort is sunk, and a deliberate-break check
last. All three product decisions were taken on 2026-08-23 (§ 5.3.1): the printed
sheet gains a `Znaczenie` column — its sixth, since the sheet has been five since
S-04 — the FR-018 backfill translates every meaning an entry already has instead
of guessing at `variants[0]`, and the popup asks which meanings to keep before
asking for sentences. The whole plan runs as one change, tracked as IL-41. The
two things most likely to bite are both recorded in § 5.9: whether the model
groups meanings well across languages, which Phase 2's live verification decides,
and whether a sixth column still fits A4, which the existing Playwright column
specs decide.
