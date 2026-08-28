# Extension HTTP Seam Implementation Plan

## Overview

`background.ts`'s `apiFetch()` is the extension's only call site for the backend API, and it is a raw, uninjected `fetch()` call with zero test coverage. This plan gives it a testable seam using three legacy-code techniques in sequence: characterization tests to pin its current behavior, branch-by-abstraction to add the new seam module without touching anything that depends on it yet, and a strangler-fig migration of the one call site through it. `auth.ts`'s two fetch call sites (Cognito token exchange) are explicitly out of scope — recorded as a follow-up leaf-node, not touched here.

## Current State Analysis

- `background.ts:55-121` (`apiFetch<T>`) calls global `fetch()` directly. It attaches a Bearer token from `auth.ts`'s `getIdToken()`, shapes five distinct error/success paths, and integrates with the observability reporter (`observability/reporter.ts`).
- `background.ts:176` registers `browser.runtime.onMessage.addListener(handle)` at module load time — there is no exported entry point to call directly; a test has to capture that listener.
- `auth.ts:88-98` (`requestTokens`) is a second, structurally identical raw `fetch()` call site, used by both `login()` and the refresh branch of `getIdToken()`. Out of scope for this change (see "What We're NOT Doing").
- No test exists for either file today. The only extension tests are `extension/test/observability/*.test.ts` and popup-facing tests that use `extension/test/helpers/webext.ts`'s `FakeBrowser` — which fakes the *popup's* view of `browser.runtime.sendMessage` (scripted per-message-type handlers), not the real `background.ts` code. It does not fake `browser.identity`, and does not fake global `fetch`.
- Sibling precedent: `frontend/src/api/client.ts` is axios, tested in `frontend/test/api/client.test.ts` by swapping `apiClient.defaults.adapter` — axios's built-in seam. Raw `fetch()` has no equivalent, which is the gap this plan closes.
- Existing test-seam convention in this codebase: `observability/reporter.ts`'s `resetForTests()`, commented "Test seam. Production code never calls this."

## Desired End State

`background.ts`'s `apiFetch` routes its network call through a new `extension/src/http.ts` module instead of calling `fetch` directly. A characterization test suite pins `apiFetch`'s full current behavior (written *before* the migration, against the unmodified source) and passes unchanged after the migration — proving it non-breaking. `auth.ts` is untouched. Verify by running `cd extension && npm test` (all suites green, including the new ones) and `npm run lint`.

### Key Discoveries:

- `background.ts:45-53` — the `alreadyReported` WeakSet exists specifically so a failure that `apiFetch` already reported isn't reported a second time by `handle()`'s catch-all. This is exactly the kind of subtle behavior a refactor could silently break; it must be in the characterization suite.
- `background.ts:56-59` — a missing/expired token throws *before* `apiFetch`'s own try block, so that specific error is never reported by `apiFetch` — only by `handle()`'s catch-all, with a generic `message:<type>` `routePath` instead of the real one. Two genuinely different reporting paths for two different failure origins.
- `auth.ts:59-73` (`expiresAtSeconds`) only ever reads the JWT's `exp` claim from the middle segment — header and signature are never parsed or verified client-side. A test double for a token only needs a well-formed middle segment.

## What We're NOT Doing

- Not touching `auth.ts`. Its two `fetch()` call sites (`requestTokens`, used by `login()` and the refresh branch of `getIdToken()`) are a recorded blocking leaf-node for a future change — they carry PKCE/session-refresh risk that deserves their own dedicated characterization-and-seam pass, not an inline addition to this one.
- Not adding characterization tests for `run()`'s full message-type switch or `handle()`'s catch-all in general — only the 1-2 message types needed to exercise `apiFetch` end-to-end. `login`, `logout`, and `report-error` aren't being restructured here.
- Not changing `apiFetch`'s external behavior, error messages, or the observability reporting contract in any way — this is a pure call-routing change.
- Not adding retry, timeout, or other new HTTP behavior to the seam. `http.ts` in this change is exactly as capable as the `fetch()` call it replaces — nothing more.

## Implementation Approach

Three phases, each independently revertible:

1. **Characterization first** — pin `apiFetch`'s current behavior with tests that exercise the real `background.ts` module (via a captured `onMessage` listener), against the unmodified source. These tests are the safety net every later phase is checked against.
2. **Branch by abstraction** — add `extension/src/http.ts` alongside `background.ts` with zero consumers. It compiles, lints, and has its own unit tests, but nothing calls it yet.
3. **Strangler migration** — switch `apiFetch`'s one call site to the new seam. Success is Phase 1's suite passing with a literal empty diff on its test file.

## Critical Implementation Details

