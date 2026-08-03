# Pronunciation Playback — Plan Brief

> Full plan: `context/changes/pronunciation-playback/plan.md`

## What & Why

Roadmap slice **S-05 / PRD FR-016**: the user can hear the target-language translation and an example sentence spoken aloud. It's the last MVP slice alongside S-04 and the payoff for FR-015's IPA — seeing `/ˈkaʦə/` helps, hearing it helps more. The PRD deliberately left the audio mechanism open (Open Question 2); this plan closes it in favour of the browser's local Web Speech API.

## Starting Point

Nothing audio-shaped exists in any of the three apps — a grep for `speechSynthesis|Polly|tts|audio|.mp3` across `backend/src`, `frontend/src`, `extension/src` and `infra/lib` returns zero hits. But both surfaces already render the exact text that needs speaking, tagged with its language: the popup shows variants and sentences per target language (`extension/src/popup/App.tsx:333-401`), and the web app shows the saved equivalents (`frontend/src/pages/CollectionDetailPage.tsx:121-135`). No API or data-model work is needed.

## Desired End State

A small play control sits on every translation variant and every example sentence, in both the extension popup and the web app's collection detail page. Clicking speaks that text in its own language; clicking again stops; clicking another stops the first. Selecting a radio option is unaffected. Languages with no installed OS voice show disabled controls and one short line saying why.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Audio engine | Browser Web Speech API | Zero backend, infra, cost and latency; ships inside the 2026-08-05 deadline alongside the unbuilt S-04. |
| Cloud fallback | Deferred (see below) | Backend route + S3 + IAM + `api-construct.ts` entry is roughly a full session on a two-day clock, for languages that are theoretical in the current data. |
| What is playable | Target-language translation + example sentence | FR-016's two targets. Native text is excluded for the same reason FR-015 excludes native IPA — you already know your own pronunciation. |
| Surfaces | Extension popup **and** web app | Capture is where FR-016 lives; saved entries are where revision happens. |
| No local voice | Disabled control + one reason line per language | Distinguishes "missing OS voice" from "broken button"; per-row text is unreadable in a 380px popup. |
| Concurrency | Cancel and replace; active button doubles as stop | Matches every dictionary and translator; stop is always reachable. |
| Errors | Inline, within the language block | Keeps an in-flight translate or save error from being clobbered by a failed playback. |
| Code sharing | Duplicate the module into both apps | Repo has no shared package — `languages.ts` already exists three times for this reason (CLAUDE.md). |
| Voice choice | Deterministic: `default`, else local, else first match | PRD Non-Goals rule out user voice selection; determinism means a word sounds the same every time. |

## Scope

**In scope:** a `speech.ts` engine and `useSpeech.ts` hook (duplicated per app); play controls on popup variants and sentences; play controls on web app saved translations and sentences; disabled-with-reason state; styles for both surfaces.

**Out of scope:** any backend route, cloud TTS, S3, IAM or `api-construct.ts` entry; native-language playback; voice, accent, speed or pitch selection; autoplay; audio for `uk` or any language whose OS voice pack isn't installed; changes to capture, translation, saving, the API, the data model, or the print view.

## Architecture / Approach

Client-only, no network. `speech.ts` is framework-free: it resolves the voice list (handling Firefox's async load), matches a bare ISO code against BCP-47 voice tags on the primary subtag, and wraps speak/cancel. `useSpeech.ts` layers React state over it — voice list, which key is speaking, last real error — and both surfaces consume it identically. The `speak(text, languageCode)` signature is the seam a cloud fallback would later slot in behind, invisibly to call sites.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Extension popup playback | FR-016 and roadmap S-05 satisfied end to end | The async voice-list load — a cold `getVoices()` returns empty and would disable every control intermittently |
| 2. Web app playback | Saved entries become revisable by ear | Legacy language codes (`EN`, `ENss`) in real collections must degrade quietly, not throw |

**Prerequisites:** S-03 (`capture-translate-save`) — done and archived. A `pl → en` collection with saved entries; ideally a second collection with a target language whose voice pack is *not* installed, to exercise the disabled path.
**Estimated effort:** ~1 session across 2 phases. No backend, no deploy, no new dependency.

## Open Risks & Assumptions

- **Six of eight supported languages are silent on a stock machine.** Measured 2026-08-03: the developer's Firefox reports voices for `en` and `pl` only. Others require OS language packs; `uk` has no Microsoft voice at all. This is the accepted cost of local-only audio and is surfaced in the UI rather than hidden.
- **Verification is entirely manual.** Neither client app has a test runner, so `tsc` and `oxlint` are the only automated gates and nothing will catch a later regression here.
- **`printable-export` (S-04) also edits `CollectionDetailPage.tsx`** — the only file the two slices share, with zero contract coupling between them. Phase 1 here is extension-only and runs safely in parallel with all of S-04; Phase 2 should land after S-04 merges. Full assessment in `plan.md` under Parallel Execution.
- Playback quality varies by machine — the same word will sound different on different systems. Inherent to Web Speech; the reason the cloud path stays on the table.

## Deferred (decided, not built)

The cloud fallback was fully specified before being cut for the deadline. Recorded here so it is not re-derived — file under Jira epic [IL-21](https://kondi827.atlassian.net/browse/IL-21) when picked up:

- **Provider: Google Cloud TTS**, not Polly. Polly covers 7 of 8 codes but [has no Ukrainian voice](https://docs.aws.amazon.com/polly/latest/dg/SupportedLanguage.html); Google ships `uk-UA` Standard and WaveNet. One integration that covers everything beats two that eventually do. OpenAI TTS is **disqualified**: its speech endpoint has no language parameter, and single-word input gives the model too little signal to infer language — fatal when the primary target is one word.
- **Delivery: synthesize once, cache in S3, return a presigned URL.** A saved entry's sentence is immutable, so its audio is generated once and reused across every future study session — the hit rate is high on the web app surface and near-zero in the popup, where every capture is new text.
- **Latency: in-memory cache per session**, spinner on first play.
- **Cost is negligible either way** — ~150k chars/month at [$4/1M standard or $16/1M neural](https://texttolab.com/blog/google-cloud-tts-pricing), inside Google's recurring monthly free tier. The cost of this work is engineering time, not spend.
- **Structure it behind a provider seam**: the route takes `(text, languageCode)` and asks a registry who can speak it; "no provider" reaches the UI as the *same* disabled-with-reason state Phase 1 already builds. A language gaining coverage requires no UI change at all.
- Remember `infra/lib/constructs/api-construct.ts` needs its own `addRoutes` entry — `lessons.md` records this breaking twice during S-03, and no test catches it.

## Success Criteria (Summary)

- A user can hear any translation or example sentence spoken in its own language, from either the extension or the web app.
- A language with no installed voice is visibly and understandably unavailable, never silently broken.
- Capture, regeneration, saving and the entry list behave exactly as they did before.
