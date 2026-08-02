---
change_id: translation-pivot
title: Re-architect translation around English-pivot concepts with sense-level reuse
status: new
created: 2026-08-02
updated: 2026-08-02
archived_at: null
---

## Notes

Supersedes `context/changes/translation-cache/` (now `blocked`). That change
scoped a per-`(word, native, target)` cache; this one changes the unit of
reuse from the *word* to the *sense*, which makes the cache a property of the
schema rather than a layer bolted in front of the model.

**Its `research.md` remains valid and should be read alongside this file** —
the `generateWithTimeout` seam, the FR-012 regeneration findings, the
test-isolation problem, and the manual-verification interference all carry
over unchanged.

### The architecture

English is the pivot. A **concept** (one sense) is the cache unit; every
language hangs off it as a spoke.

```
concepts                  -- one row per distinct sense
  id, en_lemma, en_gloss

concept_translations      -- the spokes
  concept_id, language_code, lemma, ipa

concept_sentences         -- canonical English sentences
  concept_id, set_index, en_text

sentence_renderings       -- per-language renderings
  sentence_id, language_code, text
```

Lookup for "user types `zamek`, native `pl`, targets `en,de,fr,es,it`":
find concepts via `concept_translations WHERE language_code='pl' AND
lemma='zamek'` → three concepts (castle / lock / zipper) → pull the five
target translations and the sentence renderings. On a miss: generate English
senses + English sentences, translate outward, insert.

**Division of labour:** the model generates *only* English senses and English
sentences. Translation outward is done by translators (Wiktionary where
present, DeepL otherwise), never the model. IPA comes from Wiktionary with an
espeak-ng fallback, never the model.

### What this design gives for free

- **Shared sentences across languages** — one `en_text`, N renderings. This
  was requested as a cost optimization; here it is structural.
- **The FR-012 regenerate pool** — `set_index`. Regenerate serves the next
  set; the model runs only when the pool is dry.
- **FR-018 backfill costs nothing** — adding a language to a saved entry is a
  translation of existing renderings, with no AI call at all.
- **Adding a 9th language** becomes a batch translation job, not a per-word
  regeneration.

### Cost (measured baseline vs projected)

Current architecture, measured against the live API on 2026-08-01
(`claude-haiku-4-5-20251001`, native `pl`, 5 targets):

| Capture | Input | Output | Cost |
|---|---:|---:|---:|
| "zamek" (ambiguous) | 1,238 | 1,725 | $0.0099 |
| "kot" (simple) | 1,237 | 809 | $0.0053 |
| "zamek", 1 target | 1,226 | 308 | $0.0028 |

≈ **$7.57 per 1,000 captures**; output is 77–87% of the bill.

Projected under the pivot (estimates, not measured — the English-only tool
schema does not exist yet):

| | Current | Pivot |
|---|---:|---:|
| AI call on a miss | ~$0.0076 | ~$0.0008 |
| Seed 10k words, one native language | $38 (batch) | **$4 (batch)** |
| Seed 10k words, all 8 natives | ~$304 | **$4** — one seed serves all |
| Repeat word, new target language | full price | **$0** (translation only) |

The ~10× drop on a miss comes from the tool schema: 922 of the current 1,238
input tokens exist purely to describe 5 languages × variants × sentences ×
glosses. "Give me 3 English sentences for this word" needs a fraction of that
and emits ~100 output tokens instead of 1,725.

Storage for 10k concepts plus translations into 8 languages ≈ 90 MB, inside
Neon's 0.5 GB free tier (100 CU-hours/month; Launch is usage-based at
$0.35/GB-month with no minimum, so overflow is pennies rather than a cliff).

### The hard problem: concept identity

This decides whether the design works. When a Russian user types "замок", how
do we know it is the same concept row as Polish "zamek" → castle? Options, in
increasing order of robustness and cost:

1. **Normalized English gloss string-match** — simple, fragile. The model
   returns slightly different glosses each run, producing concept
   proliferation (the same castle stored five times).
2. **Key on `(en_lemma, sense_index)`** — cheap, but sense ordering is not
   stable across generations. The extension already works around exactly this
   non-determinism by pairing on meaning text, never position
   (`extension/src/popup/App.tsx:35-37`).
3. **Open English WordNet synsets as the backbone** — stable synset IDs,
   CC-BY, comprehensive for English, with national wordnets (plWordNet,
   Russian) cross-linked via the Interlingual Index. Turns "have we seen this
   sense?" from a fuzzy string comparison into a key lookup. Cost: a mapping
   step from model output to synset, which is its own accuracy problem.

Option 3 is the one to investigate first.

### Known gaps and decisions to make

- **Pivot loses source-language sense boundaries.** Routing through English
  means the meanings shown are the ones English distinguishes. Polish "zamek"
  → castle/lock/zipper splits cleanly and is a *good* outcome; Russian "рука"
  covers hand and arm, where English forces a split Russian does not make.
  This is a semantic decision being baked into the schema — decide it, do not
  inherit it by accident.
