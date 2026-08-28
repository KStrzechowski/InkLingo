---
change_id: invariant-aggregate-refactor
title: Invariant aggregate refactor
status: impl_reviewed
created: 2026-08-25
updated: 2026-08-29
archived_at: null
---

## Notes

Implements the design in `context/domain/02-invariant-aggregate-refactor.md`
(written at `f6e3aab`) — the `Entry` aggregate that guards sense integrity.
Tracked as **IL-41** (tasks IL-42 ... IL-45).

`research.md` re-grounds that design against HEAD after the anti-corruption-layer
change landed. Read it first: the design holds, but many of the doc's `file:line`
anchors are stale, and three of them now point at things a test forbids.

**Phase 0 was run during research** (2026-08-25, read-only, dev Neon branch) —
numbers in `research.md` § 4. The migration is safe on today's data; three rows
need a disposition decision before Phase 3, and four rows would violate the
proposed aggregate's constructor invariants on read (§ 5).

**Phase 4 decision (2026-08-27): the frontend web app breaks too, same as the
extension.** Item 7's "client shape copies" line only asked for
`addEntryTranslation`'s return type, but `GET /:id` also went nested in this
phase (item 5) and `frontend/src/api/collections.ts` / `CollectionDetailPage.tsx`
are hand-copied, not derived — so nothing forces them to notice. Fixing either
route without doing Phase 6's real rework meant building a temporary
flatten-to-old-shape adapter, which cuts against decision A3's "no shims" rule.
Decided instead to leave both files untouched: `tsc -b` and `vite build` still
pass (the types are hand-copied and don't fail to compile), but
`CollectionDetailPage`'s rendering of real entries and the backfill button are
broken against a live backend from this phase until Phase 6 lands — the same
window shape as the popup's Phase 2→5 gap, just for the web app and Phase 4→6.
No frontend files were touched in Phase 4 as a result. Resolved in Phase 6:
`api/collections.ts`, `CollectionDetailPage.tsx` and `addEntryTranslation`'s
return type were all reworked together.

## Load-bearing names

Registered here per design § 5.10, since `docs/reference/contract-surfaces.md`
does not exist in this repo (no `docs/` directory). Names as actually built,
not as first proposed — two index/constraint names below differ from the
design doc's guess (`_key` suffix, not `_idx`, matching this project's existing
Postgres naming).

| Name | Kind | Note |
| --- | --- | --- |
| `Entry`, `Sense`, `SenseTranslation`, `Sentence` | Domain types (`backend/src/domain/`) | `Sense` is **entry-level**; `Sentence` deliberately has no `languageCode` |
| `glossText` | Domain field | The meaning, in the collection's **native** language |
| `senseKey()` | Domain function | The identity rule; the IL-24 seam |
| `LanguageContract` | Value object | Required to construct an `Entry` — this *is* INV-9 |
| `DomainError` + 8 named subclasses (`backend/src/domain/errors.ts`) | Error taxonomy | Mapped to HTTP in one place |
| `mapDomainError` (`backend/src/routes/api/collections/mapDomainError.ts`) | Application helper | The only domain→HTTP translation site |
| `entryRepository.{loadContract,contractFor,loadEntry,loadEntries,insertEntry,appendLanguage}` | Repository surface (`backend/src/repositories/entryRepository.ts`) | Non-interactive transactions only |
| `entry_senses` (`gloss_text`, `sense_key`) | Table | The meaning as a first-class row; later grows `concept_id` for IL-24 |
| `entry_translations.sense_id` | Column | Ties a word to the meaning it expresses |
| `entry_sentences.translation_id` | Column | INV-12 as a foreign key |
| `entry_senses_entry_id_sense_key_key` | Unique constraint | INV-13/14 as a database key |
| `entry_translations_sense_id_language_code_key` | Unique constraint | INV-10, one level down |
| `senses[]` (AI tool schema, request, response) | Wire contract | Replaces `languages[].variants[]` and the `translations[]`/`sentences[]` pair, in three clients and the tool schema |
| `alignSenseTranslations`, `senseTranslationFromProviderPayload` | AI adapter surface (`backend/src/domain/translationDraft.ts`) | The second is D-2's crossing point — one already-known meaning, one language, one word |
| `senseTranslationTool` (`backend/src/adapters/anthropicTranslator.ts`) | AI adapter surface | D-2's second tool schema; shares `TRANSLATION_TOOL_NAME` with the capture tool by design |

