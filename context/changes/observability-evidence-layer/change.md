---
change_id: observability-evidence-layer
title: Structured error evidence across backend, frontend, and extension
status: implemented
created: 2026-08-14
updated: 2026-08-14
archived_at: null
---

## Notes

backend error handler with structured logging, plus error reporting from frontend and extension, so debugging has real evidence (M3L5)

Motivation (M3L5, "Debugging with AI"): the lesson's workflow converges evidence
from four sources — production monitoring, application logs, a Playwright
reproduction, and the code. This repo has two of them. There is no monitoring
service wired anywhere; the backend has no `setErrorHandler`, so failures reach
Fastify's default logger and nowhere durable; and `extension/src/background.ts:81`
is the only `console.error` in the three apps, so a frontend or extension failure
in the wild leaves no trace at all.

Audit finding worth keeping: swallowed errors are *not* a problem here. Every
`catch` in `backend/src`, `frontend/src`, `extension/src` either surfaces to the
UI (`setError` / `setLoadError`) or returns a deliberate, commented fallback
(`printLabels.ts`, `printRows.ts`, `extension/src/auth.ts`). The one bare catch
(`extension/src/background.ts:22`) documents why. The gap is durable capture,
not error handling.
