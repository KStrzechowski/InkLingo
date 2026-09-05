<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: AI Toolkit Package (GitHub Packages) Implementation Plan

- **Plan**: context/changes/ai-toolkit-package/plan.md
- **Scope**: Phase 1 of 4
- **Date**: 2026-09-05
- **Verdict**: REJECTED at time of review; both findings fixed same session — see Decisions below
- **Findings**: 1 critical, 1 warning, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Root `.gitignore`'s blanket `CLAUDE.md` pattern silently excludes the shipped rules fragment from git

- **Severity**: CRITICAL
- **Impact**: LOW — fix is a one-line, well-understood `.gitignore` negation
- **Dimension**: Safety & Quality
- **Location**: `.gitignore:9`, `packages/ai-toolkit/rules/CLAUDE.md`
- **Detail**: Root `.gitignore:9` is a bare, unanchored `CLAUDE.md` pattern, which matches any file named `CLAUDE.md` anywhere in the repo tree, not just the project-root or `.claude/` copies it was presumably written for (confirmed by `git log -- CLAUDE.md` showing a prior "Remove CLAUDE.md" commit, and by `git ls-files | grep -i claude` returning nothing — those files are deliberately untracked). `packages/ai-toolkit/rules/CLAUDE.md` — the exact file Phase 1's contract requires and `install.js` (Phase 2) will read at runtime — matches the same pattern and is therefore untracked by git (`git status --porcelain` on `packages/ai-toolkit/rules/` returns nothing, even though the file exists on disk and every sibling file in the same commit's changeset shows as untracked `??`). `npm pack --dry-run` still includes it (1.1 passed) only because npm consults `packages/ai-toolkit/.gitignore`, not the repo root's — so this bug is invisible to every Phase 1 automated check. The real failure surfaces in Phase 3/4: `actions/checkout` in CI populates the working tree from tracked git content only, so the `publish` job's `npm publish` would ship a package **silently missing `rules/CLAUDE.md`**, breaking `install.js`'s rules-fragment injection for every real consumer, while every CI check still shows green.
- **Fix A ⭐ Recommended**: Add a negation to root `.gitignore` scoped to this file: `!/packages/ai-toolkit/rules/CLAUDE.md` (or `!/packages/**/rules/CLAUDE.md` if more packages will ship a rules fragment later).
  - Strength: One-time fix, durable — every future edit to this file gets tracked and committed normally, no special-casing needed at commit time.
  - Tradeoff: Widens the gitignore's exception list by one line; needs a one-line comment so a future reader understands why a `CLAUDE.md` is intentionally tracked here.
  - Confidence: HIGH — negation patterns after a broader ignore rule are standard, well-supported git behavior, and no parent directory of this path is separately ignored (only the bare filename matches), so the negation isn't shadowed.
  - Blind spot: None significant.
- **Fix B**: Force-add the file at each commit ritual step (`git add -f packages/ai-toolkit/rules/CLAUDE.md`) instead of touching root `.gitignore`.
  - Strength: Leaves the repo-wide gitignore semantics untouched.
  - Tradeoff: Fragile — every future phase/maintenance commit touching this file must remember the `-f` flag; the plan's own commit ritual explicitly stages "by path" with plain `git add`, so this file would need a standing exception documented somewhere or it silently drops out of every future commit again.
  - Confidence: MEDIUM — works today, but depends on every future contributor (human or agent) remembering the special case.
  - Blind spot: Haven't checked whether any other planned file in this package could hit the same pattern later.
- **Decision**: FIXED (Fix A) — added `!/packages/ai-toolkit/rules/CLAUDE.md` to root `.gitignore`, confirmed via `git status` that the file now shows as trackable.

### F2 — Unplanned `packages/ai-toolkit/.gitignore` file

- **Severity**: WARNING
- **Impact**: LOW — quick decision; addition is small and benign
- **Dimension**: Scope Discipline
- **Location**: `packages/ai-toolkit/.gitignore`
- **Detail**: Phase 1's "Changes Required" lists exactly 5 files (`package.json`, `pack.yaml`, `README.md`, `skills/code-review/SKILL.md`, `rules/CLAUDE.md`). A 6th file, `packages/ai-toolkit/.gitignore` (`node_modules/`), was added and isn't mentioned in the plan text, though it mirrors `packages/code-reviewer/.gitignore`'s existing convention (cited in `research.md` as a pattern to follow) and Phase 2 will need it once `npm install`/`npm test` can produce a `node_modules/` directory.
- **Fix**: No code change needed — note the addition in the plan as a small addendum (e.g. a one-line mention under Phase 1's file list), so the plan stays an accurate record of what shipped.
- **Decision**: FIXED — added as item 5 (`#### 5. Package-local gitignore (addendum, added during implementation)`) in Phase 1's "Changes Required" section of `plan.md`, renumbering the original item 5 (rules fragment) to item 6.
