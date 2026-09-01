## Overall concept

- GHA workflow, triggered by the `ai-cr:review` label being added to a pull request against `main` (adapted from the course template's "every new PR" default — see Deviation note below)
- composite action for the review itself so the main workflow stays easy to reason about

## Input parameters

- pull request title
- pull request description
- git diff

## Code Review Criteria

Each criterion is scored on a 1–10 scale, where 1 is the worst outcome and 10 is the best. These are already implemented in `packages/code-reviewer/src/prompts/code-review.ts` and `src/schemas/review.ts` — this document is the source spec they were built from, reproduced here for the CI change's own reference.

1) **implementation correctness** — does the code actually do what it claims, handling edge cases and error paths without introducing regressions?
   - _1_: logic is broken, misses obvious edge/error cases, or silently regresses existing behavior.
   - _10_: behaves correctly across happy path, edge cases, and failure modes with no regressions.

2) **idiomaticity** — does the code follow the language, framework, and project conventions a fluent reader would expect?
   - _1_: fights the stack's idioms and the repo's established patterns, reads as foreign.
   - _10_: indistinguishable from well-written surrounding code, uses the right idioms naturally.

3) **complexity** — is the solution as simple as the problem allows, without needless abstraction or convolution?
   - _1_: over-engineered or tangled — hard to follow, with accidental complexity that obscures intent.
   - _10_: minimal and clear, the simplest design that solves the problem completely.

4) **test / risk coverage** — are the meaningful behaviors and risky paths exercised by tests proportional to their risk?
   - _1_: risky logic ships untested; tests are absent, trivial, or assert nothing useful.
   - _10_: risk-weighted coverage — the parts most likely to break are tested deliberately and well.

5) **documentation** — are non-obvious decisions, public surfaces, and tricky code explained where a reader would need it?
   - _1_: opaque — no comments or docs where they're needed, intent must be reverse-engineered.
   - _10_: just enough docs/comments to explain the "why" without restating the obvious.

6) **security and safety** — does the change avoid introducing vulnerabilities, leaking secrets, or unsafe handling of untrusted input?
   - _1_: introduces an exploitable flaw, leaks secrets, or trusts untrusted input unsafely.
   - _10_: input is validated, secrets are handled correctly, and no new attack surface is opened.

## Parked for later

- business alignment (require broader context)
- architectural fit (require broader context)

## Expected side-effects

- PR comment with summary
- labels: `ai-cr:failed` (red) OR `ai-cr:passed` (green)

## Expected behavior

- runs when label `ai-cr:review` is added to a PR (see Deviation note)
- re-run: remove and re-add the label

## Deviation from the course template — trigger scope

The course template's default is "GHA workflow run for every new pull request to master." This repo already has an established practice of never spending real API money automatically in CI (`.github/workflows/pr-diff.yml`'s backend job uses `ANTHROPIC_API_KEY: ci-placeholder-key` with the one test that would call it stubbed) — the InkLingo repo gets real, unrelated PRs on an ongoing basis, and OpenRouter bills per token per PR.

Decided in-session (2026-08-30) with the repo owner: start with the label-gated trigger (`ai-cr:review` added → run) instead of automatic-on-every-PR, so no PR incurs cost unless someone deliberately asks for a review. Switching to automatic-on-every-PR later is a one-line `on:` change if the owner decides the cost is worth it.