**Seam must do a live lookup, not a captured reference.** `http.ts`'s exported function must resolve `fetch` at call time (`(override ?? fetch)(...)`), never capture `globalThis.fetch` into a module-level constant at import time. Phase 1's characterization tests stub `globalThis.fetch` directly (via `vi.stubGlobal`) since no seam exists yet when they're written; Phase 3 must not force those tests to change their mocking strategy, so the seam has to keep observing whatever `globalThis.fetch` currently is, on every call — not whatever it was when `http.ts` was first imported.

**Module-load-time listener registration.** `background.ts:176` calls `browser.runtime.onMessage.addListener(handle)` as a side effect of import, with no exported hook. The test harness must install the fake `browser` global *before* importing `background.ts`, and call `vi.resetModules()` before each import so a stale listener captured by an earlier test's fake `browser` (now torn down) can't still be the one that runs.

## Phase 1: Characterization tests for apiFetch

### Overview

Pin every branch of `apiFetch`'s current behavior with tests run against the real, unmodified `background.ts`. No production source changes in this phase.

### Changes Required:

#### 1. Background test harness

**File**: `extension/test/helpers/backgroundHarness.ts`

**Intent**: A new helper, separate from `webext.ts`'s `FakeBrowser` (which stands in *for* `background.ts` on the popup's side — a different role from driving the real `background.ts` code). Fakes just enough of the `browser` global (`storage.local` get/set/remove, `runtime.onMessage.addListener`) for `background.ts` and the `auth.ts`/`reporter.ts` modules it calls into to run for real. Provides a function to import `background.ts` fresh, capture its registered listener, and invoke it directly with a `Message` — bypassing `sendMessage`'s envelope entirely since this harness talks straight to `handle()`.

**Contract**: Exports `loadBackground(): Promise<{ store: Record<string, unknown>, invoke: (message: Message) => Promise<MessageResponse<unknown>> }>`, `unloadBackground(): void`, and `fakeIdToken(expiresInSeconds: number): string` — a minimal unsigned-JWT-shaped string whose middle segment is `{ exp: <now + expiresInSeconds> }` base64url-encoded, since `auth.ts`'s `expiresAtSeconds` never reads anything else. Seeding `store['auth'] = { idToken: fakeIdToken(3600), refreshToken: null }` before `invoke()` gives tests a valid token without ever exercising `auth.ts`'s own network calls.

#### 2. apiFetch characterization suite

**File**: `extension/test/background/apiFetch.test.ts`

**Intent**: Drive `apiFetch` through 1-2 representative message types (`list-collections` for GET, `save-entry` or `translate` for POST-with-body) and pin every distinct branch it has today.

**Contract**: Cases to cover, each asserting the exact current output/side-effect:
- Success: correct method (GET when no body, POST with `Content-Type: application/json` when there is one), `Authorization: Bearer <idToken>` header sent, response body returned as-is.
- `429` response → error message `'Too many requests — wait a minute and try again.'`.
- Non-`429` error with a JSON `{ message }` body → that message used verbatim.
- Non-`429` error with a non-JSON body (simulating an API Gateway 404) → falls back to `` `Request failed (${status})` ``.
- `fetch()` itself rejects (network-level failure) → the same thrown error propagates, and exactly one report is buffered in `store['inklingo.error-reports.v1']` (proves the `alreadyReported`/`wasReported` dedupe: `apiFetch`'s catch and `handle()`'s catch must not both report the same failure).
- No stored token (or an expired one with no refresh token) → throws `'Your session expired — log in again.'` *without* ever calling `fetch`, and the resulting report's `routePath` is the generic `` `message:${type}` `` (not a real API path) — the second, distinct reporting path noted in Key Discoveries.
- Response carries `x-request-id` → captured on the report; absent → report's `requestId` is `undefined`.

### Success Criteria:

#### Automated Verification:

- New suite passes: `cd extension && npm test -- test/background/apiFetch.test.ts`
- Full extension suite still green: `cd extension && npm test`
- Lint passes: `cd extension && npm run lint`

---

## Phase 2: Introduce the fetch seam (http.ts)

### Overview

Add the seam module alongside `background.ts` with zero consumers — branch by abstraction. Nothing in `background.ts` changes in this phase.

### Changes Required:

#### 1. The seam module

**File**: `extension/src/http.ts`

**Intent**: A minimal, swappable-but-live-lookup wrapper around `fetch`, mirroring `observability/reporter.ts`'s `resetForTests()` test-seam convention already established in this codebase.

**Contract**:
```ts
let override: typeof fetch | null = null

export function setFetchForTests (impl: typeof fetch): void {
  override = impl
}

// Test seam. Production code never calls this.
export function resetForTests (): void {
  override = null
}

export async function doFetch (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return await (override ?? fetch)(input, init)
}
```
The `override ?? fetch` lookup happens inside `doFetch`, on every call — see Critical Implementation Details for why this must not be hoisted to a module-level captured constant.

#### 2. Seam unit tests

**File**: `extension/test/http.test.ts`

**Intent**: Prove the seam's own contract in isolation, before anything depends on it.

