# Observability Evidence Layer Implementation Plan

## Overview

M3L5's debugging workflow converges evidence from four sources — production
monitoring, application logs, a Playwright reproduction, and the code. This repo
has two. This change builds the missing two, AWS-native and without a new
vendor: a backend error handler that writes structured, correlated log lines,
and an authenticated client-error ingest route that the frontend and extension
report into — with a buffer so the one failure class that cannot report at the
time it happens (a dead session) is still delivered once the session recovers.

## Current State Analysis

- `backend/src/app.ts` is the stock fastify-cli scaffold: two `AutoLoad`
  registrations, nothing else. **No `setErrorHandler` exists**, so every
  unhandled route error takes Fastify's default path — a 500 with a generic body
  and a pino line whose shape nobody chose.
- Lambda stdout does reach CloudWatch (`api-construct.ts:58-71`, LWA layer), but
  `BackendFunctionLogGroup` retains only **one week**
  (`api-construct.ts:58-61`). Adequate for a live incident; not for archaeology.
- `extension/src/background.ts:81` is the **only** `console.error` in the three
  app sources. A frontend or extension failure in the wild leaves no trace at
  all.
- Swallowed errors are **not** a problem here — audited clean, see
  `research.md` §2. This change adds capture, not error handling.
- `routes/api/autohooks.ts` cascades auth to every route under `/api` (via
  `app.ts:39-45`'s `autoHooks` + `cascadeHooks`), and API Gateway's
  `defaultAuthorizer` covers every route but `/health`
  (`api-construct.ts:143-148`). An authenticated ingest route therefore cannot
  receive a report from a client whose token is dead — the exact failure
  `lessons.md` records as costing a day on 2026-08-04.
- `frontend/src/api/client.ts:64-129` already owns a failure-signaling channel
  (`connectionIssue.ts` + the response interceptor), including a one-shot retry
  guarded by `_connectionRetried`. That is the integration point; a second
  interceptor would compete with it.
- `frontend/e2e/reauthPrompt.spec.ts` already drives both halves of the
  expired-token risk against the assembled app and passes in CI.

## Desired End State

A failure anywhere in the three apps leaves a durable, queryable trace that a
future debugging session can start from instead of a guess.

Verifiable by: triggering a backend 500 and finding one structured CloudWatch
line carrying the route, method, status, user id, and a request id that also
came back to the client; triggering a client-side failure while the session is
dead, and finding the report delivered after re-authentication with the same
correlation id joining both halves.

### Key Discoveries:

- `backend/src/plugins/rate-limit.ts` (14 lines) is the smallest
  `fastify-plugin` template to copy; `plugins/` is the established seam for
  cross-cutting concerns.
- `routes/api/autohooks.ts:24` sets the house logging style —
  `fastify.log.warn({ err }, 'jwt verification failed')`, pino child-object
  first, message second. Match it.
- `routes/api/autohooks.ts:5-9` deliberately lets DB failures propagate so a
  provisioning failure stays a 500 rather than becoming a 401. The new handler
  must preserve that distinction, not flatten it.
- Backend tests assert `statusCode` (e.g. `collections.test.ts:22,62,88`), so
  adding a field to the error body is low-risk — but verify, don't assume.
- `extension/src/auth.ts:76-85` and `popup/App.tsx:120,159` establish
  `browser.storage.local` as the extension's persistence idiom.
- `frontend/e2e/support/session.ts` carries `seedSession` + `API_COLLECTIONS`,
  which Phase 5 reuses rather than reinventing.

## What We're NOT Doing

- **No Sentry or any third-party monitoring SDK.** Decided: AWS-native, no new
  vendor. `infrastructure.md`'s self-hosted stance stands.
- **No lint rule for empty catch blocks.** The codebase does not have that
  problem (`research.md` §2); a rule here would be ceremony.
- **No request/response body values in logs or reports.** Keys only, values
  dropped. User vocabulary data does not leave the browser.
- **No changes to CloudWatch retention, alarms, dashboards, or alerting.** This
  change produces evidence; consuming it is a separate concern.
- **No tracing/spans, no metrics, no OTEL.** Errors only.
- **No refactor of `plugins/support.ts`** (dead `someSupport()` scaffold) — out
  of scope even though it sits next to the new plugin.
- **No public/unauthenticated ingest route.** See the tension in
  `research.md` §4; the buffer is the answer, not an open endpoint.

## Implementation Approach

Build the server side first so the client has something correct to report into,
then each client, then prove the assembled chain. Every phase's gate is verified
by making it **fail** — `lessons.md:61-66` records a gate that passed its whole
first day without ever running.

The correlation id is the spine: `request.id` exists already, travels back on a
header and in the error body, is attached to any client report that has one, and
is what joins a user's "it broke" to a log line.

## Critical Implementation Details

**Timing & lifecycle.** The frontend flush is a read-before-`await`-write in the
shape `lessons.md:52-59` names: the buffer is read, a network call awaits, and
the buffer is written back. Between those two points a new report can arrive, or
the session can die again. Drain by removing the specific reports that were
acknowledged — never by writing back a pre-`await` snapshot — or a report that
arrived mid-flush is silently lost, which is the failure this whole change
exists to prevent.

**State sequencing.** The interceptor retries once (`client.ts:101-116`), so one
user-visible failure can produce two response-error passes. Dedupe before
buffering, not after sending, or every retried failure is double-reported and
the 1-week log window fills with duplicates.

---

## Phase 1: Backend error handler + correlation id

### Overview

Give every backend failure a chosen shape and a correlation id the client can
quote, without changing any status code or response body that a client already
depends on.

### Changes Required:

#### 1. Error-handler plugin

**File**: `backend/src/plugins/error-handler.ts` (new)

**Intent**: Register a `setErrorHandler` that logs each failure once, at a level
chosen by status class, and returns the existing body shape plus a correlation
id. Follows `rate-limit.ts`'s `fastify-plugin` structure.

**Contract**: Log level by status: **5xx → `error`** with stack; **4xx →
`warn`** without stack; **401 → `debug`** (expired tokens are routine churn and
would otherwise bury real failures in a 1-week window). Log object carries
`{ err, requestId, method, routePath, statusCode, userId }` — `userId` from
`request.authUser?.id` when present, never the token or the Authorization
header. Response gains `x-request-id` and a `requestId` field on the JSON error
body; `statusCode`, `error`, and `message` keep their current values verbatim.

Per `lessons.md`, this file reads `request.authUser`, so it needs the defensive
type-only import (`import type { AuthUser as _AuthUser } from '../fastify.d.ts'`)
or ts-node/esm will intermittently fail to load the ambient augmentation.

#### 2. Preserve the 401-vs-500 distinction

**File**: `backend/src/routes/api/autohooks.ts`

**Intent**: No behavior change — but confirm the handler does not convert a
propagating DB failure into a 401. The comment at `:5-9` is the specification;
add a test rather than a code change.

**Contract**: A provisioning failure still answers 500 and logs at `error`; a
bad token still answers 401 and logs at `debug`.

#### 3. Tests

**File**: `backend/test/plugins/error-handler.test.ts` (new)

**Intent**: Cover the level routing, the correlation id round-trip, and the
redaction invariant.

**Contract**: Asserts (a) a thrown route error yields 500 with an `x-request-id`
matching the body's `requestId`; (b) a 4xx logs at `warn` and a 401 at `debug`;
(c) no log line contains the Authorization header value; (d) existing error
bodies still carry their original `statusCode`/`message`.

### Success Criteria:

#### Automated Verification:

- Backend suite passes: `cd backend && npm test`
- Type check passes: `cd backend && npm run build:ts`
- New plugin tests pass and cover all three log levels
- No existing test's error-body assertion broke

#### Manual Verification:

- `npm run dev`, force a route to throw, confirm one structured line — not a raw
  stack — and that its `requestId` matches the response header
- Confirm an expired-token request logs at `debug`, not `warn` or `error`
- **Make it fail**: temporarily break the handler registration and confirm the
  new tests go red rather than silently passing

**Implementation Note**: Pause for manual confirmation before Phase 2.

---

## Phase 2: Ingest route + infra registration

### Overview

Give clients somewhere to send reports, rate-limited, with a redaction rule that
is tested rather than trusted — and registered with API Gateway, which no test
can verify.

### Changes Required:

#### 1. Ingest route

**File**: `backend/src/routes/api/client-errors/index.ts` (new)

**Intent**: Accept a batch of client error reports, validate them against a
schema, redact request context to keys only, and write each as a structured log
line correlated to the reporting user.

**Contract**: `POST /api/client-errors`, body `{ reports: ClientErrorReport[] }`,
capped batch size. Each report: `{ eventId, app, appVersion, occurredAt, name,
message, stack?, routePath?, requestId?, request?: { method, status, bodyKeys } }`.
Responds `{ accepted: string[] }` echoing the `eventId`s that were durably
logged — the client drains exactly these, so a partial acceptance is safe.
Opts into rate limiting via per-route `config.rateLimit`, the pattern
`/:id/translate` uses.

#### 2. Redaction

**File**: `backend/src/routes/api/client-errors/redact.ts` (new)

**Intent**: Reduce any supplied request context to key names, dropping every
value, and cap key count and string lengths so a hostile or buggy client cannot
write unbounded data into CloudWatch.

**Contract**: Pure function, no Fastify dependency, so it is directly testable.
Values are never emitted under any input shape — including nested objects,
arrays, and non-object bodies.

#### 3. Redaction tests

**File**: `backend/test/routes/api/client-errors/redact.test.ts` (new)

**Intent**: The redaction rule is where this change's privacy promise lives, so
it carries its own tests independent of the route's.

**Contract**: Property-style coverage — nested objects, arrays, primitives,
oversized keys, adversarial key names. The invariant asserted is that no input
*value* appears anywhere in the output.

#### 4. API Gateway registration

**File**: `infra/lib/constructs/api-construct.ts`

**Intent**: Register the new route. `lessons.md` records this being missed
twice.

**Correction to research §5.1** (found during Phase 1 implementation): a test
*does* now catch this — `backend/test/route-reachability.test.ts` statically
compares every `fastify.<method>('/path')` under `src/routes/` against every
`addRoutes({ path, methods })` in `api-construct.ts`, in both directions. So the
registration is enforced by `npm test`, not only by `cdk synth`. Its
`MIN_EXPECTED_ROUTES` floor (currently 8) should be bumped as the comment at
`:79-83` instructs.

**Contract**: `addRoutes({ path: '/api/client-errors', methods: [POST],
integration })`, inheriting `defaultAuthorizer`. Also add `x-request-id` to the
CORS response exposure so Phase 3 can read it from the browser.

### Success Criteria:

#### Automated Verification:

- Backend suite passes: `cd backend && npm test`
- Redaction tests pass, including adversarial inputs
- `test/route-reachability.test.ts` passes with the new route on both sides
- `MIN_EXPECTED_ROUTES` bumped to match the new route count

#### Manual Verification:

- POST a report with a nested body and confirm the log line carries key names
  only — no values, at any depth
- Exceed the rate limit and confirm 429 rather than unbounded log writes
- **Make it fail**: remove the `api-construct.ts` entry and confirm
  `route-reachability` goes red — the check catches the exact miss `lessons.md`
  describes

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Frontend reporter

### Overview

Report the failures a user actually sees, plus the ones nobody wrote a path for
— and survive the case where the session is too dead to report at all.

### Changes Required:

#### 1. Reporter module

**File**: `frontend/src/observability/reporter.ts` (new)

**Intent**: Own the buffer, the dedupe, the flush, and the overflow signal.
Nothing else knows how reports are stored or sent.

**Contract**: `report(input)` enqueues; `flush()` sends the buffer and drains
only the `eventId`s the server acknowledged. Buffer persists in `localStorage`
under one key, capped by count and age. Dedupe key is
`(name, message, routePath, coarse timestamp bucket)` so the interceptor's own
retry (`client.ts:101-116`) does not double-report one user-visible failure.
On overflow or age-out, emit a single synthetic report recording that reports
were dropped, and log it — the layer must be noisy when it cannot run
(`lessons.md:61-66`).

Drain by removing acknowledged ids, never by writing back a pre-`await` snapshot
(`lessons.md:52-59`).

#### 2. Interceptor integration

**File**: `frontend/src/api/client.ts`

**Intent**: Feed the existing response-error interceptor into the reporter, and
flush opportunistically on a successful authenticated response.

**Contract**: Hooks the interceptor already at `:64-129` — no second
interceptor. Reads `x-request-id` off the response when present. Never reports
the reporter's own ingest call, or a failing flush recurses.

#### 3. Global handlers

**File**: `frontend/src/main.tsx`

**Intent**: Capture unhandled errors and rejections that never pass through
axios.

**Contract**: `window.addEventListener('error' | 'unhandledrejection')` routing
into `report()`. Registered once, before render.

#### 4. Tests

**File**: `frontend/test/observability/reporter.test.ts` (new)

**Intent**: Cover buffer, dedupe, partial acknowledgement, overflow signal, and
the mid-flush arrival case.

**Contract**: Explicitly asserts that a report arriving *during* an in-flight
flush survives the drain — the `lessons.md:52-59` failure shape.

### Success Criteria:

#### Automated Verification:

- Frontend tests pass: `cd frontend && npm test`
- Lint passes: `cd frontend && npm run lint`
- Build passes: `cd frontend && npm run build`
- Mid-flush arrival test present and passing

#### Manual Verification:

- Break a request in devtools, confirm exactly one report is sent (not two,
  despite the retry)
- Go offline, cause failures, come back online, confirm the buffer drains and
  each report carries its original `occurredAt`
- **Make it fail**: point the ingest URL at a 500 and confirm the buffer grows
  and then signals overflow, rather than silently discarding

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: Extension reporter

### Overview

The same contract in the extension, where the storage and lifecycle constraints
are different enough that sharing the frontend module is not an option.

### Changes Required:

#### 1. Reporter module

**File**: `extension/src/observability/reporter.ts` (new)

**Intent**: Mirror Phase 3's contract on `browser.storage.local`.

**Contract**: Same report schema and drain-by-acknowledged-id semantics.
`browser.storage.local`, **not** `localStorage` — Firefox destroys the popup
document on focus loss, so a popup-owned buffer would evaporate mid-flush.
There is no shared-types package between the apps (`CLAUDE.md`), so the schema is
duplicated in `extension/src/types.ts` as the other response shapes already are.

#### 2. Background integration

**File**: `extension/src/background.ts`

**Intent**: Report from the background handler's existing catch, and from
`apiFetch` failures, then flush on the next successful authenticated call.

**Contract**: Extends the `console.error` at `:81` rather than replacing it —
the console line stays useful during local development. All reporting runs in
the background script so it goes out under `host_permissions` (`:6-11`); the
popup never reports directly.

#### 3. Tests

**File**: `extension/test/observability/reporter.test.ts` (new)

**Intent**: Same coverage as Phase 3 against the `browser.storage.local` fake.

**Contract**: Reuses the extension's existing Vitest + `browser` mock setup.

### Success Criteria:

#### Automated Verification:

- Extension tests pass: `cd extension && npm test`
- Lint passes: `cd extension && npm run lint`
- Build passes: `cd extension && npm run build`

#### Manual Verification:

- Load the built extension via `about:debugging`, force a failure, confirm the
  report arrives with `app: 'extension'`
- Close the popup mid-operation and confirm the buffered report still flushes —
  the case `localStorage` would have lost
- **Make it fail**: revoke the stored token, cause a failure, confirm the report
  buffers rather than vanishing, then flushes after re-login

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: Prove it against the real incident, and document

### Overview

Show that the layer would have caught the 2026-08-04 incident — the one
`lessons.md` says cost a day — rather than only that the plumbing is connected.

### Changes Required:

#### 1. Extend the re-auth e2e

**File**: `frontend/e2e/reauthPrompt.spec.ts`

**Intent**: Add a third scenario asserting the evidence path, alongside the two
existing behavioral ones. The report cannot be sent while the token is dead, so
this proves the buffer is what makes the incident visible.

**Contract**: Drives the same `route.abort()` shape the first test uses; asserts
a report is buffered while the session is unusable, and that it is POSTed to
`/api/client-errors` once a working session returns. Follows
`frontend/e2e/E2E-RULES.md` — role-based locators, `waitForResponse` not
`waitForTimeout`, independent with its own cleanup and unique ids.

#### 2. Document the contract

**File**: `AGENTS.md`

**Intent**: Record where evidence lands and what must never be logged, so a
future change does not quietly widen the payload.

**Contract**: A short section naming the log-level policy, the correlation-id
header, the keys-only rule, and the 1-week CloudWatch retention.

#### 3. Capture the lesson

**File**: `context/foundation/lessons.md`

**Intent**: Only if implementation surfaces a genuinely recurring rule. Not a
foregone conclusion — do not pad the register.

**Contract**: Appended entry in the established Context/Problem/Rule/Applies-to
shape, or no change at all.

### Success Criteria:

#### Automated Verification:

- E2E suite passes: `cd frontend && npm run test:e2e`
- All three app suites still pass
- CI passes on the branch

#### Manual Verification:

- Confirm the new scenario **fails** when the reporter is disabled — the risk it
  claims to cover actually materializes it (`E2E-RULES.md`, and the M3L4
  verify step)
- Walk the M3L5 loop end to end: cause a failure, find it in CloudWatch by
  correlation id, and confirm the evidence names the failure without guessing

---

## Post-research corrections (2026-08-14)

`/10x-research` ran properly after the five phases landed and found two defects
that made the shipped layer wrong, plus three in code these phases wrote. All
five are fixed; each fix was verified by breaking it and watching a test go red.

| Finding | Fix |
|---|---|
| **401s produced no log line in production.** `server.ts` is `Fastify({ logger: true })` — pino default `info` — and the Lambda runs that file via `run.sh`, so `package.json`'s `-l info` never applied. `401 → debug` meant "never logged", reversing account-auth impl-review F1 | 401 → `info`; `disableRequestLogging: true` in `server.ts` removes the `/health` polling noise that motivated the demotion. New test asserts *every* failure level is `>= info` |
| **CI ran 8 of 14 backend test files.** Unquoted `test/**/*.ts`; Linux `sh` has no globstar, so both `client-errors` suites and `route-reachability.test.ts` never executed on the runner | Quoted the glob. Passed locally only because Windows npm uses `cmd.exe`, which does no globbing |
| Extension `report()` could reject on a storage failure, and `background.ts` awaits it inside its own catch — replacing the user's real error | Memory fallback mirroring the frontend, plus an outer guard so `report()` never rejects |
| Frontend buffer aged reports out silently, with no accounting — losing the evidence of the never-recovering session the buffer exists for | Age-outs counted, warned, and delivered as a `ReportBufferOverflow` |
| `client.ts` returned early for non-Axios errors *before* reporting, dropping anything the request interceptor threw | Reported before the guard |

Verification note: breaking the extension fix one line at a time did not turn
the test red, because `readBuffer` and `writeBuffer` each independently provide
the fallback. Only removing both did. Worth knowing — no single line there is
load-bearing, and a future edit could delete one without any signal.

## Testing Strategy

### Unit Tests:

- Redaction: no input value survives, at any nesting depth (Phase 2)
- Reporter buffer: dedupe across the interceptor retry; partial acknowledgement
  drains exactly the acknowledged ids; overflow emits a signal rather than
  silently dropping (Phases 3, 4)
- Error handler: level routing per status class; correlation id round-trip; the
  Authorization header never reaches a log line (Phase 1)

### Integration Tests:

- `POST /api/client-errors` end to end through a built Fastify app: auth
  required, rate limit enforced, batch partially accepted

### Manual Testing Steps:

1. Force a backend 500; confirm one structured line and a matching
   `x-request-id` on the response.
2. Break a frontend request; confirm exactly one report despite the retry.
3. Kill the session, cause a failure, re-authenticate; confirm the buffered
   report arrives with its original timestamp.
4. Disable the reporter and confirm the Phase 5 e2e goes red.

## Performance Considerations

Reporting is off the user's critical path: reports are buffered and flushed
opportunistically alongside a request that was going to happen anyway, never
awaited before rendering. The ingest route is rate-limited, and the batch size
and buffer are both capped — a client in a failure loop cannot turn CloudWatch
into a cost problem, which is the concern `infrastructure.md`'s risk register
raises about the AI routes.

## Migration Notes

No data migration. No schema change. Every phase is independently revertible;
Phases 3 and 4 are inert without Phase 2's route, and Phase 2 is inert without
its `api-construct.ts` entry — so a partial rollout degrades to no reporting
rather than to broken requests.

## References

- Related research: `context/changes/observability-evidence-layer/research.md`
- Lesson prior (silent gates): `context/foundation/lessons.md:61-66`
- Lesson prior (read-before-await): `context/foundation/lessons.md:52-59`
- Lesson prior (route registration): `context/foundation/lessons.md`, "Every new
  backend API route needs a matching api-construct.ts entry"
- The incident being proven against: `context/foundation/lessons.md`, "An
  expired token reads as a CORS failure, not a 401"
- Plugin template: `backend/src/plugins/rate-limit.ts`
- Logging style: `backend/src/routes/api/autohooks.ts:24`
- E2E to extend: `frontend/e2e/reauthPrompt.spec.ts`, rules in
  `frontend/e2e/E2E-RULES.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend error handler + correlation id

#### Automated

- [x] 1.1 Backend suite passes: `cd backend && npm test` — 92 pass, 0 fail
- [x] 1.2 Type check passes: `cd backend && npm run build:ts`
- [x] 1.3 New plugin tests pass and cover all three log levels — 7 tests, `error-handler.ts` 100% line coverage
- [x] 1.4 No existing test's error-body assertion broke — existing tests assert `statusCode`, so the added `requestId` field is inert to them

#### Manual

- [x] 1.5 Forced route error yields one structured line with matching requestId
- [x] 1.6 Expired-token request logs at debug
- [ ] 1.7 Make it fail: breaking handler registration turns the new tests red

### Phase 2: Ingest route + infra registration

#### Automated

- [x] 2.1 Backend suite passes: `cd backend && npm test`
- [x] 2.2 Redaction tests pass, including adversarial inputs — 9 tests
- [x] 2.3 `test/route-reachability.test.ts` passes with the new route on both sides
- [x] 2.4 `MIN_EXPECTED_ROUTES` bumped to match the new route count — 8 → 9

#### Manual

- [x] 2.5 Nested body logs key names only, at any depth
- [x] 2.6 Rate limit returns 429 rather than unbounded log writes
- [x] 2.7 Make it fail: removing the api-construct entry drops the route key

### Phase 3: Frontend reporter

#### Automated

- [x] 3.1 Frontend tests pass: `cd frontend && npm test` — 124 pass
- [x] 3.2 Lint passes: `cd frontend && npm run lint`
- [x] 3.3 Build passes: `cd frontend && npm run build`
- [x] 3.4 Mid-flush arrival test present and passing — `reporter.test.ts`, "does not lose a report raised while a flush is in flight"

#### Manual

- [x] 3.5 Broken request sends exactly one report despite the retry
- [x] 3.6 Offline-then-online drains the buffer with original timestamps
- [x] 3.7 Make it fail: a 500 ingest grows the buffer and signals overflow

### Phase 4: Extension reporter

#### Automated

- [x] 4.1 Extension tests pass: `cd extension && npm test` — 30 pass
- [x] 4.2 Lint passes: `cd extension && npm run lint`
- [x] 4.3 Build passes: `cd extension && npm run build`

#### Manual

- [x] 4.4 Loaded extension reports a forced failure with `app: 'extension'`
- [x] 4.5 Closing the popup mid-operation still flushes the buffered report
- [x] 4.6 Make it fail: revoked token buffers, then flushes after re-login

### Phase 5: Prove it against the real incident, and document

#### Automated

- [x] 5.1 E2E suite passes: `cd frontend && npm run test:e2e` — 6 pass
- [x] 5.2 All three app suites still pass — backend 92, frontend 124, extension 30
- [ ] 5.3 CI passes on the branch — not run; nothing committed or pushed yet

#### Manual

- [x] 5.4 New scenario fails when the reporter is disabled — verified by
      short-circuiting `report()`: the new scenario timed out on
      `waitForResponse` while the other two stayed green, so the assertion is
      load-bearing rather than decorative. Break reverted.
- [x] 5.5 Full M3L5 loop walked: failure → CloudWatch by correlation id → named