- **MT sentence quality is the pedagogical artifact**, not a convenience. A
  German sentence written in English and machine-translated can be
  grammatical but stilted, and won't use the idiom a German speaker would
  reach for. Eyeball ~20 before committing to seeding.
- **Phrases have no lexical sense.** `wordOrPhrase` accepts up to 200 chars;
  phrases bypass the concept model and go straight to generation.
- **Sparse spokes.** Some concepts have no single-word equivalent in a given
  language, so `concept_translations.lemma` will sometimes hold a phrase.
- **DeepL Free is 500k chars/month.** At ~3 sentences × 6 languages × ~70
  chars ≈ 1,260 chars per new concept, that is roughly 400 new concepts per
  month before hitting the cap. Fine at current scale; a real ceiling later.
- **CC-BY-SA (Wiktionary) and CC-BY (WordNet)** — attribution obligations,
  and share-alike on Wiktionary-derived content, need a deliberate decision
  before shipping. Unresolved legal gate carried over from `translation-cache`.

### Why this is parked (2026-08-02)

Deliberately deferred, not abandoned. The PRD's hard deadline is **2026-08-05**
and the *Primary* success criterion ends with "wygenerowanie czytelnego,
gotowego do druku dokumentu A4" — i.e. **S-04 `printable-export`, which is not
built**. S-05 `pronunciation-playback` (FR-016, must-have) is also not built,
and S-03 still has five unticked manual-verification items.

The cost problem this change solves is real but small at current scale: with
`users: small` / `qps: low`, even 500 captures across all remaining
development is under $4 total. Finishing the MVP is worth more than saving a
few dollars. Resume after the certificate.

Low rework risk from building S-04/S-05 first: the pivot changes how
translations are *generated and reused*, while S-04 reads *saved* entries
(`entries` / `entry_translations` / `entry_sentences`) and S-05 is TTS. Both
sit downstream of the path this change rewrites. The pivot also adds concept
tables *alongside* the existing schema rather than replacing it, so nothing
saved in the meantime is stranded.

### Resuming this change

Read in this order:

1. This file — the architecture, the cost table, and the concept-identity
   problem.
2. `context/changes/translation-cache/research.md` — still the substantive
   research. Its *findings* hold; its **file:line anchors will have drifted**
   once S-04/S-05 land. Re-run `/10x-research translation-pivot` to re-anchor
   them; the reasoning does not need redoing.
3. `context/changes/translation-cache/change.md` — the superseded scope and
   why it was too small.

Re-verify before planning (each is cheap, and each could have moved):

- **Cost baseline** — re-run `measure-cost.mjs` in this folder. Model pricing
  and behaviour change; the 2026-08-01 numbers are a snapshot, and
  `lessons.md:33-38` requires measured numbers rather than estimates.
- **Is FR-012 regeneration still client-side re-sending the identical
  request?** (`extension/src/popup/App.tsx`) — the whole `set_index` pool
  design depends on this.
- **Does `translateBodySchema` still accept only `text`?** If a field was
  added for another reason, the set-cursor problem may already be solved.
- **Neon free-tier limits** (0.5 GB storage / 100 CU-hours as of 2026-08-01)
  and **DeepL Free's 500k chars/month** — both are vendor terms that move.
- **Whether S-04/S-05 changed the saved-entry schema** in a way that affects
  the concept tables.

The single decision that gates planning: **concept identity** (see above).
Investigate Open English WordNet synsets first.

### Carried over from `translation-cache/research.md`

- The cache seam is `generateWithTimeout`
  (`backend/src/routes/api/collections/index.ts:43-57`) — shared by the
  capture route and the FR-018 backfill route, so intercepting there covers
  both.
- **FR-012 regeneration is shipped**, implemented client-side
  (`extension/src/popup/App.tsx:167-212`) by re-sending the *identical*
  request. The server cannot currently distinguish a first capture from a
  regenerate: `translateBodySchema` accepts only `text`. Advancing `set_index`
  therefore needs either a request field (contract + extension change) or
  server-side per-user seen-set state.
- **A global cache breaks ~16 existing tests.** Every test in
  `backend/test/routes/api/translate.test.ts` uses the same input `'pies'`/`pl`,
  so tests 2..n would hit test 1's cached row and never reach the stub,
  breaking the retry call-count assertions at `:181`, `:209`, `:238`.
- **Run the pending Phase 4/5 manual verification before this lands** — steps
  3 and 5 of `capture-translate-save/follow-ups/pending-manual-checks.md` are
  both masked by a warm cache.
- `context/foundation/lessons.md:33-38` applies: this touches
  `backend/src/ai/`, so it needs real-API verification with recorded
  measurements, not just stubbed tests.
