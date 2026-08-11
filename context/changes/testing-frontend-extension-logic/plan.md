# Frontend/Extension Logic Coverage Implementation Plan

## Overview

Rollout Phase 5 of `context/foundation/test-plan.md` — the last pending row.
Close Risk #6 by giving the two zero-coverage, highest-churn UI logic surfaces
real tests: the frontend's collection language-gap detection and the extension
popup's variant/sentence selection state. Bootstrapping a test runner for
`extension/` is a prerequisite; it has none, and no CI presence at all.

Grounding (`research.md`) turned four of these "coverage gaps" into **defects** —
three async races in the popup and one still-open data-integrity bug on
`CollectionsListPage`. A test written over any of them today would have to assert
the wrong behavior, so this phase fixes them and proves each fix with a test that
fails when its guard is removed.

## Current State Analysis

- **`extension/` has no test runner, no test files, and no CI presence** — it
  appears in neither `.github/workflows/pr-diff.yml` nor `deploy.yml` (no build,
  no lint, no test). Everything in Phase 1 and Phase 6 is new.
- **`frontend/` has a working Vitest + RTL + jsdom setup** from
  `testing-auth-resilience` (`frontend/vite.config.ts:9-17`,
  `frontend/test/setup.ts`), 6 test directories, and a collection fixture builder
  (`frontend/test/helpers/collections.ts`) that already supports partial entries —
  so the gap tests need no new fixture work.
- **The gap logic is inline JSX derivation**, not a module
  (`CollectionDetailPage.tsx:184-185`). Its failure modes live in the render +
  backfill interaction, not the arithmetic.
- **The popup's selection state is entirely in `extension/src/popup/App.tsx`.**
  Much of it is already correct — sentence picks drop when the variant changes
  (`:182`), empty-variant languages are excluded from `pickable` (`:266`),
  regeneration pairs by meaning rather than position (`:236-237`).
- **Four defects, all live** (details in `research.md` §B and §Open Questions):
  - **E-1** — a translate started for collection A can land, render, and be
    **saved** under collection B. The backend's target-language guard
    (`backend/src/routes/api/collections/index.ts:289-296`) rejects it only when
    the two collections' target sets differ; when they overlap the entry is
    written with the wrong word normalization and B's `source_language_code`.
  - **E-2** — Enter in the text input during a regeneration starts a second AI
    call; the regeneration's continuation then writes a stale `capture` closure
    (`:242-254`), resurrecting the previous word over the new translation.
  - **E-3** — a variant pick made during a regeneration is silently reverted
    (`:255` writes the index read before the await).
  - **L-1** — `CollectionsListPage`, after a failed `listCollections()`, keeps
    `collections` at `[]` and appends a successful create to it, showing one
    collection as the user's complete list (`:20-25, :49`). This is the defect
    `context/foundation/lessons.md:47-52` was written about; the rule was
    recorded, the retry was never built.

## Desired End State

`extension/` has a Vitest suite that runs locally and in CI alongside its lint and
build. Both apps' language and selection logic is covered by component tests whose
oracles come from the product requirements, not from the code under test. The four
defects are fixed, each with a test proven to fail when its guard is removed. The
test plan's §3 Phase 5 row reads `complete`, and §4/§5/§6 describe what actually
exists.

Verify by: `npm test && npm run lint && npm run build` green in both `frontend/`
and `extension/`; a PR showing the new extension CI steps; and the manual Firefox
reproduction of E-1 no longer producing a cross-collection save.

### Key Discoveries:

- **`useSpeech` already carries the guard idiom this phase needs** —
  `extension/src/useSpeech.ts:29-33` tags every utterance with the token it
  started under and drops lifecycle events from superseded ones. The popup's races
  are the same problem; the fix should read like the code next to it.
- **`CollectionDetailPage.tsx:65-97`** shows the codebase's other in-house answer
  (a `cancelled` flag in an effect), and is the model for the frontend half.
- **No `speechSynthesis` stub is needed** — `extension/src/speech.ts:25-27, 35-38`
  degrades to an empty voice list when the API is absent, as it is in jsdom. This
  has a visible consequence; see Critical Implementation Details.
- **The backfill route always returns both a translation and a sentence, or a
  502** (`backend/.../collections/index.ts:390-394`), so
  `CollectionDetailPage`'s optimistic splice cannot push `undefined`.
