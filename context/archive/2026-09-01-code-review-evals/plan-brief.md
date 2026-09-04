# Code Review Evals (promptfoo) — Plan Brief

> Full plan: `context/changes/code-review-evals/plan.md`
> Research: `context/changes/code-review-evals/research.md`

## What & Why

Introduce promptfoo to `packages/code-reviewer` so the existing code-review agent's prompt/output quality can be measured, not just assumed. Run the same agent against 3 different OpenRouter models on one fixed, deliberately-broken React 16→19 migration diff, and use a dedicated judge model to verify each model's review actually caught the injected bugs — plus a deterministic check that the agent correctly flags the diff as failing.

## Starting Point

The agent (`createCodeReviewAgent`) already supports per-call model selection (`{ modelId }`) — that seam was built specifically with this eval in mind. `formatReviewComment` already renders a `CodeReviewResult` into judge-readable markdown, and is already unit-tested. No eval tooling exists anywhere in the repo yet.

## Desired End State

`npm run eval` inside `packages/code-reviewer` runs all 3 models against the fixture diff and reports, per model, whether the deterministic check passed and whether the judge confirms all 3 injected flaws were caught. `npm run eval:validate` checks the config for free.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Third comparison model | `anthropic/claude-sonnet-4.5` | Creates a genuine cheap-vs-premium contrast against the two already-named cheap models | Plan (user decision) |
| Judge model | `openai/gpt-5.1` (distinct from all 3 under test) | Avoids a model grading its own output; user explicitly wanted a separate dedicated judge | Plan (user decision) |
| Injected flaw mix | One flaw per category: legacy-API removal, hooks correctness, prop regression | Exercises genuinely different failure modes in one diff, closest to a real complex migration PR | Plan (user decision) |
| CI wiring | Local/manual-only for now | First configuration should be validated locally before any automated, real-money trigger | Plan (user decision) |
| Judge pass bar | Binary — must catch all 3 flaws to pass | Mirrors the six-criterion rubric's own binary pass/fail contract; unambiguous to read | Plan (user decision) |
| Provider ↔ agent integration | Custom promptfoo provider class wrapping `createCodeReviewAgent` + `formatReviewComment` | The model call already lives inside the agent; promptfoo's native OpenRouter provider would bypass the tool-loop entirely | Research |
| Unit test coverage | Mocked `node:test` for the provider's adapter logic | Matches this repo's established pattern of testing pure logic without live calls | Plan (user decision) |

## Scope

**In scope:** custom promptfoo provider (`evals/provider.ts`), one fixture diff with 3 deliberate flaws, promptfoo config (3 providers + deterministic assertion + LLM-judge rubric), package/tsconfig wiring, a mocked unit test for the provider adapter, and the live verification run.

**Out of scope:** CI wiring, a hard spend/token cap, additional fixture diffs beyond the one required, any change to the agent/prompt/schema themselves, partial-credit scoring.

## Architecture / Approach

`evals/provider.ts` is a thin adapter: promptfoo calls it once per model, it calls the *unchanged* `createCodeReviewAgent({ modelId })` and reuses the *unchanged* `formatReviewComment` to shape a `ProviderResponse`. `evals/promptfooconfig.yaml` wires 3 provider entries (same file, different `modelId` in each entry's `config:`) against one fixture diff, with a `javascript` assertion for the deterministic check and an `llm-rubric` assertion (graded by a 4th, dedicated model) for the qualitative check.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Provider, fixture, and config | Everything buildable/verifiable without spending money: provider, diff fixture, config, mocked test, `validate config` check | The custom-provider config-passing contract (constructor, not `callApi`) is easy to get backwards |
| 2. Live verification | The actual paid run across 3 models + 1 judge, cost/cache/accuracy confirmed | Judge miscalibration — a rubber-stamping judge would look green while telling you nothing; spot-check against raw output is required |

**Prerequisites:** `OPENROUTER_API_KEY` repo secret (already required by the base agent) before Phase 2's live verification.
**Estimated effort:** Phase 1 is one focused session (new files + one test); Phase 2 is a short live run, blocked on your explicit go-ahead to spend.

## Open Risks & Assumptions

- The exact accessor path for reading custom `metadata` inside a promptfoo `javascript` assertion wasn't shown in a full worked example in the fetched docs — needs a quick confirmation against installed types during implementation, not a planning blocker.
- promptfoo's TypeScript loader hasn't been confirmed against this project's exact TS7 flag combination (`erasableSyntaxOnly` + `verbatimModuleSyntax` + `nodenext`) — worth an early smoke test in Phase 1.
- The judge model (`openai/gpt-5.1`) could itself be miscalibrated or biased in ways that aren't obvious from a green report — Phase 2's spot-check step exists specifically to catch this.

## Success Criteria (Summary)

- `npm run eval` produces a report covering all 3 models with both a deterministic and an LLM-judge verdict per model.
- The judge's verdict is manually confirmed to reflect the model's actual review content for at least one case, not just a passing exit code.
- Re-running the eval avoids re-billing for unchanged inputs.
