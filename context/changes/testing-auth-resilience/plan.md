# Auth Resilience Implementation Plan

## Overview

Phase 3 of the frozen test-plan rollout (`context/foundation/test-plan.md` §3). Risk #4 — "an expired or invalid auth token is sent with a request and the failure surfaces as an opaque CORS error instead of a clean re-authentication prompt." The *expired* half already shipped (`3294830`) with no regression coverage. The *invalid* half — a token the Gateway authorizer rejects for a reason the client can't locally detect (revoked, tampered, clock skew) — still hits the original CORS-masking failure mode. This phase bootstraps Vitest for `frontend/` (currently zero test infrastructure), writes regression coverage for the shipped fix, closes the invalid-token gap with a retry-then-manual-prompt mechanism, wires the new tests into CI, and closes out the test-plan bookkeeping.

## Current State Analysis

- **The expired-token fix is real and unchanged.** `frontend/src/auth/cognito.ts:49-68`'s `getFreshUser()` checks `.expired` before returning a cached user, renews via a deduped `signinSilent()` call (`renewal ??= ...`), and calls `removeUser()` on renewal failure. `AuthContext.tsx:13-15` calls `getFreshUser()` (not the raw `getUser()`) specifically to avoid rendering a signed-in shell around a dead token. `client.ts:9-18` attaches the token via `getFreshUser()`; `client.ts:25-33` drops the session on a 401 that survives renewal. None of this has any test coverage.
- **The invalid-token gap is real and unmitigated.** A Gateway-authorizer rejection for any reason other than local expiry produces a CORS-blocked response. Axios surfaces this identically to a genuine network/connectivity failure: `error.response` is `undefined`, `error.message` is the generic string `"Network Error"` — there is no way to distinguish the two cases from a single failed request, by design of the browser's CORS security boundary.
- **`frontend/` has no test infrastructure at all.** No test script, no Vitest/testing-library/jsdom in `package.json`, no `*.test.ts(x)` files anywhere, no `test/` directory. `vite.config.ts` is 8 lines with nothing to reconcile a Vitest config against.
- **CI builds frontend but never tests it.** Both `.github/workflows/pr-diff.yml` and `deploy.yml`'s `diff` job run `npm ci && npm run build` in `frontend/` with no test step. `test-plan.md` §5 already marks "frontend unit + integration" as required once this phase lands.

### Key Discoveries:

- `frontend/src/auth/cognito.ts:3-7` reads `import.meta.env.VITE_COGNITO_*` at module load time — Vite's mode-based env loading (`.env.test` overriding `.env` for the same keys) handles this cleanly without any runtime stubbing, as long as a `.env.test` file exists (it doesn't yet).
- `backend/test/helpers/` (fixture/stub factories) and `backend/test/helper.ts` (per-test app + `t.after` teardown) are the established cross-app convention this phase mirrors for `frontend/test/helpers/`.
- `frontend/.oxlintrc.json` needs no changes — its two rules (`react/rules-of-hooks`, `react/only-export-components`) don't apply differently to test files, and this plan avoids Vitest globals (explicit `vi`/`describe`/`it`/`expect` imports), so no global-recognition config is needed.
- CI's "Write frontend env from deployed stack outputs" step (`infra/scripts/write-frontend-env.mjs`) writes a real `.env` file with real Cognito values before `npm run build` runs — this happens in the same `diff`/`deploy` job as the new test step, so the test step must not pick up those real values (see Critical Implementation Details).

## Desired End State

- `cd frontend && npm test` runs Vitest against jsdom, exercising `cognito.ts`, `AuthContext.tsx`, `useAuth.ts`, and `client.ts` — the entire auth surface — and passes.
- A token the Gateway authorizer rejects for a non-expiry reason results in one silent retry, then a visible "connection or session problem — sign in again" banner instead of an opaque failure; a genuine one-off network blip that clears on retry produces no user-visible effect.
- `pr-diff.yml` and `deploy.yml`'s `diff` job both run `npm test` in `frontend/` and fail the job on a test failure, the same way backend tests already gate both workflows.
- `test-plan.md` reflects Phase 3 as `complete`: rollout table, quality gates table, §6.3 cookbook, §7 negative-space (documents the one thing deliberately left untested), and the freshness ledger.