- **The extension already declares `browser` globally** via
  `@types/firefox-webext-browser` (`extension/package.json:16`,
  `tsconfig.app.json` `types`), so TypeScript is satisfied while jsdom provides
  nothing at runtime — the fake is a runtime concern only.
- **`allowImportingTsExtensions` is already on**, which the extension source
  relies on (`import { sendMessage } from '../messages.ts'`). Vitest resolves
  these through Vite; no config change needed for it.

## What We're NOT Doing

- **Not testing pronunciation playback** beyond the incidental fact that jsdom
  renders every language's "no voice installed" line — `test-plan.md` §7 rules
  this out deliberately, and nothing here changes that.
- **Not testing `background.ts`, `auth.ts`, or the `browser.identity` flow.**
  Risk #6 names popup selection state; the background script's API layer is a
  different surface with a different risk profile, and none of the top-7 risks
  name it.
- **Not extracting `missingLanguages()` (or any other logic) into a module purely
  to make it testable.** The derivation is two lines and its failure modes are in
  the render interaction — an extraction would produce an implementation mirror
  (see `research.md` Q2).
- **Not adding e2e or Playwright coverage for either app.** Every case here is
  reachable in jsdom; `test-plan.md` §4's e2e row stays `none`.
- **Not adding a shared types package** between the apps to deduplicate
  `languages.ts` / `types.ts` — CLAUDE.md's architecture section makes the
  duplication deliberate.
- **Not adding coverage-threshold enforcement** — matches the backend's `c8`
  usage and the frontend's existing setup, neither of which gates on a percentage.
- **Not hardening `handleLogout`'s in-flight behavior beyond the token guard** —
  a resolved translate after logout writes state the anonymous view never renders.
  The token covers it for free; no separate work.
- **Not changing the "Add `<code>`" button's raw-code label** to use
  `languageLabel()`. It is a real cosmetic inconsistency
  (`CollectionDetailPage.tsx:233` vs `:165`), but it is not Risk #6 and changing
  it mid-phase would make the gap tests about copy.

## Implementation Approach

Runner first, then tests over behavior that is already correct, then the fixes —
in that order, so that when a fix lands its test is unambiguously new rather than
a rewritten assertion. Phases 4 and 5 do the same for the frontend and depend on
nothing from 1-3, so they can be reordered if convenient. CI wiring comes after
the suites exist and pass (there is nothing to gate before that), and the
documentation close-out comes last, when there is something true to write down.