`toLegacyLanguageShape` from the design's own table was never built — decision
A3 ruled out version-skew shims outright, so there was never a legacy shape to
project onto.

## Phase 7: deliberate-break check (2026-08-27)

Both preconditions confirmed load-bearing by removing each from
`backend/src/domain/entry.ts`'s shared `buildTranslation` and re-running
`entries.test.ts`:

- **`LanguageNotTaughtError`** (INV-9): with the guard removed, `POST
  /api/collections/:id/entries rejects a language the collection does not
  teach with 400` failed as `201 == 400` (created instead of rejected). Every
  other test in the file stayed green. Guard restored; full suite (190/190)
  confirmed green again.
- **`TranslationWithoutSentenceError`** (INV-12): with the guard removed,
  `POST /api/collections/:id/entries rejects a translation with no sentences
  with 400` failed the same way — `201 == 400`. Guard restored; full suite
  confirmed green again.

## Phase 7: dead column drop

`entry_sentences.language_code` dropped via migration
`1787851002435_drop-sentence-language-code`. Verified against the dev Neon
branch: `up()` applied cleanly, backend suite went 190/190 green (24 tests
failed first, before the migration was applied — `entryRepository.ts` had
already stopped writing the column); `down()` re-added it nullable and
backfilled from the parent translation with zero mismatches
(`entry_sentences.language_code` vs `entry_translations.language_code` via
`translation_id`, spot-checked with a direct query); `up()` re-applied
cleanly.

## Phase 7: live verification (2026-08-27, authorized)

Run via `context/changes/invariant-aggregate-refactor/measure-capture.mjs`
and `measure-backfill.mjs` against the real Anthropic API (`claude-haiku-4-5`),
one raw attempt per case — bypassing the adapter's own `EMPTY_DRAFT_RETRIES`
retry, since the retry's justification is exactly the raw rate these scripts
measure.

### Capture surface — 13 calls

Ambiguous words, unambiguous words, two phrases, 1 and 5 target languages, a
word captured from a target language rather than native, one obscure word.

- **Degenerate/malformed rate: 0/13 (0%).** Down from the ~3-in-34 (~9%)
  measured against the old language-first schema — but 13 trials is not
  enough to conclude the true rate dropped that far; see the retry decision
  below.
- **Cost: $0.08022 total, $0.00617/call average.** 1,000 captures ≈ $6.17.
- **Latency: 6,162ms average** (1,888ms for a 1-language unambiguous word up
  to 11,503ms for a 5-language ambiguous one).
- **Token headroom: 88.1% average** — `MAX_TOKENS_PER_SENSE_LANGUAGE *
  MAX_BUDGETED_SENSES` (10,240 for 5 languages) is generously sized; actual
  output ran 776-1,706 tokens on the 5-language cases.
- **Grouping quality, eyeballed:** `zamek` correctly split into castle vs.
  lock across all 5 languages under matching glosses; `bank` correctly split
  into financial-institution vs. riverbank; unambiguous words and phrases
  correctly stayed single-sense.
- **Real finding — not caught by any automated check:** `kara` (Polish
  "punishment/fine") returned a well-formed, non-degenerate, entirely wrong
  answer three separate times (jewelry: "bransoleta"/bracelet, "bangle"; then
  anatomy: "nape of the neck") — re-rolled twice specifically to check this
  wasn't a one-off, and it reproduced with a *different* wrong answer each
  time. This is a model-accuracy limit, not a system defect: the aggregate
  correctly persists whatever the model asserts, and nothing in the pipeline
  can distinguish a confident wrong answer from a correct one. Recorded here
  because it is exactly the class of failure `lessons.md` says a stub cannot
  reveal.

