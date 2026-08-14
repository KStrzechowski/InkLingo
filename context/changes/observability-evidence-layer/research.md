---
date: 2026-08-14T10:17:57+0200
researcher: KStrzechowski
git_commit: 37cdf1d965f3f0579d5f59fede5cabfe3b86518c
branch: main
repository: InkLingo
topic: "Observability evidence layer — what the first pass missed"
tags: [research, codebase, observability, error-handling, logging, ci, extension, frontend, backend, infra]
status: complete
last_updated: 2026-08-14
last_updated_by: KStrzechowski
---

# Research: Observability evidence layer — what the first pass missed

**Date**: 2026-08-14T10:17:57+0200
**Researcher**: KStrzechowski
**Git Commit**: 37cdf1d965f3f0579d5f59fede5cabfe3b86518c
**Branch**: main
**Repository**: InkLingo

## Research Question

`observability-evidence-layer` — check if there is anything else.

This document **replaces** a hand-written predecessor produced without the
sub-agent fan-out. Where the two disagree, this one is correct; the specific
claim that was wrong is called out in §1 rather than quietly dropped.

## Summary

Four parallel agents swept the client failure surfaces, the backend paths that
bypass the new error handler, the project's prior decisions, and the deployed
logging/CI pipeline. Two findings are severe enough to change the verdict on the
implementation that already landed, and I verified both by hand rather than
taking the agents' word:

1. **401s produce no log line in production.** `backend/src/server.ts:4-6` is
   `Fastify({ logger: true })` — pino's default level, `info`. Verified
   directly: `effective level: info`, `debug enabled: false`. The Lambda runs
   `run.sh` → `exec node dist/server.js`, never `npm start`, so
   `package.json`'s `-l info` is irrelevant and no `LOG_LEVEL` is set anywhere.
   The `401 → debug` choice therefore means *401s are not logged at all*. The
   plugin test passed only because `test/plugins/error-handler.test.ts:41`
   builds its own instance at `level: 'debug'`. The documented behavior in
   `AGENTS.md` is wrong as shipped.
2. **CI never runs six backend test files, including both new ones.**
   `backend/package.json:11` ends in an **unquoted** `test/**/*.ts`. On Linux
   npm runs scripts through `sh`, which has no globstar, so `**` collapses to
   `*` and the shell expands the pattern before Node sees it. Verified on this
   machine: the glob yields 8 paths, while 14 `*.test.ts` files exist. Not run:
   both `test/routes/api/client-errors/*.test.ts`, `route-reachability.test.ts`
   (the gateway-drift guard whose `MIN_EXPECTED_ROUTES` this change just
   bumped), `route-ownership.test.ts`, and four `routes/api/*` suites. It passes
   locally because Windows npm uses `cmd.exe`, which does no globbing, so Node
   expands the pattern with real globstar.

Both are instances of `lessons.md:61-66` — "a quality gate that can silently not
run is worse than no gate" — recurring in new forms. The first is a log level
that filters the gate's own output; the second is a shell glob that filters the
gate's own input.

Beyond those, the layer has real coverage holes, three of them in code this
change wrote.

## Detailed Findings

### 1. Correction to the previous research doc

The predecessor claimed the swallowed-error audit came back "clean" across the
three apps, and listed eight catch sites. That claim was produced by a regex
matching **block** syntax (`catch {` / `catch (err) {`) only. It could not see
promise-method catches (`.catch(cb)`), and it missed these:

- `frontend/src/useSpeech.ts:45-49` and `extension/src/useSpeech.ts:43-47` —
  bare, uncommented `.catch(() => setVoices([]))`. A `loadVoices()` rejection
  sets `ready = true` with an empty list, so `hasVoice()` is false for every
  language and the UI states a **false cause**: "No voice is installed on this
  computer for X" (`CollectionDetailPage.tsx:162-169`,
  `extension/src/popup/App.tsx:471-475`). A silent fallback that actively
  misinforms.
- `frontend/src/auth/cognito.ts:56-63` — `signinSilent().catch(...)` →
  `removeUser()`. Any refresh failure silently ends the session.
