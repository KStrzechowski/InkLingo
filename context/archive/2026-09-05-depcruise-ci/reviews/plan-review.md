<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Wire dependency-cruiser into CI

- **Plan**: context/changes/depcruise-ci/plan.md
- **Mode**: Deep
- **Date**: 2026-09-05
- **Verdict**: REVISE (findings applied — see Decision below; plan now reflects the fix)
- **Findings**: 1 critical, 0 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | PASS |

## Grounding

6/6 paths ✓ (`.github/workflows/pr-diff.yml`, `.github/workflows/deploy.yml`, `scripts/depcruise.mjs`, `.dependency-cruiser.cjs`, `frontend/src/main.tsx`, `backend/src/app.ts`), 3/3 symbols ✓ ("Run extension tests" step name in both workflows, `$GITHUB_STEP_SUMMARY` pattern, `no-cross-app-imports` rule name), brief↔plan ✓.

## Findings

### F1 — The gate is already red on main

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Success Criteria 1.1 / plan's core premise (pre-fix)
- **Detail**: Ran `node scripts/depcruise.mjs` against current `main` — exits 1, not 0. `no-circular` violation: `backend/src/domain/translationDraft.ts → backend/src/domain/translator.ts → backend/src/domain/translationDraft.ts`. `translationDraft.ts` imports the value classes `DegenerateDraftError`/`MalformedDraftError` from `translator.ts` (a real runtime edge); `translator.ts` imports `TranslationDraft`/`DraftSenseTranslation`/`RequestedLanguages` from `translationDraft.ts` type-only (erased at runtime, deliberately per that file's own comment). `tsPreCompilationDeps: true` makes the cruiser count the type-only leg as a graph edge too, so the pair reads as a cycle though there is no runtime cycle. Landed via `anti-corruption-layer`/`invariant-aggregate-refactor` (2026-08-23 onward), after `refactor-opportunities/research.md`'s verification commit — neither the research nor the original plan could have known. Landing the CI wiring as originally written would fail the very first run, for a reason unrelated to that run's actual diff — directly falsifying Success Criteria 1.1 and the "hard fail immediately" decision's stated rationale.
- **Fix A ⭐ Recommended**: Extract the three error classes into `backend/src/domain/translatorErrors.ts` (with `translator.ts` re-exporting them so `anthropicTranslator.ts`'s import needs no change); `translationDraft.ts` imports the two it throws from the new module instead.
  - Strength: Fixes the actual root cause; verified empirically (edit → `node scripts/depcruise.mjs` → exit 0 → revert) rather than reasoned from memory. Keeps `.dependency-cruiser.cjs` untouched.
  - Tradeoff: Expands blast radius from "CI config only" to "one small domain refactor + CI config" — 3 files, zero behavior change.
  - Confidence: HIGH — reproduced live against real `main`.
  - Blind spot: Not run through `npm test`/`tsc` at review time (only import-graph reachability checked) — folded into Phase 1's own Success Criteria so this gets covered at implementation time.
- **Fix B**: Scope a narrow exception in `.dependency-cruiser.cjs`.
  - Strength: Keeps the change to CI/config surface only.
  - Tradeoff: The obvious filter (`dependencyTypesNot: ['type-only']` on the circular rule) was tested and does **not** suppress this violation — the reported edge is the non-type-only one. Only a path-scoped exclusion naming these two files would work, and that permanently blinds `no-circular` to any future cycle where either file is the entry point — a narrower version of the exact "quality gate that can silently not run" failure this change exists to close.
  - Confidence: MEDIUM — the tested filter is confirmed dead; an untested path-scoped exclusion would probably work but wasn't built, since Fix A dominates.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A — applied to plan.md as new Phase 1; Phase 2 renumbered from the original Phase 1)