**Verification**: `cd frontend && npm test` passes, including new tests for the shipped renewal/dedupe/401-drop behavior and the new retry/banner mechanism; `cd frontend && npm run build` succeeds (test files type-check via the new tsconfig project); manually reverting the retry-then-signal logic makes the corresponding test fail; a PR touching `frontend/` shows the new test step running in the Actions UI.

## What We're NOT Doing

- Not driving the banner behavior through `PrintLayout` (`App.tsx`) — that view is a low-frequency, read-only print preview; the banner ships only in `AuthenticatedLayout` for now.
- Not testing `automaticSilentRenew`'s timer-driven renewal behavior itself — only that `UserManager` is constructed with the option set. The timer mechanics are `oidc-client-ts`'s own tested responsibility; asserting real timer-driven renewal would only be testing a mock's scripted behavior once the module is mocked (this phase's chosen mocking strategy), not real coverage.
- Not adding the extension (`extension/`) to this phase's scope — its auth mechanism (`browser.identity.launchWebAuthFlow`, its own `exp`-based refresh) is architecturally unrelated to `oidc-client-ts`, and `test-plan.md` §3 already scopes extension test-runner bootstrapping to Phase 5.
- Not polishing the banner's visual design — functional presence (visible, dismissible via its own action, accessible via `role="alert"`) is the bar for this phase, not styling.
- Not adding a delay/backoff before the retry — a CORS-authorizer rejection is deterministic and will fail identically on immediate retry; a delay only ever helps the rare network-blip case, at the cost of slower feedback for the case this exists to catch.
- Not adding coverage-threshold enforcement (e.g. a minimum `%` gate) — matches the backend's own `c8` usage, which reports coverage but enforces no threshold.

## Implementation Approach

Bootstrap the test runner first (Phase 1, prerequisite for everything else), then regression-test the already-shipped fix (Phase 2, no new production code), then design and test the new retry/banner mechanism for the residual gap (Phase 3, the only phase with new production code), then make the new tests actually gate merges (Phase 4, depends on 1-3 existing and passing), then close out documentation (Phase 5, depends on all four).

## Critical Implementation Details

**The retry must be marked to prevent an infinite loop.** Axios re-runs every response interceptor on a manually retried request, including the one that triggered the retry. `client.ts`'s retry (Phase 3) must stamp the retried request's config with a one-shot marker (e.g. `config._connectionRetried = true`) before re-issuing it via `apiClient.request(config)`, and check that marker before retrying again — otherwise a persistently failing request retries forever instead of failing once and signaling.

**`.env.test` must exist for Vite's own env-precedence to protect CI's test run.** CI's "Write frontend env from deployed stack outputs" step writes a real `.env` file with real Cognito values in the same job that will run the new test step. Vite merges env files by specificity — `.env.test` (mode-specific) overrides `.env` (generic) for the same key — so as long as `.env.test` defines its own `VITE_COGNITO_*`/`VITE_API_BASE_URL` values, the test run never sees the real ones regardless of step order within the job. Confirm this by running `npm test` locally with a `frontend/.env` present and checking the dummy values still win.

## Phase 1: Bootstrap Vitest + React Testing Library for `frontend/`

### Overview

Stand up the test runner, jsdom environment, and shared test fixtures — no auth-specific test assertions yet, just the infrastructure the next two phases write against.

### Changes Required:

#### 1. Test dependencies and script

**File**: `frontend/package.json`

**Intent**: Add the test runner and its jsdom/React-rendering support, and a script CI and local devs both run.

**Contract**: Add `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom` to `devDependencies` (latest versions compatible with React 19 / Vite 8). Add `"test": "vitest run"` to `scripts` — a single non-watching run, matching how `npm test` behaves in `backend/`.

#### 2. Vitest config

**File**: `frontend/vite.config.ts`

