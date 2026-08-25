---
date: 2026-08-20T23:48:50+02:00
researcher: KStrzechowski
git_commit: 259eaae663b3fcc87082d7b42d089b4c86e1abdb
branch: docs/repo-map
repository: InkLingo
topic: "Concept identity for the English-pivot re-architecture, and the three external-feasibility gates"
tags: [research, translation-pivot, concept-identity, wordnet, oewn, ili, wiktionary, wiktextract, deepl, licensing, cc-by-sa, il-24, il-27, il-32, il-38]
status: complete
last_updated: 2026-08-21
last_updated_by: KStrzechowski
last_updated_note: "Added follow-up research after the DeepL Developer plan was confirmed as 1M characters one-time. F.2/F.3 revised same session: Azure default over DeepL, bake-off decides, ~1k eager seed with a lazy long tail. F.5 records why."
---

# Research: concept identity, and the three external gates

**Date**: 2026-08-20T23:48:50+02:00
**Researcher**: KStrzechowski
**Git Commit**: `259eaae` (`docs(research): current-state analysis of the capture → translate → save flow`)
**Branch**: `docs/repo-map` (not pushed — no GitHub permalinks, local paths only)
**Repository**: InkLingo

## Research Question

Re-anchor and extend the parked English-pivot re-architecture (IL-24), focused
on **the single decision that gates planning: concept identity.** Investigate
Open English WordNet synsets as the backbone first, against normalized-gloss
string matching and `(en_lemma, sense_index)` keying. Also settle three
external-feasibility gates:

1. Which Wiktionary editions have usable machine-readable extracts for all
   eight supported codes (`en pl ru de fr es it uk`, `backend/src/languages.ts:4`).
2. DeepL Free's 500k chars/month ceiling against the seeding path.
3. The CC-BY-SA share-alike obligation.

**Explicitly out of scope, per the brief and already settled:**

- The capture → translate → save trace, its coverage map, and its blast radius
  are re-done as of `98ddef9` in `context/changes/translate-flow-analysis/research.md`
  and are **not** re-derived here.
- FR-012 regeneration is still client-side, re-sending the identical request
  (`extension/src/popup/App.tsx:258-340`), and `translateBodySchema` still
  accepts only `text` (`backend/src/routes/api/collections/schemas.ts:29-31`) —
  confirmed, unchanged, no work needed. The set-cursor problem is unsolved and
  still needs either a request field or server-side seen-set state.
- **No live Anthropic calls were made and `measure-cost.mjs` was not re-run.**
  Model *pricing* was verified from documentation (below); token counts were
  not re-measured.

## Summary

**Recommendation: adopt Open English WordNet as the backbone, but key on the
ILI, not on the synset ID — and design for partial coverage from day one.**
Four findings drive that, and two of them contradict what `change.md` currently
assumes.

1. **`change.md`'s option 3 is right about the license and wrong about two
   other things.** OEWN is CC BY 4.0 — the cleanest license in this whole
   research, and share-alike-free. But **OEWN synset IDs are *not* stable
   across editions** (`change.md:115` says they are). The stable identifier is
   the **ILI** (`i77784`-style), which OEWN carries on every synset and which
   CILI guarantees is permanent and never reused. Key the `concepts` table on
   the ILI; treat `oewn-XXXXXXXX-n` as a version-scoped display pointer.

2. **The cross-lingual half of option 3 does not exist for three of the eight
   languages, and the design does not need it.** `change.md:115-118` cites
   "national wordnets (plWordNet, Russian) cross-linked via the Interlingual
   Index". In practice: plWordNet ✅ (Princeton-style licence, commercial use
   permitted), Spanish MCR ✅ and Italian MultiWordNet ✅ (CC BY 3.0), French
   WOLF ✅ (CeCILL-C); **German GermaNet ❌ (academic-only, fee for commercial),
   Russian RuWordNet ❌ (non-commercial, email-request distribution), Ukrainian
   ❌ (no wordnet exists).** This sounds fatal and is not: in the pivot's
   schema the reverse lookup runs against `concept_translations`, which is
   populated from Wiktionary and DeepL — not from a national wordnet. WordNet
   is needed only as an **English-only concept registry**. Cross-lingual
   wordnets would be a seeding *accelerator* for four languages, never a
   dependency.

3. **The real risk in option 3 is granularity, not identity.** WordNet's sense
   inventory is famously too fine for downstream use — `castle` has five
   synsets, `star` has eight nouns two of which differ only by visibility from
   Earth. A vocabulary-learning app that shows a Polish learner five "castle"
   senses has made the product worse, not better, while satisfying FR-009's
   *kilka znaczeń*. The mapping step is also an accuracy cost: GPT-4-class
   models reach ~82% on fine-grained WSD benchmarks against ~85% for dedicated
   systems — but the pivot's mapping is a far easier problem than open WSD,
   because the model is choosing among the handful of synsets that share a
   lemma, with definitions supplied (definition-in-prompt is worth +4–9%).

4. **The seeding path is a Wiktionary problem, and Wiktionary answers it —
   through the *English* edition, not the per-language editions.** There is
   **no Ukrainian Wiktionary extract on kaikki.org** and none is planned in the
   26 editions listed. But the English edition covers all eight languages
   (Ukrainian: 80,952 senses, with IPA and inflections), and — verified by
   inspection — its **translation tables are sense-tagged**, which is exactly
   the shape `concepts` → `concept_translations` needs. Ukrainian appears in
   those tables even without an edition of its own.

Secondary but load-bearing:

- **The DeepL 500k/month figure is contested and must be confirmed
  first-party before planning.** Multiple 2026 sources say API Free and API
  Pro were withdrawn from new signups in July 2026, replaced by a **Developer**
  plan (one million characters *in total*, not per month) and **Growth**
  (~$26/mo + usage). If true, `change.md:139-141`'s "≈400 new concepts per
  month for free" is wrong in a way that changes the request-path design, not
  just the seed. DeepL's own docs pages do not enumerate plans and could not
  confirm or refute it. All eight languages are supported either way.
- **Wikimedia moved to CC BY-SA 4.0** (from 3.0). 4.0 explicitly covers *sui
  generis database rights*, which is precisely what bulk extraction of a
  translation table exercises — so the share-alike question is live for the
  database, not only for displayed strings. FR-014's printable export is the
  distribution act that triggers the attribution obligation.
- **Haiku 4.5 pricing is unchanged** at $1.00 / $5.00 per MTok, so
  `measure-cost.mjs`'s constants (`measure-cost.mjs:32-34`) are still correct.
  Neon's free tier is unchanged at 0.5 GB / 100 CU-hours, Launch is usage-based
  with no minimum, storage $0.35/GB-month. Only the *token counts* in the cost
  table are unverified.

---

# 1. Concept identity

## 1.1 First, what the backbone actually has to do

`change.md`'s framing ("when a Russian user types замок, how do we know it is
the same concept row as Polish zamek → castle?") makes this look like a
cross-lingual problem. Read against the schema at `change.md:34-46`, it is not.

The reverse lookup is:

```sql
SELECT concept_id FROM concept_translations
WHERE language_code = 'ru' AND lemma = 'замок'
```

Russian and Polish land on the same `concept_id` **because both spokes were
written pointing at that concept**, not because anything at query time compares
them. So the identity mechanism has exactly one job:

> When the model emits an English sense, decide whether that sense is already
> in `concepts` — and do it stably enough that ten independent generations of
> "castle" produce one row, not ten.

That is a **monolingual English de-duplication problem**. Everything
cross-lingual is downstream of it. This reframing is what makes the
German/Russian/Ukrainian wordnet gap survivable, and it is the single most
important thing this research changes about the plan.

