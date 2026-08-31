---
date: 2026-08-30T20:17:57+02:00
researcher: KStrzechowski
git_commit: a5d8a03c675e07aad56f5f81318bc2f6b40495c6
branch: feat/m5-code-review-agent
repository: InkLingo
topic: "Wiring packages/code-reviewer into a label-gated GitHub Actions PR check"
tags: [research, ci-cd, github-actions, code-review, m5l3]
status: complete
last_updated: 2026-08-30
last_updated_by: KStrzechowski
---

# Research: Wiring packages/code-reviewer into a label-gated GitHub Actions PR check

**Date**: 2026-08-30T20:17:57+02:00
**Researcher**: KStrzechowski
**Git Commit**: a5d8a03c675e07aad56f5f81318bc2f6b40495c6
**Branch**: feat/m5-code-review-agent
**Repository**: InkLingo

## Research Question

Per `context/changes/ci-cd-code-review/requirements.md`: how should a new GitHub Actions workflow invoke `packages/code-reviewer` when a PR gets the `ai-cr:review` label, post a PR comment with the review summary, and set `ai-cr:passed`/`ai-cr:failed` labels — in a way that matches this repo's existing CI conventions?

## Summary

This repo has exactly two workflows (`pr-diff.yml`, `deploy.yml`), both build/test/diff pipelines with **no precedent at all** for posting PR comments, managing labels, or running on anything but `push`/`pull_request` events. There is no composite action anywhere, no `github-script`/`octokit` usage, and neither workflow even references `secrets.GITHUB_TOKEN`. This will be the first workflow of its kind in the repo — everything about label-triggered runs, PR comments, and label-setting has to be built from scratch, though the repo's conventions for *how* to structure a workflow (pinned action SHAs with version comments, `working-directory` per app, Node version choices, required-status-check registration) are well established and should be followed.

The label-gated trigger decision (already recorded in `requirements.md`) is consistent with, and directly modeled on, this repo's one existing real-money-in-CI safeguard: the backend test suite's `ANTHROPIC_API_KEY: ci-placeholder-key` pattern, which exists specifically so CI never spends real API budget on every run. That pattern was itself a deliberate, documented decision (`context/archive/2026-08-05-testing-backend-ci-safety-net/`), not an accident — this new workflow is extending the same philosophy to a second AI provider (OpenRouter) via trigger scope rather than a placeholder key, since the code-review agent's whole job *is* to make a real call when invoked.

`packages/code-reviewer/src/index.ts` currently expects a **diff file path** as a CLI arg (`tsx src/index.ts <diff-file> [pr-title] [pr-description]`) — it does not fetch anything itself. The workflow will need to materialize that diff file (e.g. via `gh pr diff <PR#>`) before invoking the CLI, or the workflow could import `createCodeReviewAgent` directly via a small Node script instead of shelling out to the CLI, avoiding an intermediate file entirely.

## Detailed Findings

### Existing CI conventions to follow

- Every `uses:` step pins a full commit SHA with a `# vX.Y.Z` trailing comment (`.github/workflows/pr-diff.yml:27-29`, `.github/workflows/deploy.yml:23-25`) — no floating tags anywhere.
- `permissions:` is declared narrowly per workflow and scoped to what that workflow actually needs (`pr-diff.yml:7-9`: `id-token: write, contents: read`). A workflow that posts comments/labels will need `pull-requests: write` (and `issues: write`, since label/comment APIs on PRs go through the Issues REST surface) — currently no workflow declares either.
- Node version is deliberately chosen per job: `24` for most jobs (matches local dev), `22` only in `deploy.yml`'s `deploy` job because it matches the Lambda runtime (`deploy.yml:210-212`). The new workflow has no Lambda constraint, so `24` is the consistent choice.
- Comments in this repo explain *why*, not *what* — e.g. `pr-diff.yml:18-23` explains the ruleset location and history, not just "this checks PRs." The new workflow should carry the same density of rationale, especially for the label-gated-not-automatic trigger decision.
- Neither existing workflow uses `secrets.GITHUB_TOKEN` — GitHub provides this automatically per-workflow-run with no setup needed; the new workflow is simply the first to need it (for posting comments/labels via the API).

