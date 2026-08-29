<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Extension HTTP Seam

- **Plan**: context/changes/extension-http-seam/plan.md
- **Scope**: Phase 1 of 3, Phase 2 of 3, Phase 3 of 3 (full plan)
- **Date**: 2026-08-29
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Stale "not yet wired" comment in http.ts

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: extension/src/http.ts:1-3
- **Detail**: The module header still reads "see extension-http-seam's Phase 3 for the migration. Not yet wired to anything in this phase." That was accurate when `http.ts` was introduced in Phase 2 (5491ad9), but Phase 3 (9286fcc) wired `doFetch` into `background.ts`'s `apiFetch`. The comment is now factually wrong and could mislead a future reader into thinking `doFetch` is still dead code.
- **Fix**: Update the header comment to state the module is wired into `background.ts`'s `apiFetch`, dropping the "not yet wired" clause.
- **Decision**: FIXED

### F2 — Stray untracked JSON files at repo root

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: translate_response.json, translate_response_2.json (repo root)
- **Detail**: Leftover from the Phase 3 manual Firefox smoke test (translate against a real collection). Untracked, not part of any commit, not in the plan's file list — not implementation drift, but stray debug artifacts sitting at repo root. Currently in active use for a separate regenerate-bug investigation the user is pursuing, so deletion isn't necessarily wanted yet.
- **Fix**: Remove once no longer needed for the regenerate-bug investigation, or move into a scratch/ignored location if they'll be regenerated repeatedly during manual testing.
- **Decision**: SKIPPED — still in use for the regenerate-bug investigation

### F3 — Minor duplication between backgroundHarness.ts and webext.ts's storage.local fake

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: extension/test/helpers/backgroundHarness.ts:29-34 vs extension/test/helpers/webext.ts:75-80
- **Detail**: ~6 lines of duplicated `storage.local.get` guard/lookup logic between the two fakes. Each needs genuinely different wiring beyond that (onMessage.addListener capture vs. sendMessage dispatch; remove() support vs. not), so extracting a shared low-level storage fake would add indirection for a small saving.
- **Fix**: No action needed — flagged for visibility only; not worth extracting.
- **Decision**: SKIPPED — accepted, extraction not worth the added indirection
