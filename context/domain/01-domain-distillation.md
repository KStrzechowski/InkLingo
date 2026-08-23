---
title: "InkLingo — domain distillation"
created: 2026-08-23
type: domain-distillation
author: KStrzechowski
git_commit: f6e3aab
sources:
  - context/foundation/prd.md
  - context/foundation/shape-notes.md
  - context/foundation/roadmap.md
  - context/foundation/tech-stack.md
  - backend/migrations/, backend/src/, extension/src/, frontend/src/
method: discovery → analysis → classification (steps 0–5)
---

# InkLingo — domain distillation

A **map of the domain**, not code. Nothing here proposes an implementation.
Every term, invariant and divergence below is traced to a line I actually
opened — documents and code both. Where the record is silent, this document
writes `BRAK w kodzie` or `unknown` rather than supplying a plausible answer.

---

## 0. Project context

### 0.1 Source documents found

| Document | What it carries | Lines |
| --- | --- | --- |
| `context/foundation/prd.md` | Vision, persona, success criteria, US-01, FR-001…FR-018, business logic, access control, non-goals, open questions | 142 |
| `context/foundation/shape-notes.md` | The pre-PRD shaping pass; an **earlier, narrower** statement of the same business rule | 177 |
| `context/foundation/roadmap.md` | Slices F-01, S-01…S-05, Jira mapping, parked work, post-MVP epics | 192 |
| `context/foundation/tech-stack.md` | Stack decision and its rationale | 29 |
| `AGENTS.md`, `CLAUDE.md` | Contributor/agent guides — engineering, not domain | — |

**Requirements documents exist and are rich**, so this distillation is not
README-and-code archaeology. One consequence worth stating up front: the PRD is
written in Polish and the code is written in English, so *every* domain term
crosses a translation boundary before it reaches a file name. That is itself a
source of drift, and § 4 records where it landed.

The shape-notes are the PRD's ancestor and disagree with it in one material
way. `shape-notes.md:150` states the rule with a single target language
(*"język źródłowy i docelowy nauki"*); `prd.md:115` restates it for **1–5
target languages at once**. The PRD supersedes it. Where the two differ this
document follows the PRD and says so.

### 0.2 Where business logic lives

Four independent npm projects, no shared package between them
(`CLAUDE.md` § Project layout; `tech-stack.md:29` records the decoupling as a
deliberate, user-stated preference).

| Layer | Location | Domain content |
| --- | --- | --- |
| Persistence | `backend/migrations/` (4 files) | The only place the model is *declared*: 6 tables, 3 uniqueness constraints |
| HTTP / application | `backend/src/routes/api/collections/index.ts` (439 lines) | **Where essentially all business rules actually run** — validation, ownership, language membership, the save transaction |
| Request contracts | `backend/src/routes/api/collections/schemas.ts` (63 lines) | Cardinality and length bounds, TypeBox |
| Model boundary | `backend/src/ai/translate.ts` (164 lines) | The tool schema — **the richest domain vocabulary in the repo** |
| Capture UI | `extension/src/popup/App.tsx` (595 lines) | Selection, regeneration, sense-pairing — **domain rules with no server-side counterpart** |
| Review / export UI | `frontend/src/pages/` | Gap detection, print projection |

There is **no domain layer and no service layer**. No file under `backend/src`
is named for a domain concept except `ai/translate.ts`; there is no `domain/`,
`model/`, or `entities/` directory. The route handler *is* the model.

---

## 1. Ubiquitous Language

Extracted from the documents **and** from the code. Every row cites where the
term is defined and where it lives — or records its absence.

### 1.1 Terms that exist in both the documents and the code

