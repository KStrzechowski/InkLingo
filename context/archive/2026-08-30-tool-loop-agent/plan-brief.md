# Tool Loop Agent — Plan Brief

> Full plan: `context/changes/tool-loop-agent/plan.md`

## What & Why

`packages/code-reviewer/` is the Module 5 team agent: an AI code-review agent (Vercel AI SDK `ToolLoopAgent` + OpenRouter + Zod) that scores a PR's diff against six graded criteria and returns a structured pass/fail recommendation. This is a **retrofit plan** — the agent was scaffolded and committed before this plan was written, skipping the normal plan-first workflow; this brief and the full plan document what was built and add the hardening a proper plan would have called for.

## Starting Point

`packages/code-reviewer/` exists, typechecks clean, and its CLI guards (missing args, missing API key) work correctly. It has never made a live model call — no `OPENROUTER_API_KEY` exists yet — and has zero automated tests.

## Desired End State

The package has a cost-aware default model (already done), a test suite that validates the schema and prompt with zero network calls and zero spend, and one clearly-blocked manual phase for the first live verification, to run only once the user has an OpenRouter key and says go.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Default model | `deepseek/deepseek-v4-flash` (was `anthropic/claude-sonnet-4.5`) | User flagged real cost concern; cheap tier, referenced by the course's own eval lesson | Plan (post user input) |
| Model override | `OPENROUTER_MODEL` env var + `modelId` param | Needed for m5l3's promptfoo multi-model comparison without code changes | Plan |
| Test scope now | Unit tests only (schema, prompt, mocked agent) | No network cost until the user has a key and chooses to spend | Plan (user decision) |
| Failure mode | Throw immediately, no auto-retry | Retrying would double cost on a flaky response — user chose cheap over self-healing | Plan (user decision) |
| PR-comment formatting | Out of scope, deferred to m5l3 | Keeps this package a clean, reusable structured-output library | Plan (user decision) |

## Scope

**In scope:** documenting the existing agent scaffold, unit tests with zero network/cost, a clearly-blocked manual live-verification phase.

**Out of scope:** CI wiring, PR comment/label formatting, promptfoo evals, retry logic, spend caps beyond model choice — all deferred to m5l3 or explicitly declined by the user.

## Architecture / Approach

One package, four modules: `schemas/review.ts` (Zod output contract), `prompts/code-review.ts` (the graded rubric as a system prompt), `agent.ts` (the `ToolLoopAgent` wiring one `recordReview` tool), `index.ts` (CLI + exports for m5l3 to import). Tests mock the model layer so nothing here ever costs money automatically.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Core scaffold (retro-documented) | Records the already-built, already-committed agent | None — already done |
| 2. Unit tests | Schema/prompt/agent-capture tests, no network | Mocking the AI SDK's model layer correctly at pinned `ai@7` |
| 3. Manual live verification | One real review run, once a key exists | Blocked — do not start without the user's go-ahead |

**Prerequisites:** an `OPENROUTER_API_KEY` for Phase 3 only.
**Estimated effort:** Phase 1 already done; Phase 2 is a single short session; Phase 3 is a few minutes once a key exists.

## Open Risks & Assumptions

- The exact mock-model utility name/import path for `ai@7.0.85` needs to be confirmed against the installed package during Phase 2 implementation — the plan describes intent (mock the model, no network) rather than a specific import that might not match this pinned version.
- `deepseek/deepseek-v4-flash` is assumed available on OpenRouter at review time; if not, fall back to another cheap-tier model rather than reverting to the expensive default.

## Success Criteria (Summary)

- `npm test` and `npm run typecheck` both pass in `packages/code-reviewer/` with no network access and no cost.
- The user has explicitly approved before any Phase 3 spend occurs.
