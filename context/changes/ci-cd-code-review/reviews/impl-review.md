<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: CI/CD Code Review Workflow Implementation Plan

- **Plan**: context/changes/ci-cd-code-review/plan.md
- **Scope**: Phase 3 of 3 (full plan)
- **Date**: 2026-09-01
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Comment upsert matches by content only, not by author

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/code-review.yml:101
- **Detail**: The upsert step finds the comment to update with `comments.find((comment) => comment.body?.startsWith(marker))` — matching on content alone, not authorship. Any PR participant can post a comment starting with `<!-- ai-cr:review -->` and have the bot silently overwrite it with the real review on the next label cycle. Low blast radius (no data leak, no privilege escalation) but a real comment-hijack/confusion vector, and this is the repo's first comment-posting workflow — the pattern will likely get copied by future workflows if left as-is.
- **Fix A ⭐ Recommended**: Also require `comment.user.login === 'github-actions[bot]'` (the default actor for `actions/github-script` posting with `secrets.GITHUB_TOKEN`) alongside the marker check.
  - Strength: One-line change, matches the actual identity this workflow already posts under.
  - Tradeoff: Breaks silently if a future revision posts under a different token/app identity.
  - Confidence: HIGH — this is GitHub's documented default actor for `GITHUB_TOKEN`-authenticated `github-script` calls.
  - Blind spot: Not verified against a live run (no workflow trigger executed during this review).
- **Fix B**: Embed a harder-to-guess sentinel (e.g. the PR's node ID) into the marker itself.
  - Strength: Doesn't depend on runtime actor identity, more robust to future changes.
  - Tradeoff: Touches the marker contract Phase 1 locked (`format-review-comment.ts`'s exact first-line string), a bigger, coordinated change across two files for a low-severity issue.
  - Confidence: MEDIUM — untested design.
  - Blind spot: Overlaps with the "do not change this string independently" note in the plan's Phase 1 contract.
- **Decision**: SKIPPED — low probability (requires reading this repo's own source to know the marker string, no incentive for a trusted collaborator), and low blast radius even if it happened (decoy is either fully overwritten by the real comment or ignored as inert clutter; never affects labels or job status).

### F2 — LLM-generated text isn't escaped before landing in the markdown table

- **Severity**: ⚠️ WARNING
- **Dimension**: Safety & Quality
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Location**: packages/code-reviewer/src/format-review-comment.ts:13-16
- **Detail**: `criterion.reasoning` and `result.summary` — model-generated text influenced by the (attacker-controlled) diff — are interpolated directly into a markdown table row/body with no escaping. A `|` or embedded newline in that text will corrupt the rendered table. The schema only asks for short reasoning strings, so this is unlikely but unguarded, and `format-review-comment.test.ts` only exercises clean fixture text — no test covers this case.
- **Fix**: In `formatReviewComment`, sanitize `reasoning`/`summary` before interpolation — escape `|` as `\|` and collapse embedded newlines to spaces — and add a test fixture that exercises a criterion reasoning containing a pipe character.
- **Decision**: FIXED — added `escapeTableCell` helper in `format-review-comment.ts` applied to `criterion.reasoning`; added two test cases (pipe escaping, newline collapsing). `summary` left untouched since it renders outside the table, where neither `|` nor newlines are structurally unsafe.

### F3 — ci-review.ts drops index.ts's OPENROUTER_API_KEY presence check

- **Severity**: OBSERVATION
- **Dimension**: Pattern Consistency
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Location**: packages/code-reviewer/src/ci-review.ts:7-16
- **Detail**: Unlike `index.ts:18-24`, `ci-review.ts` has no explicit `OPENROUTER_API_KEY` presence check before calling `createCodeReviewAgent()`. Not a correctness bug — the OpenRouter client still fails on the real API call — but it drops the existing friendly-error-message convention, so a missing secret in CI surfaces as a less legible stack trace instead of a clear message.
- **Fix**: Mirror `index.ts`'s guard: check `process.env.OPENROUTER_API_KEY` up front and throw a clear, actionable error if absent.
- **Decision**: SKIPPED — not worth it now; the CI failure is still correctly non-zero-exit, just less pretty in the logs.