- `extension/src/popup/App.tsx:136-139`, `:180-189`, `:197` — popup-side
  failures, one of them (`handleLogout`) with no catch at all.

So the negative finding that justified not spending phases here **does not
hold**. The audit's conclusion (this codebase does not have an empty-catch
problem) survives; its completeness did not.

### 2. Defects in the code this change shipped

- **`extension/src/observability/reporter.ts:88,114`** — `browser.storage.local`
  rejections are not caught, so `report()` itself can reject. `background.ts`
  does `await report(...)` at `:84`, `:98`, and `:159`, so a storage failure
  **replaces the user's real error** with a storage error, and at `:91`
  `markReported()` never runs. At `:159` it makes `handle()` reject, so the
  popup's `sendMessage` rejects instead of receiving `{ok:false,error}`. The
  frontend reporter got this right (`frontend/.../reporter.ts:74-78` falls back
  to memory); the extension one did not. The evidence layer degrades the
  product it is meant to observe.
- **`frontend/src/observability/reporter.ts:113`** — reports older than
  `MAX_AGE_MS` (24h) are dropped by the `.filter()` with **no accounting**,
  unlike the `MAX_BUFFERED` path at `:129-138` which warns and emits a
  `ReportBufferOverflow`. So a session that never recovers loses its own
  evidence after 24 hours, silently — the exact case the buffer exists for, and
  a direct violation of `lessons.md:61-66`.
- **`frontend/src/api/client.ts:96-98`** — `if (!axios.isAxiosError(error))
  return Promise.reject(error)` sits **before** the `report()` call at `:104`.
  Reachable: in axios v1 a rejected *request* interceptor is routed into the
  response-error chain, so anything `getFreshUser()` throws at `:68` is dropped
  unreported and rendered as the generic `'Request failed'`
  (`frontend/src/api/errors.ts:8`).

### 3. Client failure surfaces with no trace

- **`frontend/src/auth/cognito.ts:56` + `AuthContext.tsx:26-35`** — the highest
  value gap. `automaticSilentRenew: true` is set at `cognito.ts:20`, but nothing
  subscribes to oidc-client-ts's **`addSilentRenewError`**; only
  `addUserLoaded`/`addUserUnloaded` are wired. The timer-driven renewal that
  keeps a long-open tab alive can fail entirely in the dark. The layer's
  headline scenario — Risk #4, the 2026-08-04 incident — is its blind spot.
- **`extension/src/popup/main.tsx:6-10`** — installs **no** global handlers,
  unlike `frontend/src/main.tsx:9`. A render crash blanks the popup with zero
  trace anywhere, and Firefox tears the document down on focus loss so even the
  console line is gone.
- **No React error boundary exists anywhere.** Repo-wide grep for
  `componentDidCatch|ErrorBoundary|errorElement|getDerivedStateFromError`
  returns zero matches, and `App.tsx:96-107` uses react-router 8's declarative
  `<Routes>`, not a data router — so `errorElement` is not merely unset, it is
  not wireable without changing router API or adding a class component. A
  frontend render crash *is* captured (React 19's default `onUncaughtError`
  dispatches a `window` error event), but the user gets a blank white page.
- **Speech, both apps** — `speech.ts:92,107` and `extension/src/speech.ts:88,103`
  deliver failures via the `onError` **callback**. No request, so the axios hook
  never sees them; `SpeechSynthesisErrorEvent` is dispatched on the utterance,
  not on `window`, so `globalHandlers.ts` never sees them either.