Each of the four fixes must ship with a **non-vacuity check**: remove the guard,
confirm exactly that fix's test fails and nothing else does, restore it. This is
the pattern `testing-auth-resilience`'s impl-review established
(`context/archive/2026-08-06-testing-auth-resilience/reviews/impl-review.md`,
F1's "Verified non-vacuous" note) and it is the only thing separating these tests
from coverage theater.

## Critical Implementation Details

**jsdom makes every language block render a voice warning.** Mounting the popup
runs `useSpeech` → `loadVoices()`, which resolves `[]` because jsdom has no
`speechSynthesis` (`extension/src/speech.ts:25-27`). The hook settles to
`ready: true` with `hasVoice()` false, so *every* language section renders "No
`<Language>` voice is installed on this computer…" (`popup/App.tsx:395-399`) and
every play button is disabled. Locators must be specific enough not to collide
with that copy, and a test asserting "no error is shown" must not treat that
muted line as an error. The same holds for `frontend/`'s copy of `speech.ts`.

**The regenerate continuation must stop reading its closure.** `handleRegenerate`
currently rebuilds state from the `capture` and `selectedIndex` it captured before
the await (`popup/App.tsx:242-255`). The token guard prevents a *stale* call from
writing, but the surviving call must still write against current state — so both
writes become functional updates. The selection write in particular must not force
the pre-regeneration index back; it should only clear the sentence when the
variant the user is on is still the one that was regenerated:

```ts
setSelections((prev) => (
  prev[languageCode]?.variant === selectedIndex
    ? { ...prev, [languageCode]: { variant: selectedIndex, sentence: null } }
    : prev
))
```

**The token must be invalidated on collection change and logout, not just on a new
call.** E-1's sequence never starts a second translate — the user only switches
collection — so a token bumped solely at call sites would not catch it.

---

## Phase 1: Bootstrap Vitest + RTL for `extension/`

### Overview

Stand up the runner, the jsdom environment, and the two fixtures every later
extension test needs — the `browser` global fake and the translation-response
builders. No behavioral assertions yet beyond one smoke test proving the wiring.

### Changes Required:

#### 1. Test dependencies and script

**File**: `extension/package.json`

**Intent**: Add the same runner stack `frontend/` uses so the two apps'
suites behave identically, and give CI and local devs one command.

**Contract**: Add `vitest`, `jsdom`, `@testing-library/react`,
`@testing-library/jest-dom` to `devDependencies`, matching the versions already
resolved in `frontend/package.json:22-34`. Add `"test": "vitest run"` to
`scripts` — a single non-watching run, as in `frontend/` and `backend/`.

#### 2. Vitest configuration

**File**: `extension/vite.config.ts`

**Intent**: Point the existing build config at jsdom and a setup file without
introducing a second config file.

**Contract**: Switch the `defineConfig` import from `vite` to `vitest/config` (a
superset — the same move as `frontend/vite.config.ts:3`), keeping the existing
function form and its `loadEnv`/`writeManifest` behavior intact. Add a `test`
field with `environment: 'jsdom'`, `setupFiles: ['./test/setup.ts']`, and
`include: ['test/**/*.test.{ts,tsx}']`. The `writeManifest` plugin acts only in
`closeBundle`, which Vitest never triggers.

#### 3. TypeScript project for the tests

**File**: `extension/tsconfig.vitest.json` (new), `extension/tsconfig.json`

**Intent**: Make `npm run build`'s `tsc -b` type-check the tests, instead of
silently skipping a directory no project includes.

**Contract**: Mirror `frontend/tsconfig.vitest.json` — extend
`./tsconfig.app.json`, own `tsBuildInfoFile`, `include: ["src", "test"]`. Add it
to `extension/tsconfig.json`'s `references`. The extension's tests need no `node`
types (nothing here reads the filesystem), so the app config's
`types: ["vite/client", "firefox-webext-browser"]` carries over unchanged.

#### 4. Test setup

**File**: `extension/test/setup.ts` (new)

**Intent**: Register jest-dom's matchers and RTL cleanup, which this project must
do by hand because it injects no test globals.

**Contract**: Same two lines as `frontend/test/setup.ts` — import
`@testing-library/jest-dom/vitest`, register `afterEach(cleanup)`.

#### 5. The `browser` global fake

**File**: `extension/test/helpers/webext.ts` (new)

**Intent**: Give tests a `globalThis.browser` with the two APIs the popup
actually touches, and hand them explicit control over when a call resolves —
that control is what the Phase 3 race tests are made of.

**Contract**: Export `installFakeBrowser()` (or equivalent) that assigns a fake
onto `globalThis.browser` and returns a handle. It must provide
`runtime.sendMessage` and `storage.local.get` / `.set`
(`popup/App.tsx:113, 141`; `messages.ts:39`). `sendMessage` must speak the real
`MessageResponse<T>` envelope — `{ ok: true, data }` / `{ ok: false, error }` —
because `messages.ts:38-44`'s unwrapping stays in the path and the popup's whole
error UI depends on it. Route responses by message `type`, and support both an
immediate reply and a **deferred** one the test resolves or rejects by hand.
Install per test and reset in `beforeEach`, the way
`frontend/test/helpers/oidc.ts` is used.

#### 6. Translation-response fixtures

**File**: `extension/test/helpers/translations.ts` (new)

**Intent**: Build the popup's input shapes once, so a change to
`extension/src/types.ts` surfaces in one place — the role
`frontend/test/helpers/collections.ts` plays for the print tests.

**Contract**: Builders for `Collection`, `TranslationResult`,
`TranslationLanguage`, `TranslationVariant`, `TranslationSentence`
(`extension/src/types.ts`). Must make the degenerate cases first-class: a
language with an empty `variants` array, and a variant with an empty `sentences`
array. Follow `collections.ts`'s override-object signature.

#### 7. Smoke test

**File**: `extension/test/popup/App.test.tsx` (new)

**Intent**: Prove the runner, the jsdom environment, the fake, and the
TypeScript project all work before any real assertion depends on them.

**Contract**: Render the popup with `auth-status` answering
`{ authenticated: false }`; assert the anonymous view's "Log in" control appears.
Then with `{ authenticated: true }` and a one-collection list, assert the
collection select renders. Explicit `describe`/`it`/`expect`/`vi` imports from
`'vitest'` — no globals.

### Success Criteria:

#### Automated Verification:

- Extension tests pass: `cd extension && npm test`
- Extension type-checks including `test/`: `cd extension && npm run build`
- Extension lint clean: `cd extension && npm run lint`
- Frontend suite still green (no shared state between apps): `cd frontend && npm test`

#### Manual Verification:

- `npm run dev` in `extension/` still produces a loadable add-on — the
  `vitest/config` import and the new `test` field have not disturbed the build or
  `dist/manifest.json`.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation before proceeding.

---

## Phase 2: Cover the popup's existing selection behavior

### Overview

Test what is already correct, before any production code changes. These are the
"documented edge cases" Risk #6 names, and landing them first means Phase 3's
tests are unambiguously new rather than rewritten.

### Changes Required:

#### 1. Selection-state cases

**File**: `extension/test/popup/App.test.tsx`

**Intent**: Prove the variant/sentence selection model behaves correctly on the
cases the popup was designed around, with oracles taken from the product rule
("one pick per language; a sentence belongs to a specific variant"), never from
the code.

**Contract**: Cases, each keyed to a source behavior:

1. On a fresh translate, each language with variants preselects its first variant
   and no sentence (`:85-90`) — the Save control stays disabled.
2. Choosing a different variant clears that language's sentence pick (`:182`) —
   the sentence list re-renders with nothing selected, and Save goes back to
   disabled.
3. A language the model returned nothing for renders "Nothing came back for this
   language" (`:404-405`), is excluded from the "N of M languages chosen" count
   (`:266, :476-478`), and does not block saving the languages that did return.
4. When *no* language has variants, Save stays disabled (`:279`).
5. Save is enabled only when every pickable language has both a variant and a
   sentence (`:279`), and the payload pairs each language's chosen variant with
   its chosen sentence (`:294-304`).
6. Switching collection clears the capture and its selections (`:175`) and
   persists the new id to `browser.storage.local` (`:141`).
7. On open, the popup selects the stored last-used collection, and falls back to
   the first in the list when the stored id is gone (`:115`).

#### 2. Regeneration cases

**File**: `extension/test/popup/App.test.tsx`

**Intent**: Prove regeneration replaces only the sentences of the meaning the
user is looking at, and fails loudly when the model no longer offers that meaning.

**Contract**: Two cases: (1) a fresh response whose variants come back in a
different order still updates the *same meaning*'s sentences — pair by meaning,
not position (`:236-237`); (2) a fresh response missing that meaning entirely
leaves the capture untouched and surfaces the explicit "No new … sentences came
back for this meaning" error (`:238-241`).

### Success Criteria:

#### Automated Verification:

- Extension tests pass: `cd extension && npm test`
- Extension type-checks and lints clean: `cd extension && npm run build && npm run lint`

#### Manual Verification:

- Spot-check two assertions for the oracle problem: confirm each expected value
  comes from the requirement (the FR comments at `:99-101`, `:212-215`,
  `:263-265`) and not from re-reading the implementation.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation before proceeding.

---

## Phase 3: Fix the three popup races

### Overview

Close E-1, E-2, and E-3 with a generation token plus selective disabling, and
prove each guard independently. E-1 is the only defect in this change that writes
bad data, so it leads.

### Changes Required:

#### 1. Generation token

**File**: `extension/src/popup/App.tsx`

**Intent**: Tie every async continuation to the state it was started under, so a
result that is no longer wanted is dropped instead of written.

**Contract**: A ref incremented on collection change (`:172-177`), on logout
(`:162-170`), and at the start of each `translate` / `regenerate` call; each
continuation compares its captured token against the current one and returns
without writing when they differ. Model it on
`extension/src/useSpeech.ts:29-33`, which already does exactly this for
utterances — same file tree, same reasoning, so the two should read alike. A
dropped result is silent: no error is shown, because from the user's point of view
they changed their mind, not something failed.

#### 2. Functional writes in the surviving continuation

**File**: `extension/src/popup/App.tsx`

**Intent**: Stop `handleRegenerate` rebuilding state from its closure, so a
surviving call writes against current state rather than a snapshot.

**Contract**: `setCapture` and `setSelections` at `:242-255` become functional
updates. The selection write must not force the pre-regeneration variant index
back — see Critical Implementation Details for the invariant it must satisfy.

#### 3. Selective disabling

**File**: `extension/src/popup/App.tsx`

**Intent**: Stop the UI inviting an action that is meaningless mid-call, without
freezing a 380px panel the user may legitimately want to redirect.

**Contract**: Disable the text input while `working` (`:361-367`) — its form
submits on Enter today, which is how a second concurrent AI call starts. Disable
the variant radios while that language is regenerating (`:411-416`). Leave the
collection select (`:348-357`) **enabled**: switching collection mid-call is a
legitimate action, and the token now handles it correctly.

#### 4. Race tests

**File**: `extension/test/popup/App.test.tsx`

**Intent**: Prove each guard with a case that fails without it, driving the races
through the fixture's deferred responses.

**Contract**: Three cases, each resolving a deferred `sendMessage` at a
controlled moment:

1. **E-1** — start a translate under collection A, switch to B while it is in
   flight, then resolve A's response: no capture renders, and no save can carry
   A's result to B. The user-visible oracle: an entry saved from the popup always
   belongs to the collection shown in the select at the moment of the translate.
2. **E-2** — start a regeneration, then a translate for a different word, then
   resolve the regeneration last: the popup shows the *new* word's results, not
   the resurrected previous capture. (With the input disabled this is unreachable
   through the UI; drive it at the seam so the token guard is what is under test,
   not the `disabled` attribute.)
3. **E-3** — start a regeneration, switch variant while it runs, resolve it: the
   user's newer variant pick survives.

### Success Criteria:

#### Automated Verification:

- Extension tests pass: `cd extension && npm test`
- Extension type-checks and lints clean: `cd extension && npm run build && npm run lint`

#### Manual Verification:

- **Non-vacuity, three times.** Remove the token guard → E-1 and E-2's tests fail
  and nothing else does. Restore, remove the functional selection write → E-3's
  test fails alone. Restore, remove the input `disabled` → confirm which test
  covers it. Record the result in the change notes.
- Load the built add-on in Firefox (`about:debugging`) with two collections that
  share a target language but differ in native language, and confirm the E-1
  sequence no longer produces a cross-collection save.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation before proceeding.

---

## Phase 4: Cover the frontend's language-gap detection

### Overview

Component tests over `CollectionDetailPage`'s gap row and backfill splice, using
the fixture builders that already exist. No production changes.

### Changes Required:

#### 1. Gap-detection cases

**File**: `frontend/test/pages/CollectionDetailPage.test.tsx` (new)

**Intent**: Prove a gap control appears exactly for the languages a collection
teaches that a given entry lacks — the FR-018 rule — including the legacy-data
case that the case-insensitive comparison exists for.

**Contract**: Render through `MemoryRouter` with a matching
`<Route path="/collections/:id">`, mocking `../src/api/collections` the way
`frontend/test/App.test.tsx:31-36` does, and building inputs with
`test/helpers/collections.ts`. Cases:

1. An entry holding every target language shows no gap row.
2. An entry predating a language the collection gained shows a gap control for
   that language only.
3. A collection whose `targetLanguageCodes` hold legacy uppercase codes (`'EN'`)
   against an entry with a lowercase `'en'` translation shows **no** gap control —
   the spurious-button case the lowercasing at `:184-185` exists to prevent.
4. A multi-language collection gives each entry its own independent gap set.
5. An entry with no translations at all offers every target language.

Assertions are keyed by language, matched case-insensitively. Do **not** assert
the exact button label — it renders the raw code (`Add EN`) rather than
`languageLabel()`, which is a known inconsistency this phase is not fixing;
pinning it would make the test about copy.

#### 2. Backfill cases

**File**: `frontend/test/pages/CollectionDetailPage.test.tsx`

**Intent**: Prove the optimistic splice lands on the right entry and closes the
gap it was raised for, and that a failure surfaces without corrupting the view.

**Contract**: Cases: (1) a successful `addEntryTranslation` inserts the returned
translation and sentence into that entry alone, leaving other entries visibly
unchanged (`:111-122`), and the gap control for that language disappears — the
server echoes a lowercased code, so this also covers the legacy round-trip; (2)
while a backfill is in flight, gap controls on *other* entries are disabled too
(`addingKey` is a page-global lock, `:230`) and the acting one shows its pending
label; (3) a rejected call surfaces the error and leaves the entry as it was.

### Success Criteria:

#### Automated Verification:

- Frontend tests pass: `cd frontend && npm test`
- Frontend type-checks and lints clean: `cd frontend && npm run build && npm run lint`

#### Manual Verification:

- Confirm the legacy case (3) matches real data — the dev database holds
  collections with `PL`/`EN`/`ENss` codes, so the fixture should mirror what is
  actually stored, not an invented shape.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation before proceeding.

---

## Phase 5: Fix and cover `CollectionsListPage`

### Overview

Close L-1 with the retry `context/foundation/lessons.md:51` prescribes, and cover
the create form's language coupling — the cheapest real language logic in the
repo.

### Changes Required:

#### 1. Retry on the page's own error state

**File**: `frontend/src/pages/CollectionsListPage.tsx`

**Intent**: Give the user a way to recover the list a failed load left empty, so
a subsequent create is appended to real data instead of to a phantom empty list.

**Contract**: The load moves out of the bare mount-time effect (`:20-25`) into a
callable fetch the effect invokes and a control can re-invoke. On failure the page
renders its existing error plus a retry control; a successful retry replaces the
collections and clears the error. Deliberately **not** subscribing the page to the
global `connectionIssue` signal — `lessons.md:51` rules that out, because a signal
raised by an unrelated request would refetch everything and couple every page to
that context. The create form stays usable throughout.

#### 2. Recovery and form-logic cases

**File**: `frontend/test/pages/CollectionsListPage.test.tsx` (new)

**Intent**: Prove the recovery works and that the language picker cannot build a
request the API would reject.

**Contract**: Cases:

1. **The L-1 proof**: a failed load, then a retry that succeeds, then a create —
   the list shows every collection, not just the new one. This is the case the
   lesson was written about.
2. A failed load renders the error and the retry control; a retry that fails again
   keeps both.
3. Switching the native language removes it from the picked targets (`:30-33`) —
   the backend rejects a collection whose native language is also a target.
4. Targets cap at 5: with five picked, the unpicked checkboxes are disabled and
   the legend's count reads 5 of 5 (`:35-41, :84`) — mirrors
   `MAX_TARGET_LANGUAGES` in the backend schema.
5. Create is disabled with zero targets (`:101`) and enabled again once one is
   picked.

### Success Criteria:

#### Automated Verification:

- Frontend tests pass: `cd frontend && npm test`
- Frontend type-checks and lints clean: `cd frontend && npm run build && npm run lint`

#### Manual Verification:

- **Non-vacuity**: revert the retry control, confirm case 1 fails and cases 3-5
  still pass.
- With `npm run dev` against a stopped backend, confirm the retry appears, and
  that retrying after starting the backend recovers the list rather than
  requiring a page reload.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation before proceeding.

---

## Phase 6: Wire `extension/` into CI

### Overview

Give the extension its first automated gate — tests, lint, and build — in both
workflows, following the frontend's step pattern.

### Changes Required:

#### 1. PR workflow

**File**: `.github/workflows/pr-diff.yml`

**Intent**: Gate PRs on the extension suite without adding a new required status
check to configure.

**Contract**: A step in the existing `diff` job, modeled on that job's "Run
frontend tests" step: `working-directory: extension`, `npm ci` then `npm test`,
`npm run lint`, and `npm run build`. It goes inside `diff` deliberately — `diff`
is already a required context on the `PR-Needed` ruleset, so no ruleset change is
needed (unlike Phase 4's `print-tests`, which needed its own context because it is
its own job). Needs no AWS credentials, no Neon branch, and no env file; place it
before the steps that write real env values, as the frontend step is.

#### 2. Deploy workflow

**File**: `.github/workflows/deploy.yml`

**Intent**: Keep the merge path gated identically, so a green PR cannot become a
red deploy.

**Contract**: The same step in `deploy.yml`'s `diff` job. `deploy` already carries
`needs: diff`, so a failing extension step blocks the deploy with no further
wiring. Add a comment naming why the extension is now in CI, matching the
commenting density of the surrounding steps.

### Success Criteria:

#### Automated Verification:

- Workflow files parse: `gh workflow view` or a `yamllint`/`actionlint` pass
- The three commands the step runs are green locally:
  `cd extension && npm ci && npm test && npm run lint && npm run build`

#### Manual Verification:

- Open a PR from this branch and confirm the extension step runs inside `diff`,
  and that a deliberately broken extension test turns the `diff` check red.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation before proceeding.

---

## Phase 7: Close out the rollout

### Overview

Make the test plan describe what now exists, backport the two §2 corrections
research surfaced, and record the recurring defect pattern in `lessons.md`. This
is the last phase of the last rollout phase, so it also closes §3.

### Changes Required:

#### 1. Test-plan §2 backports

**File**: `context/foundation/test-plan.md`

**Intent**: Correct two things research proved wrong, using the one in-place §2
edit the workflow sanctions outside `--refresh`.

**Contract**: In Risk #6's Source cell, note that the `frontend/src/pages` churn
figure is majority print work already covered by Phase 4, and that the surface
this phase owns is `CollectionDetailPage` + `CollectionsListPage`. In Risk #6's
Risk Response Guidance row, record the refinement: the cheapest layer is confirmed
as component tests, but the highest-value cases are async state-transition races
needing controlled promise resolution, not pure-unit cases. No file anchors —
principle #3 still holds.

#### 2. Test-plan §3, §4, §5, §6

**File**: `context/foundation/test-plan.md`

**Intent**: Move the Phase 5 row to `complete` and describe the runner, gates, and
patterns that now exist.

**Contract**: §3 Phase 5 Status → `complete`. §4: the frontend/extension runner
row gains the extension's now-shipped setup (versions, config location, the
`browser` fake), and the `checked:` dates advance. §5: new gate rows for the
extension's test, lint, and build steps, naming their location inside `diff` and
what they catch. §6.3: replace the "Extension — TBD" bullet with the shipped
pattern — where tests live, the `globalThis.browser` fixture and why it is faked
wholesale rather than mocking `messages.ts`, the deferred-response control the
race tests need, and the jsdom voice-warning trap. §6.8: a per-phase note for this
rollout phase. §8: advance the freshness ledger dates.

