---
date: 2026-08-11T18:42:40+02:00
researcher: KStrzechowski
git_commit: 23f302b46986e6610590dbd86a18341bb3ed712d
branch: chore/pin-action-shas
repository: KStrzechowski/InkLingo
topic: "Ground rollout Phase 5 — frontend language-gap detection and extension popup selection state (Risk #6)"
tags: [research, codebase, frontend, extension, vitest, testing-library, risk-6]
status: complete
last_updated: 2026-08-11
last_updated_by: KStrzechowski
---

# Research: Frontend/extension logic coverage (test-plan §3 Phase 5, Risk #6)

**Date**: 2026-08-11T18:42:40+02:00
**Researcher**: KStrzechowski
**Git Commit**: `23f302b46986e6610590dbd86a18341bb3ed712d`
**Branch**: `chore/pin-action-shas`
**Repository**: KStrzechowski/InkLingo

## Research Question

Ground rollout Phase 5 of `context/foundation/test-plan.md`.

Risk to verify: **#6** — frontend collection language-gap detection and extension
popup variant/sentence selection state break silently; both areas have zero test
coverage and the highest recent churn in the repo.

Response guidance to verify, not blindly accept:

- *Prove*: language-gap detection and popup variant/sentence selection produce
  correct output on documented edge cases (missing-language entries,
  multi-language collections, collection-switch mid-selection), not just the
  happy path.
- *Challenge*: "the UI looked right during manual testing" proves the state logic
  is right — it does not prove state transitions (stale selection after switching
  collections) are handled.
- *Avoid*: reaching for e2e/browser tests where a unit/component test suffices.

## Summary

The risk is **real and not speculative** — the logic exists, it is genuinely
uncovered, and grounding it turned up three concrete defect paths that no
existing gate can catch. The plan's guidance holds, with one sharpening.

1. **The cheapest layer is confirmed** — component tests in the existing
   `@testing-library/react` + jsdom setup, no browser. But the *highest-value*
   cases are not pure-function cases: they are **async state-transition races**
   (an AI call resolving after the user changed something), which need RTL plus a
   manually-resolved promise. A pure-unit-only reading of "unit/component tests"
   would miss exactly the failures worth catching.

2. **The "must challenge" line is right, and the reason is stronger than stated.**
   Manual testing cannot plausibly hit these: they require a *race* against a
   ~5s AI call, and Firefox destroys the popup document the moment it loses focus
   (`extension/src/useSpeech.ts:49-51`), so nobody keeps the popup open across a
   translate + collection switch by accident. That is why 3 commits of churn in
   `popup/App.tsx` never surfaced them.

3. **Three defects found** (details in §Detailed Findings B):
   - **E-1** — switching collection while a translate is in flight renders the old
     collection's results under the new collection, and can **save them there**.
     The backend's target-language guard rejects the mismatch *only when the two
     collections' target sets differ*; when they overlap the entry is written with
     the wrong `source_language_code` and a word normalized against the wrong
     native language. Silent cross-collection corruption.
   - **E-2** — pressing Enter in the text input during a regeneration starts a
     second concurrent AI call; the regeneration's continuation then writes a
     **stale `capture` closure**, resurrecting the previous word's results over the
     new translation. Also doubles Anthropic spend on the rate-limited route.
   - **E-3** — switching variant during a regeneration is silently reverted when
     the call returns (`popup/App.tsx:255` forces the pre-regeneration index back).
   All three are cheap component tests with an oracle independent of the code.

4. **The extension test runner bootstrap is small and fully specified** below
   (§C) — deps, config, tsconfig project reference, `browser` global fake. One
   pleasant surprise: **no `speechSynthesis` stub is needed**; jsdom has none and
   `speech.ts:26` already degrades to an empty voice list. One trap that follows
   from it is named in §C.4.

5. **One blocking decision for the plan** (§Open Questions Q1): `CollectionsListPage`
   still carries the *known-open* defect that `context/foundation/lessons.md:47-52`
   was written about — after a failed load, a successful create renders one
   collection as the complete list. Phase 5 is scoped as tests-only, but writing a
   test over that page means either asserting the wrong behavior (the oracle
   problem the plan warns about) or fixing it in the same phase.