## 1.2 Option 3 — Open English WordNet

### What holds up

**License: CC BY 4.0.** Attribution only. No share-alike. This is materially
better than every other resource in this document and is the reason to prefer
WordNet-derived identity over Wiktionary-derived identity even where the two
overlap (see §4.4).

**Coverage.** The 2025 Edition (released 2025-12-31) carries 107,519 synsets /
135,969 words in the core release; the "Plus" variant with proper nouns is
120,564 synsets / 161,875 words. Distributed as WN-LMF XML, JSON, RDF/Turtle
and WNDB, all downloadable, plus a JSON API at `en-word.net` and the Python
`wn` library. Nothing here needs a live service at request time — it is a file
you ingest once, which fits the deployment model (`backend/` is a zip Lambda).

**It carries ILI links.** OEWN explicitly provides "correspondence to previous
versions and wordnets in other languages … through the Collaborative
Interlingual Index (CILI)."

### What does not hold up — synset IDs are not stable

`change.md:115` says "stable synset IDs". They are not.

- The canonical illustration: *apricot (fruit)* is `07750872-n` in WordNet 3.0
  and `07766848-n` in WordNet 3.1 — same concept, different key.
- OEWN inherits the churn. When DanNet's OEWN links were moved from the 2022 to
  the 2023 edition, **the synset IDs changed and the dataset had to be
  rewritten** to the new ones.