#### 3. Lessons entry

**File**: `context/foundation/lessons.md`

**Intent**: Record the defect pattern this phase found four instances of, so
future reviews catch it by name.

**Contract**: An append-only entry in the file's existing Context/Problem/Rule/
Applies-to shape, describing the read-before-await/write-after pattern: a value
read before an `await` and written after it, while the control that changes that
value stays enabled. Cite the four instances (three in `extension/src/popup/App.tsx`,
one in `CollectionsListPage`) and the two in-repo answers — `useSpeech.ts`'s
generation token and `CollectionDetailPage`'s `cancelled` flag. Applies to: plan,
implement, impl-review.

#### 4. Change close-out

**File**: `context/changes/testing-frontend-extension-logic/change.md`

**Intent**: Record the outcome, including the measured non-vacuity results.

**Contract**: `status: complete`, `updated` stamped, and a note summarizing the
four defects fixed and what each non-vacuity check showed.

### Success Criteria:

#### Automated Verification:

- Both suites green: `cd frontend && npm test` and `cd extension && npm test`
- No stale `TBD` for Phase 5 remains: grep `test-plan.md` for "Phase 5" and
  confirm every reference describes shipped work

#### Manual Verification:

- Read §6.3 as if new to the project: it should be possible to write a new
  extension test from that section alone, without opening an existing test file.
