# Observability Coverage Gaps Implementation Plan

## Overview

The evidence layer covers the network boundary and the JS-engine boundary.
This closes the three classes it cannot see — callback failures, popup-document
failures, and render crashes — plus the backend paths that emit a correlation
id matching no log line.

## Current State Analysis

From `context/archive/2026-08-14-observability-evidence-layer/research.md`:

- `frontend/src/auth/cognito.ts:56-63` — `signinSilent().catch()` ends the
  session silently. Nothing subscribes to oidc-client-ts's
  **`addSilentRenewError`** despite `automaticSilentRenew: true`
  (`cognito.ts:20`), so the timer-driven renewal that keeps a long-open tab
  alive can fail entirely in the dark. **The layer's headline scenario is its
  blind spot.**
- `frontend/src/useSpeech.ts:45-49` (and `extension/src/useSpeech.ts:43-47`) —
  a bare `.catch(() => setVoices([]))`. On rejection `hasVoice()` is false for
  every language and the UI states a **false cause**: "No voice is installed on
  this computer for X".
- `frontend/src/speech.ts:92,107` and `extension/src/speech.ts:88,103` —
  failures arrive by **callback**. No request, so the axios hook never sees
  them; `SpeechSynthesisErrorEvent` fires on the utterance, not `window`, so
  `globalHandlers.ts` never sees them either.
- `extension/src/popup/main.tsx:6-10` — installs **no** global handlers, unlike
  `frontend/src/main.tsx`. A popup render crash leaves no trace, and Firefox
  destroys the document on focus loss so even the console line dies.
- **No React error boundary exists anywhere** (repo-wide grep: zero matches).
  A frontend render crash *is* captured — React 19's default `onUncaughtError`
  dispatches a `window` error event — but React unmounts the root, so the user
  gets a blank white page with no recovery.
- `extension/src/popup/App.tsx:279,481` — "No new sentences came back…" /
  "Nothing came back for this language…" are user-visible product failures on
  HTTP 200. `lessons.md` measured this at ~9% of calls. Nothing counts them.
- Backend: no `setNotFoundHandler`, so 404s bypass the error handler and return
  a valid `x-request-id` matching **nothing**. `collections/index.ts:52-57` and
  `autohooks.ts:24` log with `fastify.log` (root logger), so the line carrying
  the actual cause has no correlation id. No `uncaughtException` /
  `unhandledRejection` handler anywhere.

## Desired End State

Every user-visible failure in the three apps produces either a report or a
correlated log line. No correlation id is ever returned that matches nothing.

## What We're NOT Doing

- **Not** migrating to react-router's data router. The boundary is a class
  component; the router API stays as it is.
- **Not** touching IL-25's broader debt — M4L3/L4 material.
- **Not** adding alarms, dashboards, or a third-party SDK. Unchanged from the
  parent change.
- **Not** reworking `printPagination`'s fallback (`research.md` §3, last item) —
  real, but it is a print-correctness concern and belongs with that surface.

## Implementation Approach

Client first (that is where the invisible failures are), backend last. The
extension popup needs a new message type: reporting must run in the background
script, because that is where `host_permissions` and the buffer live.

## Phase 1: The auth blind spot

### Changes Required:

**File**: `frontend/src/auth/cognito.ts`

**Intent**: Report the silent-renewal failure before dropping the session, so
the cause survives.

**Contract**: `report()` inside the `signinSilent().catch()` at `:57` before
`removeUser()`. Keep the existing behavior — this adds evidence, not a retry.

**File**: `frontend/src/auth/AuthContext.tsx`

**Intent**: Subscribe to `addSilentRenewError` alongside the existing
`addUserLoaded` / `addUserUnloaded`.

**Contract**: Same subscribe/unsubscribe shape as `:26-35`; the handler reports
and does not change UI state (the renewal failing is not itself a logout).

### Success Criteria (Automated):

- `cd frontend && npm test`, `npm run lint`, `npm run build`
- New test: a rejected `signinSilent` produces exactly one report
- New test: an `addSilentRenewError` event produces a report

---

## Phase 2: Error boundary

### Changes Required:

**File**: `frontend/src/observability/ErrorBoundary.tsx` (new)

**Intent**: Catch render crashes, report them, and render a recovery affordance
instead of the blank page React leaves behind.

**Contract**: Class component (`getDerivedStateFromError` +
`componentDidCatch`) — react-router 8's declarative `<Routes>` gives no
`errorElement`, and there is no hook equivalent. Reports with the component
stack; renders a message plus a reload control.

**File**: `frontend/src/main.tsx`