| Term (PL → EN) | Definition | Document source | Code home |
| --- | --- | --- | --- |
| **Zbiór → Collection** | A user-owned, freely named folder that fixes one native language and 1–5 target languages at creation time | `prd.md:66` (FR-004), `prd.md:70` (FR-017) | `migrations/1784584360698:14-24`; `collections/index.ts:100` |
| **Język ojczysty → native language** | The collection's base language; the language an entry is stored in and sentences are glossed into | `prd.md:70`, `prd.md:117` | `collections.native_language_code`, `migrations/1785419841325:6-8` |
| **Język nauki → target language** | A language the collection teaches; 1 to 5 per collection | `prd.md:70` (FR-017) | `collection_target_languages`, `migrations/1785419841325:10-19` |
| **Wpis → Entry** | One captured word or phrase saved into a collection, together with its translations and sentences | `prd.md:46` (US-01 Then) | `entries`, `migrations/1784584360698:27-38` |
| **Słowo/fraza → word or phrase** | The captured unit itself | `prd.md:76` (FR-007) | `entries.word_or_phrase`; `schemas.ts:45` |
| **Wariant tłumaczenia → translation variant** | One of several **distinct meanings** of an ambiguous word in one target language | `prd.md:82` (FR-009: *"kilka wariantów tłumaczenia … dla słów wieloznacznych"*) | `translate.ts:26-30` (`TranslationVariant`); tool schema `translate.ts:71-77` — *"The distinct meanings of the word in this target language"* |
| **Transkrypcja fonetyczna → phonetic transcription (IPA)** | IPA for the target-language form only, never the native one | `prd.md:92` (FR-015) | `entry_translations.phonetic_transcription`, `migrations/1785433311673:9-11`; `translate.ts:83-86` |
| **Zdanie przykładowe → example sentence** | A context sentence in a target language | `prd.md:84` (FR-010) | `entry_sentences.sentence_text`, `migrations/1784584360698:56-67` |
| **Tłumaczenie zdania → native gloss** | That same sentence rendered in the collection's native language, so a beginner can read it | `prd.md:84`, `prd.md:119` | `entry_sentences.native_gloss_text`, `migrations/1785433311673:13-15`; `translate.ts:95` |
| **Forma bazowa → normalized native form** | The captured text reduced to its base form **in the collection's native language**, whichever language it was typed in | `prd.md:46`, `prd.md:117` (*"sprowadza wpis do formy w języku ojczystym zbioru jako bazowej dla zapisu"*) | `translate.ts:56-59` (`normalizedNativeText`); consumed at `extension/src/popup/App.tsx:244` |
| **Regeneracja → regeneration** | Asking for different example sentences for one target language, independently of the others | `prd.md:88` (FR-012) | `extension/src/popup/App.tsx:264-340` |
| **Uzupełnienie wpisu → backfill** | Adding a translation in one newly-added target language to one already-saved entry | `prd.md:100` (FR-018) | `collections/index.ts:358-435`; `schemas.ts:37-40` |
| **Wydruk A4 → printable export** | A black-and-white A4 table of Word / Translation / Sentence for one collection | `prd.md:104` (FR-014) | `frontend/src/pages/printRows.ts:11-28`, `PrintDocument.tsx` |
| **Wymowa → pronunciation playback** | Audio for the captured word/phrase and the chosen sentence | `prd.md:94` (FR-016) | `extension/src/speech.ts`, `useSpeech.ts` |
| **Użytkownik → User** | A registered account; flat model, no roles | `prd.md:58-63`, `prd.md:125` | `users`, `migrations/1784584360698:8-12`; `routes/api/autohooks.ts:10-43` |

### 1.2 Terms the documents define that have **no** home in the code

These are the gaps that matter most — the domain knows them, the model does not.

| Term | Document source | Status in code |
| --- | --- | --- |
| **Sens / znaczenie (sense)** as a *persisted* thing | `prd.md:82` (FR-009), and the code's own vocabulary at `translate.ts:77` and `App.tsx:283-287` | **BRAK w kodzie (as an entity).** It exists in the AI response type (`translate.ts:26-30`) and in popup memory (`App.tsx:27-30`), and is destroyed at the save boundary. No table, no column, no identifier. See § 3 A-3 and § 4 D-1 |
| **Ostatnio używany zbiór (last-used collection)** | `prd.md:98` (FR-013) — and `prd.md:99` makes it load-bearing *before* save, because the collection determines which languages the AI is asked for | **BRAK w kodzie (server-side).** Lives only as `browser.storage.local` key `lastCollectionId` (`App.tsx:10,158,197,397`). Per-browser-profile, not per-user; the web app has no notion of it |
| **Dodanie języka nauki do istniejącego zbioru** | Presupposed by FR-018 (`prd.md:100`: *"w nowo dodanym języku nauki zbioru"*) | **BRAK w kodzie.** There is no route that mutates a collection — 9 routes exist, 4 `GET` and 5 `POST`, none of them an update. Collection languages are immutable after creation. `roadmap.md:190` already records this: FR-018's stated trigger is *"unreachable while collection languages are immutable"* |
| **Wieloznaczność (ambiguity) surviving the save** | `prd.md:82` (FR-009) | **BRAK w kodzie.** `UNIQUE(entry_id, language_code)` (`migrations/1784584360698:52-54`) admits exactly one meaning per language. `roadmap.md:183` measured it: *"`zamek` zapisany jest wyłącznie jako `lock` — „castle" i „zipper" nigdy nie trafiły do bazy"* |
| **Wybór zdania (sentence choice)** on the backfill path | `prd.md:86` (FR-011) | **Deliberately absent**, and the code says so: `collections/index.ts:396-397` — *"Unlike the capture flow there's no user picking a variant here, so take the model's first one and its first sentence"* |

