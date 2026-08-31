# Extension HTTP Seam — Plan Brief

> Full plan: `context/changes/extension-http-seam/plan.md`

## What & Why

`background.ts`'s `apiFetch()` — the extension's only call site for the backend API — is a raw, untested `fetch()` call. This plan gives it a testable seam using three legacy-code techniques: characterization tests to pin current behavior, branch-by-abstraction to add the seam without touching a dependent yet, and a strangler-fig migration of the one call site through it.

## Starting Point

`background.ts:55-121` calls global `fetch()` directly, with no test coverage anywhere in the file. The extension's only existing test fake (`test/helpers/webext.ts`'s `FakeBrowser`) stands in *for* `background.ts` on the popup's side — it never runs `background.ts`'s real code, and fakes neither `browser.identity` nor `fetch`. `auth.ts` has two more raw fetch call sites (Cognito token exchange), also untested.

## Desired End State

`apiFetch`'s one network call routes through a new `extension/src/http.ts` seam instead of calling `fetch` directly. A characterization suite written *before* the migration, against the unmodified source, passes with a literal empty diff after the migration — that's the proof it's non-breaking. `auth.ts` is untouched.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Scope | `apiFetch` only, not `auth.ts` | `auth.ts`'s PKCE/token-refresh logic is a different risk profile deserving its own dedicated pass — recorded as a follow-up leaf-node rather than done inline. |
| Seam mechanism | Module-level swappable ref, live lookup | Mirrors `reporter.ts`'s existing `resetForTests()` convention; a live `fetch` lookup (not a captured reference) means characterization tests written before the seam existed need zero edits after it lands. |
| Characterization depth | `apiFetch`-focused, full error taxonomy | Pins every branch `apiFetch` has today (429, JSON/non-JSON errors, network throw, missing token, report dedupe, requestId) without expanding into `run()`'s untouched message-type switch. |
| Test helper | New helper, not an extension of `FakeBrowser` | `FakeBrowser` is documented as a stand-in *for* `background.ts`; driving the real `background.ts` code is a different, conflicting role. |
| Verification | Automated every phase + one final manual smoke test | Matches this repo's plan convention; a real Cognito/build smoke test catches what characterization tests structurally can't. |

## Scope

**In scope:**
- New `extension/src/http.ts` seam module + its own unit tests
- New `extension/test/helpers/backgroundHarness.ts` test helper
- Full characterization suite for `apiFetch`'s current behavior
- Migrating `apiFetch`'s one call site to the seam

**Out of scope:**
- `auth.ts`'s two fetch call sites (`requestTokens`) — recorded as a follow-up
- Any new HTTP behavior (retry, timeout, etc.) — the seam is exactly as capable as the `fetch()` it replaces
- Testing `run()`'s full message-type switch or `handle()`'s general catch-all

## Architecture / Approach

`http.ts` exports `doFetch()`, wrapping a module-level `override` slot that defaults to a live lookup of `fetch` on every call (never a captured reference — the load-bearing detail that keeps Phase 1's tests stable across Phase 3). `background.ts` gets exactly one line changed: its `fetch(...)` call becomes `doFetch(...)`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Characterization tests | Full `apiFetch` behavior pinned via a new test harness that drives the real `background.ts` | Missing an edge case here means Phase 3 can't actually prove non-breaking |
| 2. Introduce the seam | `http.ts` added alongside, unused, with its own tests | Capturing `fetch` at import time instead of doing a live lookup would silently break Phase 1's mocking |
| 3. Migrate + verify | `apiFetch` routes through `doFetch`; Phase 1 suite passes with zero edits + manual smoke test | None significant — single-line source change |

**Prerequisites:** None — greenfield within the extension's existing test setup (Vitest + jsdom, already configured).
**Estimated effort:** ~1 session across 3 phases; each phase is small and independently revertible.

## Open Risks & Assumptions

- Assumes global `fetch`/`Response` are available in the Vitest/jsdom test environment (true for Node 18+, which this repo's tooling targets) — no polyfill is planned.
- `auth.ts` remaining untested means a future refactor there still starts from zero coverage; this plan only defers that risk, it doesn't reduce it.

## Success Criteria (Summary)

- `apiFetch`'s external behavior (headers, error messages, reporting) is provably unchanged: the characterization test file needs zero edits after the migration.
- `cd extension && npm test`, `npm run lint`, and `npm run build` all pass after every phase.
- A real login + translate + save-entry smoke test succeeds in Firefox after Phase 3.