### No precedent for PR comments or label automation

- Confirmed zero hits repo-wide for `github-script`, `octokit`, `gh pr comment`, `gh issue edit --add-label`, `issues.createComment`, `pulls.createReview`. The only existing PR-visible output mechanism is `$GITHUB_STEP_SUMMARY` (`pr-diff.yml:218-225`, `deploy.yml:190-196`), which is a job-summary panel, not a PR comment or a label — this new workflow needs a genuinely new mechanism (`actions/github-script` with `@actions/github`'s Octokit client, or the `gh` CLI, both already available on `ubuntu-latest` runners with no extra setup).
- No `.github/actions/` directory exists — the requirements.md's "composite action for the review itself" will be the first composite action in this repo. It should live at `.github/actions/code-review/action.yml` (the conventional location), taking PR title/description/diff as inputs and outputting the structured review result for the calling workflow to act on (post comment, set label).

### The "PR-Needed" ruleset — do NOT register this as a required check

- The ruleset is real and active: `diff` (from `pr-diff.yml`) and `print-tests` were added as required contexts on 2026-08-10 (`pr-diff.yml:18-23`), confirmed historically in `context/archive/2026-08-11-testing-frontend-extension-logic/research.md:265` and `plan.md:623`.
- Registration is manual, GitHub-UI-only — `context/archive/2026-08-05-testing-backend-ci-safety-net/plan.md:42,196,251,309` explicitly notes a repo Settings change "is not something a code change can make," and later archives (`2026-08-10-testing-print-output-correctness/plan.md:574-732`) confirm each new required job needs its own manual ruleset addition or it "gates nothing."
- **This matters directly for the new workflow**: since it only runs when the `ai-cr:review` label is explicitly added (not on every PR), it must **not** be added to the `PR-Needed` ruleset — a required check that only sometimes runs would permanently block every PR that doesn't get the label. This is a plan-level constraint, not just an implementation note.

### Secrets/variables — no naming doc, but a clear existing pattern

- No master list or naming-convention doc exists; every existing secret/var is explained only by an inline comment at its point of use (`deploy.yml:216-221` for `AWS_DEPLOY_ROLE_ARN`, `context/archive/2026-08-05-testing-backend-ci-safety-net/plan.md:23,178-180` for the secrets-vs-vars split rule: repo-level `vars`/`secrets` unless a job has its own GitHub `environment:`, in which case environment-scoped).
- `OPENROUTER_API_KEY` will be this workflow's first genuinely spend-triggering secret — unlike `ANTHROPIC_API_KEY: ci-placeholder-key`, there is no safe placeholder for it, because the workflow's entire purpose is to make the real call. The label gate is the substitute safeguard (confirmed as the deliberate, in-session design choice already recorded in `requirements.md`).

### The `ci-placeholder-key` precedent this workflow extends

- `context/archive/2026-08-05-testing-backend-ci-safety-net/research.md:57-65,64,115` and `plan.md:14,24,163`: the backend test suite's `ANTHROPIC_API_KEY: ci-placeholder-key` works only because `config.ts` validates presence, not format, and the one test that would call the API (`translate.test.ts`) already stubs `app.anthropicClient` — so CI never spends real budget despite looking like it has a real key configured.
- That pattern doesn't transfer here: the code-review agent's job is to make a genuine OpenRouter call, so there's no equivalent "stub the client, use a placeholder key" option without defeating the feature's purpose. The label gate (run only when asked) is this workflow's version of the same underlying goal — don't spend money on CI runs nobody asked for.

### `packages/code-reviewer`'s current interface

- `src/index.ts:9-16,26`: CLI entry point takes `<diff-file> [pr-title] [pr-description]` as `process.argv`, reads the diff via `readFile`, and calls `createCodeReviewAgent().review(...)`. It does not fetch a diff or PR metadata itself.
- `src/agent.ts` (per `context/changes/tool-loop-agent/plan.md`, Phase 2 commit `a5d8a03`): `createCodeReviewAgent(options?: { modelId?, model? })` is already exported and importable — the workflow's composite action can either (a) shell out to the CLI after writing a diff file via `gh pr diff`, or (b) import `createCodeReviewAgent` directly in a small script step and pass `context.payload.pull_request.title/body` plus the diff text in-memory, skipping the intermediate file. Option (b) avoids a filesystem round-trip and keeps PR metadata (title/description) sourced from the GitHub event payload rather than re-parsed CLI args — likely the better fit for a GitHub Actions context specifically, since the event payload already has structured title/body fields.

## Code References

- `.github/workflows/pr-diff.yml:1-226` — existing PR-triggered workflow (build/test/diff, no comments/labels)
- `.github/workflows/deploy.yml:1-260` — existing push-triggered deploy workflow (same conventions, has an `environment: production` approval gate)
- `packages/code-reviewer/src/index.ts:1-40` — current CLI entry point, diff-file-based
- `packages/code-reviewer/src/agent.ts` — `createCodeReviewAgent(options)`, already supports direct import (post-Phase-2 model-injection seam)
- `context/changes/ci-cd-code-review/requirements.md` — the spec this research is grounded against, including the recorded label-gated-trigger deviation

## Architecture Insights

- This repo's CI philosophy is "never spend real money automatically" — enforced twice already (Neon ephemeral branches instead of shared state, `ci-placeholder-key` instead of a real Anthropic key) and now a third time via label-gating instead of a placeholder, since a placeholder isn't available for this feature's core function.
- Required-status-check registration is a manual, out-of-band step (GitHub Settings UI) that this plan must explicitly call out as **not to be done** for this workflow, rather than silently omitting it — the risk of a well-meaning future contributor adding it out of habit is real given every other job in this repo IS a required check.
- No composite action or PR-comment/label precedent exists — this change introduces both patterns to the repo for the first time, so the implementation should be built to make future workflows want to reuse it (a real composite action with clear inputs/outputs), not just a one-off inline script.

## Historical Context (from prior changes)

- `context/archive/2026-08-05-testing-backend-ci-safety-net/` — the origin of the "don't spend real API money in CI" principle this workflow's label-gated trigger extends; also where the secrets-vs-vars scoping rule (repo-level unless a job has `environment:`) was established.
- `context/archive/2026-08-11-testing-frontend-extension-logic/research.md:265`, `plan.md:623` — first named appearance of the `PR-Needed` ruleset and confirmation that `diff` is its registered required context.
- `context/archive/2026-08-14-observability-evidence-layer/research.md:47-56` — a cautionary tale directly relevant to writing shell steps in this new workflow: an unquoted glob (`test/**/*.ts`) silently ran fewer test files under Linux's `sh` than under local Windows/cmd, "a quality gate that can silently not run is worse than no gate" (`context/foundation/lessons.md:61-66`) — worth keeping in mind for any shell-based diff/label logic in the new composite action.
- `context/team/opportunity-map.md:58-64` and `context/changes/tool-loop-agent/` — the Module 5 origin story for why this agent exists at all and what it does/doesn't do yet.

## Related Research

- `context/changes/tool-loop-agent/plan.md` and `plan-brief.md` — the agent this workflow will call
- `context/team/mom-test-validation.md` — validation record for the code-review agent as a whole

## Open Questions

- Should the composite action shell out to `packages/code-reviewer`'s existing CLI (writing a diff file first), or import `createCodeReviewAgent` directly in an inline Node/`actions/github-script`-style step? Research leans toward direct import (avoids a file round-trip, gets PR title/body from the event payload), but this is a real design decision for planning, not yet settled.
- Exact mechanism for posting the comment and setting labels — `actions/github-script` (JS, runs in-process, no extra installs) vs. `gh` CLI (already on the runner, simpler bash, but shells out per call) — both are viable; planning should pick one and note why.