- The prefix itself moved: `ewn-` (2019, 2020) → `oewn-` (2021 onward).
- Editions ship annually — 3.1 (2018), 2019, 2020, 2021, 2022, 2023, 2024,
  2025 — with each release's notes recording synsets added, merged and split,
  plus ILI-link corrections ("remove duplicate ILI links", "add a few missing
  ILI links" in 2024).

A `concepts` table keyed on `oewn-02981792-n` would need a full remap on every
OEWN upgrade, and the remap is not a rename — synsets merge and split. That is
a migration hazard against the whole point of the design (`entries` referencing
concepts would have to be rewritten too).

### The fix — key on the ILI

ILIs exist for exactly this. "ILIs address this issue by providing stable
identifiers for concepts, whether for a synset across versions of a wordnet or
across languages", and CILI "includes persistent identifiers to ensure concept
stability and prevent deletion." Apricot is `i77784` in WordNet 3.0, 3.1 **and**
OEWN — one key across all three.

So:

```
concepts
  id            uuid          -- app-side, as everywhere else in this repo
  ili           text  NULL    -- 'i77784'; UNIQUE where not null
  oewn_synset   text  NULL    -- 'oewn-02981792-n'; display/debug, version-scoped
  en_lemma      text
  en_gloss      text
```

`ili` nullable and `UNIQUE`-where-not-null is the load-bearing detail — see
§1.7. Note `lessons.md`'s uniqueness-migration rule applies the moment this
constraint is added to a table that already holds rows.

One caveat worth carrying into the plan: the 2023 *Mapping Wordnets on the Fly*
paper found that for cross-version mapping specifically, **synset offsets
outperformed CILI as identifiers in most test cases**, because CILI links can
be missing or duplicated. That is an argument for keeping `oewn_synset`
alongside `ili` rather than instead of it — not an argument for keying on the
volatile one.

### The real risk — granularity

This is the finding that should shape the plan more than the ID question.

WordNet's granularity "is often too fine-grained, with narrow sense
distinctions that are irrelevant for many NLP applications … hard to
differentiate between, even for an experienced human annotator." The standard
example is directly on point for InkLingo: *star* has eight noun senses, two of
which are both "celestial body" differing only in visibility from Earth — **and
both translate to the same Spanish word.** The literature's response has been
sense-clustering and coarse inventories (e.g. CSI's 45 labels).

Checked against the repo's own worked example, `castle` (verified on
en-word.net) has five synsets:

| # | POS | Gloss |
|---|---|---|
| 1 | n | a large and stately mansion (*with* `palace`) |
| 2 | n | a large building formerly occupied by a ruler and fortified against attack |
| 3 | n | the chess piece … parallel to the sides of the chessboard (*with* `rook`) |
| 4 | n | interchanging the positions of the king and a rook (*castling*) |
| 5 | v | move the king two squares toward a rook … |

A Polish learner typing `zamek` expects castle / lock / zipper. The English
pivot correctly splits those. But senses 1 and 2 are one thing to a learner,
and 3–5 are chess noise. Two consequences:

- **The display cap already decided (max 3 meanings, `translation-cache/change.md`)
  becomes a ranking problem, not a truncation problem.** Which three? WordNet
  ships no frequency signal in the core release.
- **This interacts with IL-41** (multiple meanings per entry) directly. IL-41
  removes `UNIQUE(entry_id, language_code)` so an entry can hold several
  meanings; the pivot decides *what a meaning is*. If IL-24 lands first, IL-41
  inherits WordNet granularity as its definition of "a meaning".

### The mapping step's accuracy

`change.md:118-119` correctly names this as "its own accuracy problem".
Quantified:

- On the standard fine-grained WSD benchmarks (SemEval-2007 T17, SemEval-2013
  T12), GPT-4 reaches **82.3%** with a Definition+Examples prompt, against
  **84.8%** (EWISER) and **85.2%** (SREF-Context) for dedicated WSD systems.
- **Supplying definitions in the prompt is worth +4–9%**; zero-shot is
  markedly worse, especially on rare senses.

But the pivot's mapping is an easier problem than the benchmark:

1. The candidate set is not "all of WordNet" — it is the synsets sharing the
   lemma the model just produced. For `castle`, five candidates.
2. Definitions are available for free (that's the +4–9% condition, met by
   construction).
3. **A wrong answer is recoverable.** Benchmark WSD is scored per-token;
   here, a mis-mapped sense produces a wrong concept row, which shows up as a
   duplicate or a mis-grouped translation and can be repaired offline. There is
   no user-visible failure mode as sharp as the current "Nothing came back for
   this language".
4. The prompt can legitimately answer *"none of these"* — see §1.7.

The measurement this needs is not a WSD benchmark run; it is the
`lessons.md:33-38` treatment: a few dozen real captures through the mapping
prompt, counting how many produce a *usable* synset choice. That is one
scratchpad script and one live-API session, and it is the concrete deliverable
IL-27 should produce.

## 1.3 The cross-lingual claim, corrected

`change.md:115-118` implies national wordnets fill the spokes. For the eight
supported codes:

| Code | Wordnet | Size (OMW v1) | License | Usable here? |
|---|---|---:|---|---|
| `en` | Open English WordNet 2025 | 107,519 syn | **CC BY 4.0** | ✅ backbone |
| `pl` | plWordNet / Słowosieć | 33,826 syn / 45,387 w | Princeton-style; explicitly permits commercial use, no fee or royalty | ✅ |
| `es` | Multilingual Central Repository | 38,512 syn / 36,681 w | CC BY 3.0 | ✅ |
| `it` | MultiWordNet | 35,001 syn / 41,855 w | CC BY 3.0 | ✅ |
| `fr` | WOLF | 59,091 syn / 55,373 w | CeCILL-C (LGPL-like copyleft) | ⚠️ compatible but copyleft-flavoured |
| `de` | GermaNet | — | Academic Research License; **fee for non-academic** | ❌ |
| `ru` | RuWordNet | — | **Non-commercial only**, distributed by email request | ❌ |
| `uk` | — | — | — | ❌ none exists |

(OdeNet — Open German WordNet — is downloadable via the `wn` library as
`odenet:1.4` and is the open alternative to GermaNet; its coverage and license
were not verified in this pass and are an open question below.)

**Why this is survivable:** per §1.1, spokes come from Wiktionary/DeepL. Where
a permissively-licensed wordnet exists (pl, es, it, and possibly de via
OdeNet), an ILI join gives a free, high-precision seed for
`concept_translations` — a bonus path for four of eight languages. Where it
does not, nothing is lost relative to the baseline design.

**Why it still matters for the plan:** it kills any design that *routes* the
reverse lookup through ILI-linked national wordnets, because Russian and
Ukrainian — two of the eight, and Russian is one of the two languages whose
homograph stress the espeak-ng note in `translation-cache/change.md` calls out
as "exactly the disambiguation case InkLingo exists for" — would have no path.

## 1.4 Option 1 — normalized English gloss string-match

`change.md:108-110` calls this "simple, fragile" and that is confirmed, but the
mechanism deserves stating precisely, because it is the *fallback* in the
recommended design.

The failure is not typo-level noise; it is that the model paraphrases. Ten
generations of the castle sense produce "a large fortified building", "a
fortified residence of a ruler", "a large fortified structure, typically
medieval" — all correct, none equal after `lower().trim()`. The repo already
has direct evidence of this class of non-determinism and has already paid for
it: `sameMeaning` (`extension/src/popup/App.tsx:35-37`) exists **because the
model reorders and re-words meanings between calls**, and pairing by index was
found not to work.

Two upgrades make it usable as a fallback rather than a primary:

- **Embedding similarity over the gloss** instead of string equality, with a
  threshold. Turns exact-match into nearest-neighbour. Cost: an embedding model
  in the request path — a new dependency the repo does not have, and Anthropic
  ships no embeddings endpoint.
- **Model-as-judge**: on a near-miss, ask the model "is this the same sense as
  any of these N?" — reuses the mapping call already being made in §1.2, so it
  adds no new dependency.

The second is the one to plan for. It is the same prompt shape as the synset
mapping, pointed at internal rows instead of WordNet.

## 1.5 Option 2 — `(en_lemma, sense_index)`

Confirmed dead, and the repo's own code is the evidence:
`extension/src/popup/App.tsx:35-37` pairs variants **by meaning text, never by
position**, and the reason is written into the surrounding code — generation is
non-deterministic. Keying persisted rows on an index the model does not
stabilise would reintroduce, at the schema level, the exact bug the popup was
written to work around. It also cannot survive a re-seed: regenerating the
English senses for a lemma reshuffles every `sense_index`, orphaning every
`entries` row that pointed at one.

Not worth further investigation. Its only merit — a compact human-readable key
— is available from `(ili, en_lemma)` without the instability.

## 1.6 Two options `change.md` does not list

**Wikidata Lexemes (CC0)** — the licensing dream, ruled out on coverage.
Lexemes have `Sense` entities and `item for this sense` (P5137), and "if two
senses in different languages have the same property pointing to the same item,
they can reliably be considered translations" — structurally a perfect fit, and
CC0 means no attribution and no share-alike at all. Current sense counts:

| en | pl | ru | uk | de | fr | es | it |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 36,922 | 3,593 | 17,066 | **350** | 17,492 | 10,649 | 17,811 | 21,269 |

Ukrainian has 350 senses. Polish has 3,593 against plWordNet's 33,826 and the
Polish Wiktionary edition's 688,939 translations. Not a backbone; possibly a
high-precision cross-check later.

**BabelNet** — the resource that would solve all of this at once (WordNet +
Wiktionary + Wikipedia, cross-lingual, sense-linked) and is **licensed
non-commercially, to research institutions only**, with versions after 2.5 not
downloadable at all. Rules itself out for a product. Worth naming in the plan
so it does not get re-proposed.

## 1.7 Recommendation

**A two-tier identity with WordNet as the preferred tier and a model-minted
concept as the floor.**

```
1. Model emits an English sense (lemma + gloss).
2. Look up candidate synsets for that lemma in a local OEWN table.
   → 0 candidates: go to 4.
3. Ask the model to pick one candidate or answer "none".
   → a pick: concept keyed on that synset's ILI.
   → "none": go to 4.
4. Mint a local concept: ili = NULL, keyed on (en_lemma, normalized_gloss),
   with the model-as-judge check from §1.4 against existing NULL-ili rows
   for the same lemma.
```

Why this shape:

- **WordNet's gaps are structural, not incidental.** Neologisms, slang, and
  domain vocabulary a learner actually captures from a web page are exactly
  what a curated 2025-edition lexicon lacks. A design that can only represent
  what WordNet represents will drop real captures on the floor.
- **`wordOrPhrase` accepts 200 chars** (`schemas.ts:44-46`) and
  `change.md:135-136` already concedes phrases have no lexical sense. Tier 4 is
  where they live. It is not an exception path bolted on — it is a majority
  path for multi-word captures.
- **The ILI is a value, not a foreign key.** Nothing joins to OEWN at request
  time; the OEWN table is a lookup fixture. An OEWN upgrade re-imports the
  fixture and leaves `concepts` untouched.
- **It degrades to option 1 gracefully**, so a failure in the mapping step is a
  duplicate row, never a lost capture.

**What IL-27 should deliver before IL-29 (schema) is written:** a measured
number for "of N real captures, how many map to an ILI, how many mint local,
and how many mint a *duplicate* local" — over a real captured-word list, not
`pies`/`zamek`/`kot`. Per `lessons.md:33-38` this needs real API calls, which
per the standing rule need explicit permission first.

---

# 2. Gate 1 — Wiktionary machine-readable extracts for all eight codes

## 2.1 The distinction that answers the question

`translation-cache/change.md` asks "which Wiktionary **editions** have usable
extracts for all 8 supported codes" and notes "Polish Wiktionary is far smaller
than English." That framing conflates two different things, and separating them
resolves the gate:

- An **edition** is a wiki (`plwiktionary`, `ruwiktionary`) — the language the
  *definitions are written in*.
- A **covered language** is what a given edition has entries *about*. The
  English Wiktionary documents words in 400+ languages.

## 2.2 Editions available on kaikki.org (wiktextract)

**26 editions**, English plus 20 others: Chinese, Czech, Dutch, French, German,
Greek, Indonesian, Italian, Japanese, Korean, Kurdish, Malay, Polish,
Portuguese, Russian, Simple English, Spanish, Thai, Turkish, Vietnamese — the
non-English ones flagged work-in-progress. Each ships `.jsonl`, `.log` and
`.errors`, raw and gzipped.

- **There is no Ukrainian edition, and none is listed as coming.** This is the
  hard fact behind the gate. `translation-cache/research.md` did not surface it
  because it enumerated the Polish edition's contents rather than the edition
  list.
- English edition, dump dated **2026-08-05**: **22.9 GB uncompressed JSONL /
  2.6 GB gzipped.** That is an ingestion-pipeline sizing input, not a
  storage-in-Neon number.
- Polish edition: 1,151,981 lemmas / **688,939 translations**.
  Russian edition: 1,747,429 lemmas / **817,047 translations**.

## 2.3 The English edition covers all eight — including Ukrainian

Sense counts within the English edition (2026-08-05 dump):

| Language | Senses |
|---|---:|
| English | 1,780,480 |
| Spanish | 874,006 |
| Italian | 719,427 |
| German | 631,714 |
| Russian | 492,165 |
| French | 458,908 |
| Polish | 264,993 |
| **Ukrainian** | **80,952** |

12,999,260 senses across 400+ languages in total. **Ukrainian is thin — ~22× smaller than English, ~6× smaller than Russian — but it is present and it is
the only machine-readable option for `uk`.** Verified by inspection: the
Ukrainian entry for `замок` in the English edition carries **IPA for both
etymologies** (`[ˈzamɔk]` "castle" / `[zɐˈmɔk]` "lock"), English glosses, and
full seven-case declension tables. That is a per-sense stress distinction on
the exact Russian/Ukrainian homograph pair
`translation-cache/change.md` flags espeak-ng as getting wrong.

**Verdict on the gate: pass, via the English edition, for all eight codes.** The
per-language editions are an optional enrichment (deeper coverage for pl/ru/de/
fr/es/it), not the path.

## 2.4 The finding that matters most — translation tables are sense-tagged

Verified against the English edition's `castle` entry. Translations are not a
flat bag attached to the headword; they are **grouped per sense**, each group
labelled with the sense gloss (`Translations (fortified building):`), and the
extracted objects carry a `sense` field alongside `code`, `lang`, `word`,
`roman`, `tags` and `english`.

All eight target languages appear under the fortified-building sense:

| Lang | Translation(s) |
|---|---|
| pl | zamek (m) |
| ru | за́мок (zámok) (m) |
| **uk** | за́мок (zámok) (m) |
| de | Burg (f), Festung (f), Schloss (n) |
| fr | château (m), château-fort (m) |
| es | castillo (m), castro (m) |
| it | castello (m) |

This maps onto the pivot's schema almost literally: one sense → N
`concept_translations` rows. It is the strongest single piece of evidence that
the architecture is buildable, and it makes the Wiktionary path a **first-class
source for the spokes rather than a fallback to DeepL**, which directly relieves
gate 2.

Two qualifications the plan must carry:

- **Sense-tagged is not sense-*identified*.** The tag is the gloss string, so
  joining a Wiktionary sense to an OEWN synset is the same mapping problem as
  §1.2, run offline. There is a partial exception: some entries carry explicit
  `{{senseid}}` values pointing at Wikidata items — `castle`'s fortified
  building sense is tagged `en:Q23413`. **How widely `senseid` is populated is
  unmeasured and is a cheap, decisive thing to measure** (one pass over the
  extract), because where it exists it is a free, stable cross-resource key.
- **IPA is not in the translation entries.** Confirmed: the `castle` entry
  carries `/ˈkɑːsəl/` and `/ˈkæsəl/` for the English headword only; the Polish
  and Ukrainian translations arrive without phonetics. IPA for a target lemma
  requires a **second lookup** of that lemma in its own language's slice of the
  extract (which does carry it — see the `замок` check above). So
  `concept_translations.ipa` is a two-step join, not a field that comes along
  for the ride. This is a concrete ingestion-design consequence and it is not
  in `change.md`.

## 2.5 DBnary — the alternative worth knowing about

RDF/OntoLex extraction of Wiktionary, ~26 language editions as of 2024, twice
per Wikimedia dump, **3.16M translation links** from 10 extracted languages
into 1,000+ target languages. Licensed **CC BY-SA 3.0**.

Its enumerated language list is Bulgarian, Catalan, Chinese, Czech, Danish,
Dutch, English, Finnish, French, Irish, German, Greek, Indonesian, Italian,
Japanese, Kurdish, Latin, Lithuanian, Malagasy, Norwegian, Polish, Portuguese,
Russian, Serbo-Croat, Spanish, Swedish, Turkish — **Ukrainian is not on it**,
same gap as kaikki. (One search summary asserted Ukrainian "would fall within
the supported languages list"; that is an inference, not a source, and it is
wrong against the enumerated list.)

Recommendation: **stay with wiktextract/kaikki**. JSONL against RDF suits a
Node ingestion script better, the sense-tagged translation structure is already
verified, and kaikki's English edition is the only path to Ukrainian.

---

# 3. Gate 2 — DeepL Free's ceiling against the seeding path

## 3.1 Language support: clean pass

All eight codes are supported by the DeepL API as **both source and target**:
EN, PL, RU, DE, FR, ES, IT and **UK**. Ukrainian was the one to check and it is
fine. Glossaries, tag handling and translation memory are available for these
languages too — a glossary is worth noting, because it is the mechanism that
would let a seed pin a domain term consistently across a batch.

## 3.2 The plan status is genuinely uncertain — resolve it first-party

`change.md:139` states "DeepL Free is 500k chars/month". That was true and is
still widely reported. But multiple independent 2026 sources state that **in
July 2026 DeepL API Free and API Pro stopped being purchasable by new
customers**, replaced by:

- **Developer** — one million characters **in total**, one-time. Explicitly
  *"should not be modeled as one million free characters every month"* — a
  trial for integration and building a test set.
- **Growth** — ~$26/month billed annually plus usage; 1M chars/month monthly or
  12M/year annually, then overage; documented 50M chars/month ceiling.
- Legacy **API Pro** was $5.49/month + ~$25/M characters (one source says
  $5.49/M, another $25/M — the discrepancy is itself a reason not to plan on
  these numbers).

**I could not confirm or refute this from DeepL's own documentation.**
`developers.deepl.com/docs/getting-started/readme` only links to the plans page;
the cost-control page names API Pro alone; the pricing page did not render its
plan table. The sources asserting the withdrawal are third-party SEO-style
blogs, which is exactly the class of source `lessons.md` would say not to build
a plan on.

**Action for the plan (cheap, decisive):** open
`https://www.deepl.com/pro-api#api-pricing` in a browser and record what a new
account can actually sign up for, with the date. This is one manual check and
it changes the request-path design.

## 3.3 The arithmetic, under both worlds

Using `change.md:139-141`'s own per-concept figure — ~3 sentences × 6 languages
× ~70 chars ≈ **1,260 chars per new concept**:

| Scenario | Characters | Under 500k/mo free | Under Developer (1M total) | Under paid @ ~$25/M |
|---|---:|---|---|---|
| One new concept | 1,260 | — | — | $0.03 |
| Steady state, per month | — | ~**397 concepts/mo** | ~**794 concepts, once** | — |
| Seed 10,000 concepts | 12.6M | ~**25 months** | ~1.3% of the trial | ~**$315** |
| Seed 10,000, English sentences only re-rendered into 7 spokes | 14.7M | ~29 months | — | ~$368 |

So `change.md:142-149` is confirmed and, if the plan change is real, **worse
than stated**: a one-million-character lifetime trial cannot even sustain the
request path for a year at 400 concepts/month, let alone seed. Its conclusion —
**seed from bulk Wiktionary, reserve DeepL for the request path and for gaps** —
is the right one either way, and §2.4 makes it more achievable than `change.md`
assumed, because sense-tagged translation tables cover the *lemma* spokes
outright. DeepL's residual job is the **sentence renderings**, which Wiktionary
cannot supply.

That distinction is worth writing into the plan explicitly:

| Spoke content | Source | Wiktionary can do it? |
|---|---|---|
| `concept_translations.lemma` | English-edition sense-tagged translation table | **Yes** |
| `concept_translations.ipa` | Target-language slice of the same extract (2-step, §2.4) | **Yes**, espeak-ng for gaps |
| `sentence_renderings.text` | MT | **No** — this is DeepL's whole job |

Seeding sentence renderings is therefore the *only* line item that hits the
character cap — and it is also the one `change.md:131-134` flags as the
pedagogical risk ("eyeball ~20 before committing to seeding"). Those two
constraints point the same way: **do not seed sentence renderings; render them
lazily on first demand.** That converts the 12.6M-character seed into an
amortised request-path cost, which every plan variant above can absorb.

## 3.4 If a paid seed is still wanted

Alternatives to price against DeepL Pro's ~$315 for a 10k-concept seed:
Google Cloud Translation (~$20/M chars), Azure Translator (~$10/M chars), or a
self-hosted Opus-MT / NLLB batch job (free but for compute, and materially
worse quality on idiom — which is the axis `change.md:131-134` says matters).
None were priced in depth here; this is IL-38's job once the seed scope is
settled.

---

# 4. Gate 3 — CC-BY-SA and the licensing decision

## 4.1 The version moved: CC BY-SA 4.0, not 3.0

`translation-cache/change.md` records Wiktionary as CC-BY-SA without a version;
`translation-cache/research.md` and DBnary both say 3.0. **Wikimedia projects
moved to CC BY-SA 4.0** (announced 2023). This matters for one specific reason
in §4.3.

## 4.2 The four obligations, concretely

For content reused from Wiktionary:

1. **Attribution** — credit per Wikimedia's terms of use (the article/entry, or
   a hyperlink to it, plus a list of authors or a link to the page history).
