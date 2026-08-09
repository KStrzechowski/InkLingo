<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Auth Resilience Implementation Plan

- **Plan**: context/changes/testing-auth-resilience/plan.md
- **Scope**: Full plan — Phases 1-5 of 5
- **Date**: 2026-08-08
- **Verdict**: NEEDS ATTENTION at review time — all findings triaged and
  resolved 2026-08-08 (8 fixed, 1 no-change-needed, 0 skipped)
- **Findings**: 1 critical, 2 warnings, 6 observations
- **Post-triage**: `npm test` 32 passing (was 28), lint 0/0, build clean

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Overall is NEEDS ATTENTION rather than REJECTED by deliberate reading of the
rubric: the CRITICAL is a reliability-and-cost defect, not one of the four
rejection triggers (security, major drift, data safety, failing tests). No data
is corrupted — the unique index holds — and the fix is a few lines. Disagree
and it becomes REJECTED; the distinction only affects labelling, not F1's
priority.

## Success criteria re-verified (2026-08-08)

| Check | Result |
|---|---|
| `cd frontend && npm test` | 5 files, 28 tests passed |
| `cd frontend && npm run build` | `tsc -b && vite build` clean, built in 294ms |
| `cd frontend && npm run lint` | 0 warnings, 0 errors, 26 files |
| `grep "\| 3 \| Auth resilience" context/foundation/test-plan.md` | Status column reads `complete` |
| Manual rows 1.4, 2.3, 3.3, 3.4, 4.2, 4.3, 5.2 | Confirmed passing by the user, 2026-08-08 |

Plan adherence was audited item-by-item across all 15 "Changes Required"
entries: all 15 MATCH. All six "What We're NOT Doing" guardrails hold —
PrintLayout carries no banner (diff-verified), `automaticSilentRenew` is
config-asserted only, zero `extension/` files touched, no banner styling, no
retry backoff, no coverage threshold.

## Findings

### F1 — Retry replays non-idempotent writes and fires on client timeouts

- **Severity**: CRITICAL
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: frontend/src/api/client.ts:59-64
- **Detail**:
  The retry is gated on `error.response === undefined` alone. That condition is
  not specific to "the browser blocked it" as the comment at :52-57 states — it
  is also true for axios's own client-side timeout (`AxiosError` with
  `code: ECONNABORTED` carries no `response`). And `apiClient.request(config)`
  replays whatever verb the caller used; there is no method check.

  `apiClient` sets `timeout: 8000` (client.ts:16). The backend's translate
  budget is `TRANSLATE_TIMEOUT_MS = 20_000`
  (backend/src/routes/api/collections/index.ts:21) — 2.5x the client ceiling.
  `addEntryTranslation` (frontend/src/api/collections.ts:67) POSTs to that
  route. Failure sequence:

  1. t=0 request 1 sent; handler passes its dedupe `SELECT`
     (collections/index.ts:375-381, empty) and enters `generateWithTimeout`.
  2. t=8s axios aborts client-side. The server keeps running; the abort never
     reaches Lambda.
  3. Interceptor sees `response === undefined` + `Authorization` present + no
     marker, and retries. Request 2 arrives while request 1 is still in the
     model call, so it also passes the dedupe `SELECT` — **a second Anthropic
     generation is billed**.
  4. Whichever transaction commits second violates `UNIQUE(entry_id,
     language_code)`. This handler has no `UNIQUE_VIOLATION` catch — unlike the
     collections POST at :140 — so `NeonDbError` propagates as a **500**.
  5. t=16s request 2 times out too, so `signalConnectionIssue()` fires and the
     user is told their **session may have ended** for a translation that
     actually succeeded. The banner's only action is `login()`, a full
     navigation off the SPA that discards any in-progress form input.

  This is a doubled LLM charge on exactly the route the project built
  rate-limiting for (backend/src/plugins/rate-limit.ts:8-11 — the
  denial-of-wallet risk). `translateRateLimit` caps blast radius but does not
  prevent it.

  The plan is partly culpable: "Critical Implementation Details" anticipated
  the infinite-loop risk and specified the `_connectionRetried` marker (which
  works correctly — verified, terminates at exactly 2 attempts), but never
  considered idempotency or timeout-vs-network discrimination. The
  implementation followed the plan faithfully; the spec was incomplete.
