---
artifact: decision-brief
change_id: translation-pivot
date: 2026-08-21
status: draft
synthesizes: >
  context/changes/translate-flow-analysis/research.md,
  context/changes/translation-pivot/research.md,
  context/changes/translation-pivot/change.md,
  context/changes/translation-cache/{change.md,research.md}
audience: a reviewer deciding whether this refactor is justified and ready to plan
---

# Translation pivot — decision brief

One page on why this refactor, why this shape, and what is still open.
Evidence lives in the two `research.md` files; this does not repeat them.

## The problem, measured

The capture → translate → save flow calls Claude Haiku 4.5 once per capture,
with a tool schema describing every target language. Measured against the live
API on 2026-08-01 (`pl` → 5 targets):

| | Input tok | Output tok | Cost |
|---|---:|---:|---:|
| "zamek" (ambiguous) | 1,238 | 1,725 | $0.0099 |
| "kot" (simple) | 1,237 | 809 | $0.0053 |
| "zamek", 1 target | 1,226 | 308 | $0.0028 |

**≈$7.57 per 1,000 captures**, output 77–87% of the bill. Of the ~1,238 input
tokens, **922 (81%) are the tool schema itself** — the JSON description of
5 languages × variants × sentences × glosses, re-sent on every call.

Nothing is reused. Two users capturing `zamek` pay twice. The same user
capturing it in a second collection pays twice. Adding a ninth language
re-generates every word from scratch.

Haiku 4.5 pricing re-verified 2026-08-20: unchanged at $1.00 / $5.00 per MTok.
The cost baseline stands; only the token counts are un-remeasured.

## Why not the smaller fix

`context/changes/translation-cache/` scoped a cache keyed on
`(word, native_lang, target_lang)`. It was abandoned 2026-08-02 for being the
smaller idea, not the wrong one: it caches *in front of* the model while
leaving the unit of reuse as the word. Its own research found the scope was
not achievable as written — the lazily-grown sentence pool that FR-012
regeneration requires needs a set cursor, and `translateBodySchema` carries
only `text`, so "no API contract change" and "a working pool" are mutually
exclusive. Its substantive findings carry over unchanged.

Seeding arithmetic is what settles it: per-word caching costs ~$304 to seed
10k words across all 8 native languages, because every language pair is its
own row. Sense-level reuse costs **$4 once**, because one seed serves all.

## The decision

**English is the pivot. A concept — one sense — is the unit of reuse. Every
language hangs off it as a spoke.** The model generates *only* English senses
and English sentences; translation outward comes from Wiktionary and a machine
translator, never the model; IPA comes from Wiktionary with an espeak-ng
fallback, never the model.

Four sub-decisions, each with its alternatives on record:

1. **Concept identity: two-tier, keyed on the ILI.** Look up candidate OEWN
   synsets for the model's English lemma; ask the model to pick one or answer
   "none"; a pick keys the concept on that synset's **ILI**, a miss mints a
   local concept with `ili = NULL` keyed on `(en_lemma, normalized_gloss)`.
   - *Rejected:* gloss string-matching alone (concept proliferation),
     `(en_lemma, sense_index)` (sense order is not stable across generations —
     the extension already works around exactly this at `App.tsx:35-37`).
   - *Why the floor tier is not an exception path:* `wordOrPhrase` accepts 200
     characters, and phrases have no lexical sense. Tier 4 is the majority path
     for multi-word captures.
2. **OEWN is an English-only concept registry, not a cross-lingual index.**
   The reverse lookup runs against `concept_translations`, which Wiktionary and
   MT populate. Two spokes land on one concept because both were *written*
   pointing at it, not because anything compares them at query time.
3. **Spokes come from the English Wiktionary edition**, whose translation
   tables are sense-tagged — the single best asset the research found — and
   which covers all eight codes including Ukrainian, for which no edition of
   its own exists.
4. **MT behind a provider-agnostic seam, Azure as the default**, decided by a
   bake-off rather than reputation. ~1,000-concept eager seed for a reviewable
   corpus, lazy long tail thereafter.

## What the research changed about the original design

Two claims in `change.md` did not survive, and both are now annotated there:

- **OEWN synset IDs are not stable across editions.** The ILI is. *apricot
  (fruit)* is `07750872-n` in WordNet 3.0 and `07766848-n` in 3.1. Keying on
  the synset ID would have silently broken on the first fixture upgrade.