2. **Share-alike** — modifications and additions must be licensed CC BY-SA 4.0
   or later.
3. **License notice** — every distributed copy carries a statement that the
   work is CC BY-SA, with a URL to or copy of the license.
4. **Indication of modification** — say, reasonably, that the original was
   modified.

## 4.3 Why 4.0 makes this a database question, not just a display question

CC 4.0 brought "better handling of rights outside copyright, **such as database
rights**." That is the EU *sui generis* database right (Directive 96/9/EC),
which protects substantial investment in obtaining/verifying/presenting a
database contents *independently of* whether the individual entries are
copyrightable.

This is directly on point. The strongest argument against share-alike here is
that an individual translation pair — `castle` → `zamek` — is a **fact**, not
creative expression, and facts are not copyrightable. That argument survives
for a handful of lookups. It does **not** obviously survive **bulk extraction
of a substantial part of a translation database**, which is precisely what
seeding does, and which is the act sui generis rights exist to reach. CC BY-SA
4.0 licenses that right on share-alike terms rather than leaving it unlicensed.

`concept_translations` seeded from Wiktionary is therefore best treated as a
CC BY-SA 4.0 derived database until a deliberate decision says otherwise. This
is a real decision, not a formality, and it belongs to IL-32.

## 4.4 The per-source picture