- **Fix A (Recommended)**: Gate the retry on safe methods and exclude timeouts.
  Add before the retry: `const method = (config.method ?? 'get').toLowerCase()`
  and require `method === 'get' || method === 'head' || method === 'options'`;
  separately bail out when `error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'`.
  - Strength: Preserves the entire stated purpose — the authorizer-rejection
    case is observed on the mount-time GETs in CollectionsListPage /
    CollectionDetailPage — with zero replay risk. A timeout is not evidence of
    a rejected token, so excluding it also makes the signal more truthful.
  - Tradeoff: A response-less failure on a POST now surfaces with no retry and
    no banner, i.e. the pre-change behaviour for writes only.
  - Confidence: HIGH — the two conditions are independently verifiable and the
    existing retry tests in test/api/client.test.ts pin the GET path.
  - Blind spot: Needs a new test asserting a POST is not retried; the current
    suite only exercises GETs.
- **Fix B**: Keep retrying writes but make them safe with a client-generated
  idempotency key echoed by the backend, so a replay returns the original 201.
  - Strength: Retains blip-recovery for writes, which Fix A gives up.
  - Tradeoff: Backend work on every write route; far larger than this change.
  - Confidence: MEDIUM — no idempotency-key infrastructure exists today.
  - Blind spot: Interacts with the entry-translations dedupe `SELECT`, which
    would need to become a real upsert.
- **Decision**: FIXED via Fix A, extended during triage. Three guards now:
  (1) `ECONNABORTED`/`ETIMEDOUT` reject before the retry block — this alone
  closes the double-billing path, since it was the 8s-vs-20s timeout that
  triggered it; (2) writes are not replayed by default, opting back in via a
  new `replaySafe` request-config flag (module-augmented onto
  `AxiosRequestConfig`, so call sites are type-checked) — chosen over an
  opt-out so a forgotten flag on a future route costs a spurious banner rather
  than a duplicated side effect; (3) the signal was decoupled from the retry,
  so an unreplayable write still raises the banner on its first opaque failure
  — legibility, the point of Risk #4, no longer depends on replaying anything.
  Four tests added to `test/api/client.test.ts` (POST not replayed but still
  signals; `replaySafe` opt-in replays; opted-in replay that succeeds stays
  quiet; timeout never replays or signals). Verified non-vacuous: disabling
  both guards fails exactly those two new assertions and nothing else.
  Suite 28 → 32 passing, lint and build clean.

### F2 — A retried create surfaces "already exists" for a collection that was just created

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend/src/api/client.ts:63, frontend/src/pages/CollectionsListPage.tsx:47-55
- **Detail**: In the genuine response-lost case (server committed, connection
  dropped before the response), the retry re-sends the same body.
  `collections_user_id_lower_name_key` prevents a duplicate row, so the backend
  returns `reply.conflict('a collection with this name already exists')`
  (collections/index.ts:140-142). The page catches it into `setError` with no
  refetch, so the user is told the name is taken for a collection that was
  created successfully, it is absent from the on-screen list, and retrying the
  same name 409s again — a dead end until a manual reload.
- **Fix**: Covered entirely by F1's method gate. No separate change needed if
  F1 Fix A lands.
- **Decision**: FIXED via F1. `createCollection` is no longer replayed, so the
  response-lost window can no longer produce a 409 for a collection that was
  created. Would return only if someone marks that route `replaySafe: true`.

### F3 — No initial-state replay when a listener subscribes

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: frontend/src/auth/connectionIssue.ts:13-21,31-36
- **Detail**: `setActive` early-returns when the value is unchanged, and
  `onConnectionIssueChange` adds the listener without ever calling it with the
  current value. A listener subscribing while `active === true` is never told;
  `AuthProvider` initialises `useState(false)` and would show no banner until
  the next transition. Not reachable today — `AuthProvider` is the root and
  mounts before any page effect fires a request — but the invariant breaks the
  moment a second subscriber or a remounting provider appears.
- **Fix**: Replay on subscribe — `listeners.add(listener); listener(active)` —
  or export a `getConnectionIssue()` for lazy `useState` init.
- **Decision**: FIXED. `onConnectionIssueChange` now hands the current value to
  the new listener immediately, with a comment noting that only AuthProvider's
  root position hides the gap today.

### F4 — A dead token is re-sent on the retry

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend/src/api/client.ts:19-28,63
- **Detail**: The request interceptor only ever *sets* `Authorization`, never
  deletes it. `apiClient.request(config)` reuses the failed attempt's config,
  whose header is already populated. If the session dies between attempts
  (`getFreshUser()` returns null after `removeUser()`), the retry silently
  re-sends the stale token instead of going out unauthenticated.