- Confirm §3 has no rows left at anything other than `complete` — this is the
  final rollout phase, so the next `/10x-test-plan` invocation should print the
  completion summary.

**Implementation Note**: This is the final phase. After it lands, run
`/10x-test-plan` to reconcile §3 and print the rollout completion summary, then
`/10x-archive` the change.

---

## Testing Strategy

### Unit Tests:

- The popup's pure derivations, exercised through the component rather than
  extracted: `initialSelections`' preselect rule, `pickable`/`picks`/`readyToSave`
  gating, and the meaning-pairing in regeneration.
- `CollectionsListPage`'s language-picker state: native/target exclusion, the
  5-target cap, the empty-target submit guard.

### Integration Tests:

- The gap-detection → backfill → splice round trip in `CollectionDetailPage`,
  including the legacy-code path where the server echoes a lowercased code.
- The three popup races, driven through deferred `sendMessage` responses — these
  are integration tests in everything but name: they exercise the component, the
  real `messages.ts` envelope unwrapping, and the fake transport together.
- `CollectionsListPage`'s failed-load → retry → create recovery.

### Manual Testing Steps:

1. Build the extension and load `dist/manifest.json` via `about:debugging`.
2. With two collections that share a target language but differ in native
   language, start a translate in one and switch to the other before it returns.
   Confirm no result renders under the second collection.
