<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Invariant Aggregate Refactor

- **Plan**: context/changes/invariant-aggregate-refactor/plan.md
- **Scope**: Phase 7 of 7 (full plan — all phases complete)
- **Date**: 2026-08-29
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — `senseRowSpans` misaligns with `rows` on a zero-row sense group

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: frontend/src/pages/printRows.ts:56-65
- **Detail**: `senseRowSpans` always pushes one array element per entry in `senseRowCounts`, even when that entry is `0`:
  ```js
  for (const count of senseRowCounts) {
    spans.push(count)
    for (let i = 1; i < count; i++) { spans.push(null) }
  }
  ```
  `buildBands` (same file, :111-117) contributes zero actual rows to `PrintBand.rows` for a sense whose group count is `0` — its own comment there admits this: "recording a zero-row group rather than dropping it silently is the defensible failure mode if that ever changes." But `senseRowSpans`'s output (`glossSpans`) is meant to align 1:1 with `rows` (stated explicitly in the doc comment at :52-55 and consumed that way — `PrintDocument.tsx:167,172` indexes `glossSpans[index]` where `index` comes from mapping over `rows`). A `0` entry breaks that: `glossSpans` ends up one element longer than `rows` for every group after the zero one, so every later `<th rowSpan>` group-header cell renders against the wrong row — confirmed by reading `PrintDocument.tsx:142-175`.
  Currently unreachable: a sense can only exist with at least one translation (`SenseWithoutTranslationError`) and collections never lose target languages, so `senseRowCounts` should never actually contain a `0` today. `frontend/test/pages/printRows.test.ts`'s `senseRowSpans` tests only cover all-nonzero arrays, so this gap is untested either way.
  Fix A ⭐ Recommended: guard in `senseRowSpans` — skip emitting anything when `count === 0`.
  ```js
  for (const count of senseRowCounts) {
    if (count === 0) continue
    spans.push(count)
    for (let i = 1; i < count; i++) { spans.push(null) }
  }
  ```
  - Strength: Minimal, localized fix; keeps `buildBands`'s recording of the zero-row group (the code's own stated "defensible failure mode") while making the actual consumer-side alignment invariant hold.
  - Tradeoff: `senseRowCounts.length === entry.senses.length` still doesn't hold in spirit — a zero survives in `senseRowCounts`, just silently ignored downstream. A future consumer assuming that equality would still be misled.
  - Confidence: HIGH — directly closes the indexing bug with the narrowest possible change.
  - Blind spot: Haven't checked whether any other file reads `PrintBand.senseRowCounts.length` expecting it to equal `entry.senses.length`.
  Fix B: filter zero-count groups out of `senseRowCounts` at the source in `buildBands` (skip the `push` when `senseRows.length === 0`).
  - Strength: Fixes the invariant at its origin — `senseRowCounts` never carries a value with no corresponding rows, so every consumer stays correct automatically, not just `senseRowSpans`.
  - Tradeoff: Contradicts the code's own comment, which explicitly argues for recording the zero rather than dropping it silently — the comment would need updating or removing too.
  - Confidence: MEDIUM — correct fix, but overrides reasoning the original author wrote down deliberately, so worth a second look before doing so.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — guard added at printRows.ts:56-65, plus a new test case (`printRows.test.ts`: "drops a zero-row group instead of emitting a spurious entry"). Verified: 18/18 tests pass.

### F2 — `seed-demo.mjs` still writes to a column Phase 7 dropped

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/invariant-aggregate-refactor/seed-demo.mjs:173-176
- **Detail**: The Phase 3 seed script inserts into `entry_sentences` naming a `language_code` column:
  ```js
  `INSERT INTO entry_sentences (entry_id, translation_id, language_code, sentence_text, native_gloss_text)
   VALUES ($1, $2, $3, $4, $5)`,
  [entryId, translationId, translation.lang, targetText, nativeGloss]
  ```
  Phase 7's migration (`backend/migrations/1787851002435_drop-sentence-language-code.ts:13`) drops that column — confirmed: `ALTER TABLE entry_sentences DROP COLUMN language_code`. The script was correct when Phase 3 landed and was never revisited when Phase 7 changed the schema underneath it. Phase 3's own contract calls it "Idempotent — safe to re-run"; that's no longer true — re-running it now throws `column "language_code" of relation "entry_sentences" does not exist`, the same failure class `change.md` documents happening to a stale `npm run dev` process. Low real-world impact (an unshipped manual fixture generator, and the demo collection it already produced on the dev branch during its one successful Phase 3 run still stands), but it's a genuine cross-phase break as committed.
  Fix: drop `language_code` and its bound parameter from the `INSERT INTO entry_sentences` statement at :173-176, matching the post-Phase-7 schema.
