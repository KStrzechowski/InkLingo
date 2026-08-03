# Pronunciation Playback Implementation Plan

## Overview

Roadmap slice **S-05 / PRD FR-016**: the user can play audio of the target-language translation and of an example sentence, in the extension popup (where capture happens) and in the web app (where saved entries live). Audio is produced locally by the browser's Web Speech API — no backend, no infrastructure, no new dependency. Languages the user's operating system has no voice for show a disabled button and a one-line reason rather than silently missing controls.

This closes PRD Open Question 2 and roadmap Open Roadmap Question 2 (Web Speech API vs. paid TTS) in favour of Web Speech, with the cloud path scoped, decided, and deliberately deferred — see "What We're NOT Doing".

## Current State Analysis

Nothing audio-shaped exists anywhere in the repo. A grep for `speechSynthesis|Web Speech|Polly|tts|text-to-speech|audio|\.mp3` across `backend/src`, `frontend/src`, `extension/src` and `infra/lib` returns zero hits. The extension's dependencies are `react` and `react-dom` only.

Both surfaces already render exactly the text that needs playing, tagged with its language:

- **Extension popup** (`extension/src/popup/App.tsx:333-401`) renders, per target language, a radio list of translation variants (`meaningText` + optional `phoneticTranscription`) and, once a variant is picked, a radio list of that variant's sentences (`targetText` + `nativeGlossText`).
- **Web app** (`frontend/src/pages/CollectionDetailPage.tsx:121-135`) renders each saved entry's `translations[]` (`languageCode` + `meaningText` + `phoneticTranscription`) and `sentences[]` (`languageCode` + `sentenceText` + `nativeGlossText`).

So no API change, no data-model change, and no new fetch is required on either surface. The work is entirely presentational plus a speech module.

