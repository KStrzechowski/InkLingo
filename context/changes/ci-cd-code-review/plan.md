# CI/CD Code Review Workflow Implementation Plan

## Overview

Wire `packages/code-reviewer` (the already-built AI review agent) into a label-gated GitHub Actions workflow: adding the `ai-cr:review` label to a PR runs a composite action that reviews the diff against the six existing criteria, posts (and upserts on retry) a PR comment with the result, and sets `ai-cr:passed`/`ai-cr:failed` — without ever becoming a required, merge-blocking check.

## Current State Analysis

- `packages/code-reviewer` is fully built and unit-tested (`context/changes/tool-loop-agent/plan.md`): `createCodeReviewAgent()` is directly importable, takes `{ prTitle, prDescription, diff }`, and returns a Zod-validated `CodeReviewResult` (six scored criteria + summary + `pass`/`fail` recommendation). It has never made a live model call — no `OPENROUTER_API_KEY` exists yet.
- This repo has exactly two workflows (`pr-diff.yml`, `deploy.yml`), both `push`/`pull_request` build-test-diff pipelines. There is **no precedent** anywhere in the repo for posting PR comments, managing labels, running on label events, or a composite action (`.github/actions/` does not exist).
- The `PR-Needed` ruleset (GitHub Settings → Rules → Rulesets, not classic branch protection) currently requires `diff` and `print-tests`. Registration there is manual, GitHub-UI-only, and this plan's job must **never** be added to it — a required check that only runs when a label is manually added would permanently block every PR that doesn't get the label.
- `packages/code-reviewer` is not covered by any local quality-gate layer (`scripts/quality/checks.mjs`'s `APPS` list omits it entirely) — editing it triggers no per-edit/pre-commit/pre-push hook. Its own `npm run typecheck` / `npm test` are the only automated gates.
- Repo convention (confirmed across both existing workflows): every `uses:` step pins a full commit SHA with a `# vX.Y.Z` comment; `working-directory:` is set per app/package for each `run:` step; Node 24 unless a job has a specific runtime constraint (none applies here); secrets/vars are declared at repo level unless a job has its own `environment:` (this job doesn't).

## Desired End State

Adding the `ai-cr:review` label to a PR against `main` triggers a workflow that:
1. Fetches the PR's diff, filtered to exclude lockfiles/generated paths.
2. Runs the code-review agent against title, description, and the filtered diff.
3. Posts a single PR comment with all six scored criteria, the summary, and the verdict — updating the same comment in place if the label is removed and re-added to retry, rather than piling up duplicates.
4. Sets `ai-cr:passed` or `ai-cr:failed` on the PR (removing whichever was set by a prior run).
5. Reports the job itself as red when the verdict is `fail` — visible in the PR's checks list, but never blocking merge, since the job is not registered on the `PR-Needed` ruleset.

Verified by: opening a real PR, adding the label, and confirming all five behaviors above, plus confirming a second, unrelated label addition does **not** trigger a run.

### Key Discoveries

- `packages/code-reviewer/src/agent.ts:32` — `createCodeReviewAgent(options)` already supports direct import with model injection; no CLI round-trip needed.
- `packages/code-reviewer/package.json:9` — the existing `dev` script hard-requires `.env` via `tsx --env-file=.env`, which doesn't exist in CI; the new CI entrypoint needs its own script that reads plain process env, not a dotenv file.
- `.github/workflows/pr-diff.yml:18-23` — the `PR-Needed` ruleset's exact registration history and the explicit warning (from `context/archive/2026-08-11-testing-frontend-extension-logic/`) that a new required job needs its own manual Settings addition or "gates nothing" — the inverse risk (accidentally registering this *optional* job) is the one this plan must guard against.
- `context/archive/2026-08-14-observability-evidence-layer/research.md:47-56` (`context/foundation/lessons.md:61-66`) — "a quality gate that can silently not run is worse than no gate"; directly relevant to the `types: [labeled]` trigger, which fires for *every* label addition, not just `ai-cr:review` — the job-level `if:` filter is load-bearing, not decorative.

## What We're NOT Doing

- Not registering this job on the `PR-Needed` ruleset — it must stay non-blocking by design.
- Not switching the trigger to automatic-on-every-PR — the label gate is a deliberate, recorded cost-avoidance decision (`requirements.md` Deviation note); switching later is a one-line `on:` change if the repo owner decides the spend is worth it.
- Not adding auto-retry on agent failure — matches the existing "throw immediately, no auto-retry" decision from `tool-loop-agent/plan.md`.
- Not building promptfoo evals or multi-model comparison tooling — that's `m5l3`'s own separate scope per `.claude/prompts/m5l3-requirements.md`.
- Not building this as a shared/reusable action across repos, or adding any review-history UI beyond the PR comment and labels.

## Implementation Approach

Three phases, each building on the last: (1) a small, unit-tested CI entrypoint inside the existing package that turns agent output into a file-based, GitHub-Actions-safe contract; (2) a composite action that's a pure wrapper around that entrypoint (input → review result, no GitHub API calls of its own); (3) the workflow, which owns all GitHub-specific orchestration — label filtering, diff fetch/filtering, comment upsert, label swap, and the final pass/fail job status. Keeping GitHub API calls entirely in the workflow (not the composite action) keeps the action a reusable, testable-in-isolation unit.

## Critical Implementation Details

**Security — untrusted PR content must never enter a `run:` script body.** PR title, description, and diff content are attacker-controlled (any PR author can set them). Every place this content reaches a shell or Node script — in the composite action's steps and the workflow's steps alike — must arrive via an `env:` mapping (`env: PR_TITLE: ${{ inputs.pr-title }}`) and be read back as `process.env.PR_TITLE` / `$PR_TITLE`, never spliced directly into a `run:` script via `${{ }}` interpolation (e.g. never `run: echo "${{ github.event.pull_request.title }}"`). This is the classic GitHub Actions script-injection class, and getting it wrong here would be a direct failure of the very "security and safety" criterion this workflow scores.

**Label-name filtering is load-bearing.** `on.pull_request.types: [labeled]` fires for *any* label added to a PR, not just `ai-cr:review` — GitHub Actions has no trigger-level way to filter by label name. The job needs `if: github.event.label.name == 'ai-cr:review'`. Omitting this silently defeats the entire cost-avoidance reason this workflow is label-gated instead of running on every PR.

**Working-directory mismatch for file paths.** The composite action's `run:` steps execute with `working-directory: packages/code-reviewer`, but the diff file is written by the calling workflow at the repo root. Pass `diff-file` into the action, and read `comment-file` back out of it, as absolute paths — a relative path resolves against the wrong directory on one side or the other.

**Job-fail step must run last.** The step that turns the job red (`exit 1` when `recommendation == 'fail'`) must come *after* the comment-upsert and label-swap steps have already executed successfully — not before. Placing it earlier would skip posting the very comment that explains the failing verdict.

**Comment/output size — pass files, not inline multiline strings.** The composite action must expose the review comment via a **file path** output (e.g. `comment-file`), not inline markdown text through `$GITHUB_OUTPUT` — a real diff-driven review comment can be long, and GitHub Actions' multiline-output delimiter syntax (`key<<EOF ... EOF`) is easy to get subtly wrong (and unsafe if the content itself happens to contain the delimiter).

## Phase 1: CI entrypoint in `packages/code-reviewer`

### Overview

Add a small, testable seam between the existing agent and the GitHub Actions environment: read plain env vars (no `.env` file), call the agent, and write its output to disk in a form the composite action can pass along without further parsing.

### Changes Required:

#### 1. Pure comment formatter

**File**: `packages/code-reviewer/src/format-review-comment.ts`

**Intent**: Turn a `CodeReviewResult` into the markdown PR comment body — six criteria (score + one-line reasoning each), the summary paragraph, and a bold pass/fail verdict line — with a hidden HTML marker at the top so the workflow's upsert step can find and update this exact comment on retry.

**Contract**: `formatReviewComment(result: CodeReviewResult): string`. First line of output is `<!-- ai-cr:review -->` (exact string, used verbatim by the workflow's comment-matching logic in Phase 3 — do not change this string independently of that step).

#### 2. Unit test for the formatter

**File**: `packages/code-reviewer/test/format-review-comment.test.ts`

**Intent**: Verify the formatter's output against a fixture `CodeReviewResult` — presence of the marker, all six criteria, the summary, and the verdict line. Zero network, matches the existing test pattern (`test/review-schema.test.ts`, `test/code-review-prompt.test.ts`).

**Contract**: `node --import tsx --test` (existing `npm test` script) picks this file up automatically — no config changes needed.

#### 3. CI entrypoint script

**File**: `packages/code-reviewer/src/ci-review.ts`

**Intent**: The composite action's actual invocation target. Reads `PR_TITLE`, `PR_DESCRIPTION`, `DIFF_FILE` (an absolute path to the diff text) from `process.env`, reads the diff file, calls `createCodeReviewAgent().review(...)`, formats the result with `formatReviewComment`, and writes two files next to the diff: `review-comment.md` (the formatted markdown) and `review-result.json` (the raw `CodeReviewResult`, for anyone who wants it later). Prints only the recommendation (`pass` or `fail`) as its final stdout line, so the calling shell step can capture it with simple command substitution — no JSON parsing in bash.

**Contract**: invoked as `node --import tsx src/ci-review.ts` from `packages/code-reviewer/`; exits non-zero (propagating the agent's thrown error) if the agent finishes without calling `recordReview`, matching the existing no-retry behavior. Not unit-tested directly, consistent with `src/index.ts` (the existing CLI entrypoint) also being untested — the substantive logic it calls (`agent.ts`, `format-review-comment.ts`) is what's covered.

#### 4. New package script

**File**: `packages/code-reviewer/package.json`

**Intent**: Give the composite action a stable command to invoke that doesn't require a `.env` file, unlike the existing `dev` script.

**Contract**: add `"review:ci": "node --import tsx src/ci-review.ts"` to `scripts`.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes in `packages/code-reviewer/`
- `npm test` passes in `packages/code-reviewer/`, including the new formatter test, with zero network access

#### Manual Verification:

- The formatted comment (checked by eye against a sample `CodeReviewResult`) renders sensibly as GitHub-flavored markdown — headings/emphasis/line breaks in the right places

---

## Phase 2: Composite action

### Overview

A thin, self-contained wrapper: given PR metadata and a diff file, install deps and run the Phase 1 entrypoint, exposing its two outputs. No GitHub API calls live here — that stays in the workflow (Phase 3), keeping this action a reusable input→output unit.

### Changes Required:

#### 1. Composite action definition

**File**: `.github/actions/code-review/action.yml`

**Intent**: Wraps `npm ci` + the `review:ci` script for the calling workflow, so `code-review.yml` stays orchestration-only.

**Contract**:
- Inputs: `pr-title` (required), `pr-description` (required, may be empty), `diff-file` (required, absolute path), `openrouter-api-key` (required), `openrouter-model` (optional — passes through the existing `OPENROUTER_MODEL` override already supported by `agent.ts`).
- Steps: pinned `actions/setup-node` (Node 24, matching repo convention — no Lambda-style runtime constraint here), `npm ci` with `working-directory: packages/code-reviewer`, then a `run:` step invoking `npm run review:ci` with `env:` set from every input (per the Security detail above — never interpolate inputs into the script body itself), followed by two `echo "...=..." >> "$GITHUB_OUTPUT"` lines that capture the script's final stdout line as `recommendation` and the known, absolute `review-comment.md` path as `comment-file`.
- Outputs: `recommendation`, `comment-file`.

### Success Criteria:

#### Automated Verification:

- None applicable — this repo has no installed Actions/YAML linter (confirmed in research; `actionlint`/`action-validator` are not present as devDependencies anywhere in the repo), so `npm run typecheck`/`npm test` from Phase 1 are the closest automated signal and don't exercise the YAML itself.

#### Manual Verification:

- Verified together with Phase 3's end-to-end trigger below — a composite action has no meaningful standalone invocation without a calling workflow.

---

## Phase 3: Workflow — trigger, diff handling, comment/label orchestration

### Overview

The GitHub-specific half: filter the trigger to the right label, fetch and filter the diff, call the Phase 2 action, then post/update the comment, swap the labels, and finally reflect the verdict in the job's own status.

### Changes Required:

#### 1. New workflow

**File**: `.github/workflows/code-review.yml`

**Intent**: Orchestrate the label-gated review end-to-end, following every existing repo convention (pinned SHAs, per-step `working-directory`, narrowly-scoped `permissions:`, comments explaining *why* — especially for the non-required-check decision).

**Contract**:
- Trigger: `on: pull_request: { types: [labeled], branches: [main] }`.
- `permissions: { contents: read, pull-requests: write, issues: write }` (label/comment APIs on PRs go through the Issues REST surface, per research).
- `concurrency: { group: code-review-${{ github.event.pull_request.number }}, cancel-in-progress: true }` — protects against duplicate spend if the label is toggled off/on in quick succession.
- Single job `review`, gated with `if: github.event.label.name == 'ai-cr:review'` (see Critical Implementation Details — this is the actual trigger filter, not the `on:` block).
- Steps, in order:
  1. `actions/checkout` (pinned SHA, matching existing convention).
  2. Ensure the three labels exist (`ai-cr:review`, `ai-cr:passed` green, `ai-cr:failed` red) via `actions/github-script`, catching the "already exists" error from `createLabel` — idempotent, since `ai-cr:review` was just added to trigger this run but the color/description may not have been set yet if it was created ad hoc.
  3. Fetch the diff: `gh pr diff <PR#> > diff.txt` (authenticated via `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, no extra setup needed), then filter it to `diff.filtered.txt` by dropping whole per-file sections whose `diff --git a/<path> b/<path>` header matches an exclusion list (`package-lock.json`, `**/dist/**`, and other generated paths) — filtering by diff-header boundaries rather than a `git diff` pathspec, since `gh pr diff` doesn't accept pathspec filters and this avoids relying on `fetch-depth`/base-SHA availability in the checkout. A short reference implementation for the header-boundary split:
     ```
     awk '/^diff --git a\// { skip = ($0 ~ /package-lock\.json|\/dist\// ) } !skip'
     ```
     (adjust the regex to the final exclusion list; the mechanism — split on `diff --git` lines, toggle a skip flag per matched header — is the non-obvious part, not the exact pattern.)
  4. Invoke `./.github/actions/code-review` with `pr-title: ${{ github.event.pull_request.title }}`, `pr-description: ${{ github.event.pull_request.body || '' }}`, `diff-file: <absolute path to diff.filtered.txt>`, `openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}`, `openrouter-model: ${{ vars.OPENROUTER_MODEL }}`. Give this step an `id` (e.g. `review`) so later steps can reference `steps.review.outputs.*`.
  5. Upsert the PR comment via `actions/github-script`: read `steps.review.outputs.comment-file`, list existing PR comments, find one whose body starts with the `<!-- ai-cr:review -->` marker (Phase 1), and `updateComment` if found else `createComment`.
  6. Swap labels via `actions/github-script`: remove whichever of `ai-cr:passed`/`ai-cr:failed` is *not* the current recommendation (ignore a 404 if it wasn't present), add the one that matches `steps.review.outputs.recommendation`.
  7. Final step: `if: steps.review.outputs.recommendation == 'fail'` → `run: exit 1` (see Critical Implementation Details — must be last).
- A prominent inline comment near the top of the file, matching this repo's rationale-comment density, stating explicitly: this job is intentionally **not** added to the `PR-Needed` ruleset, and why (label-gated ≠ every-PR, so a required check here would permanently block unlabeled PRs).

### Success Criteria:

#### Automated Verification:

- None applicable (see Phase 2) — verification is the live trigger below.

#### Manual Verification:

- **BLOCKED pending explicit user go-ahead** — this step makes a real, billed OpenRouter call, same gate as `tool-loop-agent/plan.md` Phase 3. Do not start until the user confirms `OPENROUTER_API_KEY` is set and gives the go-ahead to spend.
- Confirm `OPENROUTER_API_KEY` (secret) and, optionally, `OPENROUTER_MODEL` (var) are configured at repo level (Settings → Secrets and variables → Actions), following the existing secrets/vars scoping convention.
- Add an unrelated label to a test PR first — confirm the workflow does **not** run (proves the `if:` filter works, not just the intent).
- Add `ai-cr:review` to the test PR — confirm the workflow runs, a PR comment appears with all six criteria + summary + recommendation correctly formatted, and the matching `ai-cr:passed`/`ai-cr:failed` label is applied.
- Confirm the job's own status (green/red in the PR checks list) matches the recommendation, and that a red status does **not** block merge (not on the `PR-Needed` ruleset).
- Remove and re-add the `ai-cr:review` label — confirm the *same* PR comment is updated in place (no duplicate comment) and the label set is swapped correctly if the verdict changes between runs.

**Implementation Note**: After Phase 3's automated verification (none, as noted) is confirmed complete, pause here for the user's explicit manual go-ahead before triggering the real, cost-incurring end-to-end run.

---

## Testing Strategy

### Unit Tests:

- `format-review-comment.ts`: marker presence, all six criteria rendered, summary and verdict present — fixture-based, no network.

### Integration Tests:

- None automated — GitHub Actions workflow behavior in this repo is verified live (see Manual Testing Steps), consistent with `pr-diff.yml`/`deploy.yml` having no local integration-test harness either.

### Manual Testing Steps:

1. Trigger on an irrelevant label → confirm no run (filter correctness).
2. Trigger on `ai-cr:review` → confirm comment + label + job status all land correctly.
3. Remove/re-add `ai-cr:review` → confirm comment upsert (no duplicate) and label swap.
4. Confirm the job is absent from the `PR-Needed` ruleset in GitHub Settings.

## Performance Considerations

Diff filtering (excluding lockfiles/generated paths) keeps token count — and therefore cost and latency — proportional to the actual human-authored change, not incidental `npm install` noise. The `concurrency` group with `cancel-in-progress: true` prevents a rapid label-remove-then-re-add from running (and billing) two reviews at once.

## Migration Notes

None — net-new workflow and package files, no existing state or behavior to migrate.

## References

- Requirements: `context/changes/ci-cd-code-review/requirements.md`
- Research: `context/changes/ci-cd-code-review/research.md`
- Course template origin: `.claude/prompts/m5l3-requirements.md`
- Agent this workflow calls: `context/changes/tool-loop-agent/plan.md`, `context/changes/tool-loop-agent/plan-brief.md`
- Existing workflow conventions: `.github/workflows/pr-diff.yml`, `.github/workflows/deploy.yml`
- Package being wired in: `packages/code-reviewer/src/agent.ts`, `packages/code-reviewer/src/index.ts`, `packages/code-reviewer/src/schemas/review.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: CI entrypoint in `packages/code-reviewer`

#### Automated

- [x] 1.1 `npm run typecheck` passes in `packages/code-reviewer/` — b8dac07
- [x] 1.2 `npm test` passes in `packages/code-reviewer/`, including the new formatter test, with zero network access — b8dac07

#### Manual

- [x] 1.3 Formatted comment renders sensibly as GitHub-flavored markdown

### Phase 2: Composite action

#### Manual

- [x] 2.1 Verified together with Phase 3's end-to-end trigger

### Phase 3: Workflow — trigger, diff handling, comment/label orchestration

#### Manual

- [x] 3.1 `OPENROUTER_API_KEY` (secret) and `OPENROUTER_MODEL` (var, optional) configured at repo level
- [x] 3.2 Irrelevant label does not trigger the workflow
- [x] 3.3 `ai-cr:review` label triggers the workflow: comment posted with all six criteria + summary + recommendation, matching label applied
- [x] 3.4 Job status (green/red) matches recommendation and does not block merge
- [x] 3.5 Remove/re-add `ai-cr:review`: comment upserted in place (no duplicate), label swapped correctly
