# Invariant Aggregate Refactor — Plan Brief

> Full plan: `context/changes/invariant-aggregate-refactor/plan.md`
> Design: `context/domain/02-invariant-aggregate-refactor.md`
> Research: `context/changes/invariant-aggregate-refactor/research.md`

## What & Why

A saved entry must keep **every meaning the user chose**, and every example sentence must
belong to **exactly one of them**. Today neither holds: `UNIQUE(entry_id, language_code)`
forbids a second meaning outright, and `entry_sentences` keys on `(entry_id,
language_code)` with no reference to a translation, so the meaning↔sentence pairing exists
only as a convention inside the popup. The model returns `zamek` = *castle* / *lock* /
*zipper* correctly and the save throws two away — measured on real data as `zamek`
surviving only as `lock`. This builds the `Entry` aggregate that guards both rules.

## Starting Point

The anti-corruption-layer change (2026-08-23) gave the backend a port, a domain value
object and a provider adapter — but only for the *translation draft*. There is still no
repository and no `Entry`; every persistence rule runs inline in a 482-line route file.
Research re-grounded the design at HEAD and found its evidence base badly stale: the file
its §5 is written against no longer exists and a test now **asserts** it doesn't, the name
`Sense` is already taken by a language-scoped type meaning the opposite thing, and the
print budget leaves 6.7pp free against the 12-16pp a meaning column needs. Phase 0 ran
read-only on 2026-08-25: 23 entries, zero ambiguous sentences, zero would-be uniqueness
violations — the migration is safe on this data.

## Desired End State

Capture `zamek`, tick two meanings, pick a sentence for each in each language, save — and
both meanings come back on `GET`, appear grouped in the review page, and print as two rows
distinguished by a `Znaczenie` column. Adding a language to an existing entry translates
every meaning it already has, instead of guessing at the first one. Every rejection is a
named domain error thrown from one place, not a log line.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Sense level | Entry-level, not per-language | A meaning is a property of the word; a target language only supplies a word *for* it | Design |
| Read reconstruction | One strict path; repair the 4 offending rows | Cheapest at this volume, and keeps exactly one place that knows what a valid entry is | Plan (user) |
| Print column | Swap `Language` out for `Znaczenie` | The only move that frees enough width, and it keeps the sheet at five columns so the geometry test stays green | Plan (user) |
| Version-skew shims | None | Solo side-loaded extension; the popup breaks Phase 2→5 rather than carrying two throwaway adapters | Plan (user) |
| Live AI verification | One measured pass after the epic | User preference; the early-exit risk is recorded below | Plan (user) |
| Cache-first / EN pivot (IL-24) | Separate change, after this one | You cannot key reuse on "the meaning" while the database has no concept of a meaning | Plan (user) |
| Legacy data | Free hand; seed a fresh demo collection | User doesn't need the old rows; the new shape needs fixtures the old ones can't provide | Plan (user) |
| `sense_key` in migration | Frozen inline copy, not an import | A migration must keep producing what it produced the day it ran; IL-24 will redefine `senseKey()` | Plan |
| `DraftSense` collision | Renamed to `SenseTranslation` in Phase 2 | That file is being rewritten there anyway | Plan |
| Backfill response | The whole updated entry | One entry shape in the system instead of a second partial one the client merges by hand | Plan |

## Scope

**In scope:** the `Entry`/`Sense`/`SenseTranslation`/`Sentence` aggregate and its named
error taxonomy; the meaning-first AI tool schema plus a second one for backfill; the
`entry_senses` table and both FK chains; an entry repository; declared response schemas on
the two entry-shaped routes; the meanings-first popup; the review page and printed sheet.

**Out of scope:** cache-before-model and English-as-pivot (IL-24); replacing `senseKey`'s
weak identity; server-side normalization of `wordOrPhrase`; any new route; compatibility
shims.

## Architecture / Approach

```
tool schema          senses[] → translations[] → sentences[]     (adapter)
      ↓
TranslationDraft     same nesting                                 (domain)
      ↓
wire (POST body)     senses[] → translations[] → sentences[]      (schemas.ts)
      ↓
Entry.capture        every precondition, one place, named errors  (domain)
      ↓
entryRepository      one non-interactive transaction, 3 levels    (repositories)
      ↓
entry_senses ← entry_translations.sense_id ← entry_sentences.translation_id
```

`LanguageContract` is a required constructor input, so "only languages this collection
teaches" stops being three hand-written checks and becomes structural. `Sentence` carries
no `languageCode` at all — a cross-wired sentence becomes unrepresentable rather than
merely rejected.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 0. Survey ✅ | Row counts, orphan/ambiguity probes (done 2026-08-25) | — |
| 1. Domain core | Pure aggregate + error taxonomy, no wiring | Getting precondition order wrong is cheap here and expensive later |
| 2. AI contract | Meaning-first tool schema, draft reshaped, rename | **The popup's translate flow breaks here until Phase 5**; unverified against the live model until Phase 7 |
| 3. Migration | `entry_senses`, both FK chains, constraint swap, seeded fixtures | `down()` is a one-way door; dropping the unique constraint also drops the only `entry_id` index |
| 4. Repository + routes | Aggregate wired in, nested read model, D-2 backfill | The lexical ownership test fails a *correct* repository; response schemas silently strip undeclared fields |
| 5. Extension | Meanings-first popup; translate works again | Radio groups and speak keys are per-language — the feature is unbuildable until they're re-keyed |
| 6. Frontend + print | Grouped review page, `Znaczenie` column, nested `rowSpan` | Wrapping glosses inflate band height into the pagination budget |
| 7. Cleanup + verify | Dead column dropped, live measurement, break checks | The model may group meanings badly — discovered here, with everything already built |

**Prerequisites:** none outstanding — Phase 0 is complete, and the dev Neon branch is the
only environment probed. Re-run `phase0-probe.mjs` before applying Phase 3 anywhere else.
**Estimated effort:** ~7 sessions, one per phase; phases 4 and 5 are coupled by the
no-shim decision and are best run back to back.

## Open Risks & Assumptions

- **Live verification moved to the end (your call).** The design put it at Phase 2
  specifically to buy an early exit if the model groups meanings badly across languages.
  With it at Phase 7, that discovery would come after the migration, both clients and the
  print layout are built. A 3-call smoke test at Phase 2 (~$0.03) would restore the exit if
  you change your mind.
- **The popup is non-functional from Phase 2 to Phase 5.** Verification in that window is
  through tests and direct API calls only.
- **`down()` can be rehearsed exactly once**, in Phase 3, against pre-refactor data — it
  re-adds a constraint the feature's first real use makes unsatisfiable.
- **D-2 issues one model call per meaning.** A three-meaning entry means three sequential
  calls under a 20s route timeout and API Gateway's 29s ceiling; they need to run
  concurrently or be capped.
- **Phase 0's numbers are the dev branch only.**
- **`senseKey` stays a weak identity** — *"budowla obronna"* and *"budowla"* are two
  meanings under it. Deliberate, and the named seam IL-24 replaces.

## Success Criteria (Summary)

- Saving `zamek` with two meanings keeps both, each with its own words and its own
  sentences, and reads back identically.
- Every rejection is a named domain error with a mapped status code, thrown from one place —
  no violation is logged and continued.
- The printed sheet shows why a word has two rows, still fits A4, and still passes the
  committed column geometry and pagination specs.
