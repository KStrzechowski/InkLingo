---
date: 2026-08-01T16:00:53+02:00
researcher: KStrzechowski
git_commit: c2fe269917889a3b92a4b3a6beb9686e83fd6736
branch: main
repository: InkLingo
topic: "Translation cache in Neon + non-model IPA lookup (Change A)"
tags: [research, codebase, translation-cache, ai, neon, wiktionary, espeak-ng, fr-012]
status: complete
last_updated: 2026-08-01
last_updated_by: KStrzechowski
---

# Research: Translation cache in Neon + non-model IPA lookup

**Date**: 2026-08-01T16:00:53+02:00
**Researcher**: KStrzechowski
**Git Commit**: c2fe269917889a3b92a4b3a6beb9686e83fd6736
**Branch**: main
**Repository**: InkLingo

## Research Question

Can a global translation cache in Neon plus a non-model IPA source cut the
measured ≈$7.57/1,000-capture Anthropic bill without breaking shipped
behaviour? Specifically: where does the cache slot in, how does it survive
FR-012 regeneration, and are Wiktionary seeding and espeak-ng viable on the
free-tier Neon + zip-package Lambda this project deploys to?

## Summary

The cache is viable and the insertion point is clean, but **three findings
change the shape of the change, and one of them breaks its stated scope.**

1. **FR-012 regeneration is shipped, not planned**, and it works by re-sending
   the *identical* translate request. A naive cache would make the "New
   sentences" button visibly worse than a no-op: it would clear the user's
   sentence selection and redisplay the same three sentences. This is a
   regression against manually-verified behaviour, not a theoretical risk.
2. **The lazily-grown pool cannot be built without a contract change.** The
   request carries no set cursor, so the server cannot tell a first capture
   from a regenerate. Change A was scoped as "no API contract or client
   changes" — that scope is not achievable as written. A decision is required.
3. **Wiktionary seeding of translations does not fit Neon's free tier**
   (0.5 GB), but **IPA-only extraction fits comfortably** (tens of MB). The
   change should keep the IPA half and drop or defer the translation-seeding
   half.

Secondary but load-bearing: a global cache **breaks the existing test suite**,
which reuses the same input word across every test, and it interferes with two
steps of the pending Phase 4/5 manual verification.

## Detailed Findings

### The insertion point (clean, one decision)

The request path for `POST /api/collections/:id/translate` is
`backend/src/routes/api/collections/index.ts:213-249`: an auth hook with a
users upsert (`autohooks.ts:31-36`), a rate-limit config (`index.ts:218`,
20/min keyed on user), a collection-ownership query (`index.ts:225-232`), a
target-languages query (`index.ts:234-235`), then `generateWithTimeout`
(`index.ts:240-244`). The `TranslationResult` is returned **raw** — there is
no response schema and no mapping step, so the AI layer's shape *is* the API
contract.

`generateWithTimeout` (`index.ts:43-57`) is shared by both AI routes: the
capture path and the FR-018 backfill route (`index.ts:402-406`, which passes a
single-element `targetLanguageCodes`). **A cache placed inside
`generateWithTimeout` covers both routes; placed at the `/translate` call site
it covers only capture.** Inside is the better seam.

Precedent for a short-circuit already exists: the backfill route does an
existing-translation check and 409s (`index.ts:394-400`).

### FR-012 regeneration — shipped, and hostile to a naive cache

Implemented entirely client-side in `extension/src/popup/App.tsx`:

- Button at `App.tsx:370-377` ("New sentences", per language).
- Handler `handleRegenerate` at `App.tsx:167-212`.
- The code comment at `App.tsx:163-166` states the mechanism: *"The backend
  has a single all-languages call, so this re-asks for everything and then
  keeps just this language's fresh sentences."*
- It re-sends `{ type: 'translate', collectionId, text: capture.input }` with
  the **verbatim original input** (`App.tsx:180`), deliberately kept
  unnormalized for this purpose (`App.tsx:15-17`).
- It pairs variants **by meaning text, not index** (`App.tsx:186-188`, via
  `sameMeaning()` at `App.tsx:35-37`) because generation is non-deterministic.