3. Start a regeneration and try to submit a new word — the input should be
   disabled. Switch variant during the regeneration and confirm the pick survives.
4. Stop the backend, load the web app's collections list, confirm the error and
   retry appear; start the backend, retry, confirm the full list returns.
5. Open a PR and confirm the `diff` check now covers the extension.

## Performance Considerations

The extension CI step adds an `npm ci` plus three short commands to `diff`, the
longest job in both workflows — on the order of 30-60s. That is the cost of the
app having any gate at all, and it needs no browser download (unlike Phase 4's
`print-tests`), so it does not warrant a separate job.

## Migration Notes

None — no data, schema, or deployed-contract changes. The four production fixes
are client-side behavior only, and the extension is loaded manually rather than
deployed by CI, so a bad extension build cannot reach a user through this pipeline.

## References

- Related research: `context/changes/testing-frontend-extension-logic/research.md`
- Rollout phase definition: `context/foundation/test-plan.md` §3 Phase 5, §2 Risk #6
- Runner-bootstrap precedent: `context/archive/2026-08-06-testing-auth-resilience/plan.md`
- Non-vacuity / fix-with-proof precedent: `context/archive/2026-08-06-testing-auth-resilience/reviews/impl-review.md` (F1)
- Guard idiom: `extension/src/useSpeech.ts:29-33`, `frontend/src/pages/CollectionDetailPage.tsx:65-97`
- Recovery rule this phase implements: `context/foundation/lessons.md:47-52`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Bootstrap Vitest + RTL for `extension/`

