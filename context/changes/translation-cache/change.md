---
change_id: translation-cache
title: Cut translation cost with a Neon cache and non-model IPA lookup
status: blocked
created: 2026-08-01
updated: 2026-08-02
archived_at: null
---

## Notes

> **SUPERSEDED 2026-08-02 by `context/changes/translation-pivot/`.** Not
> abandoned for being wrong — abandoned for being the smaller idea. This
> change caches per `(word, native_lang, target_lang)`; the pivot change moves
> the unit of reuse to the *sense*, which makes the cache structural rather
> than a layer in front of the model, and drops the all-language-pairs preseed
> from ~$304 to ~$4. Status is `blocked` rather than archived because nothing
> here was implemented.
>
> **`research.md` in this folder is still valid and still worth reading** —
> the `generateWithTimeout` seam, the FR-012 regeneration findings, the
> test-isolation problem, and the manual-verification interference all carry
> over to the new change unchanged. It is referenced from there rather than
> duplicated.

Scope decided 2026-08-01 after a cost review of the Haiku translate path
(`backend/src/ai/translate.ts`). This is **Change A of two** — everything here
is lookup-before-the-model infrastructure, with no API contract or client
changes. The data-model restructure is deliberately deferred to Change B.

### Measured baseline (real calls, `claude-haiku-4-5-20251001`, native `pl`, 5 targets)

| Capture | Input | Output | Cost | Output share |
|---|---:|---:|---:|---:|
| "zamek" (ambiguous) | 1,238 | 1,725 | $0.0099 | 87% |
| "kot" (simple) | 1,237 | 809 | $0.0053 | 77% |
| "zamek", 1 target | 1,226 | 308 | $0.0028 | 56% |

≈ **$7.57 per 1,000 captures**. Input splits as tool JSON schema 922 tokens
(81%), system prompt 209 (18%), the captured word 9 (1%). Going 1→5 target
languages costs only ~3 extra input tokens per language, so the existing
single-call bundling is already efficient and should not be undone.

### In scope

- Translation cache table in Neon, keyed `(normalized_text, native_lang,
  target_lang)` — **global**, not per-user or per-collection; the content is
  not user-specific.
- Per-language partial hits: call the model with only the *missing* languages.
  `targetLanguageCodes` is already a parameter, so this is a small change at
  the `generateWithTimeout` call site.
- IPA sourced outside the model: Wiktionary first, espeak-ng fallback, model
  never. Request-path lookup, not just an offline job.
- Wiktionary pre-seeding of common words (kaikki.org machine-readable
  extracts).

### Out of scope (→ Change B)

- Sense/sentence restructure (senses as a property of the source word; 3
  shared sentences rendered per language).
- Dropping `UNIQUE(entry_id, language_code)` on `entry_translations`.
- Generation caps (max 3 meanings, exactly 3 sentences).
- Trimming the 922-token tool-schema descriptions (~6% saving; fold into
  Change B while that file is already open).

### FR-012 regeneration vs the cache (decided 2026-08-01)

FR-012 (must-have) lets the user regenerate different example sentences, per
language, independently. A cache that always returns the same rows would make
that button a no-op, so the cache row is a **lazily-grown pool of sentence
sets**, not a single frozen answer:

- First capture of a word generates one set (3 sentences) and caches it.
- Regenerate generates the next set and **appends** to the same cache row.
- A later capture of the same word serves set 1 from cache; if that user
  regenerates, set 2 is already there and costs nothing.

Nothing is generated that isn't shown, and regeneration gets cheaper as the
pool fills from real demand. Needs a deterministic "which set has this user
already seen" notion so regenerate advances rather than randomizes — shape to
be settled in research.

Display cap (user decision, 2026-08-01): **max 3 meanings and max 3 sentences**
shown per language. Compatible with FR-009/FR-010 ("kilka") and FR-011 (user
picks one per language). Enforcing the cap in generation is Change B; Change A
only needs the cache to store sets of that size.

### Constraints and known traps

- **Prompt caching cannot help here.** Haiku 4.5's minimum cacheable prefix is
  4,096 tokens; the request is ~1,238, so `cache_control` would silently never
  engage while still charging the write premium. Do not add it.
- `normalizedNativeText` only comes back *after* the call, so cache lookup
  needs a cheap lowercase+trim key on the way in; store rows under both the
  raw and normalized forms.
- Store the cached payload as JSONB with a `schema_version` column so Change
  B's restructure invalidates rows rather than corrupting them.
- espeak-ng covers all 8 supported codes, but guesses Russian/Ukrainian stress
  on homographs (за́мок vs замо́к) — exactly the disambiguation case InkLingo
  exists for. Wiktionary has per-sense IPA and should win where present.
- Wiktionary is **CC-BY-SA**: attribution required, and share-alike on derived
  content needs a deliberate decision before shipping.
- The empty-result retry (`EMPTY_RESULT_RETRIES`, ~3 in 34 calls) adds ~9% to
  the bill; a cache hit avoids it entirely.

### To verify in research (not yet confirmed)

- Which Wiktionary editions have usable machine-readable extracts for all 8
  supported codes. Polish Wiktionary is far smaller than English.
- Realistic hit rate for `pl→{de,fr,es,it}` specifically — that number decides
  whether seeding earns the ingestion work at all.

### Related

- Phase 4 & 5 manual verification of `capture-translate-save` is still
  pending; Change B would alter some of what that verifies, this change
  should not.