### Backfill surface (D-2) — 12 calls

Four sense-scoped pairs (`zamek` castle/lock × de/fr, `bank`
financial/riverbank × de/es — the exact case D-2 exists for: does the model
answer for THIS meaning and not drift to the word's others?), four
unambiguous single-meaning words/phrases across four more languages.

- **Failure rate: 0/12 (0%).**
- **Sense-scoping, eyeballed: correct in all 8 sense-paired calls** — `zamek`
  castle → `Festung`/`forteresse`, lock → `Verschluss`/`agrafe`; `bank`
  financial → `Bank`/`banco`, riverbank → `Ufer`/`orilla`. No drift to the
  word's other meaning in any call.
- **Cost: $0.02316 total, $0.00193/call average.** 1,000 backfills ≈ $1.93.
- **Latency: 2,001ms average** (1,605-2,322ms — a tight, predictable range,
  as expected for a one-meaning-one-language ask).
- **Token headroom: 60.7-74.8% of the 512 ceiling** — tighter than the
  capture surface's, as expected for a smaller answer shape, with no case
  close to the ceiling.

### Combined

- **25 live calls, $0.10338 total** — within the pre-authorization estimate
  ($0.10-$0.25).
- **Retry decision: `EMPTY_DRAFT_RETRIES` stays at 1.** The measured
  degenerate rate (0/13) doesn't disprove a rate near the old ~9% — at that
  true rate, 13 trials show zero failures about 30% of the time. The retry
  only spends anything on an actual empty response, which is itself cheap
  (`lessons.md`'s own number: ~167 tokens, ~1.3s), so the cost of keeping an
  unexercised safety net is low against the cost of removing it and being
  wrong.
- **Comments updated** in `anthropicTranslator.ts` (`EMPTY_DRAFT_RETRIES`,
  `MAX_TOKENS_PER_SENSE_LANGUAGE`) and `translator.ts`
  (`DegenerateDraftError`) to carry these numbers instead of the stale
  language-first ones.

### Manual verification (2026-08-28, user-confirmed)

Full end-to-end pass across the extension, frontend, print, and backfill,
run by the user against the real dev backend:

- Captured `zamek` in the extension, checked two meanings, picked a
  sentence per language under each, confirmed picking a sentence under one
  meaning does not clear the other meaning's pick in the same language,
  saved. Confirmed both meanings persisted via the frontend's `GET`.
- Printed the collection: `Znaczenie` column present, native-language
  furniture, meanings own their rows, word spans the band.
- **4.9's real gap, found during this pass**: the app has no way to add a
  target language to an *existing* collection (create-only), and the
  extension always requests every current target for a checked meaning, so
  FR-018's "Add X" backfill button can't arise through ordinary use — only
  through direct data manipulation, same as the fixtures the automated
  suite already uses. Worked around by seeding one entry directly into the
  user's own dev-branch collection (two meanings, `en`+`ru` only) so the
  button had something to act on; clicking it produced two French
  translations, one per meaning, confirming D-2 end to end through the real
  UI. This gap is pre-existing (not introduced by this change) and out of
  this plan's scope — worth its own change if it's worth closing.
- **Two environment bugs found and fixed along the way, neither a defect in
  this change's code**:
  - The manual-verification walkthrough itself first told the user to
    build the extension with `npm run build` (production, targets the
    deployed API) while running the backend via `npm run dev`
    (`localhost:3000`) — a mismatch that surfaced as a "Not Found" error
    inside the popup (API Gateway's generic 404 body). Fixed by rebuilding
    with `npm run dev` instead.
  - `backend`'s `npm run dev` script (`fastify start -l info -P
    src/app.ts`) has no watch flag despite `CLAUDE.md` describing it as
    "start with hot reload" — a long-running dev session missed the
    Phase 7 migration + `entryRepository.ts` change entirely and threw
    `column "language_code" of relation "entry_sentences" does not exist`
    until manually restarted. The doc/script mismatch is real but out of
    this change's scope to fix.