**Contract**: `doFetch` delegates to whatever `globalThis.fetch` currently is when no override is set (including a `fetch` reassigned *after* `http.ts` was imported — the live-lookup guarantee); `setFetchForTests` intercepts calls; `resetForTests` reverts to delegating to global `fetch` again.

### Success Criteria:

#### Automated Verification:

- New suite passes: `cd extension && npm test -- test/http.test.ts`
- Full extension suite still green: `cd extension && npm test`
- Lint passes: `cd extension && npm run lint`
- Type-checks and builds: `cd extension && npm run build`

---

## Phase 3: Migrate apiFetch to the seam

### Overview

Switch `background.ts`'s one call site to `http.ts`. This is the only phase that touches `background.ts`'s source.

### Changes Required:

#### 1. Route apiFetch through the seam

**File**: `extension/src/background.ts`

**Intent**: Replace the direct `fetch(...)` call inside `apiFetch` with `doFetch(...)` from the new seam. No other line of `apiFetch` changes — same headers, same method logic, same body serialization, same error handling downstream of the call.

**Contract**: `import { doFetch } from './http.ts'`; the line `response = await fetch(...)` becomes `response = await doFetch(...)` with identical arguments.

### Success Criteria:

#### Automated Verification:

- Phase 1's characterization file is byte-for-byte unchanged: `git diff --exit-code extension/test/background/apiFetch.test.ts`
- Phase 1's suite still passes, unmodified: `cd extension && npm test -- test/background/apiFetch.test.ts`
- Full extension suite green: `cd extension && npm test`
- Lint passes: `cd extension && npm run lint`
- Type-checks and builds: `cd extension && npm run build`

#### Manual Verification:

- Load the built extension in Firefox (`about:debugging` → load `extension/dist/manifest.json`), log in via Cognito, run one translate and one save-entry against a real collection, confirm both succeed with no console errors.

**Implementation Note**: After this phase's automated verification passes, pause for the manual smoke test above before considering the change complete.

---

## Testing Strategy

### Unit Tests:

- Phase 1: `apiFetch`'s full current error/success taxonomy, driven through the real `background.ts` handler via the new harness.
- Phase 2: `http.ts`'s own delegate/override/reset contract, in isolation.

### Integration Tests:

- None new — the characterization suite already exercises `background.ts` end-to-end from the message boundary down through the (real) `auth.ts` and `reporter.ts` it calls into.

### Manual Testing Steps:

1. After Phase 3, load the built extension in Firefox and confirm login, translate, and save-entry all still work end-to-end.

## Performance Considerations

None. This changes test scaffolding and an internal call-routing detail; no request shape, payload, timing, or caching behavior changes.

## Migration Notes

`auth.ts`'s two `fetch()` call sites (`requestTokens`, used by `login()` and `getIdToken()`'s refresh branch) are a recorded follow-up: they need their own characterization-and-seam pass in a future change, given the added PKCE/session-refresh risk of touching them. Not scoped here.

## References

- `extension/src/background.ts:55-121` — `apiFetch`, the function this plan makes testable.
- `extension/src/auth.ts:88-98` — `requestTokens`, the out-of-scope follow-up call site.
- `extension/src/observability/reporter.ts:207-213` — the existing `resetForTests()` test-seam convention this plan's `http.ts` mirrors.
- `frontend/src/api/client.ts` / `frontend/test/api/client.test.ts` — the sibling app's equivalent seam (axios adapter swap), used here only as a precedent, not a pattern to copy directly (no axios in the extension).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Characterization tests for apiFetch

#### Automated

- [x] 1.1 New suite passes: `cd extension && npm test -- test/background/apiFetch.test.ts`
- [x] 1.2 Full extension suite still green: `cd extension && npm test`
- [x] 1.3 Lint passes: `cd extension && npm run lint`

### Phase 2: Introduce the fetch seam (http.ts)

#### Automated

- [ ] 2.1 New suite passes: `cd extension && npm test -- test/http.test.ts`
- [ ] 2.2 Full extension suite still green: `cd extension && npm test`
- [ ] 2.3 Lint passes: `cd extension && npm run lint`
- [ ] 2.4 Type-checks and builds: `cd extension && npm run build`

### Phase 3: Migrate apiFetch to the seam

#### Automated

- [ ] 3.1 Phase 1's characterization file is byte-for-byte unchanged: `git diff --exit-code extension/test/background/apiFetch.test.ts`
- [ ] 3.2 Phase 1's suite still passes, unmodified: `cd extension && npm test -- test/background/apiFetch.test.ts`
- [ ] 3.3 Full extension suite green: `cd extension && npm test`
- [ ] 3.4 Lint passes: `cd extension && npm run lint`
- [ ] 3.5 Type-checks and builds: `cd extension && npm run build`

#### Manual

- [ ] 3.6 Load the built extension in Firefox, confirm login + translate + save-entry all succeed with no console errors