| Source | Used for | License | Share-alike? | Attribution? |
|---|---|---|---|---|
| Open English WordNet | `concepts` backbone, ILI | **CC BY 4.0** | **No** | Yes |
| CILI / ILI ids | `concepts.ili` | Open (explicit open license is CILI's defining feature) | No | Yes |
| plWordNet | optional `pl` seed | Princeton-style, commercial OK, no fee | No | Yes |
| MCR (es), MultiWordNet (it) | optional seeds | CC BY 3.0 | No | Yes |
| WOLF (fr) | optional seed | CeCILL-C | Weak copyleft on the *work* | Yes |
| GermaNet (de) | — | Academic-only, fee otherwise | — | **Unusable** |
| RuWordNet (ru) | — | Non-commercial only | — | **Unusable** |
| **Wiktionary / wiktextract** | **`concept_translations`, IPA** | **CC BY-SA 4.0** | **Yes** | Yes |
| DBnary | alternative to above | CC BY-SA 3.0 | Yes | Yes |
| BabelNet | — | Non-commercial, research institutions only | — | **Unusable** |
| Wikidata Lexemes | possible cross-check | **CC0** | No | No |
| DeepL output | `sentence_renderings` | Per DeepL's terms — **not researched here** | ? | ? |
| Model output (English senses/sentences) | `concepts`, `concept_sentences` | Per Anthropic's terms — customer owns outputs | No | No |

**The shape of the decision:** everything except Wiktionary is attribution-only
or freer. Wiktionary is the single share-alike source, and it is also the
source `change.md`'s seeding strategy leans on hardest.

## 4.5 Three viable postures

1. **Accept share-alike on the derived database.** Publish
   `concept_translations` (the Wiktionary-derived columns) under CC BY-SA 4.0,
   attribute Wiktionary in-app and in the export, and note the modification.
   Cheapest, and it costs nothing the project currently values — InkLingo has
   no plan to license its data proprietarily. **Recommended.**
2. **Segregate by provenance.** Add `concept_translations.source` (`wiktionary`
   / `deepl` / `model` / `wordnet`) and keep share-alike scoped to the rows that
   earn it. Worth doing **regardless of which posture is chosen** — provenance
   per row is cheap at insert time, impossible to reconstruct later, and it is
   also what lets a later decision be made at all. This is the one concrete
   schema requirement this gate imposes on IL-29.
3. **Avoid Wiktionary for translations entirely**, using it only for IPA (or
   dropping it for espeak-ng), and sourcing lemma spokes from the CC-BY
   wordnets plus DeepL. Loses Ukrainian and German coverage (§1.3) and loses
   §2.4's sense-tagged tables — the single best asset found in this research.
   Not recommended.

## 4.6 The export is the distribution act

FR-014's printable A4 export is where content leaves the app, and it is the
Primary success criterion. Whatever posture is chosen, the attribution and
license-notice obligations attach to **that artifact** — a footer line naming
Wiktionary (CC BY-SA 4.0) and Open English WordNet (CC BY 4.0) with URLs. S-04
`printable-export` is being built now, and it is cheaper to leave room for that
footer during S-04 than to retrofit it. **Worth raising with the S-04 work
before IL-24 starts**, even though IL-24 is blocked on S-04 finishing.

---

## Code References

Current as of `259eaae`. Anchors verified this pass.

- `backend/src/languages.ts:4` — the eight supported codes; the list every
  coverage question in this document is measured against
- `backend/src/routes/api/collections/schemas.ts:29-31` — `translateBodySchema`,
  **still only `text`** — the set-cursor problem is unsolved
- `backend/src/routes/api/collections/schemas.ts:44-46` — `wordOrPhrase`,
  `maxLength: 200`; why tier 4 of §1.7 is a majority path for phrases
- `backend/src/routes/api/collections/schemas.ts:6` — `MAX_TARGET_LANGUAGES = 5`
- `backend/src/ai/translate.ts:3` — `claude-haiku-4-5-20251001`
- `backend/src/ai/translate.ts:10` — `MAX_TOKENS_PER_LANGUAGE = 2048`
- `backend/src/ai/translate.ts:19` — `EMPTY_RESULT_RETRIES = 1`, and the comment
  recording the measured ~3-in-34 empty-result rate
- `extension/src/popup/App.tsx:35-37` — `sameMeaning`; the in-repo proof that
  option 2 (`sense_index`) cannot work
- `extension/src/popup/App.tsx:258-340` — `handleRegenerate`, **still
  client-side, still re-sending the identical request**
- `context/changes/translation-pivot/measure-cost.mjs:32-34` — `MODEL`, and
  `IN`/`OUT` at $1/$5 per MTok; **pricing constants confirmed still correct**
- `context/foundation/lessons.md` § "A stubbed AI client cannot tell you the
  model's output is usable" — governs the IL-27 mapping-accuracy measurement
- `context/foundation/lessons.md` § "Check for pre-existing duplicates before
  adding a uniqueness migration" — governs `UNIQUE(ili)` in §1.2

## Architecture Insights

- **The identity problem is monolingual.** Everything cross-lingual in the
  pivot resolves through `concept_translations` rows written pointing at a
  concept, never through a query-time comparison across languages. This is the
  reframing that makes the German/Russian/Ukrainian wordnet gap a non-issue and
  should be stated at the top of the plan.
- **Stability and expressiveness pull in opposite directions, and the design
  needs both.** WordNet gives stable, licensable identity but cannot represent
  what a learner actually captures from the web. The model gives full
  expressiveness with no identity at all. The two-tier design in §1.7 is not a
  compromise — it puts each where its strength is.
- **Non-determinism is load-bearing, already, in shipped code.** `sameMeaning`
  is a workaround for it in the client. The pivot is the change that fixes it
  at the schema level rather than working around it — and it must not
  reintroduce it as a key.
- **Provenance is only recordable at insert time.** §4.5's `source` column is
  cheap now and unreconstructable later. It is the one schema requirement the
  licensing gate imposes regardless of which posture wins.
- **The `$4 seed` line is an AI-half number, and the other half just got
  cheaper.** §2.4's sense-tagged translation tables cover lemma spokes from a
  free bulk source; §3.3's conclusion is to not seed sentence renderings at all.
  Together those make the seed materially more affordable than
  `change.md:142-149` assumed — but the cost table still needs the AI half
  re-measured before it is trusted.
- **An OEWN edition upgrade must be a fixture re-import, not a migration.**
  Keying on the ILI is what buys that. Any design where `entries` transitively
  depends on `oewn-XXXXXXXX-n` inherits an annual data migration.

## Historical Context (from prior changes)

- `context/changes/translation-pivot/change.md` — the architecture, the cost
  table, and the concept-identity gate this document answers. Two of its claims
  are corrected here: synset-ID stability (§1.2) and national-wordnet
  cross-linking (§1.3).
- `context/changes/translation-cache/research.md` (2026-08-01) — still the
  substantive prior research: the `generateWithTimeout` seam, FR-012 being
  client-side, the ~16-test isolation problem (every test reuses `'pies'`/`pl`),
  and the manual-verification interference. Its Wiktionary section enumerated
  the Polish edition's *contents*; this document adds the *edition list*, which
  is where the Ukrainian gap lives.
- `context/changes/translation-cache/change.md` — the superseded per-word cache
  scope, the espeak-ng Russian/Ukrainian homograph-stress caveat (`за́мок` vs
  `замо́к`), the "prompt caching cannot help" note, and the max-3-meanings /
  max-3-sentences display cap decided 2026-08-01.
- `context/changes/translate-flow-analysis/research.md` (2026-08-20, `98ddef9`)
  — current-state anchors for the whole flow. Not re-derived here. Its §5.12
  (one meaning survives the save, IL-41) and §5.14 (cost, and this parked
  re-architecture) are the two sections that bear directly on this change.
- `context/foundation/roadmap.md:176-183` — IL-24 blocked-by IL-5 (S-04) and
  IL-21 (S-05); IL-41's note that the pivot's unit of reuse is the *sense*, so
  the two schemas must be reconciled if IL-24 moves first.

## Related Research

- `context/changes/translation-cache/research.md` — cost baseline, cache seam,
  Neon/espeak-ng feasibility. Findings hold; file:line anchors have drifted.
- `context/changes/translate-flow-analysis/research.md` — current-state trace,
  coverage map, blast radius. Anchors current as of `98ddef9`.
- `context/archive/2026-07-25-capture-translate-save/change.md` — the
  single-call decision, the empty-variants discovery, the measured baseline.

## Open Questions

**Blocking IL-27 → IL-29 (must be answered before the schema is written):**

1. **What is the measured ILI-mapping rate on real captures?** Of N genuinely
   captured words, how many map cleanly to an OEWN synset, how many mint a
   local concept, and how many mint a *duplicate* local concept? Needs live API
   calls per `lessons.md:33-38` — **and therefore explicit permission first.**
2. **What is the display rule for WordNet granularity?** With `castle` at five
   synsets and a max-3-meanings cap already decided, which three, ranked how?
   WordNet's core release carries no frequency signal.
3. **Does the model reliably answer "none of these"?** The two-tier design's
   floor depends on the mapping prompt declining rather than forcing a bad
   pick. This is measurable in the same run as (1).

**Blocking IL-38 (seeding) and IL-32 (licensing):**

4. **What can a new DeepL account actually sign up for today?** §3.2 — one
   manual check at `deepl.com/pro-api#api-pricing`, recorded with a date.
5. **How widely is `{{senseid}}` populated in the English Wiktionary extract?**
   §2.4 — one pass over the extract. Where present it is a free stable key
   linking Wiktionary senses to Wikidata items.
6. **Which licensing posture (§4.5)?** Recommended: accept share-alike on the
   derived database, and add `concept_translations.source` regardless.

**Not blocking, but cheap and worth settling:**

7. **Is the cost table's token half still accurate?** Pricing is confirmed
   unchanged at $1/$5 per MTok; the 2026-08-01 token counts are not
   re-measured. `measure-cost.mjs` costs ~$0.02 per run — needs permission.
8. **Is the "prompt caching cannot help" note still right?**
   `translation-cache/change.md` states Haiku 4.5's minimum cacheable prefix is
   4,096 tokens against a ~1,238-token request. Current Anthropic documentation
   states a general minimum of ~1,024 tokens. If the lower figure applies to
   Haiku 4.5, the note is wrong and caching the tool schema is back on the
   table — which would cut the input half of the bill without any
   re-architecture at all. Verify before the plan repeats the claim.
9. **Is OdeNet (`odenet:1.4`, downloadable via the `wn` library) a usable open
   substitute for GermaNet?** Coverage and license unverified. Would take
   German from ❌ to ✅ in §1.3's optional-seed column.
10. **What do DeepL's terms say about storing and redistributing MT output?**
    §4.4 leaves that cell empty. `sentence_renderings` is the pedagogical
    artifact and it ends up in the printable export.
11. **Do the two legacy-uppercase collections still exist?** Carried over from
    `translate-flow-analysis/research.md`'s open questions; any concept-spoke
    ingestion writing `language_code` inherits that normalization debt.

## Sources

- [Open English WordNet — releases](https://github.com/globalwordnet/english-wordnet/releases) · [repository](https://github.com/globalwordnet/english-wordnet) · [2024 version, LLDS](https://llds.ling-phil.ox.ac.uk/llds/xmlui/handle/20.500.14106/2571-2024) · [en-word.net](https://en-word.net/lemma/castle)
- [CILI: the Collaborative Interlingual Index (GWC 2016)](https://aclanthology.org/2016.gwc-1.9.pdf) · [globalwordnet/cili](https://github.com/globalwordnet/cili)
- [wn — Interlingual Queries](https://wn.readthedocs.io/en/latest/guides/interlingual.html)
- [Mapping Wordnets on the Fly with Permanent Sense Keys (arXiv:2303.01847)](https://arxiv.org/abs/2303.01847)
- [Open Multilingual Wordnet — v1 wordnet list](https://omwn.org/omw1.html) · [OMW v2](https://omwn.org/omw2.html)
- [plWordNet 3.1 license](http://nlp.pwr.wroc.pl/plwordnet/license/) · [RuWordNet](https://ruwordnet.ru/en) · [GermaNet](https://en.wikipedia.org/wiki/GermaNet)
- [kaikki.org dictionary index](https://kaikki.org/dictionary/index.html) · [raw data downloads](https://kaikki.org/dictionary/rawdata.html) · [English `castle`](https://kaikki.org/dictionary/English/meaning/c/ca/castle.html) · [Ukrainian `замок`](https://kaikki.org/dictionary/Ukrainian/meaning/з/за/замок.html)
- [Wiktextract: Wiktionary as Machine-Readable Structured Data (LREC 2022)](https://aclanthology.org/2022.lrec-1.140.pdf) · [wiktextract README](https://github.com/tatuylonen/wiktextract/blob/master/README.md)
- [DBnary](http://kaiko.getalp.org/about-dbnary/)
- [DeepL supported languages](https://developers.deepl.com/docs/getting-started/supported-languages) · [DeepL cost control](https://developers.deepl.com/docs/best-practices/cost-control) · [DeepL pricing 2026 (third-party)](https://www.eesel.ai/blog/deepl-pricing) · [DeepL API pricing guide (third-party)](https://langbly.com/blog/deepl-api-pricing-guide/)
- [Wikipedia Moves to CC 4.0 Licenses](https://creativecommons.org/2023/06/29/wikipedia-moves-to-cc-4-0-licenses/) · [Wikimedia CC 4.0 FAQ](https://meta.wikimedia.org/wiki/Terms_of_use/Creative_Commons_4.0/FAQ/en) · [Reusing Wikipedia content](https://en.wikipedia.org/wiki/Wikipedia:Reusing_Wikipedia_content)
- [BabelNet license](https://babelnet.org/license)
- [Wikidata Lexemes — counts by language](https://www.wikidata.org/wiki/Wikidata:Lexicographical_data/Statistics/Count_of_lexemes,_forms,_and_senses_by_language) · [Senses documentation](https://www.wikidata.org/wiki/Wikidata:Lexicographical_data/Documentation/Senses)
- [Do Large Language Models Understand Word Senses? (EMNLP 2025)](https://aclanthology.org/2025.emnlp-main.1720.pdf) · [Exploring the WSD Capabilities of LLMs](https://www.aimodels.fyi/papers/arxiv/exploring-word-sense-disambiguation-capabilities-large-language) · [Meaningful Clustering of Senses](https://www.researchgate.net/publication/220874683_Meaningful_Clustering_of_Senses_Helps_Boost_Word_Sense_Disambiguation_Performance)
- [Neon free tier & pricing 2026 (third-party)](https://www.saaspricepulse.com/tools/neon)

---

# Follow-up Research — 2026-08-21

Three decisions were taken after the original pass, on the user's own reading
of the DeepL plans page. They close open question 4 and materially change what
IL-38 and IL-29 have to build.

## F.1 The DeepL gate is settled: 1M characters **in total**, one-time

Confirmed against the live plans page: the free **Developer** plan grants
**1,000,000 characters once**, not per month. The third-party reporting in §3.2
was right, and `change.md:139-141` is now definitively wrong — not merely
contested. Its "≈400 new concepts per month" describes a recurring allowance
that no longer exists for new accounts.

**Correction to §3.3's table.** The relevant column is not "per month" but
"ever":

| | Characters | Against the 1M one-time grant |
|---|---:|---|
| One concept, 7 target languages, eager | ~1,470 | ~680 concepts, ever |
| One capture, 5 targets, **lazy** (worst case) | ~1,050 | ~950 first-captures, ever |
| One capture, 1 target, lazy | ~210 | ~4,760 first-captures, ever |
| Repeat capture, renderings already present | **0** | unlimited |
| Seed 10,000 concepts | 14.7M | **impossible** — 14.7× the whole grant |

**The number that matters:** `change.md` estimates ~500 captures across all
remaining development. At the worst case of 1,050 chars per first-capture, that
is **~525k characters — 52% of the grant.** The one-time trial covers the
entire remaining build with margin to spare, and it never has to be topped up
before launch.

So the ceiling is a **launch-time problem, not a now problem.** That is the
finding that makes the two decisions below safe.

## F.2 Decision — small eager seed (~1,000 concepts), lazy long tail

**Seed the top ~1,000 concepts eagerly; render everything else the first time
a user actually needs that sentence in that language.**

### Sizing

At ~1,470 chars per concept (3 sentences × ~70 chars × 7 target languages):

| Seed size | Characters | Against Azure's 2M free month |
|---|---:|---|
| 500 concepts | 735k | 37% |
| **1,000 concepts** | **1.47M** | **74%** |
| 2,000 concepts | 2.94M | 1.5 months, or Azure + Google inside one |
| 10,000 concepts | 14.7M | ~7 months |

**1,000 concepts fits inside a single free Azure month**, leaving Google's
500k and the whole of DeepL's 1M untouched. That is the recommended size.

### Why a seed at all — it is a quality instrument, not a performance one

Latency is **not** the argument. A ~300ms MT round-trip is noise against the
4.7–10.0s Anthropic call already measured on that path
(`context/archive/2026-07-25-capture-translate-save/change.md`). What the seed
actually buys:

1. **A reviewable corpus.** `change.md:131-134` asks for ~20 renderings to be
   eyeballed before committing. Pure lazy rendering supplies that feedback by
   *dribble* — unsystematic, slow, and easy to never actually do. A deliberate
   1,000-concept seed that gets read is a far stronger instrument, and it is
   the difference between discharging that note and nodding at it.
2. **A smaller render-then-return surface.** Seeded concepts never hit the
   in-request translation path, so the partial-render failure mode below stays
   confined to the long tail.
3. **A populated system demos better than a cold one** — relevant given the
   certification submission this project feeds.

### Why the long tail stays lazy

- **It keeps the character cap off the critical path.** §3.3 established that
  sentence renderings are the only line item touching a character budget; a
  bounded seed plus lazy tail means the budget is drawn against once, on
  purpose, rather than growing with the corpus.
- **Reuse drives the marginal cost toward zero**, which is the pivot's whole
  claim. Pre-rendering the tail assumes the opposite.
- **A 10k eager seed was never affordable and is not needed** — 14.7M chars is
  ~7 months of Azure's free tier for renderings most of which nobody would
  ever read.

### What this does *not* change

**IL-38's Wiktionary bulk ingest stays, in full.** It is not a translation-API
cost at all — lemma spokes and IPA come from a downloaded extract (§2.3, §2.4)
with no character cap and no per-call billing. Only *sentence renderings* are
governed by the seed/lazy split:

| IL-38 sub-part | Source | Status |
|---|---|---|
| `concept_translations.lemma` bulk seed | English Wiktionary extract, sense-tagged tables | **keep** — free, no cap |
| `concept_translations.ipa` bulk seed | Target-language slice of the same extract (2-step, §2.4) | **keep** — free, no cap |
| `sentence_renderings` | MT provider | **~1k eager, remainder lazy** |

The `$4 seed` line in `change.md`'s cost table is the AI half (English senses +
sentences via the Batch API) and is untouched. At 1,000 concepts that half is
**~$0.40** — negligible.

### A prerequisite IL-38 does not currently have

Seeding 1,000 concepts requires a **ranked English wordlist to seed from**, and
none is specified anywhere in this change. Candidates: a published frequency
list (SUBTLEX, wordfreq) or top-N by Wiktionary translation-table richness —
the latter has the advantage of ranking by exactly the coverage the spokes
need. The AI cost is negligible; **the ranking is the real work**, and it is a
new IL-38 input.

### Schema and route consequences for IL-29

These hold for the lazy tail and are unchanged by the seed:

1. **`sentence_renderings` is sparse by design.** A concept may hold an
   `en_text` with renderings in two of eight languages, indefinitely. No
   coverage invariant, no `NOT NULL` assumption, and nothing may treat a
   missing rendering as a data error.
2. **The read path is render-then-return, not 404.** A lookup that finds the
   concept and the English sentence but not the rendering must translate,
   insert and return — inside the request. That puts a network call on a path
   that would otherwise have none, so it needs the same treatment
   `generateWithTimeout` gets (`backend/src/routes/api/collections/index.ts:50-66`):
   a bounded `AbortController` well inside API Gateway's 29s cap, with failure
   collapsed to a logged null rather than a thrown 500.
3. **A partial-render response must degrade, not blank.** This is the
   already-known failure shape from `translate-flow-analysis/research.md` §5.3
   — four of five languages populated is a 200 that renders as "Nothing came
   back for this language". Lazy rendering makes that state routine for the
   tail, so it needs a real answer rather than only a client-side
   `DegradedAiResult` count.
4. **Character spend has to be observable.** The DeepL grant is finite and
   non-renewing and the Azure allowance resets monthly, so the seam (F.3) is
   where a running character counter lives. Without it a budget is exhausted
   silently, which is the same class of failure as `lessons.md`'s "a quality
   gate that can silently not run".

## F.3 Decision — provider-agnostic seam, **Azure** default, bake-off decides

### The seam

Wire one narrow interface rather than calling a provider SDK from the route.

> **Corrected 2026-08-25 (anti-corruption-layer).** This section originally read
> "the precedent already exists: `generateWithTimeout`
> (`backend/src/routes/api/collections/index.ts:50-66`) is exactly this shape."
> It was not. `generateWithTimeout` isolated a timeout and an exception while the
> provider's data shape, model id, retry policy and failure vocabulary all passed
> straight through it — a passthrough, not a seam. Anyone planning off the
> original sentence would have inherited the premise that the seam already
> existed and only needed a second implementation.
>
> **The seam exists now**, built by `context/archive/2026-08-23-anti-corruption-layer/`:
> `Translator` (`backend/src/domain/translator.ts`) is the one-method port,
> `TranslationDraft.fromProviderPayload` is the single crossing point from
> provider data into the domain, and
> `backend/src/adapters/anthropicTranslator.ts` is the only file under
> `backend/src` allowed to import a provider SDK — enforced by
> `backend/test/architecture/providerBoundary.test.ts`. A second provider is a
> new file in `adapters/` plus one line in `plugins/translator.ts`.

The translator seam should be shared by the request path and the Wiktionary-gap
path for the same reason: intercepting inside covers both.

**Plugin shape.** Already built as `backend/src/plugins/translator.ts` —
`fp<Options>(async (fastify) => {...}, { name, dependencies })`, the decorator
declared **only** in `backend/src/fastify.d.ts`, and the defensive type-only
import that `lessons.md` requires. That trap has now been hit three times; the
third was caused by renaming `plugins/anthropic.ts` to `plugins/translator.ts`,
which moved the forcing import from first to last in autoload order.

### Azure is the default, not DeepL

| | Free allowance | Renews? | Paid rate |
|---|---|---|---:|
| **Azure AI Translator F0** | **2,000,000 chars/month** | **yes, monthly** | **$10/M** |
| Google Cloud Translation | 500,000 chars/month | yes, never expires | $20/M |
| DeepL Developer | 1,000,000 chars | **no — one-time** | ~$25/M |

Azure wins on every measured axis. The case for DeepL rests entirely on a
**quality claim that this research asserted rather than measured** — and the
reputation behind it comes from general-prose MT benchmarks, not from short
pedagogical example sentences, which is the register that actually matters
here. Economics decide unless a measurement overturns them.

### Capital vs income

- **DeepL's 1M is capital**: one-time, non-renewing. Spending it on the
  request path burns a non-renewable asset on a recurring cost.
- **Azure's and Google's allowances are income**: they reset, and **unused
  capacity evaporates — there is no rollover.**

The practical inversion, which is easy to get backwards: being frugal with
DeepL is meaningful; being frugal with Azure is *strictly wasteful*. DeepL's
grant is reserved for the bake-off and as a per-language fallback.

### The bake-off

30 English sentences × 7 target languages × 3 providers ≈ **15k characters per
provider** — ~1.5% of the DeepL grant, free on the other two. Eyeball across
`pl de fr es it uk`. This is what picks the seed provider, on evidence.

It also confirms in passing that all three providers actually cover Ukrainian
at usable quality — the language with the thinnest resources throughout this
research (§2.3).

### One provider per corpus

Splitting the *seed* across providers by concept is the one composition to
avoid: the sentences **are** the artifact, so a corpus where one row came from
Azure and the next from DeepL carries inconsistent register, visible to a
learner comparing two entries. One provider per corpus.

Splitting by *language* — routing the languages where the bake-off shows a real
gap to a different provider — is defensible, but only **after** that
measurement exists. Before it, it is cargo-culting.

## F.4 What changed in the open questions

- **Q4 (what can a new DeepL account sign up for) — CLOSED.** 1,000,000
  characters, one-time, Developer plan.
- **Q10 (provider terms on storing and redistributing MT output) — now more
  urgent, and broader.** With a provider-agnostic seam the question applies to
  whichever provider is active, and `sentence_renderings` is the pedagogical
  artifact that ends up in FR-014's printable export. Needs settling alongside
  the §4.5 licensing posture, not after it.
- **Unchanged and still blocking IL-29:** Q1 (measured ILI-mapping rate), Q2
  (granularity display rule), Q3 (does the model answer "none of these").
  Q1 and Q3 need live API calls and therefore explicit permission.
- **New, and now the near-term blocker for IL-38:** the **bake-off** (F.3) —
  30 sentences × 7 languages × 3 providers. Until it runs, the seed provider is
  a default rather than a decision.
- **New:** **which 1,000 words?** The seed needs a ranked English wordlist that
  does not exist anywhere in this change (F.2). Frequency list, or top-N by
  Wiktionary translation-table richness.
- **Resolved by F.3:** which provider sustains the request path. Azure by
  default, on economics; the seam makes it a config change either way.

## F.5 Why F.2 and F.3 were revised, same session

F.2 and F.3 above are the **second** version of those two decisions. The first
read "lazy-only, no seed at all" and "DeepL first, Azure as launch fallback".
Both were revised within the same session, before anything was built on them.
Recording why, because the reasoning generalises past this change.

**1. A reputation was standing in for a measurement.** The original F.3 made
DeepL the default on the strength of "generally rated strongest on
European-language idiom". That is a real reputation, but it comes from
general-prose MT benchmarks, and the artifact here is *short pedagogical
example sentences* — a different register, in eight specific languages, with
no evidence either way. `lessons.md`'s "A stubbed AI client cannot tell you the
model's output is usable" is the same failure in a different coat: an
unmeasured quality assumption was allowed to outrank a measured cost
difference of 2.5× on price and ∞ on renewal. The fix is the bake-off, which
costs ~1.5% of the DeepL grant.

**2. "Free tier" hid two different kinds of resource.** Both DeepL's 1M and
Azure's 2M/month were reasoned about as "the free allowance", which flattened
the distinction that actually matters: one is a **one-time grant** and the
other is a **renewing allowance whose unused capacity evaporates**. Naming them
capital and income made the right allocation obvious and inverted the intuition
that had been operating — the instinct to conserve applies to DeepL and is
actively wasteful applied to Azure.

**3. The seed was costed as a performance feature and rejected on those
terms.** The original F.2 dismissed the seed partly because latency does not
justify it — which is true: ~300ms of MT against a 4.7–10.0s Anthropic call is
noise. But that was the wrong ledger. The seed's value is a **reviewable
corpus**, and the original F.2 simultaneously claimed lazy rendering "converts
the quality risk into a feedback loop" — a feedback loop that dribbles, is
unsystematic, and is easy to never actually perform. Rejecting the seed on
latency grounds while relying on it for quality assurance was incoherent. A
bounded ~1k seed serves the quality goal that `change.md:131-134` actually
asked for, at 74% of one free month.

**4. The original option framing undersold the seed arithmetically.** It
described a 1–2k seed as costing "1–2 months of Azure free", which is correct
but reads as a *sustained burn* rather than a one-time draw against an
allowance that returns next month regardless. The framing, not the arithmetic,
carried the wrong conclusion.

**What did not change:** the DeepL gate finding (F.1), the lazy long tail, the
seam itself, the Wiktionary ingest, and the ILI-keyed concept identity of §1.7.
The revision is about *which provider, how much eager* — not about the
architecture.