**Intent**: Point Vite's existing config at jsdom and a setup file, using Vitest's own `defineConfig` (a superset of Vite's) so the `test` field type-checks.

**Contract**: Change the `defineConfig` import from `'vite'` to `'vitest/config'` (drop-in compatible — re-exports Vite's config shape plus the `test` field). Add `test: { environment: 'jsdom', setupFiles: ['./test/setup.ts'] }`. No `globals: true` — tests import `describe`/`it`/`expect`/`vi` explicitly from `'vitest'`, consistent with the backend's explicit-import style (`node:test`).

#### 3. Test setup file

**File**: `frontend/test/setup.ts` (new)

**Intent**: Register jest-dom's matchers (`toBeInTheDocument`, etc.) against Vitest's `expect` before any test file runs.

**Contract**: `import '@testing-library/jest-dom/vitest'` — the package's Vitest-specific entry point, which both extends `expect` and provides the matching type augmentation.

#### 4. Dummy test env

**File**: `frontend/.env.test` (new)

**Intent**: Give `cognito.ts`'s module-load-time `import.meta.env.VITE_COGNITO_*` reads deterministic, non-real values during tests (see Critical Implementation Details for why this must exist before Phase 4's CI wiring).

**Contract**: Mirror the keys in `frontend/.env.development` (`VITE_API_BASE_URL`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_COGNITO_DOMAIN`, `VITE_COGNITO_REDIRECT_URI`, `VITE_COGNITO_REGION`) with clearly fake values (e.g. `eu-central-1_testplaceholder`).

#### 5. Test TypeScript project

**File**: `frontend/tsconfig.vitest.json` (new), `frontend/tsconfig.json` (modified)

**Intent**: Give `test/` its own type-checked project, following the same extend-and-include pattern `backend/test/tsconfig.json` uses, so `tsc -b` actually checks test files instead of silently skipping a directory no tsconfig includes today.

**Contract**: New file extends `./tsconfig.app.json`, overrides `include` to `["src", "test"]` and `tsBuildInfoFile` to its own path. Root `tsconfig.json` gets a third `references` entry pointing at it, alongside the existing `tsconfig.app.json`/`tsconfig.node.json` entries.

#### 6. Shared auth test fixtures

**File**: `frontend/test/helpers/oidc.ts` (new)

**Intent**: One fake `UserManager` + fake `User` factory that Phase 2 and Phase 3's test files both need, instead of three ad hoc mocks — mirrors `backend/test/helpers/fixtures.ts`'s role.

**Contract**: Exports a factory building a fake `User` (`{ expired: boolean, id_token: string, profile: { email: string } }` — the subset of `oidc-client-ts`'s `User` shape this codebase actually reads) and a fake `UserManager` (`getUser`, `signinSilent`, `removeUser` as `vi.fn()`s, plus a minimal `events` object exposing `addUserLoaded`/`removeUserLoaded`/`addUserUnloaded`/`removeUserUnloaded` as `vi.fn()`s) for use with `vi.mock('oidc-client-ts', ...)`.

### Success Criteria:

#### Automated Verification:

- `cd frontend && npm install` succeeds with the new dependencies
- `cd frontend && npm test` runs (zero test files yet is fine — the runner itself must start and exit cleanly)
- `cd frontend && npm run build` succeeds (confirms the new tsconfig project doesn't break `tsc -b`)

#### Manual Verification:

- Confirm `frontend/.env.test`'s dummy values, not `frontend/.env.development`'s or any local `.env`'s real values, are what a quick `console.log(import.meta.env.VITE_COGNITO_USER_POOL_ID)` inside a throwaway test shows

---

## Phase 2: Regression tests for the shipped expiry fix

### Overview

Cover the four already-shipped behaviors from `context/foundation/lessons.md`'s incident writeup — nothing here changes production code.

### Changes Required:

#### 1. `cognito.ts` coverage

**File**: `frontend/test/auth/cognito.test.ts` (new)

**Intent**: Prove `getFreshUser()`'s expiry check, deduped renewal, and renewal-failure fallback — the core of the shipped fix.

**Contract**: `vi.mock('oidc-client-ts', ...)` using Phase 1's fixture factory. Cases: (1) a non-expired cached user is returned with `signinSilent` never called; (2) an expired user triggers exactly one `signinSilent` call; (3) two concurrent `getFreshUser()` calls against an expired user produce exactly one `signinSilent` call (the `renewal ??=` dedupe); (4) a rejected `signinSilent` results in `removeUser` being called once and `getFreshUser()` resolving to `null`; (5) `UserManager` is constructed with `automaticSilentRenew: true` (config assertion only — see What We're NOT Doing).

#### 2. `AuthContext`/`useAuth` coverage

**File**: `frontend/test/auth/AuthContext.test.tsx` (new)

**Intent**: Prove the context bootstraps from `getFreshUser()` (not the raw `getUser()`) and reacts to renewal/session events fired outside React.

**Contract**: Render `AuthProvider` with a consumer using `useAuth()` (RTL `render`). Cases: (1) on mount, `getFreshUser()` is called and its result becomes `user`, with `loading` settling to `false`; (2) firing the mocked `UserManager`'s `userLoaded` event updates `user`; (3) firing `userUnloaded` sets `user` back to `null`.

#### 3. `client.ts` coverage (existing behavior only)

**File**: `frontend/test/api/client.test.ts` (new)

**Intent**: Prove the request interceptor attaches a fresh token and the response interceptor drops the session on a real (non-network) 401 — Phase 3 extends this same file for the new retry/signal behavior.

**Contract**: Mock `getFreshUser`/`userManager` (via `../src/auth/cognito`, not the raw `oidc-client-ts` mock, since `client.ts` imports from there directly). Cases: (1) a request picks up `Authorization: Bearer <id_token>` when `getFreshUser()` resolves a user; (2) no `Authorization` header when it resolves `null`; (3) a response with `status: 401` (a real, CORS-headered rejection, `error.response` present) triggers `removeUser()`.

### Success Criteria:

#### Automated Verification:

- `cd frontend && npm test` passes, including all three new test files
- `cd frontend && npm run build` succeeds

#### Manual Verification:

- Temporarily comment out the `renewal ??=` dedupe in `cognito.ts` (make each call start its own `signinSilent`), confirm the concurrency test in `cognito.test.ts` fails, then revert — proof the test actually catches the regression it exists to catch

---

## Phase 3: Close the residual invalid-token gap

### Overview

New production code: a retry-then-signal mechanism in `client.ts` for the CORS-masking failure mode the shipped fix doesn't cover, surfaced as a dismissible banner rather than a forced logout.

### Changes Required:

#### 1. Connection-issue signal module

**File**: `frontend/src/auth/connectionIssue.ts` (new)

**Intent**: A minimal pub/sub so the non-React `client.ts` interceptor can notify the React `AuthContext` without either module depending on the other's internals — same shape as `userManager.events`, which `AuthContext.tsx:24-33` already consumes.

**Contract**: `signalConnectionIssue(): void`, `clearConnectionIssue(): void`, `onConnectionIssueChange(listener: (active: boolean) => void): () => void` (returns an unsubscribe function, mirroring the `addUserLoaded`/`removeUserLoaded` pairing pattern already used elsewhere in this codebase).

#### 2. Retry-then-signal in the response interceptor

**File**: `frontend/src/api/client.ts`

**Intent**: On a response-less failure for a request that carried a token, retry once before concluding it's likely an auth rejection rather than a network blip; on success (this call or any later one), clear any active signal.

**Contract**: In the success handler, call `clearConnectionIssue()`. In the error handler, after the existing 401 check: if `error.response === undefined` and the failed request's config had an `Authorization` header and wasn't already retried, stamp the config (`_connectionRetried = true`, see Critical Implementation Details) and re-issue it via `apiClient.request(config)`; if that retry also fails with `error.response === undefined`, call `signalConnectionIssue()` before rejecting. A retry that succeeds, or fails with a real status code, does not signal.

#### 3. Expose the signal through `AuthContext`

**File**: `frontend/src/auth/AuthContext.tsx`, `frontend/src/auth/useAuth.ts`

**Intent**: Make the signal consumable by `App.tsx` the same way `user`/`loading` already are.

**Contract**: `AuthContextValue` (in `useAuth.ts`) gains `connectionIssue: boolean`. `AuthProvider` adds local state defaulted `false`, subscribed in a `useEffect` to `onConnectionIssueChange(setConnectionIssue)` (unsubscribe on cleanup, same pattern as the existing `userLoaded`/`userUnloaded` effect).

#### 4. Banner UI

**File**: `frontend/src/App.tsx`

**Intent**: Turn the signal into the "clean re-authentication prompt" Risk #4 asks for, replacing what used to be an opaque failure.

**Contract**: In `AuthenticatedLayout`, when `connectionIssue` is `true`, render a `role="alert"` element with an explanatory message and a "Sign in again" button calling the existing `login()`. No change to `PrintLayout` (see What We're NOT Doing).

### Success Criteria:

#### Automated Verification:

- `cd frontend && npm test` passes, including new cases in `client.test.ts` (retry-then-signal, retry-then-success-clears-signal, real-status-code-does-not-signal) and a new `App.test.tsx` (banner renders when `connectionIssue` is true, absent otherwise, "Sign in again" invokes `login()`)
- `cd frontend && npm run build` succeeds

#### Manual Verification:

- With the backend stopped (simulating a network-level failure), sign in, then make a request from the UI — confirm the request fails once, retries once, and the banner appears with a working "Sign in again" button, rather than a silent failure or a forced logout
- Restart the backend and make another request — confirm the banner disappears without any manual dismissal

---

## Phase 4: Wire frontend tests into CI

### Overview

Make `npm test` in `frontend/` actually gate merges, per `test-plan.md` §5's stated requirement — mirrors how `testing-backend-ci-safety-net` wired backend tests into both workflows in its own phase rather than a follow-up.

### Changes Required:

#### 1. PR workflow

**File**: `.github/workflows/pr-diff.yml`

**Intent**: Fail the `diff` job on a frontend test failure, before the build/deploy-diff steps run.

**Contract**: Add a step (e.g. "Run frontend tests") running `npm ci && npm test` in `frontend/`, placed before the existing "Write frontend env from deployed stack outputs" / "Build frontend" steps so the dummy `.env.test` values are exercised independently of the real env the later build step writes.

#### 2. Deploy workflow

**File**: `.github/workflows/deploy.yml`

**Intent**: Same gate on every push to `main`, in the `diff` job only (the `deploy` job below it already `needs: diff` and rebuilds independently, matching the existing backend-test placement).

**Contract**: Same step as above, added to the `diff` job.

### Success Criteria:

#### Automated Verification:

- `cd frontend && npm ci && npm test` (the exact command the new CI step runs) passes locally
- Opening a PR against `main` shows the new "Run frontend tests" step running and passing in the Actions UI

#### Manual Verification:

- Temporarily introduce a failing assertion in any Phase 2/3 test file, push to a PR branch, confirm the `diff` job goes red on the new step specifically — then revert

---

## Phase 5: Close out test-plan.md bookkeeping

### Overview

Record what shipped so `test-plan.md` stays accurate, and flip rollout Phase 3 to `complete`.

### Changes Required:

#### 1. Rollout, gates, cookbook, and freshness updates

**File**: `context/foundation/test-plan.md`

**Intent**: Reflect Phases 1-4's shipped state.

**Contract**:
- §3 Phased Rollout table: Phase 3's `Status` cell → `complete`.
- §4 Stack table: update the "unit + integration (frontend/extension)" row's frontend half to name Vitest + `@testing-library/react` + jsdom as shipped, keeping the extension half as still-pending (Phase 5 of the rollout).
- §5 Quality Gates table: change "frontend unit + integration" row's `Required?` cell from "required after §3 Phase 3" to "enforced" (mirroring how the backend row reads), naming this phase and both workflow files.
- §6 cookbook: fill in §6.3 ("Adding a frontend or extension unit/component test") with the `frontend/test/` layout, the `test/helpers/oidc.ts` fixture factory, and the `vi.mock('oidc-client-ts')` pattern from Phase 2 — the template new frontend tests should follow.
- §7 "What We Deliberately Don't Test": add an entry for `oidc-client-ts`'s internal `automaticSilentRenew` timer mechanics (config-asserted only, not behavior-tested — see this plan's What We're NOT Doing for the rationale).
- §8 Freshness Ledger: update "Strategy (§1–§5) last reviewed" to today's date.

### Success Criteria:

#### Automated Verification:

- `grep "| 3 | Auth resilience" context/foundation/test-plan.md` shows the Phase 3 row's Status column as `complete`

#### Manual Verification:

- Read the updated §4/§5/§6/§7 sections and confirm they accurately describe what shipped in Phases 1-4

---

## Testing Strategy

### Unit Tests:

- `cognito.ts`'s `getFreshUser()` expiry/renewal/dedupe/fallback logic (Phase 2)
- `connectionIssue.ts`'s pub/sub contract (Phase 3, covered indirectly through `client.test.ts`'s retry-then-signal cases)

### Integration Tests:

- `AuthContext`/`useAuth` reacting to mocked `UserManager` events (Phase 2)
- `client.ts`'s request/response interceptors, including the new retry-then-signal path (Phases 2-3)
- `App.tsx`'s banner rendering and dismissal via RTL (Phase 3)

### Manual Testing Steps:

1. Break the `renewal ??=` dedupe, confirm the concurrency test fails, revert (Phase 2).
2. Stop the backend, trigger a request from the running UI, confirm one retry then a banner with a working "Sign in again" button; restart the backend and confirm the banner self-clears (Phase 3).
3. Introduce a failing test on a PR branch, confirm the new CI step goes red specifically, revert (Phase 4).
4. Read `test-plan.md`'s updated sections for accuracy (Phase 5).

## Performance Considerations

The retry adds at most one extra round-trip, only on an already-failing, response-less request — no effect on the happy path. No new runtime dependency executes in production beyond the small `connectionIssue.ts` module (a few closures, no timers, no polling).

## Migration Notes

No schema or data changes. No production data affected. No breaking change to any existing component's public props/exports — `AuthContextValue` gains a field, existing consumers destructuring only `user`/`loading`/`refresh` are unaffected.

## References

- Test-plan: `context/foundation/test-plan.md` §2 (Risk #4), §3 (Phase 3 row), §5
- Research: `context/changes/testing-auth-resilience/research.md`
- Lesson this phase directly applies: `context/foundation/lessons.md` ("An expired token reads as a CORS failure, not a 401")
- Shipped fix being regression-tested: `frontend/src/auth/cognito.ts:49-68`, `frontend/src/auth/AuthContext.tsx:13-15,24-33`, `frontend/src/api/client.ts:9-33`
- Structurally analogous prior phase: `context/archive/2026-08-05-testing-ai-usability-cross-user-isolation/plan.md` (found protection already in place, added regression guard + new empirical/behavioral coverage)
- Backend test conventions mirrored: `backend/test/helper.ts`, `backend/test/helpers/`
- CI workflows being extended: `.github/workflows/pr-diff.yml`, `.github/workflows/deploy.yml`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Bootstrap Vitest + React Testing Library for `frontend/`

#### Automated

- [x] 1.1 `cd frontend && npm install` succeeds with the new dependencies — 90643b4
- [x] 1.2 `cd frontend && npm test` runs and exits cleanly — 90643b4
- [x] 1.3 `cd frontend && npm run build` succeeds — 90643b4

#### Manual

- [ ] 1.4 Confirm `.env.test`'s dummy values win over any local `.env`'s real values inside a test

### Phase 2: Regression tests for the shipped expiry fix

#### Automated

- [x] 2.1 `cd frontend && npm test` passes, including `cognito.test.ts`, `AuthContext.test.tsx`, `client.test.ts` — a622698
- [x] 2.2 `cd frontend && npm run build` succeeds — a622698

#### Manual

- [ ] 2.3 Breaking the `renewal ??=` dedupe fails the concurrency test; reverting restores green

### Phase 3: Close the residual invalid-token gap

#### Automated

- [x] 3.1 `cd frontend && npm test` passes, including new retry-then-signal/App banner cases — 9c83863
- [x] 3.2 `cd frontend && npm run build` succeeds — 9c83863

#### Manual

- [ ] 3.3 Backend-down repro: one retry, banner appears, "Sign in again" works
- [ ] 3.4 Backend-back-up: banner self-clears on next successful request

### Phase 4: Wire frontend tests into CI

#### Automated

- [x] 4.1 `cd frontend && npm ci && npm test` passes locally — edadd37
- [ ] 4.2 New CI step passes on an open PR

#### Manual

- [ ] 4.3 A deliberately failing test turns the new CI step red specifically; reverting restores green

### Phase 5: Close out test-plan.md bookkeeping

#### Automated

- [x] 5.1 `grep "| 3 | Auth resilience" context/foundation/test-plan.md` shows Status as `complete` — aaf817d

#### Manual

- [ ] 5.2 Updated §4/§5/§6/§7 sections read accurately against what shipped