### 1.3 Terms the code introduces that no document names

Concepts invented during implementation. Each is real domain knowledge that
was never written back into the PRD.

| Term | Code home | What it means |
| --- | --- | --- |
| `sameMeaning` | `App.tsx:36-38` | **Sense identity is a normalized string comparison of `meaningText`.** This is the de-facto primary key of a sense in the whole system |
| Sense-preserving regeneration | `App.tsx:283-290` | Regeneration re-pairs by meaning, never by position: *"Attaching one sense's sentences to another is exactly the mismatch that nesting sentences under variants exists to prevent"* |
| `pickable` / `readyToSave` | `App.tsx:342-358` | A language the model returned nothing for is excluded from "everything chosen"; every language that *did* produce variants must be fully picked before save |
| `alignToRequested` | `translate.ts:113-120` | A target language the model skipped comes back with an empty `variants` array rather than vanishing — the response shape is rebuilt against what was *asked for* |
| Empty-result retry | `translate.ts:12-19` | The model intermittently returns all-empty variants, *"measured at roughly 3 in 34 calls"* — a domain-visible failure mode with a one-shot retry |
| `PrintBand` | `printRows.ts:22-28` | An entry's languages kept together as one `<tbody>` so a word's rows never split across a page fold — languages add **rows, not columns** (`printRows.ts:11-13`) |
| `SUPPORTED_LANGUAGE_CODES` | `backend/src/languages.ts:4` | The domain's actual language vocabulary is **eight** codes (`en, pl, ru, de, fr, es, it, uk`). No document states this list |

---

## 2. Subdomain classification

Classified against the product's own statement of what it is for:
`prd.md:22` — the market gap is *"zero-friction capture + AI-native
translation"* in one flow — and the primary success criterion at `prd.md:31`.

### Core — the reason the product exists

| Area | Why Core | Anchor |
| --- | --- | --- |
| **AI-native multi-sense translation** — one capture yielding, per target language, several distinct meanings, each with IPA and its own bilingual example sentences | This is the differentiator named in the vision. `prd.md:22` says explicitly that no existing tool combines capture with *"natywnej integracji AI do tłumaczenia i generowania przykładowych zdań w kontekście"*. FR-009/010/015 are the substance of it | `prd.md:22,82,84,92`; `translate.ts:49-107` |
| **The collection as a language contract** — a collection fixes one native + 1–5 target languages, and that choice determines what the AI is asked for and what may be saved | FR-017 was *challenged and upheld* (`prd.md:71`: languages belong to the collection, not the account, so the user can run PL→EN and RU→EN side by side). Everything downstream — translation, save validation, print, backfill — reads from it | `prd.md:70-71`; `collections/index.ts:293-304` |
| **Sense-preserving selection** — the user picks one meaning and one sentence per target language, and regeneration must not cross-wire them | FR-011/FR-012. The code treats this as a correctness property, not a nicety (`App.tsx:283-287`) | `prd.md:86,88`; `App.tsx:264-340` |
| **Capture-to-save integrity** — a saved entry is stored in the collection's native base form, with data for every target language | US-01's *Then* clause and the guardrail at `prd.md:37` (*"Zero utraty zapisanych słówek"*) | `prd.md:37,46,52` |

### Supporting — necessary, product-specific, not the differentiator

