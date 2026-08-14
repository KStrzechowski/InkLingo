# Observability Evidence Layer — Plan Brief

> Full plan: `context/changes/observability-evidence-layer/plan.md`
> Research: `context/changes/observability-evidence-layer/research.md`

## What & Why

M3L5's debugging workflow converges evidence from four sources — production
monitoring, application logs, a Playwright reproduction, and the code. This repo
has two of them. Without the other two, every debugging session starts from a
guess instead of a signal.

## Starting Point

`backend/src/app.ts` is stock fastify-cli scaffold with no `setErrorHandler`, so
failures land in CloudWatch (1-week retention) in a shape nobody chose.
`extension/src/background.ts:81` is the only `console.error` in the three apps —
a frontend or extension failure in the wild leaves no trace at all. Swallowed
errors, the lesson's named failure mode, were audited and are **not** a problem
here: the gap is durable capture, not error handling.

## Desired End State

A failure anywhere in the three apps leaves a queryable trace. A backend 500
writes one structured line carrying route, method, status, and user id, stamped
with a request id that also came back to the client. A client-side failure —
including one that happens while the session is too dead to report — is
delivered once the session recovers, correlated to the same id.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Sink | AWS-native, no new vendor | Fits `infrastructure.md`'s self-hosted stance; CloudWatch is already receiving Lambda stdout. | Plan |
| Ingest auth | Authenticated `/api/client-errors` + client buffer | An open write endpoint is an abuse vector, but an authenticated one can't receive the dead-token report — the buffer resolves both. | Research |
| Report payload | Shape + redacted request context | Keys only, values dropped: enough to tell "translate failed" from "save failed" without user vocabulary leaving the browser. | Plan |
| Reporter failure | Buffer, then surface if it never drains | `lessons.md:61-66` — a gate that can silently not run is worse than no gate. | Plan |
| Correlation | `x-request-id` header **and** error-body field | The header covers non-JSON failures (API Gateway 404s); the body field is quotable by a user. | Plan |
| Triggers | Unhandled errors/rejections + API failures the user sees | Covers both the unanticipated class and the incidents this repo actually had. | Plan |
| Log levels | 5xx error, 4xx warn, 401 debug | Keeps a 1-week window readable — real failures aren't buried under routine token expiries. | Plan |
| Proof | Extend `frontend/e2e/reauthPrompt.spec.ts` | Proves the hardest case against a spec that already passes CI. | Plan |

## Scope

**In scope:** backend error handler + correlation id; `POST /api/client-errors`
with tested redaction; its `api-construct.ts` registration; frontend and
extension reporters with buffer/flush; an e2e proving the 2026-08-04 incident
would now be visible; the contract recorded in `AGENTS.md`.

**Out of scope:** Sentry or any third-party SDK; alarms, dashboards, alerting;
tracing, spans, metrics; retention changes; a lint rule for a problem the
codebase doesn't have; any public unauthenticated endpoint.

## Architecture / Approach

Server first, then each client, then proof. The correlation id is the spine:
`request.id` already exists, rides back on a header and in the error body, is
attached to any client report that has one, and is what joins "it broke" to a
log line. Clients report into one authenticated route; anything that can't be
sent now is buffered (`localStorage` in the frontend, `browser.storage.local` in
the extension, because Firefox destroys the popup document on focus loss) and
drained by acknowledged id on the next working request.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend error handler | Structured logs + `x-request-id` | Changing an error body a client already depends on |
| 2. Ingest route + infra | `POST /api/client-errors`, tested redaction | The `api-construct.ts` miss `lessons.md` records twice — no test can catch it |
| 3. Frontend reporter | Buffer, dedupe, flush | Read-before-`await` drain losing a mid-flush arrival |
| 4. Extension reporter | Same contract on `browser.storage.local` | Popup lifecycle destroying the buffer |
| 5. Prove it + document | E2E against the real incident | A test that passes without materializing the risk |

**Prerequisites:** none — every phase builds on code already in the repo.
**Estimated effort:** ~2 sessions across 5 phases.

## Open Risks & Assumptions

- Assumes backend tests assert `statusCode` rather than exact error-body shape
  (spot-checked, not exhaustively verified) — Phase 1 confirms before relying on it.
- The redaction rule is where the privacy promise lives; it carries its own
  tests precisely because a later change could widen it without noticing.
- 1-week CloudWatch retention bounds how far back any of this is useful.

## Success Criteria (Summary)

- A failure produces one structured, correlated log line — not a raw stack.
- A failure that happens while the session is dead still arrives after recovery.
- The Phase 5 e2e goes red when the reporter is disabled.
