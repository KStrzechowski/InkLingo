# CI/CD Code Review Workflow — Plan Brief

> Full plan: `context/changes/ci-cd-code-review/plan.md`
> Research: `context/changes/ci-cd-code-review/research.md`

## What & Why

Wire the already-built `packages/code-reviewer` agent into GitHub Actions: adding the `ai-cr:review` label to a PR runs a composite action that scores the diff against six rubric criteria, posts a PR comment with the result, and sets `ai-cr:passed`/`ai-cr:failed` — without ever gating merge, so no PR incurs OpenRouter cost unless someone deliberately asks for a review.

## Starting Point

`packages/code-reviewer` typechecks clean, is unit-tested with zero network cost, and exports a directly-importable `createCodeReviewAgent()` — but has never made a live model call and has no CI wiring at all. This repo has exactly two workflows, both plain build/test/diff pipelines with zero precedent for PR comments, label automation, or composite actions.

## Desired End State

A reviewer (or the PR author) adds `ai-cr:review` to a PR; within a few minutes a comment appears with all six scored criteria, a summary, and a pass/fail verdict, and the matching label lands. Removing and re-adding the label re-runs the review and updates the same comment in place instead of piling up duplicates. The check is visible but never blocks merge.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Agent invocation | Direct import (`createCodeReviewAgent`) via a small `tsx` entrypoint | Avoids a diff-file round-trip through the CLI; PR metadata comes structured from the event payload | Plan (post user input) |
| Comment/label API | `actions/github-script` (Octokit) | No shell-escaping of a multi-paragraph markdown body; runs in-process | Plan (post user input) |
| Composite action contract | Workflow fetches PR data, action just receives inputs | Keeps the action a pure, reusable input→output unit, all GitHub API calls stay in the workflow | Plan (post user input) |
| Job status on `fail` verdict | Job itself turns red (`exit 1`), still not a required check | User chose visibility over the safer-by-default "always green" option; mitigated by never registering it on the `PR-Needed` ruleset | Plan (user decision, non-default) |
| Retry comment behavior | Upsert a single comment via a hidden marker | Removing/re-adding the label is the documented retry mechanism — must not spam the PR thread | Plan (post user input) |
| Diff scope | Filter out lockfiles/generated paths before sending to the model | Keeps cost proportional to the human-authored change, matching the repo's cost-conscious CI philosophy | Plan (post user input) |
| Trigger scope | Label-gated (`ai-cr:review` added), not automatic-on-every-PR | Repo policy: never spend real API money in CI automatically; recorded deviation from the course template | Requirements |
| Required-check registration | Explicitly **not** added to the `PR-Needed` ruleset | A label-gated job as a required check would permanently block every unlabeled PR | Research |

## Scope

**In scope:** CI entrypoint script + formatter (with unit test) in `packages/code-reviewer`; `.github/actions/code-review/action.yml` composite action; `.github/workflows/code-review.yml`; label creation/swap, comment upsert, diff filtering, job-status reflection.

**Out of scope:** promptfoo evals/multi-model comparison (m5l3's own scope), auto-retry on agent failure, automatic-on-every-PR trigger, registering the job as a required check, any review-history UI beyond the PR comment/labels.

## Architecture / Approach

Three layers, each owning one concern: (1) `packages/code-reviewer/src/ci-review.ts` + `format-review-comment.ts` — env-var-driven entrypoint and pure markdown formatter, unit-tested, zero GitHub awareness; (2) `.github/actions/code-review/action.yml` — thin composite action, `npm ci` + run the entrypoint, exposes `recommendation`/`comment-file` outputs, no GitHub API calls; (3) `.github/workflows/code-review.yml` — all GitHub-specific orchestration: label filtering, diff fetch/filter, calling the action, comment upsert, label swap, final job status.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. CI entrypoint (`packages/code-reviewer`) | Env-driven script + tested comment formatter | None — pure logic, fully unit-testable |
| 2. Composite action | Thin `npm ci` + entrypoint wrapper, file-based outputs | Untestable standalone — verified together with Phase 3 |
| 3. Workflow | Trigger filter, diff fetch/filter, comment upsert, label swap, job status | Untrusted PR content (title/description/diff) must never hit a `run:` script body directly — script-injection risk if this slips |

**Prerequisites:** `OPENROUTER_API_KEY` repo secret (and optionally `OPENROUTER_MODEL` repo var) before Phase 3's live verification.
**Estimated effort:** Phase 1 is a short session (new files + one test); Phases 2–3 are one focused session each, with Phase 3's live trigger blocked on the user's explicit go-ahead to spend.

## Open Risks & Assumptions

- The job turning red on a `fail` verdict (user's deliberate choice over the "always green" default) relies entirely on the `PR-Needed` ruleset never gaining this job as a required context — a future contributor adding it "for consistency" would silently make every PR require a label-gated review to merge.
- `gh pr diff` doesn't support pathspec filtering, so lockfile/generated-path exclusion is done by parsing diff-header boundaries (`awk`-style) rather than a `git diff` pathspec — correct today, but the exclusion pattern needs updating if new generated-path conventions are added later.
- No Actions/YAML linter exists in this repo, so Phases 2–3 have no automated verification beyond Phase 1's `typecheck`/`test` — correctness is confirmed only by the live, cost-incurring manual trigger.

## Success Criteria (Summary)

- Adding `ai-cr:review` to a PR produces a correctly formatted comment and matching label; an unrelated label addition produces nothing.
- Removing and re-adding the label updates the same comment rather than duplicating it.
- The job is visibly not a required/blocking check, confirmed both by workflow design and by absence from the `PR-Needed` ruleset.