- **The national-wordnet cross-linking does not exist for three of eight
  languages.** German GermaNet is academic-only, Russian RuWordNet is
  non-commercial, Ukrainian has no wordnet at all. Survivable only because of
  decision 2 above — had the design depended on cross-lingual wordnets, this
  would have been fatal.

A third correction is arithmetic: **DeepL's free allowance is 1,000,000
characters one-time**, not 500k/month. That is capital, not income, and it
inverted the seeding plan.

## Cost, projected

| | Current | Pivot |
|---|---:|---:|
| AI call on a miss | ~$0.0076 | ~$0.0008 |
| Seed 10k words, one native language | $38 | $4 |
| Seed 10k words, all 8 natives | ~$304 | **$4** |
| Repeat word, new target language | full price | **$0** |

The ~10× drop on a miss is the tool schema: "give me 3 English sentences for
this word" needs a fraction of 922 tokens and emits ~100 output tokens instead
of 1,725. These are projections — the English-only tool schema does not exist
yet.

Storage for 10k concepts × 8 languages ≈ 90 MB, inside Neon's 0.5 GB free tier.

## What this buys beyond cost

- **Shared sentences across languages** — one `en_text`, N renderings.
  Structural, not an optimization.
- **FR-012's regenerate pool** — `set_index`. The model runs only when the
  pool is dry.
- **FR-018 backfill costs nothing** — adding a language to a saved entry
  becomes a translation of existing renderings, with no AI call.

## Still open — and who owns each

| # | Question | Blocks | Needs |
|---|---|---|---|
| Q1 | Measured ILI-mapping rate over real captured words — how many map, mint, or mint a *duplicate* | IL-29 (schema) | **Live API calls — explicit permission** |
| Q2 | Granularity display rule. WordNet gives `castle` five synsets; showing a learner five is worse product, not better | IL-29 | Product decision |
| Q3 | Does the model reliably answer "none of these" rather than forcing a bad pick | IL-29 | **Live API calls — explicit permission** |
| — | The bake-off: 30 sentences × 7 languages × 3 providers | IL-38 | Authorization + human judgement of output quality |
| — | Which 1,000 words? No ranked English wordlist exists in this change | IL-38 | Frequency list or Wiktionary translation-table richness |
| Q10 | Provider terms on storing and redistributing MT output | licensing posture | Settle with §4.5, not after |
| — | Licensing posture — recommended: accept share-alike on the derived database | IL-32 | Decision |

**One schema requirement is already firm regardless of the posture chosen:**
`concept_translations.source` (`wiktionary` / `deepl` / `model` / `wordnet`).
Provenance is cheap at insert time and impossible to reconstruct later.

## Risks carried knowingly

- **The pivot bakes a semantic choice into the schema.** English distinguishes
  castle / lock / zipper for `zamek` — a good outcome. English forces a
  hand/arm split on Russian `рука` that Russian does not make. Decide it; do
  not inherit it.
- **MT sentence quality is the pedagogical artifact**, not a convenience. The
  bake-off exists because a reputation was standing in for a measurement — the
  same shape as `lessons.md`'s "A stubbed AI client cannot tell you the model's
  output is usable".
- **Granularity, not identity, is the real risk** in the WordNet tier. The
  mapping is an easier problem than open WSD (choosing among synsets that share
  a lemma, definitions supplied), but it is still an accuracy cost.

## Status

Nothing is built. `change.md` is at `status: preparing`; the schema
(`concepts`, `concept_translations`, `concept_sentences`,
`sentence_renderings`) is designed but unwritten, and lands *alongside* the
existing tables rather than replacing them, so nothing saved in the meantime is
stranded. Jira: epic IL-24, tasks IL-27 … IL-32 plus IL-38.

**Stale link to clear:** IL-24 is marked blocked-by IL-5 (S-04) and IL-21
(S-05). Both shipped and were archived on 2026-08-04. The epic is showing
blocked when it is not.

**One stale line in `research.md` §4.6:** it says S-04 `printable-export` "is
being built now" and recommends leaving room for the license footer during that
work. S-04 was archived 2026-08-04 — the attribution footer on FR-014's export
is a retrofit now, not a concurrent change. The obligation itself is unaffected.
