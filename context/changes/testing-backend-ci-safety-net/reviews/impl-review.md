<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Backend CI Safety Net Implementation Plan

- **Plan**: context/changes/testing-backend-ci-safety-net/plan.md
- **Scope**: Full plan (Phases 1-4 of 4)
- **Date**: 2026-08-05
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — route-reachability.test.ts has a silent-false-negative surface

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: backend/test/route-reachability.test.ts
- **Detail**: The check's regex extractors correctly round-trip every route in the codebase today (verified live by both the plan's own manual proof and this review's sub-agent). But they only recognize two literal shapes: `fastify.get/post/...('/path', ...)` on the backend side and `addRoutes({ path: '...', methods: [...] });` on the gateway side. A route registered via `fastify.route({ method, url })`, a computed/template-literal path, or a reformatted `addRoutes` call would be invisible to *both* extractors — meaning it would appear in neither set and the test would report a clean match (green) while the route is genuinely unregistered with the gateway. That is exactly the failure class this check exists to catch, so the blind spot matters more than a typical parsing edge case would.
- **Fix A ⭐ Recommended**: Add a code comment stating the two literal patterns the check depends on (mirroring the existing `autohooks.ts`-exclusion comment style), plus a tripwire assertion like `assert.ok(backendRoutes.size >= 8)` so a silent drop in extracted routes (not just a mismatch) fails loudly.
  - Strength: Cheap, ships today, makes the check's actual coverage boundary an explicit, visible invariant instead of an implicit one — the next person touching route registration style sees the constraint before hitting it blind.
  - Tradeoff: Doesn't close the gap, just documents and partially trips on it — a genuinely non-literal route registration still wouldn't be caught by name.
  - Confidence: HIGH — the current codebase has zero non-literal registrations, so this is purely forward-looking risk, not a live bug.
  - Blind spot: If the count-based tripwire's threshold isn't updated when a *legitimate* route is added, it'll never fail (only catches drops below the floor, not new-but-unlinked routes).
- **Fix B**: Migrate to a lightweight AST parser (e.g. `ts-morph`, already compatible with this project's TypeScript tooling) instead of regex.
  - Strength: Closes the blind spot structurally — any route-registration call shape is caught by walking the actual AST, not string-matching a convention.
  - Tradeoff: New dependency, more code, and the plan explicitly chose static-regex-comparison over an AST/cdk-synth approach for speed and simplicity — this reopens a decision made deliberately during planning (see plan.md Phase 3 questioning round).
  - Confidence: MEDIUM — right long-term, but not clearly worth it while every real route uses the literal form.
  - Blind spot: Haven't measured how much slower an AST walk would be inside `npm test`'s existing budget.
- **Decision**: FIXED via Fix A — added a comment documenting the two literal patterns the check depends on, and strengthened the `> 0` tripwires to `>= MIN_EXPECTED_ROUTES` (8) on both sides.

### F2 — Neon ephemeral branch names aren't collision-proof across re-runs

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/pr-diff.yml (branch_name: `pr-${{ github.event.number }}-${{ github.run_id }}`), .github/workflows/deploy.yml (branch_name: `deploy-${{ github.sha }}`)
- **Detail**: `github.run_id` is stable across a manual "re-run" of the same workflow run, and `github.sha` is stable if a failed `deploy.yml` run is re-run on the same commit. If a prior run's delete-branch step never completed (crash, force-cancel), a re-run's create-branch step would collide with the still-existing orphaned branch and fail outright, rather than degrading gracefully.
- **Fix**: Append `github.run_attempt` to both branch-name expressions (e.g. `deploy-${{ github.sha }}-${{ github.run_attempt }}`).
- **Decision**: FIXED — appended `github.run_attempt` to both the create-branch `branch_name` and delete-branch `branch` fields in both workflow files (four sites total, so create/delete stay in sync).

### F3 — test-plan.md §5 row is stale after the deploy.yml amendment

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md:120
- **Detail**: The "backend unit + integration (`npm test`)" row's Where column still reads "…`deploy.yml` still never runs it," and the Required? column still says "needs `NEON_API_KEY`/`NEON_PROJECT_ID` repo secrets and a required-status-check rule…(pending)." Both were accurate when Phase 4 was originally written (pr-diff.yml-only, secrets not yet added), but Phase 3 was later amended mid-implementation to also wire `deploy.yml`, and the secrets were confirmed added and proven working on a real push to `main`. Phase 4's own stated intent was "accurately describe what shipped" — this row no longer does.
- **Fix**: Update the Where column to state both workflows run it, and the Required? column to reflect that secrets are in place and `deploy.yml` self-enforces via `needs: diff` (branch protection on `pr-diff.yml` remains the only piece dependent on repo Settings, per the plan's own Phase 3 note).
- **Decision**: FIXED — rewrote the row's Where and Required? columns to reflect both workflows running tests, secrets being confirmed added, and the live push-to-main proof.

### F4 — schemas.ts excluded by absence, not by name

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: backend/test/route-reachability.test.ts (walkRouteFiles function)
- **Detail**: `autohooks.ts` is explicitly excluded by filename; `backend/src/routes/api/collections/schemas.ts` is not, and is currently skipped only because it contains zero `fastify.get/post(...)` call patterns today. If it never breaks (a stray matching string, e.g. inside a comment, would cause a loud false failure, not a silent pass), so this is a maintenance nuisance rather than a safety hole — but it's an inconsistency with the explicit-exclusion pattern already established for autohooks.ts.
- **Fix**: Add `schemas.ts` (or a more general `!== 'schemas.ts'` / suffix check) to the same exclusion condition as `autohooks.ts`, for symmetry and to make the invariant explicit.
- **Decision**: FIXED — replaced the single-filename check with a `NON_ROUTE_FILES` set containing both `autohooks.ts` and `schemas.ts`.