**Intent**: Wrap `<App />`.

**Contract**: Inside `<BrowserRouter>` so the boundary can offer navigation, and
outside `<Routes>` so it covers every route.

### Success Criteria (Automated):

- New test: a throwing child renders the fallback and produces one report
- Frontend tests, lint, build

---

## Phase 3: Speech, both apps

### Changes Required:

**Files**: `frontend/src/useSpeech.ts`, `extension/src/useSpeech.ts`

**Intent**: Stop the bare catch from asserting a false cause, and report it.

**Contract**: The `loadVoices()` rejection reports, and the resulting state must
be distinguishable from "voices loaded, none for this language" so the UI can
stop claiming "no voice is installed".

**Files**: `frontend/src/speech.ts`, `extension/src/speech.ts`

**Intent**: Report playback failures arriving through `onError`.

**Contract**: Report at the `handlers.onError` call sites, carrying
`event.error`. The user-facing message is unchanged.

### Success Criteria (Automated):

- Both apps' tests, lint, build
- New test: a `loadVoices` rejection reports and does not present as
  "no voice installed"

---

## Phase 4: Extension popup

### Changes Required:

**File**: `extension/src/messages.ts`

**Intent**: A report channel from popup to background.

**Contract**: New `{ type: 'report-error', report: {...} }` member plus its
`MessageResults` entry. The popup never posts to the backend directly.

**File**: `extension/src/background.ts`

**Intent**: Handle the new message by delegating to the existing reporter.

**Contract**: One `case` in `run()`; reuses `report()` unchanged.

**File**: `extension/src/popup/main.tsx`

**Intent**: Install global handlers, mirroring `frontend/src/main.tsx`.

**Contract**: `error` + `unhandledrejection` listeners routing through
`sendMessage`. Must not throw if the background is unreachable — that is the
very failure being reported.

**File**: `extension/src/popup/App.tsx`

**Intent**: Report the two degraded-AI-result cases.

**Contract**: At `:279` and `:481`, report alongside the existing `setError`.
These are HTTP 200 responses, so nothing else can see them; `lessons.md`
measured ~9%. User-facing text unchanged.

### Success Criteria (Automated):

- Extension tests, lint, build
- New test: a popup-side failure reaches the background reporter
- New test: reporting failure does not break the popup's own error display

---

## Phase 5: Backend correlation gaps

### Changes Required:

**File**: `backend/src/plugins/error-handler.ts`

**Intent**: Add `setNotFoundHandler` so 404s produce a structured line, and
process-level handlers so a boot failure or floating rejection is not a raw
stack.

**Contract**: 404 logs at `warn` with the same context shape and returns the
same body plus `requestId` — today Fastify's default sends a plain object, not
an Error, so it bypasses `setErrorHandler` entirely and returns an
`x-request-id` matching nothing. `process.on('unhandledRejection' |
'uncaughtException')` logging through the Fastify logger.

**Files**: `backend/src/routes/api/collections/index.ts`,
`backend/src/routes/api/autohooks.ts`

**Intent**: Move the two root-logger calls onto `request.log` so the line
carrying the cause carries the correlation id too.

**Contract**: `fastify.log.error({ err }, 'anthropic translate call failed')` →
`request.log`. Same at `autohooks.ts:24`. This is the break in the chain: the
502 has the id and a generic message; the cause has the detail and no id.

### Success Criteria (Automated):

- `cd backend && npm test`
- New test: a 404 produces a structured line whose `requestId` matches its
  `x-request-id`
- New test: the AI-failure line carries a correlation id

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: The auth blind spot

#### Automated

- [x] 1.1 Frontend tests, lint, build pass
- [x] 1.2 Rejected `signinSilent` produces exactly one report
- [x] 1.3 `addSilentRenewError` produces a report

### Phase 2: Error boundary

#### Automated

- [x] 2.1 Throwing child renders fallback and reports once
- [x] 2.2 Frontend tests, lint, build pass

### Phase 3: Speech, both apps

#### Automated

- [x] 3.1 Both apps' tests, lint, build pass
- [x] 3.2 `loadVoices` rejection reports and is distinguishable from "no voice"

### Phase 4: Extension popup

#### Automated

- [x] 4.1 Extension tests, lint, build pass
- [x] 4.2 Popup-side failure reaches the background reporter
- [x] 4.3 Reporting failure does not break the popup's error display

### Phase 5: Backend correlation gaps

#### Automated

- [x] 5.1 Backend suite passes
- [x] 5.2 404 line's `requestId` matches its `x-request-id`
- [x] 5.3 AI-failure line carries a correlation id
