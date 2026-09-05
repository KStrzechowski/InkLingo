# Wire dependency-cruiser into CI — Plan Brief

> Full plan: `context/changes/depcruise-ci/plan.md`
> Research: `context/changes/refactor-opportunities/research.md` (§5.1 C-12, §5.2, §4)

## What & Why

`.dependency-cruiser.cjs` already declares every cross-app boundary rule this repo cares about, at `severity: error`, each verified by deliberate break. None of it runs anywhere — no CI workflow, no git hook. This plan adds one CI step that runs the existing `scripts/depcruise.mjs` wrapper, turning an already-correct, already-verified mechanism that nothing invokes into an actual gate.

## Starting Point

`pr-diff.yml`'s and `deploy.yml`'s `diff` jobs both build and test all four apps but never run dependency-cruiser. The earliest point either job has all four apps' `node_modules` installed is right after the "Run extension tests" step.

**Plan review found the cruise does not pass clean on `main` today**: a `no-circular` violation between `backend/src/domain/translationDraft.ts` and `backend/src/domain/translator.ts`, introduced by the `anti-corruption-layer`/`invariant-aggregate-refactor` work after the source research was verified. It's not a real runtime cycle — one leg is a type-only import, deliberately — but `dependency-cruiser` counts type-only edges too, so it reads as one. Phase 1 fixes it at the source (verified empirically during review) before Phase 2 turns the gate on, so it starts green.

## Desired End State

Both `diff` jobs run `node scripts/depcruise.mjs` right after "Run extension tests." A boundary violation fails the job the same way a failing test does today, and on failure the cruise output is also appended to the run's `$GITHUB_STEP_SUMMARY`, matching the existing "Diff" step's pattern.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Which workflow(s) | Both `pr-diff.yml` and `deploy.yml` | `deploy.yml`'s `diff` job is an exact structural mirror per its own comments; leaving it out would let the two drift | Plan |
| Gate strictness | Hard fail immediately, no warn-only trial | Rules already pass clean today (research confirms it) — a gate that can't fail is the C-08 vacuous-pass failure mode this repo's lessons.md already warns about | Plan |
| Visibility on failure | Also write to `$GITHUB_STEP_SUMMARY` | Boundary violations are exactly the kind of thing worth surfacing on the PR page, not buried in a step log | Plan |
| Local hook (pre-push) | Out of scope, deferred | Research's own note: "promote to pre-push if it starts catching things" — CI-only for now | Research |
| Placement in job | Immediately after "Run extension tests" | First point where all four apps' `node_modules` exist, which `scripts/depcruise.mjs` needs to see cross-app edges | Research |
| Pre-existing violation | Fix at the source (extract error classes), not a config exception | A tested config filter didn't work; a path-scoped rule exclusion would permanently blind `no-circular` to these two files, the same failure class this change closes | Plan review |

## Scope

**In scope:**
- One new step (plus a failure-path summary-write step) in `pr-diff.yml`'s `diff` job
- The identical pair of steps in `deploy.yml`'s `diff` job
- A local deliberate-break-and-revert proving the gate actually gates before it ships

**Out of scope:**
- Any change to `.dependency-cruiser.cjs` rules themselves (none needed — nothing violates them today)
- Any change to `scripts/depcruise.mjs` (its default `err-long` output is already right)
- Wiring into `.githooks/pre-push` or any local hook
- Any `PR-Needed` ruleset / branch-protection change (the step rides inside a job that's already required)

## Architecture / Approach

Both jobs already install all four apps' dependencies over the course of earlier steps (backend, infra, frontend, extension, in that order). The new step is a plain `run: node scripts/depcruise.mjs` from the checkout root — no `working-directory:` override, since the script resolves its own repo root. A second step, gated on `if: failure()`, re-runs the same command and appends its output to `$GITHUB_STEP_SUMMARY` under a `## Dependency Cruise` heading.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Break the pre-existing domain cycle | Extract 3 error classes out of `translator.ts` into a new `translatorErrors.ts`; verbatim move, no behavior change | Low — verified empirically during review (exit 0), backend's own tests + typecheck are the safety net |
| 2. Wire the cruise into both CI workflows | New step (+ failure-summary step) in both `diff` jobs, verified locally via break-and-revert | Low — additive YAML-only change; the break-and-revert proves the wiring before any real CI run |

**Prerequisites:** None — `.dependency-cruiser.cjs` and `scripts/depcruise.mjs` already exist; Phase 1 clears the one thing standing between "exists" and "passes clean."
**Estimated effort:** One short session, two small phases.

## Open Risks & Assumptions

- Research's "rules pass clean" claim was true as of its 2026-08-23 verification commit but is no longer true against current `main` — Phase 1 exists because of that drift, not because research was wrong at the time.
- `deploy.yml`'s `diff` job change is additive scope beyond `change.md`'s original one-workflow framing, added deliberately during planning for symmetry — flagged here rather than silently expanding scope.
- Phase 1's fix is verified structurally (import graph) and by re-running the backend suite/typecheck as its own success criteria, but was not separately fuzzed beyond that — low risk given it is a verbatim move with no logic change.

## Success Criteria (Summary)

- Phase 1: `node scripts/depcruise.mjs` exits 0, backend typecheck and test suite pass unchanged.
- Phase 2: both workflow files stay valid YAML after the edit, and a deliberately introduced cross-app import fails the cruise (naming `no-cross-app-imports`) with a clean revert.
- The next real PR and the next push to `main` both show the new step passing in their respective `diff` jobs.
