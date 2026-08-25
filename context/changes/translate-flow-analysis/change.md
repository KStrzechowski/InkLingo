---
change_id: translate-flow-analysis
title: Analysis of the capture → translate → save flow across all four apps
status: preparing
created: 2026-08-20
updated: 2026-08-20
archived_at: null
---

## Notes

Analysis-only change. No implementation is planned under this id — it exists to
hold `research.md`, a current-state description of the repo's north-star flow
(S-03 `capture-translate-save`, archived 2026-08-02) as it stands today, after
S-04, S-05 and the four testing slices have landed on top of it.

Scope framed by `context/map/repo-map.md` (2026-08-18): the flow crosses all
four apps and three of its hops have **no import edge**, so they are recorded
as `[unknown]` there. This research carries those forward as real couplings
rather than treating them as uncoupled.

Deliverables asked for: an E2E trace with file:line and a Mermaid diagram, a
test-coverage/gap map, a blast-radius map combining the static import graph
with git co-change, plus explicit **Feature overview** and **Technical debt**
sections.

Related:

- `context/archive/2026-07-25-capture-translate-save/` — the change that built it
- `context/changes/translation-pivot/` — parked re-architecture of the same path
- `context/changes/translation-cache/` — superseded, its `research.md` still valid