- **Fix**: Add `else { delete config.headers.Authorization }` in the request
  interceptor.
- **Decision**: FIXED as proposed.

### F5 — Context value is not memoized

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: frontend/src/auth/AuthContext.tsx:42
- **Detail**: `value={{ user, loading, refresh, connectionIssue }}` is a fresh
  object every render. Pre-existing, but this change adds a fourth
  independently-changing field. Concretely: `PrintLayout` consumes `useAuth()`
  without reading `connectionIssue`, so it and its `PrintCollectionPage`
  subtree now re-render whenever the signal toggles. Small today (3 consumers,
  no timers introduced anywhere in the change).
- **Fix**: Wrap the value in `useMemo`.
- **Decision**: FIXED as proposed, keyed on all four fields.

### F6 — Comments name `.env`, but the script writes `.env.production`

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend/.env.test:1-4, frontend/test/env.test.ts:3-7, .github/workflows/pr-diff.yml:91-95
- **Detail**: All three say CI writes a real `frontend/.env` and rely on Vite
  resolving `.env.test` over the generic `.env`.
  `infra/scripts/write-frontend-env.mjs:47` actually writes
  **`.env.production`**, which Vite never loads in `test` mode at all. The
  safety property holds — more strongly than described, and step ordering makes
  it moot regardless — but the stated mechanism is wrong and will mislead the
  next reader. The plan's own "Critical Implementation Details" section carries
  the same error.
- **Fix**: Correct the three comments (and the plan's note) to name
  `.env.production`.
- **Decision**: FIXED in `.env.test`, `test/env.test.ts` and both workflows.
  Each now states the stronger property: Vite loads only the current mode's
  files, so a `test` run never reads `.env.production` at all. The plan's own
  "Critical Implementation Details" paragraph carries the same error and was
  left alone — the plan is a record of what was decided at the time, and
  `/10x-archive` freezes it.

### F7 — `npm ci` runs twice in the same CI job

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: .github/workflows/pr-diff.yml:96-110, .github/workflows/deploy.yml:99-113
- **Detail**: "Run frontend tests" and "Build frontend" each run `npm ci`
  against the same `working-directory: frontend` — roughly 30-60s wasted per
  run. Step ordering itself is correct and deliberate (tests before the env
  write), and no log leakage was found: the new steps declare no `env:`, and
  `vitest run` prints only file and test names.
- **Fix**: Drop `npm ci` from the later "Build frontend" step, or hoist a
  single install ahead of both.
- **Decision**: FIXED. "Build frontend" in each `diff` job is now just
  `npm run build`, reusing the test step's install. `deploy.yml`'s second job
  keeps its own `npm ci` — separate job, fresh runner, nothing to reuse.

### F8 — Production build now depends on test devDependencies

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: frontend/tsconfig.json:6, frontend/tsconfig.vitest.json:9
- **Detail**: `npm run build` is `tsc -b && vite build`, and the root tsconfig
  now references `tsconfig.vitest.json`, which includes `test`. An
  `npm ci --omit=dev` build would fail on missing `vitest` /
  `@testing-library` types where it previously succeeded. Both workflows
  install devDeps, so nothing is broken today. Confirmed separately that no
  test code or placeholder Cognito value ships to users — `dist/` greps clean.
- **Fix**: Note the devDeps requirement, or drop the reference and type-check
  tests via a separate `tsc -p tsconfig.vitest.json` step.
- **Decision**: FIXED by documentation, not code — the coupling is intentional
  (it is what makes `tsc -b` check test files at all). Both workflows now carry
  a comment on the install step saying it must stay a full install because
  `tsc -b` reaches `test/` through `tsconfig.vitest.json`. This matters more
  now that F7 removed the build step's own install.

### F9 — `test/setup.ts` exceeds the plan's "exactly one import"

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: frontend/test/setup.ts:4-10
- **Detail**: The plan specified the file as exactly
  `import '@testing-library/jest-dom/vitest'`. The actual file adds
  `afterEach(cleanup)` from RTL. This is a plan defect, not an implementation
  defect: RTL only auto-registers cleanup when Vitest globals are injected, and
  the plan deliberately chose no globals. Without it, rendered trees leak
  between tests. The file's own comment explains this.
- **Fix**: None needed — record the reasoning in the plan if it is ever used as
  ground truth again.
- **Decision**: NO CHANGE NEEDED. The implementation is correct and the file's
  own comment already explains why; the plan was the thing that was wrong.
