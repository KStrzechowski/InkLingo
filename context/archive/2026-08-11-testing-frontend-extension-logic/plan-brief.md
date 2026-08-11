# Frontend/Extension Logic Coverage — Plan Brief

> Full plan: `context/changes/testing-frontend-extension-logic/plan.md`
> Research: `context/changes/testing-frontend-extension-logic/research.md`

## What & Why

Rollout Phase 5 of `context/foundation/test-plan.md` — the last pending row —
closing Risk #6: the frontend's collection language-gap detection and the
extension popup's variant/sentence selection state have zero test coverage and
the repo's highest recent churn. Grounding turned four of those "coverage gaps"
into live defects, so the phase both tests the logic and fixes what it found.

## Starting Point

`frontend/` has a working Vitest + RTL + jsdom suite from `testing-auth-resilience`
and a collection fixture builder that already covers partial entries. `extension/`
has **nothing** — no runner, no tests, and no CI presence at all (no build, no
lint, no test in either workflow). The gap logic is a two-line inline derivation
in `CollectionDetailPage.tsx:184-185`; the popup's selection state lives entirely
in `extension/src/popup/App.tsx`, much of it already correct.

## Desired End State

Both apps' language and selection logic is covered by component tests whose
oracles come from the product rules, not the code. The extension has a Vitest
suite that runs in CI alongside its lint and build. Four defects are fixed, each
with a test proven to fail when its guard is removed. `test-plan.md` §3 reads
`complete` on every row, and §4/§5/§6 describe what actually exists.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Popup race guards | Generation token **plus** selective disabling | `useSpeech.ts:29-33` already uses a token for the same problem in the same app; disabling alone would freeze a 380px panel for ~5s | Plan |
| Which controls to disable | Text input while working, variant radios while regenerating; collection select stays enabled | Switching collection mid-call is legitimate — the token handles it correctly rather than forbidding it | Plan |
| Extension test seam | Fake `globalThis.browser` wholesale | Keeps `messages.ts`'s real ok/error envelope unwrapping in the path; the popup calls `browser.storage` directly, so a fake is needed regardless | Plan |
| `CollectionsListPage` | Fix the load path, then test it | The defect `lessons.md:47-52` describes is still live; testing without fixing would pin wrong behavior | Plan |
| Recovery design | "Try again" on the page's own error state | Exactly what `lessons.md:51` prescribes — not a subscription to the global signal's false edge | Plan |
| Popup defects | Fix all three, prove each | E-1 is silent cross-collection data corruption; a test today would have to assert the bug | Plan |
| Extension CI | Test **and** lint **and** build, inside the `diff` job | `diff` is already a required check, so no ruleset change; the app has had zero signal until now | Plan |
| §2 corrections | Backport both now | The one in-place §2 edit the workflow sanctions outside `--refresh` | Research |
| Gap logic testing | Component test, no extraction | The derivation is two lines; extracting it purely to test it produces an implementation mirror | Research |

## Scope

**In scope:** Vitest bootstrap for `extension/` (config, tsconfig project, setup,
`browser` fake, fixtures); popup selection-state coverage; fixes for E-1/E-2/E-3;
`CollectionDetailPage` gap + backfill coverage; `CollectionsListPage` retry fix +
form-logic coverage; extension CI wiring; test-plan §2/§3/§4/§5/§6/§8 and a
`lessons.md` entry.

**Out of scope:** pronunciation playback (test-plan §7); `background.ts`,
`auth.ts`, and the `browser.identity` flow; e2e/Playwright for either app;
extracting logic into modules for testability; a shared types package; coverage
thresholds; changing the "Add `<code>`" button's raw-code label.

## Architecture / Approach

Runner first, then tests over behavior that is already correct, then the fixes —
so each fix's test is unambiguously new rather than a rewritten assertion. Phases
4-5 mirror that shape for the frontend and depend on nothing in 1-3. CI comes
after the suites pass; docs come last, when there is something true to write.

Every fix ships with a **non-vacuity check**: remove the guard, confirm exactly
that fix's test fails and nothing else does, restore it. That check is the only
thing separating these tests from coverage theater, and it follows the F1 pattern
from `testing-auth-resilience`'s impl-review.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Bootstrap Vitest for `extension/` | Runner, tsconfig project, `browser` fake, fixtures, smoke test | The fake must model the real message envelope, or every later test passes against a contract the background script doesn't honor |
| 2. Popup selection coverage | Tests for the already-correct selection model | Oracle problem — expected values must come from the FR comments, not from re-reading the component |
| 3. Fix the three popup races | Token + selective disabling, three race tests | Two guards can mask each other; each needs its own failing-when-removed proof |
| 4. Frontend gap detection | `CollectionDetailPage` gap + backfill tests | Asserting the raw-code button label would make the test about copy, not behavior |
| 5. Fix + cover `CollectionsListPage` | Retry control, L-1 proof case, form-logic tests | The retry must not be wired to the global connection signal (`lessons.md:51`) |
| 6. Extension CI | Test/lint/build in `diff`, both workflows | First time the extension can block a merge — a latent build break surfaces here |
| 7. Close out | §2 backports, §3-§6 updates, `lessons.md` entry | §6.3 must be writable-from, not just readable |

**Prerequisites:** None beyond a working checkout — no credentials, no database,
no browser downloads. Phase 1 blocks 2-3; Phases 4-5 are independent of both.

**Estimated effort:** ~3-4 sessions across seven phases; Phases 1 and 3 are the
substantial ones, 6 and 7 are short.

## Open Risks & Assumptions

- The E-1 fix is verifiable in a browser only with two collections that **share a
  target language but differ in native language** — with disjoint targets the
  backend guard masks the bug, and the manual check would pass vacuously.
- jsdom renders a "no voice installed" line in every language block (no
  `speechSynthesis`). Locators must not collide with it, and "no error shown"
  assertions must not treat it as one.
- Phase 6 gates an app CI has never touched; if `extension/` has a latent build or
  lint failure, that phase surfaces it and must fix it before the gate can land.
- The popup's dropped-result behavior is deliberately silent — a discarded
  translate still costs an Anthropic call. If that proves confusing in use, adding
  a notice is a follow-up, not part of this phase.

## Success Criteria (Summary)

- A word captured in the extension always lands in the collection that was
  selected when it was translated — and a switched collection, a re-typed word,
  or a changed variant mid-call never produces a stale or mispaired result.
- The web app shows a gap control exactly for the languages a collection teaches
  that an entry lacks, including collections holding legacy uppercase codes, and a
  failed list load can be recovered without a page reload.
- `npm test`, `npm run lint`, and `npm run build` are green and CI-gated in both
  `frontend/` and `extension/`, and `test-plan.md` §3 is `complete` throughout.