#### Automated

- [x] 1.1 Extension tests pass: `cd extension && npm test` — c132dd0
- [x] 1.2 Extension type-checks including `test/`: `cd extension && npm run build` — c132dd0
- [x] 1.3 Extension lint clean: `cd extension && npm run lint` — c132dd0
- [x] 1.4 Frontend suite still green: `cd frontend && npm test` — c132dd0

#### Manual

- [ ] 1.5 `npm run dev` still produces a loadable add-on with a correct `dist/manifest.json`

### Phase 2: Cover the popup's existing selection behavior

#### Automated

- [x] 2.1 Extension tests pass: `cd extension && npm test` — 05d1641
- [x] 2.2 Extension type-checks and lints clean: `cd extension && npm run build && npm run lint` — 05d1641

#### Manual

- [ ] 2.3 Spot-check two assertions for the oracle problem (expected values trace to requirements, not to the implementation)

### Phase 3: Fix the three popup races

#### Automated

- [x] 3.1 Extension tests pass: `cd extension && npm test`
- [x] 3.2 Extension type-checks and lints clean: `cd extension && npm run build && npm run lint`

#### Manual

- [ ] 3.3 Non-vacuity: each guard removed in turn fails exactly its own test; results recorded in change notes
- [ ] 3.4 Firefox reproduction of E-1 no longer produces a cross-collection save

