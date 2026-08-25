---
change_id: observability-coverage-gaps
title: Close the failure surfaces the evidence layer cannot see
status: archived
created: 2026-08-14
updated: 2026-08-23
archived_at: 2026-08-23T21:25:43Z
---

## Notes

Direct follow-up to `observability-evidence-layer`, archived 2026-08-14. Its
`/10x-research` sweep found that the layer covers exactly two boundaries — the
network boundary (axios / `apiFetch`) and the JS-engine boundary (`window`
error/rejection) — and that everything failing through a *callback*, a *state
setter*, or *inside a document with no handlers* is structurally invisible.
That is a coherent shape, not a random set of holes, which is why this is one
change rather than seven bug fixes.

Findings inherited verbatim from
`context/archive/2026-08-14-observability-evidence-layer/research.md` §2–§4.
Do not re-derive them; that document is the evidence.

Scope decision (2026-08-14): the full backlog, error boundary included. The
boundary is the one architectural item — react-router 8's declarative `<Routes>`
means `errorElement` is not wireable, so it needs a class component.

Deliberately NOT here: IL-25's broader technical debt (auth ×3, dev DB). That
is M4L3/L4 material — those lessons produce a tech-debt report and a defended
refactoring decision, and doing it by hand now would duplicate them.