| Area | Why Supporting | Anchor |
| --- | --- | --- |
| **Collection management** (create, list, browse, unique naming) | Required for Core to have anywhere to put anything, but it is ordinary folder CRUD — the domain rule sits in the *language contract* above, not in the CRUD | `prd.md:66,68`; `collections/index.ts:100,77,155` |
| **Printable export** | A must-have (FR-014) and the MVP's stated end point (`prd.md:129`), but it is a **projection** of Core data, and the PRD deliberately refuses to specify its mechanism (Open Question 1, `prd.md:140`). Non-goals cap it at one plain layout (`prd.md:131`) | `prd.md:104,131,140`; `printRows.ts` |
| **Backfill (FR-018)** | Product-specific and rule-bearing (explicitly *not* a bulk re-translate — `prd.md:101`, `prd.md:136`), but nice-to-have priority and currently unreachable (§ 1.2) | `prd.md:100-101`; `collections/index.ts:358-435` |
| **Ownership / tenancy** | Every read and write is scoped to the owning user. Real, enforced, and not differentiating — a flat model with no roles by explicit decision (`prd.md:125`) | `prd.md:125`; `ownership.ts:19-38` |

### Generic — solved problems, buy/borrow rather than model

| Area | Why Generic | Anchor |
| --- | --- | --- |
| **Authentication** (FR-001–003) | Email/OAuth sign-in. Delegated to Cognito; the domain keeps only `users.cognito_sub` | `prd.md:58-63`; `migrations/1784584360698:8-12`; `plugins/auth.ts` |
| **Pronunciation playback** (FR-016) | Text-to-speech. The PRD explicitly leaves the mechanism open (Open Question 2, `prd.md:141`) and non-goals rule out voice selection (`prd.md:135`). Implemented as a thin wrapper the code itself calls a swappable seam (`speech.ts:6-7`) | `prd.md:94,135,141`; `extension/src/speech.ts` |
| **Language code vocabulary** | ISO-639-1 codes and their display labels | `backend/src/languages.ts:4`; `extension/src/languages.ts` |
| **Error reporting / observability** | Cross-cutting infrastructure, no domain content | `routes/api/client-errors/` |

**One observation the classification makes visible.** The Core column is where
the code has the *least* structure: three of its four rows have no persisted
model at all, and the fourth (`the language contract`) is enforced by
hand-written comparisons in a route handler. The Supporting and Generic columns
are where the tables, constraints and plugins are.

---

## 3. Aggregate candidates and their invariants

Each candidate names the rule that must **always** hold, its source, and
whether the code **enforces** it (something rejects a violation), **declares**
it (it is written down but nothing checks), or **ignores** it.

### A-1 — Collection (aggregate root)

Owns: `name`, `native_language_code`, its target-language set, and — by
`ON DELETE CASCADE` — every entry beneath it.

| # | Invariant | Source | Status |
| --- | --- | --- | --- |
| I-1 | A collection's name is unique per user, case-insensitively | `prd.md:66` (*"z unikalną … nazwą"*) | **ENFORCED, twice.** DB partial unique index on `(user_id, lower(name))` — `migrations/1784819058952:6-9` — surfaced as 409 at `collections/index.ts:148-150` |
| I-2 | A collection has between 1 and 5 target languages | `prd.md:70` (FR-017) | **ENFORCED at the edge only.** `schemas.ts:11-14` (`minItems: 1, maxItems: 5` via `MAX_TARGET_LANGUAGES`, `schemas.ts:6`). **No database constraint** — nothing stops a row count outside 1–5 if any other writer ever appears |
| I-3 | The native language is never also a target language | *Implied* by `prd.md:92` (IPA is for target languages, *"nie dla języka ojczystego"*) and by the gloss direction at `prd.md:84`. **Not stated as a rule anywhere in the PRD** | **ENFORCED at creation** — `collections/index.ts:124-126`. Safe from drift only because no update path exists (§ 1.2) |
| I-4 | Target languages carry no duplicates | Not in any document — invented in code | **ENFORCED**, `collections/index.ts:121-123`, plus `UNIQUE(collection_id, language_code)` at `migrations/1785419841325:20-22`. The comment at `:117-120` explains it was added to stop a duplicate surfacing as a misleading name-conflict 409 |
| I-5 | Every language code is one of the eight supported | Not in any document | **ENFORCED**, `collections/index.ts:111-116` against `languages.ts:4` |
| I-6 | A collection's language contract is immutable after creation | **Contradicted** by FR-018's premise (`prd.md:100`) | **ENFORCED BY ABSENCE** — no update route exists. This is an accident of scope, not a decision; `roadmap.md:190` records it as a defect found at verification |

### A-2 — Entry (aggregate root, or a part of Collection — see § 5)

Owns: `word_or_phrase`, `source_language_code`, its translations and its
sentences.