- **Decision**: FIXED — `language_code` and its bound `translation.lang` parameter removed from the `entry_sentences` INSERT at seed-demo.mjs:172-176.

### F3 — Backfill route can fire up to 10 concurrent Anthropic calls from one request

- **Severity**: ⚪ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend/src/routes/api/collections/index.ts:414-421
- **Detail**: The FR-018 backfill route fires one Anthropic call per sense missing the target language, concurrently via `Promise.all` — correct fix for the "one call per sense" timeout risk the plan flagged (wall time ≈ one call's latency, not N×). For an entry at the schema's cap (`MAX_SENSES_PER_ENTRY = 10`), that's up to 10 concurrent Anthropic requests from a single backend request, each independently subject to the adapter's own retry/timeout. Nothing in the change measures or bounds provider-side behavior at that burst size — Phase 7's `measure-backfill.mjs` tested smaller cases (paired senses, not a 10-sense entry).
  Fix: no change needed now; if 429s show up under real backfill traffic, a small concurrency cap (batches of 4-5) is a cheap mitigation.
- **Decision**: SKIPPED — accepted as-is; revisit only if real rate-limit errors show up under backfill traffic.

### F4 — Migration backfill loop holds its transaction open with sequential per-row round trips

- **Severity**: ⚪ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend/migrations/1787770286111_add-entry-senses.ts:52-66
- **Detail**: The backfill loop issues 2 round trips per existing `entries` row (INSERT …RETURNING then UPDATE), sequentially, inside the single transaction node-pg-migrate wraps the migration in. Fine at current data volumes (a handful of dev/demo entries per Phase 0's count of 23 entries); would hold the transaction and its locks open a long time against a materially larger `entries` table.
  Fix: no change needed now; batch the per-entry work if this migration path is ever rerun against a much larger dataset.
- **Decision**: SKIPPED — accepted as-is; revisit only if this migration path is rerun against a much larger dataset.

### F5 — `handleAddLanguage` is the one state-writing handler missing the cancellation guard used elsewhere

- **Severity**: ⚪ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: frontend/src/pages/CollectionDetailPage.tsx:105-123
- **Detail**: Unlike the load effect at :65-97, `handleAddLanguage` has no `cancelled`-style guard — if the component unmounts mid-flight, `setCollection` still fires. Harmless in practice: the update is a functional `setCollection(prev => ...)` matched by `entry.id` against fresh state, not a stale pre-await snapshot written back — the specific "value read before await, written back after" bug class this repo has hit before (see `lessons.md`) does not apply here. React 18 also silently tolerates a state update after unmount. Flagged only because it's the one place in the reviewed frontend/extension code missing the idiom used everywhere else.
  Fix: add the same `cancelled` guard for consistency with the load effect, though not required for correctness.
- **Decision**: FIXED — added a `mountedRef` set false on unmount (mirroring the load effect's `cancelled` flag, adapted for an event handler rather than an effect); `handleAddLanguage`'s three post-await state writes now check it. Verified: `CollectionDetailPage.test.tsx` 11/11 pass, `tsc` clean.

### F6 — Stale cross-reference comment points at a `change.md` entry that doesn't exist

- **Severity**: ⚪ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: backend/src/domain/translationDraft.ts:286-290
- **Detail**: The comment on `producedCharacters()` states: "Recorded as a follow-up in change.md; until it exists, nothing reads this number." `change.md` contains no mention of `producedCharacters`, `billableCharacters`, or a submitted-characters follow-up anywhere. Cosmetic — doesn't affect behavior — but the cross-reference is unfulfilled.
  Fix: either add the missing follow-up note to `change.md`, or update the comment to stop pointing at a nonexistent entry.
- **Decision**: FIXED — comment at translationDraft.ts:286-290 updated to say the follow-up is "not yet tracked as a follow-up anywhere" instead of falsely pointing at change.md. Verified: `tsc` clean.