- It then replaces only that language's `sentences` (`App.tsx:193-205`) and
  resets that language's sentence pick to `null` (`App.tsx:206`).

**Consequence:** a cache keyed `(normalized_text, native_lang, target_lang)`
returns byte-identical sentences on the regenerate call. The popup swaps the
array for an equal one and clears the selection. The user sees their pick
disappear and the same three sentences reappear — strictly worse than nothing
happening.

There is no dedicated regeneration message type: `extension/src/messages.ts:13-19`
defines exactly six, and regeneration reuses `translate` verbatim.

Status is confirmed shipped, not pending: `plan.md:415` (`[x] 2.4`) and
`plan.md:446` (`[x] 4.7`); `reviews/impl-review-phase-4.md:39` marks the popup
capture UI `MATCH` including "meaning-paired regeneration". Regeneration is
**not** among the pending manual checks.

### The scope break: no set cursor exists

For the lazily-grown pool in `change.md:52-67` to work, the server must know
whether this is a first capture (serve set 1) or a regenerate (serve set 2).
It cannot:

- `translateBodySchema` (`backend/src/routes/api/collections/schemas.ts:29-31`)
  accepts only `text`.
- The extension message is `{ type: 'translate', collectionId, text }`
  (`messages.ts:18`).

So advancing the pool requires **either** a new request field — a contract +
extension change, which `change.md:14-15` explicitly excludes from Change A —
**or** server-side per-user state (a "sets this user has seen" table keyed by
user + word + language).

A ticked acceptance criterion also asserts the opposite of caching.
`plan.md:171` (criterion 2.4, ticked at `plan.md:415`): *"Typing the same word
again ('regenerate') returns a fresh set of sentences (non-deterministic
output confirms a real call is happening, **not a cached/stubbed
response**)."* Whatever design is chosen has to reconcile with this.

### Test-suite impact (blocking, not cosmetic)

Every test in `backend/test/routes/api/translate.test.ts` uses the **same
input text `'pies'` with native `'pl'`** (`:60-77`, `:92-105`, `:122-138`,
`:157-178`, `:193-205`, `:222-235`, `:266-269`, `:286-291`), varying only the
collection and target set. `entry-translations.test.ts` likewise always uses
`'pies'`/`pl`/`de` (`:52`, `:28-40`).

A global cache means tests 2..n hit rows written by test 1 and never reach the
stub. The call-count assertions that prove retry behaviour (`:181`, `:209`,
`:238`) and the 502 assertion (`:293`) would all break.

Compounding it: tests run against a **real Neon database** with no per-test
schema isolation, and `createCollectionRow` does not register cleanup (only
`createUserRow` does, via cascade — `test/helpers/fixtures.ts:14`). Globally
keyed cache rows would persist across runs.

### Conventions the change must follow

- **Plugins**: `export default fp<XOptions>(async (fastify) => {...}, { name, dependencies })`.
  Canonical example `backend/src/plugins/anthropic.ts:1-20`. Plugins that read
  a decorated property need the defensive type-only import at
  `anthropic.ts:10` — this is `lessons.md:19-24`, hit twice already.
  Autoload is unconditional (`src/app.ts:30-34`).
- **Decorators**: declared only in `backend/src/fastify.d.ts:25-30`; the
  inline `declare module 'fastify'` in `support.ts:16-20` is the anti-pattern
  the file warns against at `:18-23`.
- **Migrations**: `backend/migrations/<epoch-ms>_<kebab>.ts`, created via
  `npm run migrate:create`. Best template for a new table is
  `1785419841325_add-collection-languages.ts:10-29` — `pgm.createTable` with a
  `gen_random_uuid()` default, a named `pgm.addConstraint(...unique)`, a
  `pgm.createIndex`, and a reversing `down`. **No JSONB column exists anywhere
  yet** — this change introduces the first.
- **DB access**: `fastify.sql` is the Neon HTTP driver
  (`backend/src/plugins/neon.ts:12-16`), typed `NeonQueryFunction<false, false>`.
  Transactions are **non-interactive only** — you pass an array of query
  promises and cannot feed a `RETURNING` value into the next statement
  (`index.ts:309-313`). Ids are generated app-side with `randomUUID()`.