| # | Invariant | Source | Status |
| --- | --- | --- | --- |
| I-7 | An entry's source language is always its collection's native language — never taken from the caller | `prd.md:46`, `prd.md:117` | **ENFORCED**, and stated at the line: `collections/index.ts:312-313` — *"source_language_code is always the parent collection's native language, never taken from the request body"* — written at `:316` |
| I-8 | The stored word/phrase is the **normalized base form in the native language** | `prd.md:46` (*"w formie bazowej w języku ojczystym zbioru"*), `prd.md:117`; the AI is asked for it at `translate.ts:56-59` | **DECLARED, NOT ENFORCED.** The normalization is produced by the model, adopted by the popup (`App.tsx:244`) and sent as `wordOrPhrase` (`App.tsx:374`). The backend validates only that it is non-blank and ≤200 chars (`schemas.ts:45`, `index.ts:258-261`). **Any client can save any string.** See § 4 D-2 |
| I-9 | Every saved translation and sentence is in one of the collection's target languages | *Implied* by FR-013 (`prd.md:98`) and US-01's acceptance criterion at `prd.md:52` | **ENFORCED in three separate hand-written places** — `index.ts:299-304` (save), `:379-381` (backfill), and case-insensitively at `:385`. No database constraint; no shared helper |
| I-10 | An entry holds at most one translation per target language | **Contradicts** FR-009 (`prd.md:82`), which asks for several variants | **ENFORCED**, `UNIQUE(entry_id, language_code)` at `migrations/1784584360698:52-54`, plus the route pre-check at `index.ts:281-286`. This is the constraint that makes the Core requirement unrepresentable — see § 4 D-1 |
| I-11 | An entry holds at most one sentence per target language | Nowhere. Not a document rule | **HALF-ENFORCED.** The route rejects duplicates (`index.ts:281-286`), but `entry_sentences` has **only an index** (`migrations/1784584360698:68`) — no unique constraint. The comment at `index.ts:279-280` claims both tables hit `UNIQUE(entry_id, language_code)`; for sentences that is **false** |
| I-12 | A saved entry never disappears without an explicit user action | `prd.md:37` (guardrail) | **ENFORCED BY ABSENCE.** No `DELETE` route exists anywhere in the API; the only deletion path is `ON DELETE CASCADE` from a collection that also cannot be deleted |
| I-13 | Blank text is never saved, and blank input never reaches the AI | `prd.md:51` (acceptance criterion) | **ENFORCED**, `index.ts:258-261`, `:273-278`; `schemas.ts:30` (`minLength: 1`) |

### A-3 — Sense / TranslationVariant (**candidate that does not exist**)

The concept the whole Core depends on: *one distinct meaning of the captured
word in one target language, carrying its own IPA and its own example
sentences.*

| # | Invariant | Source | Status |
| --- | --- | --- | --- |
| I-14 | Every example sentence belongs to exactly one sense — never to a language in general | The AI contract nests it structurally (`translate.ts:26-30`: `sentences` live *inside* `TranslationVariant`), and the popup guards it explicitly: *"Attaching one sense's sentences to another is exactly the mismatch that nesting sentences under variants exists to prevent"* (`App.tsx:285-287`) | **IGNORED IN PERSISTENCE.** `entry_sentences` links a sentence to `(entry_id, language_code)` — `migrations/1784584360698:56-67` — and carries **no reference to a translation**. The nesting is flattened into two sibling arrays at read time (`index.ts:197-213`, `frontend/src/api/collections.ts:31-32`). It survives today **only** as a side effect of I-10: with one sense per language, "the sentence for this language" and "the sentence for this sense" happen to be the same row |
| I-15 | A sense is identified by its meaning, not by its position | `App.tsx:283-290` — regeneration re-finds the sense by `sameMeaning`, *"never by position"* | **ENFORCED IN ONE CLIENT ONLY**, as a lowercase-trim string comparison (`App.tsx:36-38`). Nothing server-side knows a sense has an identity |
| I-16 | A word with several meanings keeps them all | `prd.md:82` (FR-009), which exists precisely *"dla słów wieloznacznych"* | **IGNORED.** Measured on real data: `roadmap.md:183` — *"`zamek` … „castle" i „zipper" nigdy nie trafiły do bazy"* |

### A-4 — User

| # | Invariant | Source | Status |
| --- | --- | --- | --- |
| I-17 | A user reaches only their own collections and entries | `prd.md:125` | **ENFORCED** on every id-accepting route via `fetchOwnedCollection` / `fetchOwnedEntry` (`ownership.ts:19-38`, called at `index.ts:160,230,288,367,372`) — ownership is folded into the fetch, so an unowned row is indistinguishable from a missing one |