**Voice availability was measured, not assumed** (2026-08-03, developer's Firefox): `speechSynthesis.getVoices()` reports voices for **`en` and `pl` only** — 2 of the 8 codes in `backend/src/languages.ts:4` (`en, pl, ru, de, fr, es, it, uk`). Additional languages appear only if the corresponding OS language pack is installed; Ukrainian has no Microsoft voice on typical Windows builds. This is the accepted limitation of the local-only approach and is the reason the disabled-with-reason state is a first-class part of the design rather than an edge case.

The same measurement surfaced the API's central gotcha: the first `getVoices()` call returned an empty array, and the language list only appeared on a second call. See Critical Implementation Details.

## Desired End State

In the extension popup, every translation variant row and every example-sentence row carries a small play control. Clicking it speaks that text in its own language. Clicking it again stops. Clicking a different one stops the first and starts the second. Choosing a radio option is unaffected by clicking play.

In the web app's collection detail page, the same controls sit beside each saved translation and each saved sentence.

For a target language with no installed voice, that language's play controls are visibly disabled and the language block carries one short line explaining why — not repeated per row.

**Verification**: with a `pl → en` collection, capturing a word yields an English variant that speaks aloud on click and an English sentence that speaks aloud on click; adding a `de` or `ru` target language to a collection (or testing on a machine without those packs) yields disabled controls with a reason line, with no console errors and no effect on capture, regeneration or save.

### Key Discoveries:

- Both surfaces already have the text and its language code in hand — `extension/src/popup/App.tsx:333-401`, `frontend/src/pages/CollectionDetailPage.tsx:121-135`. No API work.
- **Play buttons cannot go inside the existing `<label>` elements.** Popup variant and sentence rows are `<li><label><input type="radio" …/>…</label></li>` (`extension/src/popup/App.tsx:348-360`, `381-394`). A `<button>` nested in a `<label>` makes every play click also select that radio. The button must be a sibling of the `<label>` inside the `<li>`.
- Voice `lang` values are BCP-47 (`en-US`, `pl-PL`); collection codes are bare ISO-639-1. Matching is on the primary subtag.
- **Legacy language codes exist in real data.** `frontend/src/pages/CollectionDetailPage.tsx:110-115` documents collections holding `EN`, `PL` and `ENss` from before write-time normalization. `ENss` must resolve to "no voice" rather than matching `en` — primary-subtag matching gives this for free, but it must not throw.
- The repo has **no shared package between apps** (CLAUDE.md, Architecture). `languages.ts` is already triplicated across backend, frontend and extension for this reason. The speech module follows the same convention: duplicated, not shared.
- **Neither client app has a test runner.** Only `backend/` has tests. Automated verification for both phases is therefore limited to `tsc` and `oxlint`; correctness rests on the manual checklist.
- oxlint config (`.oxlintrc.json`, both apps) enables `react/rules-of-hooks` as an error and `react/only-export-components` as a warning. Keeping the speech engine and its hook in plain `.ts` files (no JSX) avoids the latter entirely — the same class of problem recorded in `context/foundation/lessons.md` for context/hook pairs.
- `frontend/src/languages.ts` exports **`languageLabel(code)`** (added as a prep commit on `main` for this work). Use it for the no-voice reason line; do not re-implement the lookup. It matches case-insensitively and falls back to the uppercased code, so legacy `EN` / `ENss` render readably.
- `frontend/src/pages/CollectionDetailPage.tsx` is **also edited by the `printable-export` change** (S-04 adds a Print link at lines 99-102 and `Link` to the `react-router` import). Phase 2 here touches the import block and the entry rows at lines 121-135. The body edits are ~19 lines apart and auto-merge; **the import block will conflict** if both land independently. See the Parallel Execution note below.

## What We're NOT Doing

- **No cloud TTS fallback, no backend route, no S3, no infra change.** Consequently no `api-construct.ts` entry, no IAM grant, no new SSM parameter, no deploy dependency. The design for this work is recorded in `plan-brief.md` under "Deferred (decided, not built)" so it is not re-derived later.
- **No playback of native-language text** — neither the normalized native word/phrase nor `nativeGlossText`. FR-015 deliberately excludes native IPA on the grounds that the learner already knows their own pronunciation; the same reasoning applies to audio.
- **No voice or accent selection.** PRD Non-Goals: one default voice per language in MVP.
- **No speed, pitch or volume controls.** Not in FR-016.
- **No audio for `uk`, and none for any language whose OS voice pack the user has not installed.** Accepted limitation, surfaced in the UI.
- No changes to capture, translation, regeneration, saving, the API, the data model, or the print view.
- No autoplay. Every playback is an explicit click.

## Parallel Execution with S-04 (`printable-export`)

These two slices are safe to build concurrently, but **not on the same file at the same time**. Assessed 2026-08-03:

- **Phase 1 here is extension-only and shares nothing with S-04** — that is the clean parallel window. Run it in its own worktree alongside S-04's two phases.
- **Phase 2 here is the only overlap.** It touches `CollectionDetailPage.tsx`, which S-04 also edits. Land it **after S-04 merges**, so the play buttons go onto a page that already has the Print link and the merged result is verified once, in its final state.
- Contract coupling is **zero** — both slices are read-only consumers of the existing `getCollection`; neither changes the API, types, schema or infra.
- **Keep `.speak` rules class-scoped in `App.css`** — never a bare `button` selector. `App.css` is imported by `App.tsx` and therefore applies on S-04's print route, where its stylesheet is doing deliberate black-on-white overrides.

If both do run fully in parallel, re-run **both** slices' manual checklists against the merged page — each one's pre-merge verification covers a version that never ships, and no test runner exists to catch the difference.

## Implementation Approach

A single small module per app, duplicated:

- `speech.ts` — framework-free. Resolves the voice list (handling the async load), finds a voice for a language code, speaks, cancels. No React.
- `useSpeech.ts` — a React hook over it, owning "which item is currently speaking", the resolved voice list, and the last playback error.

Both client surfaces then consume the hook identically: ask `hasVoice(languageCode)` to decide enabled vs. disabled-with-reason, and call `play(key, text, languageCode)` / `stop()` from the button.

The `speak(text, languageCode)` signature is deliberately the seam a future cloud fallback slots in behind — the call sites never learn where audio came from.

## Critical Implementation Details

**Timing & lifecycle — the voice list loads asynchronously.** In Firefox, `speechSynthesis.getVoices()` returns `[]` on the first call; the real list arrives with the `voiceschanged` event. This was observed live during planning — the one-liner returned nothing, then `en, pl` on re-run. A component that calls `getVoices()` once on mount will conclude no voices exist and disable every control, intermittently, depending on how warm the browser is. Resolve once, with an event listener and a timeout backstop:

```ts
const now = speechSynthesis.getVoices()
if (now.length > 0) return now
// else: resolve on 'voiceschanged' (once), with a ~3s setTimeout fallback
```

Until that promise resolves the UI must render a *pending* state — never treat "not yet loaded" as "no voice for this language".

**State sequencing — cancel fires the outgoing utterance's `onend`.** `speechSynthesis.cancel()` triggers `onend` on the utterance being cancelled. Under cancel-and-replace, cancelling A to start B means A's `onend` arrives *after* B's speaking key is set, and an unconditional `onend` handler will immediately clear B. Tag each utterance with its key and ignore lifecycle events from any utterance that is no longer the active one.

**Deliberate cancellation is not an error.** `utterance.onerror` fires with `error` of `canceled` or `interrupted` on every intentional stop. Surfacing those as user-facing errors would flash a message on every normal stop-and-switch. Only genuine failures (e.g. `synthesis-failed`, `audio-busy`) reach the inline error line.

**Popup teardown must cancel speech.** Firefox destroys the popup document when it loses focus, and speech started there should not outlive it. Call `speechSynthesis.cancel()` from the hook's effect cleanup. The same cleanup covers route changes in the web app.

**Deterministic voice choice.** Several voices commonly match one language (`en-US`, `en-GB`, multiple vendors). Since PRD Non-Goals rule out user selection, pick deterministically so a word sounds identical every time: the voice flagged `default` if it matches the language, else the first `localService` voice, else the first match.

**User experience — one reason line per language, not per row.** The popup is 380px wide (`extension/src/popup/popup.css:14-20`) and a language block can hold several variants and several sentences. Repeating "No German voice installed" on every row is unreadable. Disabled buttons carry a `title` attribute; the explanatory line appears once, under the language heading.

---

## Phase 1: Extension popup playback

### Overview

Add the speech module to the extension and wire play controls into the popup's variant and sentence rows. On completion FR-016 and roadmap slice S-05 are satisfied.

### Changes Required:

#### 1. Speech engine

**File**: `extension/src/speech.ts` (new)

**Intent**: Framework-free wrapper over `speechSynthesis` that hides the async voice-list load, the language-code mismatch, and the cancellation semantics from every call site.

**Contract**: Exports `loadVoices(): Promise<SpeechSynthesisVoice[]>` (resolving via `voiceschanged` with a timeout backstop), `findVoice(voices, languageCode): SpeechSynthesisVoice | null` (primary-subtag, case-insensitive, deterministic pick order per Critical Implementation Details), `speak(text, voice, handlers)` and `cancel()`. No React import. `findVoice` must return `null` — never throw — for unknown or malformed codes such as `ENss`.

#### 2. React hook

**File**: `extension/src/useSpeech.ts` (new)

**Intent**: Owns voice-list state, which item is currently speaking, and the last real playback error; provides the API both surfaces use.

**Contract**: `useSpeech()` returns `{ ready, hasVoice(languageCode), speakingKey, play(key, text, languageCode), stop(), error }`. `hasVoice` returns `false` while `ready` is `false` only in the sense that the UI shows a pending state — callers distinguish the two. Cancels any in-flight utterance on unmount. Plain `.ts`, no JSX, so `react/only-export-components` does not apply.

#### 3. Popup play controls

**File**: `extension/src/popup/App.tsx`

**Intent**: Put a play control on every translation variant row and every displayed example-sentence row, driven by the hook.

**Contract**: Each `<li>` in `.variants` and `.sentences` gains a `<button type="button">` **as a sibling of the existing `<label>`, not inside it** (see Key Discoveries — nesting selects the radio). Keys are `${languageCode}:variant:${index}` and `${languageCode}:sentence:${index}`. The button reflects three states: idle, speaking (acts as stop), disabled (no voice). Each language block renders one reason line under its `<h2>` when that language has no voice. Playback errors render inline within the language block, using the existing `.error` class, and must not clear or be cleared by the component's existing `error` / `saved` state.

#### 4. Popup styles

**File**: `extension/src/popup/popup.css`

**Intent**: Style the play control so it reads as a small inline affordance rather than a primary action, and keep rows aligned now that each holds a label plus a button.

**Contract**: A `.speak` class (compact, transparent, inherits colour — the existing `button.link` at line 106 is the closest precedent), a speaking/active variant, a disabled appearance consistent with `button:disabled` at line 101, and the row layout adjustment for `li` in `.variants` / `.sentences`.

### Success Criteria:

#### Automated Verification:

- Extension type-checks and builds: `cd extension && npm run build`
- Extension lints clean: `cd extension && npm run lint`

#### Manual Verification:

- With a `pl → en` collection, capture a word; the English variant's play control speaks it aloud
- An example sentence's play control speaks the full sentence
- Clicking play on a second item while one is speaking stops the first and starts the second
- Clicking the control of the currently-speaking item stops it
- Clicking any play control does **not** change the selected variant or sentence radio
- A collection with a target language that has no local voice (e.g. `de` or `ru`) shows disabled controls plus exactly one reason line for that language
- Closing the popup mid-sentence stops the audio
- Cold-start check: quit Firefox, relaunch, open the popup immediately and capture — controls are enabled, not falsely disabled by the empty first `getVoices()` call
- Capture, regeneration and save all behave exactly as before

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Web app playback

### Overview

Bring the same controls to saved entries on the collection detail page, so a collection can be revised without reopening the extension.

**Sequencing**: this is the phase that collides with S-04 — start it only after `printable-export` has merged (see Parallel Execution above).

### Changes Required:

#### 1. Speech engine and hook (duplicated)

**File**: `frontend/src/speech.ts` (new), `frontend/src/useSpeech.ts` (new)

**Intent**: Same modules as Phase 1, copied into the frontend. Duplication is the established convention here — `languages.ts` already exists three times for the same reason (CLAUDE.md, Architecture).

**Contract**: Identical exports to the extension's versions. If Phase 1's implementation needed adjustment, port the final version rather than the original.

#### 2. Entry play controls

**File**: `frontend/src/pages/CollectionDetailPage.tsx`

**Intent**: Add a play control beside each saved translation and each saved sentence.

**Contract**: Controls attach to the existing `entry.translations` and `entry.sentences` lists (lines 121-135), keyed by the rows' database ids (`${entry.id}:t:${translation.id}` / `${entry.id}:s:${sentence.id}`) — no index keys needed here, unlike the popup. Translations speak `meaningText`, sentences speak `sentenceText`, each in its own `languageCode`. The no-voice reason line uses `languageLabel` from `../languages` — already present, do not re-implement. Legacy codes (`EN`, `ENss`) must degrade to the disabled state without throwing. The existing `handleAddLanguage` flow and its `addingKey` state are untouched.

#### 3. Web app styles

**File**: `frontend/src/App.css`

**Intent**: Give the control the same compact treatment as the popup, within the frontend's much plainer styling.

**Contract**: A `.speak` class matching Phase 1's states (idle / speaking / disabled). The page currently uses inline styles for errors only; this adds the first page-level class for entry rows.

### Success Criteria:

#### Automated Verification:

- Frontend type-checks and builds: `cd frontend && npm run build`
- Frontend lints clean: `cd frontend && npm run lint`

#### Manual Verification:

- The collection detail page shows a play control beside every saved translation and every saved sentence
- Controls speak the correct text in the correct language
- Cancel-and-replace and stop behave as in the popup
- A language with no local voice shows disabled controls plus one reason line
- A legacy collection containing `EN` / `PL` / `ENss` codes renders disabled controls and logs no errors
- Navigating away from the page mid-sentence stops the audio
- The "Add \<language\>" backfill buttons still work unchanged

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

Neither client app has a test runner — only `backend/` does, and this change touches no backend code. There is therefore **no automated coverage to add**, and `tsc` + `oxlint` are the only automated gates. This is a known property of the repo, not an omission: the `printable-export` plan records the same constraint.

Correctness rests on the manual checklist in each phase. The checks worth not skipping, because they encode the non-obvious failures:

1. **Cold start** — the empty first `getVoices()` is the highest-probability bug in this change and only reproduces on a cold browser.
2. **Radio isolation** — clicking play must not move the user's variant or sentence selection.
3. **Rapid switching** — click several play controls in quick succession; the speaking indicator must track the last one clicked and never get stuck on a stopped item.
4. **A language with no voice** — the disabled path is the majority path on a stock machine (6 of 8 languages), so it deserves as much attention as the happy path.

### Manual Testing Steps:

1. Build the extension, load `dist/manifest.json` via `about:debugging`, log in, capture a word in a `pl → en` collection.
2. Play a variant; play a sentence; interrupt one with another; stop the active one.
3. Confirm no radio selection changed during any of the above.
4. Add a `de` (or `ru`) target language to a collection, capture again, confirm disabled controls and one reason line.
5. Quit and relaunch Firefox; repeat step 2 immediately on first popup open.
6. Run the frontend, open a collection with saved entries, repeat steps 2-4 there.
7. Open a legacy collection (one holding `EN` / `ENss` codes) and confirm it degrades quietly.

## Performance Considerations

Local synthesis needs no network, so the NFR "playback starts with no noticeable delay" is met by construction once the voice list is resolved. The voice list is fetched once per popup open / page load and cached in the hook. Utterances are created per click and discarded; there is nothing to pool or memoize.

## Migration Notes

None. No data, schema, API or deployed infrastructure is touched. The change is additive to two client surfaces and is reverted by removing the added files and edits.

## References

- Roadmap slice: `context/foundation/roadmap.md` — S-05, Open Roadmap Question 2
- PRD: `context/foundation/prd.md` — FR-016, FR-015, Non-Goals, Open Question 2
- Lessons: `context/foundation/lessons.md` — React file-boundary rule; the `api-construct.ts` rule (why the deferred cloud path is expensive)
- Sibling slice sharing a file: `context/changes/printable-export/plan.md`
- Popup capture UI: `extension/src/popup/App.tsx:333-401`
- Web app entry rendering: `frontend/src/pages/CollectionDetailPage.tsx:121-135`
- Jira: epic [IL-21](https://kondi827.atlassian.net/browse/IL-21), subtasks IL-22, IL-23

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extension popup playback

#### Automated

- [x] 1.1 Extension type-checks and builds: `cd extension && npm run build` — 6e9a464
- [x] 1.2 Extension lints clean: `cd extension && npm run lint` — 6e9a464

#### Manual

- [ ] 1.3 English variant play control speaks the word in a `pl → en` collection
- [ ] 1.4 Example sentence play control speaks the full sentence
- [ ] 1.5 Playing a second item stops the first and starts the second
- [ ] 1.6 Clicking the speaking item's control stops it
- [ ] 1.7 Play clicks do not change the selected variant or sentence radio
- [ ] 1.8 A language with no local voice shows disabled controls plus one reason line
- [ ] 1.9 Closing the popup mid-sentence stops the audio
- [ ] 1.10 Cold-start: controls are enabled on first popup open after a Firefox relaunch
- [ ] 1.11 Capture, regeneration and save behave exactly as before

### Phase 2: Web app playback

#### Automated

- [x] 2.1 Frontend type-checks and builds: `cd frontend && npm run build`
- [x] 2.2 Frontend lints clean: `cd frontend && npm run lint`

#### Manual

- [ ] 2.3 Play controls appear beside every saved translation and sentence
- [ ] 2.4 Controls speak the correct text in the correct language
- [ ] 2.5 Cancel-and-replace and stop behave as in the popup
- [ ] 2.6 A language with no local voice shows disabled controls plus one reason line
- [ ] 2.7 A legacy collection with `EN` / `PL` / `ENss` codes degrades quietly, no console errors
- [ ] 2.8 Navigating away mid-sentence stops the audio
- [ ] 2.9 The "Add \<language\>" backfill buttons still work unchanged
