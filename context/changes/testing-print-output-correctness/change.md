---
change_id: testing-print-output-correctness
title: Print output correctness — catch print/A4 regressions without a manual preview
status: implementing
created: 2026-08-10
updated: 2026-08-10
archived_at: null
---

## Notes

Rollout Phase 4 of `context/foundation/test-plan.md`: "Print output correctness".

**Risk covered — #2:** a print/A4 export regresses silently after a CSS or
component change (broken pagination, wrong colors under dark-mode OS
preference, or content clipped outside the printable area).

**Test types planned:** deterministic visual diff/snapshot, manual print
spot-check.

**Risk response intent:** prove the print view keeps A4-safe geometry,
black-on-white color, and header/row integrity across a CSS or component
change, in both light and dark OS theme. "Looks right on screen" proves
nothing here — the global stylesheet actively overrides colors and layout for
print. Avoid a snapshot test that merely locks in the current,
possibly-still-wrong layout with no independent check against real A4 output.