---

## 4. MODEL vs CODE — where the divergences are

The most valuable section: places where the domain knowledge exists in writing
and the code does not reflect it.

| # | The document says | The code does | Evidence | Severity |
| --- | --- | --- | --- | --- |
| **D-1** | *"System zwraca **kilka wariantów** tłumaczenia … dla słów wieloznacznych"* — several distinct meanings per target language, and the tool schema calls them *"The distinct meanings of the word"* | Persists **exactly one** meaning per (entry, language), and drops the rest at save time. The sense concept has no table, no id, and no foreign key | `prd.md:82` / `translate.ts:71-77` vs `migrations/1784584360698:52-54`; measured at `roadmap.md:183` | **Highest.** The Core differentiator is generated, shown, and then thrown away |
| **D-2** | *"reguła … sprowadza wpis do formy w języku ojczystym zbioru jako **bazowej dla zapisu**"* | The backend never checks it. `wordOrPhrase` is accepted as any non-blank ≤200-char string; only `source_language_code` is stamped server-side | `prd.md:117`, `prd.md:46` vs `schemas.ts:45`, `index.ts:258-261,316`. The rule is applied at `App.tsx:244,374` — in one client | **High.** A core invariant enforced in the least trustworthy layer |
| **D-3** | FR-018 backfills a language *"nowo dodanym"* — newly added to the collection | No route can add a language to an existing collection. The feature's trigger is unreachable through the product | `prd.md:100` vs the 9-route surface (`api-construct.ts:149-208`, `collections/index.ts`); already recorded at `roadmap.md:190` | **High.** A shipped must-have whose precondition cannot occur |
| **D-4** | A sentence illustrates *this meaning* — the AI contract nests sentences under variants, and the popup calls cross-wiring them the mismatch the nesting exists to prevent | Storage flattens the nesting: `entry_sentences` keys on `(entry, language)` with no link to a translation; the read model returns two sibling arrays | `translate.ts:26-30`, `App.tsx:285-287` vs `migrations/1784584360698:56-67`, `index.ts:197-213` | **High**, and *latent*: correct today only because D-1's constraint forces one sense. Relaxing D-1 without fixing D-4 silently corrupts pairings |
| **D-5** | FR-011 — the user chooses the sentence | The backfill path chooses by array position, and says so: *"take the model's first one and its first sentence"* | `prd.md:86` vs `index.ts:396-399` | Medium. Consistent with FR-018's own wording, but the same domain question gets two different answers on two paths |
| **D-6** | FR-013 — the last-used collection is the default, and `prd.md:99` makes it matter *before* generation, since it decides which languages are requested | Stored per browser profile in `browser.storage.local`; the server has no idea. A second device, or the web app, starts with no default | `prd.md:98-99` vs `App.tsx:10,158,397` | Medium |
| **D-7** | The route comment asserts the duplicate-sentence case *"hits UNIQUE(entry_id, language_code)"* | `entry_sentences` has **no** unique constraint — only an index. The claim is true for translations, false for sentences | `index.ts:279-280` vs `migrations/1784584360698:52-54` (translations) and `:68` (sentences, index only) | Medium. The route guard is currently the *only* thing preventing duplicate sentences |
| **D-8** | FR-017 — 1 to 5 target languages | Enforced only in the request schema. The database accepts any count | `prd.md:70` vs `schemas.ts:11-14`; no constraint in `migrations/1785419841325` | Low today (one writer), rises the moment anything else writes |
| **D-9** | The PRD never states which languages exist | The domain has exactly eight, hard-coded and duplicated across three apps | `backend/src/languages.ts:4`; `extension/src/languages.ts`; `frontend/src/languages.ts` | Low. But the vocabulary of a *language*-learning product is undocumented |
| **D-10** | I-3 (native ≠ target) is enforced in code as a first-class rule | The PRD never states it. It is inferable from FR-015 and the gloss direction, but a reader of the PRD alone would not know it | `index.ts:124-126` vs `prd.md` (absent) | Low. A **reverse** divergence: the code knows something the document does not |

**The pattern.** D-1, D-2 and D-4 are the same failure with three faces: the
richest, most domain-loaded structure in the system — the AI response, which
*correctly* models word → language → sense → sentence — is progressively
flattened as it moves toward storage. The model boundary knows the domain best;
the database knows it least.

