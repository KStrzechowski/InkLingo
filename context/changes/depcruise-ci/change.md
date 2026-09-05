---
change_id: depcruise-ci
title: Wire dependency-cruiser into CI
status: impl_reviewed
created: 2026-09-05
updated: 2026-09-05
archived_at: null
---

## Notes

Wire the existing dependency-cruiser rules (`.dependency-cruiser.cjs`) into CI —
currently correct but enforced in no layer (C-12 from
`context/changes/refactor-opportunities/research.md` § 5, a ranked opportunity
named alongside C-08 as an already-built, already-correct mechanism that is
simply switched off).

Scope: add a step running `node scripts/depcruise.mjs` into both
`.github/workflows/pr-diff.yml`'s and `.github/workflows/deploy.yml`'s `diff`
jobs, after the extension step — per `research.md`'s feasibility note, that's
the point where all four apps' `node_modules` are installed, the pass takes
~17s, needs no credentials/DB/browsers, and is purely additive and deletable.
`deploy.yml` was folded in during planning (its `diff` job is an exact
structural mirror of `pr-diff.yml`'s, per its own comments) rather than left to
drift out of sync. A violation also fails the check hard immediately (no
warn-only trial period — the rules already pass clean today) and, on failure,
appends its output to `$GITHUB_STEP_SUMMARY`, mirroring the existing "Diff"
step's pattern.

**Plan review (`reviews/plan-review.md`) found the cruise does not actually
pass clean on `main`** — a pre-existing `no-circular` violation between
`backend/src/domain/translationDraft.ts` and `backend/src/domain/translator.ts`,
introduced by the `anti-corruption-layer`/`invariant-aggregate-refactor` work
after `research.md`'s verification commit. Fixed by adding a new Phase 1
(extract the error classes into `translatorErrors.ts`, verified empirically to
resolve the cycle) ahead of the original CI-wiring phase, now Phase 2.

Chosen deliberately as the smallest already-scoped `refactor-opportunities`
candidate — not the top-ranked item (C-01, response contracts) — to serve as a
real, bounded change run end-to-end through `/10x-goal-implement` (Module 5
Lesson 5 exercise).