## Detailed Findings

### A. Frontend — language-gap detection

**Where it lives.** Not a module: it is a 2-line derivation inside the entry map
in `frontend/src/pages/CollectionDetailPage.tsx:184-185`.

```ts
const have = new Set(entry.translations.map((t) => t.languageCode.toLowerCase()))
const missing = collection.targetLanguageCodes.filter((code) => !have.has(code.toLowerCase()))
```

Consumers: the "Missing:" row and one `Add <code>` button per gap
(`CollectionDetailPage.tsx:223-237`), and `handleAddLanguage`
(`CollectionDetailPage.tsx:102-128`) which splices the new rows into the entry in
place rather than refetching.

**Edge cases that are real, verified against the backend:**

| Case | Behavior today | Verified at |
|---|---|---|
| Legacy uppercase code (`'EN'`, `'PL'`) in `targetLanguageCodes` | Matched case-insensitively, so no spurious gap button — but the button *label* renders the raw code (`Add EN`), unlike the voice-warning line which uses `languageLabel()` | `CollectionDetailPage.tsx:184-185` vs `:233`; `languages.ts:22-25` |
| Entry predates a language the collection gained | Gap button shown; backfill route generates one variant + one sentence | `CollectionDetailPage.tsx:223`; `backend/.../collections/index.ts:383-394` |
| Backfill response shape | Route always returns **both** `translation` and `sentence`, or a 502 — so the optimistic splice at `:117-118` cannot push `undefined` | `backend/.../collections/index.ts:390-394` |
| Code casing after backfill | Backend lowercases before insert and echoes the row, so the `Add EN` button disappears on a legacy-cased target | `backend/.../collections/index.ts:357, 416` |
| Multi-language collection | Independent gap per entry; `addingKey` is a **global** lock — one backfill disables every gap button on the page (`:230`) | `CollectionDetailPage.tsx:60, 230` |
| Entry has a translation but no sentence in a language | **Not** detected as a gap — `missing` looks only at `translations` | `CollectionDetailPage.tsx:184` |
| Route param changes mid-backfill | `handleAddLanguage` has no cancellation flag (unlike the load effect at `:65-97`); the splice no-ops because entry ids won't match | `CollectionDetailPage.tsx:102-128` |

**Also uncovered, same family, cheaper:** the create-form's language coupling in
`CollectionsListPage.tsx:30-41` — switching native language drops it from the
picked targets (`:30-33`), targets cap at `MAX_TARGET_LANGUAGES = 5` (`:35-41`,
mirroring the backend constant), and Create is disabled at zero targets (`:101`).
Pure state functions, no async, strong oracle (the backend rejects
native-as-target and >5). Recommend folding in — it is the same "language logic"
Risk #6 names and costs almost nothing.

### B. Extension — popup variant/sentence selection state

**Where it lives.** All of it in `extension/src/popup/App.tsx`; there are no other
files. The pieces:

- `initialSelections` (`:85-90`) — variant 0 preselected when the language has
  variants, sentence always `null`.
- `selectVariant` (`:179-183`) — drops the sentence pick, because sentences are
  nested under a variant.
- `selectSentence` (`:185-190`).
- `picks` / `readyToSave` (`:266-279`) — the save gate: every language that has
  variants must have both a variant and a sentence chosen.
- `handleRegenerate` (`:216-261`) — re-asks for everything, keeps only this
  language's fresh sentences, **paired by meaning, not position** (`:236-237`).
- `handleCollectionChange` (`:172-177`) — persists the choice and calls
  `resetCapture()`.

**What is already correct** (worth locking in, cheap):

- Sentence pick is dropped when the variant changes (`:182`) — the mismatch that
  nesting sentences under variants exists to prevent.
- A language the model returned nothing for is excluded from `pickable`
  (`:266`), renders "Nothing came back for this language" (`:405`), and does not
  block save — Risk #3's degenerate response, handled.
- `readyToSave` is false when *nothing* is pickable (`:279`).
- Regeneration pairs the fresh variant by normalized meaning text (`:36-38`,
  `:236-237`) and errors explicitly when the meaning is gone (`:238-241`).
