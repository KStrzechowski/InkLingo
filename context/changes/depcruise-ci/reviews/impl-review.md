<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Wire dependency-cruiser into CI

- **Plan**: context/changes/depcruise-ci/plan.md
- **Scope**: Phase 1 and Phase 2 (both complete)
- **Date**: 2026-09-05
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Verification performed

- `node scripts/depcruise.mjs` on current `main`: exit 0, "no dependency violations found (214 modules, 487 dependencies cruised)".
- `cd backend && npm run build:ts`: clean, no errors.
- `cd backend && npm test`: 205 pass, 0 fail.
- `npx -p js-yaml js-yaml` on both `.github/workflows/pr-diff.yml` and `.github/workflows/deploy.yml`: valid YAML.
- Deliberate break/revert re-run live (append a `frontend/` → `backend/` import to `frontend/src/main.tsx`): exit 1, correctly names `no-cross-app-imports`; `git checkout --` revert confirmed clean via `git status --porcelain`.
- Two sub-agents independently verified: (1) file-level plan drift for both phases — full MATCH, no unplanned files; (2) safety/quality/pattern compliance across all changed files — no CRITICAL/WARNING findings.

All automated Progress checkboxes (1.1–1.3, 2.1–2.4) are corroborated by live re-execution, not just trusted from the commit messages. The two pending Manual rows (2.5, 2.6) correctly remain unchecked — they require a real PR run and a real `main` push/deploy run, neither of which has happened yet.

## Findings

### F1 — Failure-path summary step re-runs the full cruise

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; matches an existing convention, no action required
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/pr-diff.yml` (Surface dependency-cruise violations step), `.github/workflows/deploy.yml` (same)
- **Detail**: On failure, `node scripts/depcruise.mjs` runs a second time (with `|| true`) just to capture output for `$GITHUB_STEP_SUMMARY`, doubling the ~17s cruise (plus `npx` resolution) exactly when a violation occurs. This is not a deviation — it's the same pattern the pre-existing "Diff" step already uses, which the plan explicitly said to mirror.
- **Fix**: None needed — this is the established convention in this repo's CI, not a regression introduced by this change.
- **Decision**: ACCEPTED (no fix needed — matches existing convention)

### F2 — Two import paths to the extracted error classes

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped if ever wanted
- **Dimension**: Architecture
- **Location**: `backend/src/adapters/anthropicTranslator.ts` (imports via `translator.ts`'s re-export), `backend/src/domain/translationDraft.ts` (imports directly from `translatorErrors.ts`)
- **Detail**: `translator.ts` re-exports `TranslatorUnavailableError`/`MalformedDraftError`/`DegenerateDraftError` from the new `translatorErrors.ts` specifically so `anthropicTranslator.ts` needs no change; `translationDraft.ts` was updated to import directly from the new module. Result: two valid import paths to the same three classes. This was a deliberate minimal-diff choice per the plan's own contract ("re-export instead of defining... so every existing importer needs no change"), not an oversight, and is low-risk — removing the re-export later would be a loud TS compile error, never a silent break.
- **Fix**: Optional follow-up — point `anthropicTranslator.ts` at `translatorErrors.ts` directly and drop the re-export from `translator.ts` for one consistent import path. Not blocking; the plan explicitly chose the re-export to keep Phase 1's diff verbatim.
- **Decision**: ACCEPTED (deliberate minimal-diff tradeoff per the plan; leave as-is)

### F3 — Stale comment in errors.ts references translator.ts's taxonomy

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `backend/src/domain/errors.ts:9-11`
- **Detail**: Comment reads "Deliberately separate from `translator.ts`'s taxonomy" — that taxonomy (the three error classes) now lives in `translatorErrors.ts`, not `translator.ts`. Pre-existing comment, not touched by either commit in this change, purely cosmetic drift caused by the move.
- **Fix**: Update the comment to say `translatorErrors.ts` instead of `translator.ts`.
- **Decision**: FIXED (backend/src/domain/errors.ts:9 updated)