- **No route changes** ⇒ `lessons.md:26-31` (every new route needs an
  `api-construct.ts` entry) does **not** apply, provided the change adds no
  routes. Worth stating explicitly in the plan.
- `lessons.md:33-38` applies directly: this change touches `backend/src/ai/`,
  so it needs real-API verification and recorded measurements, not just
  stubbed tests.

### External feasibility

**Neon free tier**: 0.5 GB storage per project, 100 CU-hours/month,
autosuspend after 5 minutes, scale-to-zero. The compute allowance doubled from
50 to 100 CU-hours in October 2025.

**kaikki.org** publishes per-edition wiktextract JSONL, generated from
2026-05-01 dumps. The Polish edition (`plwiktionary`) carries 171,695 Polish
senses, plus other languages documented within it (English 124,406, German
58,957, Italian 52,381), totalling 1,232,206 senses across 100+ languages.
Russian (`ruwiktionary`) exists as a separate edition. Entries include IPA
pronunciations, multiple senses/glosses, usage examples, and translations.

**Verdict on seeding**: full translation seeding does **not** fit. At roughly
1–3 KB per sense, 1.23M senses is ~1.5–4 GB against a 0.5 GB cap. But an
**IPA-only extraction** — `(word, language_code, ipa)` — at roughly 800k rows
× ~50 bytes lands in the tens of MB and fits comfortably. This cleanly splits
the change: keep the IPA half, drop or defer translation seeding.

**espeak-ng in a zip Lambda**: no native binary needed — WASM builds exist.
Candidates: `phonemizer` (npm, text→phones via eSpeak NG, Node-compatible, IPA
output); `@echogarden/espeak-ng-emscripten` (Emscripten build, last published
~1 year ago); `espeak-ng` (npm, last published ~3 years ago — stale, avoid).
Maintenance is the risk, not feasibility. **Not verified**: exact package
sizes, IPA-vs-phoneme-code output fidelity per language, and behaviour under
Lambda's read-only filesystem. Confirm at implementation time with a spike
before committing.

## Code References

- `backend/src/routes/api/collections/index.ts:43-57` — `generateWithTimeout`, the cache seam covering both AI routes
- `backend/src/routes/api/collections/index.ts:213-249` — capture translate route
- `backend/src/routes/api/collections/index.ts:394-400` — existing 409 short-circuit precedent
- `backend/src/routes/api/collections/index.ts:309-313` — Neon non-interactive transaction constraint
- `backend/src/ai/translate.ts:155-164` — `generateTranslation` + empty-result retry
- `backend/src/ai/translate.ts:113-120` — `alignToRequested`, preserves requested language order
- `backend/src/plugins/neon.ts:12-16` — `fastify.sql` HTTP driver
- `backend/src/plugins/anthropic.ts:1-20` — plugin shape + defensive type-only import
- `backend/src/fastify.d.ts:25-30` — decorator declarations
- `backend/src/routes/api/collections/schemas.ts:29-31` — `translateBodySchema`, only `text`
- `extension/src/popup/App.tsx:167-212` — `handleRegenerate`, the FR-012 path
- `extension/src/popup/App.tsx:35-37` — `sameMeaning`, pairs variants by text not index
- `extension/src/messages.ts:13-19` — six message types, no regeneration type
- `backend/test/routes/api/translate.test.ts:181,209,238` — call-count assertions a cache would break
- `backend/migrations/1785419841325_add-collection-languages.ts:10-29` — new-table migration template

## Architecture Insights

- **The AI layer's return type is the public API contract.** No response
  schema, no mapping (`index.ts:248`). Any cache must reproduce
  `TranslationResult` exactly, including `alignToRequested`'s guarantee that a
  skipped language returns `variants: []` rather than being absent.
- **Non-determinism is load-bearing, not incidental.** The extension pairs
  variants by meaning text precisely because output varies between calls
  (`App.tsx:181-185`). A cache that returns a *different set of meanings* on
  regenerate would break `sameMeaning` and surface "No new sentences came back
  for this meaning."