- Collection switch clears capture + selections (`:175`) — the *synchronous* half
  of "collection-switch mid-selection" is handled.

**Defects found.** These are the tests worth writing.

**E-1 — an in-flight translate is not tied to the collection it was started for.**

`handleTranslate` (`:192-210`) reads `activeCollection` before the await, then
writes `setCapture` / `setSelections` unconditionally after it (`:203-204`). The
`<select>` carries no `disabled={working}` (`:348-357`), and `handleCollectionChange`
has no in-flight guard. So:

1. Pick collection A ("Polish → English, German"), translate a word.
2. While "Translating…" is shown, switch to collection B ("Russian → English, German").
3. A's response lands and renders under B. `resetCapture()` already ran, so nothing
   clears it.
4. Save posts to `activeCollection.id` — **B** (`:292`).

The backend guard at `backend/src/routes/api/collections/index.ts:289-296` only
checks that each language code is one of *B's* targets. Here they are, so the
insert proceeds: `word_or_phrase` is the Polish-normalized form
(`normalizedNativeText` from A's call) and `source_language_code` is stamped with
**B's** native language (`:308`). Wrong word, wrong language stamp, wrong
collection, no error. When the target sets don't overlap it degrades to a
confusing 400 instead.

**E-2 — concurrent AI calls, and a stale-closure write.**

The regenerate button is guarded (`disabled={working}`, `:442`) but the text input
is not (`:361-367`), and the form submits on Enter. `handleTranslate` checks only
for empty text and a resolved collection (`:195`). So a translate can start while
a regeneration is running. `handleRegenerate`'s continuation then calls
`setCapture({ ...capture, ... })` (`:242-254`) using the `capture` captured in its
closure — the *previous* word. If the regeneration resolves last, the popup
silently reverts to the earlier word's results while `text` still shows the new
one. Two live calls also double the spend on the route Risk #7's rate limit exists
to bound (`config: translateRateLimit`, `backend/.../collections/index.ts:355`).

**E-3 — a variant pick made during regeneration is silently reverted.**

Variant radios carry no `disabled` (`:411-416`), so they stay live while
"Regenerating…" is shown. On return, `:255` writes
`{ variant: selectedIndex, sentence: null }` where `selectedIndex` was read
*before* the await (`:218`). The user's newer pick is overwritten with no
indication. (The `setCapture` merge at `:248-249` targets the same stale index,
which is correct — it is the sentences for the meaning that was re-asked. Only the
selection write is wrong.)

**Lower severity, worth a line in the plan not a phase:** `handleLogout` (`:162-170`)
has no in-flight guard either (harmless — the anonymous view renders nothing from
`capture`); `selections` is keyed by language code, so a duplicated code in the
response would collide (`:86`).

### C. Bootstrapping a test runner for `extension/`

The extension has **no test runner, no test files, and no CI presence at all** —
it appears in neither `.github/workflows/pr-diff.yml` nor `deploy.yml` (no build,
no lint, no test). Everything below is new.

**C.1 Dependencies** — mirror `frontend/package.json:22-34`: `vitest ^4.1.10`,
`jsdom ^30`, `@testing-library/react ^16.3.2`, `@testing-library/jest-dom ^7`.
Add `"test": "vitest run"` to `extension/package.json:6-10`.

**C.2 Config** — `extension/vite.config.ts` is the function form
(`defineConfig(({ mode }) => ...)`, `:61`) imported from `vite`. Switch the import
to `vitest/config` (a superset, same move as `frontend/vite.config.ts:3`) and add
the `test` field: `environment: 'jsdom'`, `setupFiles: ['./test/setup.ts']`,
`include: ['test/**/*.test.{ts,tsx}']`. The `writeManifest` plugin only acts in
`closeBundle` (`:36`), which Vitest never triggers — no interference.

**C.3 tsconfig** — `extension/tsconfig.app.json` includes `src` only. Add
`extension/tsconfig.vitest.json` mirroring `frontend/tsconfig.vitest.json`
(extends the app config, `include: ["src", "test"]`) and reference it from
`extension/tsconfig.json:3-6`, so `npm run build`'s `tsc -b` type-checks the tests
the way the frontend's does. Note `allowImportingTsExtensions` is already on
(`tsconfig.app.json`), which the source relies on (`import ... from '../messages.ts'`).

**C.4 The `browser` global — the one genuinely new fixture.**
`@types/firefox-webext-browser` (`extension/package.json:16`) declares `browser`
globally, so TypeScript is satisfied while jsdom provides nothing at runtime.
The popup's surface is exactly two APIs:

- `browser.runtime.sendMessage` — via `sendMessage()` (`extension/src/messages.ts:39`),
- `browser.storage.local.get` / `.set` — called **directly** by the popup
  (`popup/App.tsx:113, 141`).

Because the storage calls are direct, a `globalThis.browser` fake is required no
matter which seam is chosen for messaging. Recommend one fixture covering both
(`extension/test/helpers/webext.ts`, same role as
`frontend/test/helpers/oidc.ts`): faking `browser.runtime.sendMessage` keeps the
real ok/error envelope unwrapping (`messages.ts:38-44`) in the path, which
`vi.mock('../src/messages.ts')` would replace. This matches the convention already
recorded in test-plan §6.3 — *mock at the seam the module under test imports from*
— since `App.tsx` reaches `browser.*` itself.

For E-1/E-2 the fake must return a **deferred** promise the test resolves by hand;
that control is the whole test.

**C.5 speechSynthesis — no stub needed, but know what it does.**
Rendering the popup mounts `useSpeech` → `loadVoices()` → `speech.ts:35-38`, which
returns `Promise.resolve([])` when `speechSynthesis` is undefined, as it is in
jsdom (`speech.ts:25-27`). The hook therefore settles to `ready: true` with
`hasVoice()` false, so **every language block renders "No <Language> voice is
installed on this computer…"** (`popup/App.tsx:395-399`) and every play button is
disabled. Cleanup calls `synthesis()?.cancel()` — null-safe (`speech.ts:108-110`).
Consequences for the tests: that muted line is unavoidable DOM noise, and
`getByText(/voice/i)`-style locators will collide with it. `frontend/` has the same
property via its own copy of `speech.ts`.

**C.6 CI wiring.** The frontend precedent is a plain step inside the existing
`diff` job of both workflows (`pr-diff.yml`, "Run frontend tests"; `deploy.yml:149-150`)
— no credentials, no database, and `deploy` is already gated by `needs: diff`, with
`diff` a required status check on the `PR-Needed` ruleset. An extension step is the
same shape and needs no new required context (unlike Phase 4's `print-tests`, which
had to be its own job). `context/foundation/test-plan.md` §5 needs a new gate row.

### D. Test conventions this phase inherits

From `testing-auth-resilience` (test-plan §6.3), all verified in the live tree:

- Tests under `<app>/test/`, mirroring the source tree — not colocated
  (`frontend/test/auth/cognito.test.ts` ↔ `frontend/src/auth/cognito.ts`).
- **No globals** — `describe`/`it`/`expect`/`vi` imported from `'vitest'`
  explicitly (`frontend/test/App.test.tsx:1`).
- `test/setup.ts` registers `afterEach(cleanup)` by hand, because RTL only
  auto-registers it when globals are injected (`frontend/test/setup.ts:8-10`).
- `vi.resetAllMocks()` in `beforeEach` (`frontend/test/App.test.tsx:46-50`).
- Shared fakes in `test/helpers/`, extended rather than re-mocked ad hoc
  (`frontend/test/helpers/oidc.ts`, `frontend/test/helpers/collections.ts`).
- `vi.hoisted` + a module factory when the mock must exist at import time
  (`frontend/test/App.test.tsx:9-27`).
- Component tests render through `MemoryRouter` when the component uses router
  hooks (`frontend/test/App.test.tsx:38-44`) — `CollectionDetailPage` reads
  `useParams` (`:54`), so it needs `initialEntries={['/collections/<id>']}` plus a
  matching `<Route path="/collections/:id">`, or a route wrapper.
- `frontend/test/helpers/collections.ts` already builds `CollectionDetail` /
  `Entry` / `EntryTranslation` / `EntrySentence` and explicitly supports partial
  entries ("translation but no sentence, or a backfill gap", `:48-50`) — the gap
  tests need **no new frontend fixture work**. The extension needs its own
  (different shapes: `TranslationResult` / `TranslationLanguage` /
  `TranslationVariant`, `extension/src/types.ts`).

### E. Hot-spot evidence check (test-plan §2 Source column)

§2 cites `frontend/src/pages` at 21 commits/30d. A per-file scan over 60 days
shows that directory's churn is **majority print**: `PrintCollectionPage.tsx` 5,
`print.css` 4, `printLabels.ts` 2, `printPagination.ts` 1, `printRows.ts` 1,
`PrintDocument.tsx` 1 — all already covered by Phase 4. The churn Phase 5 still
owns there is `CollectionDetailPage.tsx` (7) and `CollectionsListPage.tsx` (4).
`extension/src` at 11 commits/30d holds up (`popup/App.tsx` 3, `popup.css` 3,
`types.ts` 2, `auth.ts` 2). Not a misdirection — the risk stands on its own
evidence — but the "21" overstates the uncovered surface. Optional §2 Source
refinement, not a required backport.

## Code References

- `frontend/src/pages/CollectionDetailPage.tsx:184-185` — the gap derivation (`have`/`missing`), case-insensitive
- `frontend/src/pages/CollectionDetailPage.tsx:102-128` — `handleAddLanguage`, optimistic in-place splice
- `frontend/src/pages/CollectionDetailPage.tsx:223-237` — gap UI; raw code in the button label; global `addingKey` lock
- `frontend/src/pages/CollectionsListPage.tsx:30-41` — native/target coupling and the 5-target cap
- `frontend/src/pages/CollectionsListPage.tsx:20-25, 49` — failed load leaves `collections` empty; create appends to it (see Q1)
- `frontend/src/languages.ts:22-25` — `languageLabel`, case-insensitive with an uppercase fallback
- `extension/src/popup/App.tsx:85-90` — `initialSelections`
- `extension/src/popup/App.tsx:172-190` — collection change + variant/sentence selection
- `extension/src/popup/App.tsx:192-210` — `handleTranslate`, unguarded post-await write (**E-1**)
- `extension/src/popup/App.tsx:216-261` — `handleRegenerate`, stale-closure `setCapture` (**E-2**) and forced selection revert (**E-3**)
- `extension/src/popup/App.tsx:266-279` — `pickable` / `picks` / `readyToSave`
- `extension/src/popup/App.tsx:348-357, 361-367, 411-416` — controls left enabled while a call is in flight
- `extension/src/messages.ts:38-44` — `sendMessage` envelope unwrapping (the seam to preserve)
- `extension/src/speech.ts:25-27, 35-38` — degrades to an empty voice list without `speechSynthesis`
- `backend/src/routes/api/collections/index.ts:289-296` — target-language guard (partial protection for E-1)
- `backend/src/routes/api/collections/index.ts:302-310` — `source_language_code` always taken from the collection
- `backend/src/routes/api/collections/index.ts:383-394` — backfill returns both rows or 502
- `frontend/vite.config.ts:9-17` — the `test` field precedent for the extension config
- `frontend/tsconfig.vitest.json` — the project-reference precedent
- `.github/workflows/pr-diff.yml` ("Run frontend tests") and `.github/workflows/deploy.yml:149-150` — the CI step to mirror

## Architecture Insights

- **The two apps duplicate rather than share** (`frontend/src/languages.ts:17-21`,
  `extension/src/types.ts:1-4`) — deliberate, per CLAUDE.md. Consequence for this
  phase: two fixture sets, two runners, two configs. Do not try to unify them.
- **Every popup state bug in this codebase has the same shape**: a value read
  before an `await` and written after it, with the control that changes that value
  left enabled meanwhile. E-1, E-2 and E-3 are three instances.
  `CollectionDetailPage`'s load effect (`:65-97`) shows the codebase already knows
  the fix — a `cancelled` flag — and is the natural model for the popup.
- **The backend is a partial safety net, not a boundary**: it validates target
  languages and stamps `source_language_code` itself, which converts some client
  state bugs into 400s and lets others through silently. Tests must assert the
  client's behavior, not lean on the server rejecting bad input.
- **The frontend's gap logic is inline JSX derivation, not a module** — unlike the
  print work, which extracted `printRows.ts` / `printPagination.ts` as pure modules
  first. That is a fork in the road for the plan (§Open Questions Q2).

## Historical Context (from prior changes)

- `context/foundation/lessons.md:47-52` — "Clearing a failure signal doesn't
  restore the view it was raised over", written *about* `CollectionsListPage`
  during `testing-auth-resilience` Phase 3. The rule ("prefer a user-triggered
  retry on each view's own error state") was recorded; the retry was never built.
- `context/archive/2026-08-06-testing-auth-resilience/plan.md:34` — explicitly
  deferred the extension: "its auth mechanism … is architecturally unrelated to
  `oidc-client-ts`, and `test-plan.md` §3 already scopes extension test-runner
  bootstrapping to Phase 5." This phase is that scope.
- `context/archive/2026-08-06-testing-auth-resilience/plan.md:33` — the precedent
  for *not* testing a mocked dependency's own scripted behavior. Relevant here:
  do not assert that `browser.storage.local.set` stored something and call that
  "last-used collection is remembered"; assert what the popup does with it on the
  next open.
- `context/archive/2026-08-06-testing-auth-resilience/reviews/impl-review.md:60-128`
  (F1/F2) — the retry/idempotency triage that produced `replaySafe`. Confirms the
  house style for this kind of finding: fix the client, prove it with a test that
  fails when the guard is removed.
- `context/archive/2026-07-25-capture-translate-save/` — where the popup capture
  flow and the "empty variants" handling originally shipped.

## Related Research

- `context/archive/2026-08-10-testing-print-output-correctness/research.md` —
  the jsdom-limitations analysis (no layout, no stylesheets). Directly relevant:
  it is why these tests must assert *state and rendered text*, never geometry or
  computed style.
- `context/archive/2026-08-06-testing-auth-resilience/research.md` — the original
  Vitest-for-`frontend/` bootstrap analysis this phase mirrors for `extension/`.

## Open Questions

**Q1 (blocking for scope — user decision).** `CollectionsListPage` still has the
defect `lessons.md:47-52` describes: after a failed `listCollections()`,
`collections` stays `[]` and a successful create appends to that empty array, so
the user sees one collection presented as their complete list
(`CollectionsListPage.tsx:20-25, 49`). Phase 5 is scoped as tests-only. Options:
(a) leave the page out of scope entirely; (b) test only the create-form's language
logic, which is untouched by the bug; (c) fix it in this phase (a retry on the
page's own error state, per the lesson) and test the fix. Writing a test that
pins the current behavior is the one option to avoid — that is the oracle problem
§1 warns about.

**Q2 (plan-time call, no user input needed).** For the gap logic: component test
against `CollectionDetailPage`, or extract `missingLanguages(entry, targets)` into
a module and unit-test it? Recommendation: **component test**. The derivation is
two lines; its failure modes are in the render + backfill interaction (the button
label, the global `addingKey` lock, the splice), and a component test's oracle is
user-visible ("no gap button for a language this entry already has"). Extracting
purely to make it testable would produce an implementation mirror.

**Q3.** Should E-1/E-2/E-3 be *fixed* in this phase or only *characterized*?
They are real defects, not gaps in coverage — a test written today has to assert
the wrong behavior or fail. Recommendation: fix (each is a `cancelled`-flag or
`disabled={working}`-sized change, modeled on `CollectionDetailPage.tsx:65-97`) and
prove each fix with a test that fails when the guard is removed — the F1 pattern
from the auth-resilience impl-review. This does add production code to a phase the
plan described as test-only; flagging it rather than assuming it.

**Q4.** Does the extension get a CI gate now (a step in `diff`, mirroring the
frontend) or stay local-only? Recommendation: wire it — it needs no credentials,
and the extension currently has *zero* CI presence, so this is also the first
automated check that `extension/` still compiles.