- **AI quality signals** — `extension/src/popup/App.tsx:279` ("No new sentences
  came back…") and `:481` ("Nothing came back for this language…") are
  user-visible product failures on HTTP 200. Nothing measures them, and
  `lessons.md`'s "A stubbed AI client cannot tell you the model's output is
  usable" says this is a ~9%-of-calls phenomenon.
- **`frontend/src/pages/printPagination.ts:32-42` → `PrintDocument.tsx:83`** —
  a commented fallback whose `querySelector` targets are a stringly-typed
  coupling to `print.css`. Renaming a class silently reverts the feature in
  production; the user finds out on paper.

### 4. Backend paths that bypass the new error handler

- **404s.** No `setNotFoundHandler` exists. Fastify's default sends a **plain
  object**, not an `Error`, so `setErrorHandler` never runs; the only trace is
  `request.log.info('Route GET:/x not found')` — a bare string with no
  `requestId`. Because the root `onRequest`/`onSend` hooks *are* copied into the
  404 context, the response still carries a valid `x-request-id` that matches
  nothing in the logs — a dead end worse than no header.
- **Malformed URLs** (`GET /api/collections/%zz`) skip all hooks, so
  `x-request-id` is emitted **empty** (the `decorateRequest` default).
- **`@fastify/cors` strict preflight** — `cors/index.js:195-197` sends a plain
  **string** `400 'Invalid Preflight Request'`, bypassing the handler with no
  log line at all, and also with an empty `x-request-id` because autoload's
  readdir order puts `cors.ts` before `error-handler.ts`. That ordering is
  incidental, not declared.
- **AI failure causes are unjoinable.** `collections/index.ts:52-57` catches and
  logs with **`fastify.log`** (the root logger) — no `requestId`, no `userId`.
  The `badGateway` that follows *does* reach the handler and carries the
  correlation id, but its message is the generic "could not generate a
  translation". The chain breaks precisely where the cause lives. Same defect at
  `autohooks.ts:24`.
- **No `uncaughtException`/`unhandledRejection` handler anywhere.** A boot
  failure in `server.ts`'s top-level `await` kills the container with a raw
  stack and no pino JSON.
- Confirmed **fine**: 429s from `@fastify/rate-limit` (it throws an Error),
  `reply.unauthorized()` (sensible `send()`s an Error, which Fastify routes to
  the handler), and typebox validation errors — all reach the handler with full
  context.

### 5. Prior decisions this change must reconcile with

- **`401 → debug` reverses a recorded review decision.**
  `context/archive/2026-07-21-account-auth/reviews/impl-review.md:23-31`, finding
  F1, was *"JWT verification failures are silently swallowed with no logging …
  a real incident would just look like a spike of 401s with no breadcrumb"* —
  resolved by adding `fastify.log.warn`. Demoting that to `debug` (which in
  production means *off*) undoes the fix. That may still be the right call, but
  it has to be an argued one.
- **Observability was deliberately deferred on 2026-07-18** —
  `infrastructure.md:78` and its Risk Register `:108` ("a CloudWatch-style alarm
  isn't worth the setup at this scale"). This change stays inside that deferral
  (no alarms/dashboards), so it does not contradict it.
- **No prior mention of correlation ids, request ids, or structured logging
  exists anywhere in `context/`.** This is new ground — nothing to honor.
- **The PRD has exactly three NFRs** (`prd.md:107-111`), all latency/browser.
  This change satisfies **no** stated PRD requirement and is **off-roadmap** —
  `roadmap.md:60` only records the absence ("Observability: absent"), which this
  change now makes stale. IL-25 ("Dług techniczny") is the plausible Jira home.
- **`test-plan.md` §2 has no risk for "a failure leaves no evidence."** The work
  maps onto Risk #4; Risk #7 (denial-of-wallet) governs the new route's rate
  limit; §6.4's new-endpoint cookbook should gain the error contract.
- **An open follow-up from 2026-08-02 belongs to this change.**
  `context/archive/2026-07-25-capture-translate-save/follow-ups/backend-unreachable-reads-as-logged-out.md:55-74`
  says the popup conflating "backend unreachable" with "logged out" should be
  "folded into whichever slice next touches the popup's shell". This is that
  slice, and `popup/App.tsx:136-139` is still the code in question.

### 6. Deployed pipeline

- Structured JSON **does** reach CloudWatch intact: no `pino-pretty` in
  `backend/package.json`, `run.sh` uses `exec` so stdout is inherited, and
  `logger: true` means no transport. `-P` (pretty) is dev-only.
- Retention is `ONE_WEEK` in exactly one place (`api-construct.ts:59`); no drift.
- API Gateway throttling is **stage-wide** (`:137-141`, 5 rps / 10 burst), so
  `/api/client-errors` competes with real traffic; the per-user app limit does
  not bound aggregate pressure.
- `/health` is polled by LWA on every cold start and Fastify's default request
  logging is on, so the one-week window already carries two `info` lines per
  request — the noise the `debug` choice was meant to avoid, from another source.

## Code References

- `backend/src/server.ts:4-6` — `Fastify({ logger: true })`, the whole reason 401s are dark
- `backend/run.sh:2` — `exec node dist/server.js`, why `package.json`'s `-l info` never applies
- `backend/package.json:11` — the unquoted `test/**/*.ts` that shrinks CI to 8 files
- `extension/src/observability/reporter.ts:88,114` — uncaught storage rejections
- `extension/src/background.ts:84,98,159` — `await report(...)` that can replace the real error
- `frontend/src/observability/reporter.ts:113` — silent age-out, no accounting
- `frontend/src/api/client.ts:96-98` — non-Axios early return, before `report()`
- `frontend/src/auth/cognito.ts:56-63` — silent session death
- `frontend/src/auth/AuthContext.tsx:26-35` — no `addSilentRenewError` subscriber
- `extension/src/popup/main.tsx:6-10` — no global handlers in the popup
- `backend/src/routes/api/collections/index.ts:52-57` — root logger, unjoinable AI cause
- `backend/src/routes/api/autohooks.ts:24` — same, for jwt failures
- `context/archive/2026-07-21-account-auth/reviews/impl-review.md:23-31` — the F1 decision

## Architecture Insights

The layer covers **two boundaries** — the network boundary (axios / `apiFetch`)
and the JS-engine boundary (`window` error/rejection). Everything that fails
through a *callback* (speech), a *state setter* (popup), or *inside a document
with no handlers* (the extension popup) is structurally invisible. That is a
coherent shape, not a random set of holes, and it suggests the next increment is
a third seam rather than more one-off call sites.

Second: a correlation id is only as good as the weakest link that carries it.
Three separate places (`fastify.log` in two routes, the 404 handler, the CORS
short-circuit) emit either a line with no id or an id with no line. An id that
sometimes matches nothing is worse than none, because it invites a search that
comes back empty and reads as "no such failure".

## Historical Context (from prior changes)

- `context/archive/2026-07-21-account-auth/reviews/impl-review.md:23-31` — F1, the decision that auth failures must be logged at `warn`
- `context/archive/2026-07-21-account-auth/change.md:26,29` — `/api` is authenticated with no public-route opt-out; the sensible error body shape
- `context/archive/2026-07-25-capture-translate-save/follow-ups/backend-unreachable-reads-as-logged-out.md:55-74` — open since 2026-08-02, belongs to this slice
- `context/foundation/infrastructure.md:78,96,108` — observability deferred 2026-07-18; CloudWatch is the sink
- `context/foundation/roadmap.md:60` — "Observability: absent", now stale
- `context/foundation/lessons.md:26-31,47-52,54-59,61-66` — the four rules binding this change

## Related Research

None — no prior `research.md` under `context/changes/**` or `context/archive/**`
covers logging, observability, or error handling. This is the first.

## Open Questions

1. **Should 401s be logged at `info` (visible) or stay `debug` (off in prod)?**
   Reversing F1 needs a decision, not a default. Options: raise the deployed
   level to `debug` (noisy — `/health` already emits two `info` lines per
   request), log 401s at `info`, or keep `debug` and accept that 401s are
   deliberately unlogged — but then say so in `AGENTS.md`, which currently
   claims the opposite.
2. **Is `disableRequestLogging` worth turning on?** It would cut the `/health`
   polling noise that motivated the level choice in the first place.
3. Whether the popup's "backend unreachable reads as logged out" follow-up gets
   folded in here or stays deferred.