### Phase 4: Cover the frontend's language-gap detection

#### Automated

- [ ] 4.1 Frontend tests pass: `cd frontend && npm test`
- [ ] 4.2 Frontend type-checks and lints clean: `cd frontend && npm run build && npm run lint`

#### Manual

- [ ] 4.3 Legacy-code fixture mirrors what the dev database actually stores

### Phase 5: Fix and cover `CollectionsListPage`

#### Automated

- [ ] 5.1 Frontend tests pass: `cd frontend && npm test`
- [ ] 5.2 Frontend type-checks and lints clean: `cd frontend && npm run build && npm run lint`

#### Manual

- [ ] 5.3 Non-vacuity: reverting the retry control fails the L-1 proof case alone
- [ ] 5.4 Retry recovers the list against a restarted backend, without a page reload

### Phase 6: Wire `extension/` into CI

#### Automated

- [ ] 6.1 Workflow files parse (`actionlint` or `gh workflow view`)
- [ ] 6.2 `cd extension && npm ci && npm test && npm run lint && npm run build` green locally

#### Manual

- [ ] 6.3 PR shows the extension step inside `diff`; a deliberately broken test turns the check red

### Phase 7: Close out the rollout

#### Automated

- [ ] 7.1 Both suites green: `cd frontend && npm test` and `cd extension && npm test`
- [ ] 7.2 No stale `TBD` for Phase 5 remains in `test-plan.md`

#### Manual

- [ ] 7.3 §6.3 reads well enough to write a new extension test from it alone
- [ ] 7.4 §3 has every row at `complete`; `/10x-test-plan` prints the completion summary