- **"Ephemeral until save" was a deliberate decision**
  (`plan-brief.md:25`, `plan.md:146`: the route "never persists anything").
  A cache revisits that decision for generation *output* while leaving
  candidate selection state untouched. Worth stating so it isn't waved
  through.
- **Single-call-for-all-languages is settled and should not be undone**
  (`capture-translate-save/change.md:35`, chosen for cost: ~$0.008 vs ~$0.04
  at five languages). Per-language partial hits must not become per-language
  API calls on a miss — call once for the missing subset.

## Historical Context (from prior changes)

- `context/changes/capture-translate-save/change.md:35` — one Anthropic call
  for all target languages, chosen for cost; forced `MAX_TOKENS_PER_LANGUAGE`
  scaling and a 15s→20s timeout bump.
- `context/changes/capture-translate-save/change.md:37` — the empty-variants
  failure (~3 in 34 five-language calls) that motivated `EMPTY_RESULT_RETRIES`;
  two hypotheses tested and disproved, including that repeated identical
  requests were the trigger (16/16 fine — so regeneration is not the cause).
- `context/changes/capture-translate-save/change.md:38` — prior measurements:
  $0.0063/capture, 4.7–10.0s at five languages, peak 1,721 output tokens
  against a 10,240 budget.
- `context/changes/capture-translate-save/plan.md:171,415` — ticked criterion
  2.4 explicitly requires "not a cached response".
- `context/archive/2026-07-20-minimal-database/plan-brief.md:21,26` —
  node-pg-migrate chosen, no ORM; migrations run manually.
- `context/archive/2026-07-21-account-auth/change.md:25` — precedent for
  accepting a per-request DB write on the hot path (JIT provisioning upsert).
- `context/foundation/prd.md:93` (FR-015) — IPA was justified *because* its
  marginal cost inside the existing call is low. Moving IPA to Wiktionary/
  espeak-ng makes it an independent dependency; that rationale no longer
  applies, though accuracy improves.

## Manual-verification interference

`context/changes/capture-translate-save/follow-ups/pending-manual-checks.md`
has five unticked items (4.8, 5.3, 5.4, 5.5, 5.6). Two are affected:

- **Step 3 (multi-language capture, 5.3)** — the doc says to expect 5–10
  seconds at five languages and to watch whether the retry is working. A cache
  hit changes the latency being eyeballed and masks the retry's live
  behaviour.
- **Step 5 (FR-018 backfill, 5.6)** — with a warm cache the "Add de" button
  serves from cache instead of exercising the generate-and-insert path.

Unaffected: steps 1, 2, 4, 6, 7, 8. The rate-limit check (step 7) still fires
on cache hits since the limiter is route-level config (`index.ts:60-65`).

**Recommendation: run the manual verification before this change lands**, or
use never-before-captured words for steps 3 and 5.

## Open Questions

1. **How does the server distinguish a first capture from a regenerate?**
   Either add a request field (breaks Change A's "no contract change" scope)
   or hold server-side per-user seen-set state (stays in scope, more schema).
   This is the decision that must be made before planning.
2. **How is the test suite isolated from the cache?** Options: a per-test
   unique input word, a cache-disable flag in test config, or a truncate step
   in `test/helpers/fixtures.ts`. Affects roughly 16 existing tests.
3. **Does criterion 2.4 get rewritten, or does the pool design preserve it?**
   The lazily-grown pool arguably satisfies it (a *fresh* set still appears),
   but the wording says "a real call is happening".
4. **Is translation seeding dropped or deferred?** IPA-only seeding fits the
   free tier; translation seeding does not. Recommend dropping it from Change
   A and reassessing if the cache's natural hit rate proves too low.
5. **Which espeak-ng WASM package, and does it emit true IPA for all 8 codes?**
   Needs a spike; `phonemizer` is the leading candidate.
6. **CC-BY-SA attribution and share-alike** for Wiktionary-derived IPA shown
   in the product and in printed exports (FR-014). Unresolved legal gate,
   carried over from `change.md:87-88`.