---

## 5. Refactor ranking

Ranked by **value** (how central the invariant is to the product's reason for
existing) against **risk** (how weakly it is enforced today).

| Rank | Aggregate candidate | Value | Risk | Net |
| --- | --- | --- | --- | --- |
| **#1** | **Sense as a first-class part of the Entry aggregate** (A-3: I-14, I-15, I-16 / D-1, D-4) | **Core.** FR-009 is the differentiator named in the vision | **Ignored in persistence.** No table, no id, no FK; sense identity is a lowercase string match in one client | **Highest** |
| **#2** | **Entry's normalized native form** (A-2: I-8 / D-2) | **Core.** It is what makes an entry addressable and printable | **Declared only.** Enforced in the popup; the API accepts anything | High |
| **#3** | **Collection's language contract as a real boundary** (A-1/A-2: I-9, I-2 / D-8) | **Core.** Every downstream behaviour reads from it | **Enforced but scattered** — the same membership rule is hand-written three times, with no shared helper and no DB constraint | Medium-high |
| #4 | Collection mutability (I-6 / D-3) | Supporting | Unreachable feature; needs a product decision before a model one | Medium |
| #5 | Last-used collection as domain state (D-6) | Supporting | Client-local; cheap to move, low blast | Low |

### #1 — Make the sense an entity inside the Entry aggregate

**The invariant that should always be true and today is not representable:**
*every example sentence belongs to exactly one sense, and a word with several
meanings keeps them all.*

**Why it ranks first.** It is the only candidate where the **Core** requirement
is generated correctly, displayed correctly, guarded correctly in the popup —
and then discarded by the schema. `prd.md:82` exists specifically for ambiguous
words; `roadmap.md:183` measured the loss on real data (`zamek` → only `lock`).
Every other candidate is a rule that is enforced in the wrong *place*; this one
is a rule the model **cannot express at all**.

**Why it is also the highest-risk thing to leave alone.** D-4 is currently
masked by D-1. `entry_sentences` keys on `(entry_id, language_code)`; sentence-
to-sense pairing is correct today only because `UNIQUE(entry_id, language_code)`
on `entry_translations` allows exactly one sense per language. **Anyone who
relaxes the uniqueness constraint to satisfy FR-009 — without first giving
sentences a sense reference — silently cross-wires sentences and meanings**, and
nothing in the system would detect it. The popup's own comment
(`App.tsx:285-287`) names that exact failure as the thing the AI contract's
nesting exists to prevent. That is a trap laid for the next person who touches
this, and it is already on the board as IL-41 (`roadmap.md:183`).

**Target shape, named but not designed** (per the boundary of this exercise):
`entries → entry_translations` becomes the sense-bearing relation, and
`entry_sentences` hangs off a *translation*, not off `(entry, language)`. The
Entry aggregate's root stays `entries`; the aggregate boundary grows to include
senses as parts, and the invariant I-14 becomes a foreign key rather than a
convention.

**Two things a planning session must weigh, not this document.** First, IL-41
and IL-24 (`roadmap.md:176,183`) both touch this schema, and IL-24's unit of
reuse is *the sense* — so the two must agree on shape if either moves.
Second, this is a **business-concept** change, not a code-structure one, which
is exactly why `context/changes/refactor-opportunities/research.md` § 1.3
excluded it from its structural ranking. The two rankings are not in conflict:
that document deferred what a domain lens is supposed to surface. Its #1
(the undeclared response contract) is the instrument that would make this
change safe across four apps; this document's #1 is the change itself.

---

## Limitations of this distillation

- Documents are in Polish, code in English; every mapping in § 1 crosses that
  boundary and was made by reading both sides, not by name matching.
- `shape-notes.md` predates multi-language collections and disagrees with the
  PRD on the Core rule; the PRD was treated as authoritative (§ 0.1).
- Enforcement statuses in § 3 were read from source, not exercised at runtime.
  "Enforced" means a code path rejects a violation, not that a test proves it.
- No `context/archive/` change was mined for design intent. Where a rule's
  origin is not in a living document or at the line, this document says the
  origin is **unknown** rather than reconstructing it.
- Aggregate *boundaries* are proposed as candidates only. Whether Entry is its
  own root or a part of Collection is a modelling decision this document
  deliberately leaves open — § 5 names the trade-off and stops.
