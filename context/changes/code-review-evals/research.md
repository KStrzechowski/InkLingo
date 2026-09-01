---
date: 2026-09-01T02:10:19+02:00
researcher: KStrzechowski
git_commit: b539b455a0cd509f5a3a07288e19c07493e5ea6c
branch: feat/m5-code-review-agent
repository: InkLingo
topic: "Introducing promptfoo (or an alternative) to eval packages/code-reviewer"
tags: [research, evals, promptfoo, code-reviewer, m5l3]
status: complete
last_updated: 2026-09-01
last_updated_by: KStrzechowski
---

# Research: Introducing promptfoo (or an alternative) to eval packages/code-reviewer

**Date**: 2026-09-01T02:10:19+02:00
**Researcher**: KStrzechowski
**Git Commit**: b539b455a0cd509f5a3a07288e19c07493e5ea6c
**Branch**: feat/m5-code-review-agent
**Repository**: InkLingo

## Research Question

Per `.claude/prompts/m5l3-promptfoo.md`: analyze the current state of `packages/code-reviewer` for eval-readiness (reusability of prompts, importability of the agent), and determine whether promptfoo (the user's first pick) is aligned with this repo's tech stack — or whether another OSS eval tool fits better.

## Summary

**promptfoo is a good fit and is the recommended path**, matching the user's stated preference — with two implementation adjustments, not blockers:

1. The 3-model comparison must go through **one custom TypeScript provider file**, not promptfoo's native `openrouter:` provider type — because the actual model call is already encapsulated inside `createCodeReviewAgent()`, not something promptfoo should call directly. Three `providers:` entries pointing at the same custom-provider file, each parameterized with a different `modelId` in its `config`, reproduces the multi-model comparison.
2. The LLM-as-judge rubric must grade a **flattened text view** of the structured `CodeReviewResult` (summary + per-criterion reasoning), not a raw JSON path — promptfoo's `llm-rubric` docs don't show a worked example of grading a nested field directly, so the custom provider should format the review into judge-friendly text before returning it as `output`.

Everything else lines up cleanly: async custom providers with direct `.ts` imports (no build step, matches this package's existing `tsx`-based dev/test workflow), file-based diff fixtures (avoids YAML escaping of a large diff), a `javascript` assertion type for the deterministic `recommendation === 'fail'` check, and CI-friendly exit codes / JSON output / disk caching.

A parallel comparison against TS-native alternatives (Evalite, autoevals, Braintrust, deepeval-ts, a hand-rolled `node:test` harness) found none of them earn their keep over promptfoo for this specific, closed-shape task — `createCodeReviewAgent({ modelId })` already does the multi-model part natively, so a framework's main selling point (multi-model orchestration) isn't actually needed here. The one alternative worth remembering later is **Evalite's LLM-call caching** (`wrapAISDKModel`), if live-call cost/iteration friction becomes a real problem after promptfoo is in place — not a reason to pick it over promptfoo now.

This is explicitly the deferred second half of the m5l3 lesson: both `context/changes/tool-loop-agent/plan.md` and the now-archived `context/archive/2026-08-30-ci-cd-code-review/plan.md` name "promptfoo eval configuration (multi-model comparison, LLM-as-judge)" as out of scope, pointing here. One open question surfaced from the source prompt itself: it asks for "three different models" but names only two (`z-ai/glm-5.1`, `deepseek/deepseek-v4-flash`) — the third needs to be picked during planning.

## Detailed Findings

### `packages/code-reviewer`'s current shape (eval-readiness)

- `src/agent.ts:32` — `createCodeReviewAgent(options?: { modelId?: string; model?: LanguageModel })` returns `{ review(input): Promise<CodeReviewResult> }`. The `modelId` option already routes straight to `createOpenRouter(...).chat(modelId)` (`agent.ts:33-37`), so multi-model comparison needs zero code changes to the agent itself — an eval harness just calls this three times with three `modelId` values.
- `src/agent.ts:41-55` — the agent is a Vercel AI SDK `ToolLoopAgent` that must call a `recordReview` tool exactly once; structured output arrives via tool-calling, not a raw text/JSON completion. Any eval provider wrapping this needs to call `.review(...)` and hand back the resulting object, not attempt to re-implement the prompt/tool-loop itself.
- `src/prompts/code-review.ts:1-33` — `CODE_REVIEW_SYSTEM_PROMPT` is a plain exported template string, trivially reusable/importable without invoking the agent.
- `src/schemas/review.ts` — `codeReviewResultSchema` (Zod v4) is directly importable for typing an eval provider's return value.
- `package.json:2,20-25` — `"type": "module"`, Node 24, TypeScript 7 with `erasableSyntaxOnly`/`verbatimModuleSyntax`/`moduleResolution: nodenext`, `tsx` for running `.ts` files with no build step. Existing `test/` files (`agent.test.ts`, `review-schema.test.ts`, `code-review-prompt.test.ts`, `format-review-comment.test.ts`) all run via `node --import tsx --test`, zero network, using `MockLanguageModelV4` from `ai/test` to avoid live calls.
- `.env.example` (2 lines) — only declares `OPENROUTER_API_KEY`; `OPENROUTER_MODEL` (the override `agent.ts` already supports) isn't documented there or in the README. An eval config will need to reuse `OPENROUTER_API_KEY` and should probably document `OPENROUTER_MODEL` at the same time.
- No rate limits, spend caps, or eval tooling exist anywhere in this package today — cost control so far is entirely the cheap-default-model choice (`deepseek/deepseek-v4-flash`) plus `stopWhen: isStepCount(4)` bounding worst-case calls per review to 4 (`context/changes/tool-loop-agent/plan.md:171`).

### promptfoo capability check (fetched docs, Sept 2026)

| Capability | promptfoo's answer | Fit |
|---|---|---|
| Custom in-process provider | `providers: [{ id: 'file://./provider.ts', ... }]` exporting an async `callApi(prompt, context, options)`; CJS/ESM/`.ts` all supported with no build step ([docs](https://www.promptfoo.dev/docs/providers/custom-api/)) | ✅ Good — `import { createCodeReviewAgent } from '../src/agent.ts'` directly inside `callApi` |
| Multi-model comparison | `providers:` array; a native `openrouter:<vendor>/<model>` provider type exists ([docs](https://www.promptfoo.dev/docs/providers/openrouter/)) but calls OpenRouter directly, bypassing the agent's tool-loop | ⚠️ Needs adjustment — 3 provider entries, same custom-provider file, each with a different `modelId` in `config` |
| LLM-as-a-judge | `llm-rubric` (also `model-graded-closedqa`, `factuality`, `g-eval`); grades against the rendered `output`, no built-in "grade this one JSON field" ([docs](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric/)) | ⚠️ Needs adjustment — format `output` as flattened judge-readable text (summary + reasonings) in the custom provider |
| Deterministic assertion | `javascript` assertion type, function receives `(output, context)`, can inspect a parsed object directly ([docs](https://www.promptfoo.dev/docs/configuration/expected-outputs/)) | ✅ Good — `assert: [{ type: 'javascript', value: 'output.recommendation === "fail"' }]` |
| Diff fixture as test var | `vars.diff: file://fixtures/react-migration.diff` — file-based loading is the documented, recommended approach for long strings ([docs](https://www.promptfoo.dev/docs/configuration/guide/)) | ✅ Good |
| Project integration | Plain `npm install --save-dev promptfoo`, `promptfoo eval` CLI (or `npx`), no monorepo tooling required; top-level config is `.yaml`/`.js`/`.json` — **`.ts` config format not confirmed**, only provider files ([docs](https://www.promptfoo.dev/docs/configuration/reference/)) | ✅ Good, one naming caveat |
| CI-friendliness | Exit code `100` on failed assertions (configurable), `1` on other errors, `0` on success; `--output result.json`; disk caching restorable via `actions/cache` ([docs](https://www.promptfoo.dev/docs/usage/command-line/), [GH Action](https://www.promptfoo.dev/docs/integrations/github-action/)) | ✅ Good for cost control — should still run label-gated like the `ci-cd-code-review` workflow, not on every push |

Not independently confirmed: promptfoo's TS loader against this project's exact TypeScript 7 flag combination (`erasableSyntaxOnly` + `verbatimModuleSyntax` + `nodenext`) — worth a smoke test in planning/implementation rather than assuming.

### Alternative TS/Node-native eval frameworks (comparison)

- **Vercel AI SDK itself** ships building blocks (`MockLanguageModelV3/V4`, `Output.object/choice`) but no eval *runner*. `vercel-labs/agent-eval` exists but targets sandboxed coding-agent benchmarks (Claude Code/Codex/opencode) — wrong shape for structured-JSON grading. `@ai-sdk-tool/eval` targets raw model benchmarking (function-calling leaderboards), also the wrong shape.
- **Evalite** (`mattpocock/evalite`, MIT, Vitest-based) — the closest framework-shaped fit: `wrapAISDKModel()`/`traceAISDKModel()` gives automatic caching of live LLM calls (avoids re-burning OpenRouter credits while iterating on judge logic) plus tracing; local-first, CI-friendly exit codes. Actively maintained (`0.19.0` ~Nov 2025, v1 in beta preview).
- **autoevals** (`braintrustdata/autoevals`) — a scorer *library*, not a runner; would still need a hand-rolled `node:test` harness around it. Actively maintained.
- **Braintrust** — hosted platform, generous free tier, genuinely nice diff-of-outputs UI across 3 models, but an added account/dependency for a one-off internal eval.
- **deepeval-ts** — beta, thin, mostly proxies to a hosted platform; not worth adopting pre-1.0 here.
- **Hand-rolled `node:test`** — this repo already has the pattern (`test/agent.test.ts` uses `MockLanguageModelV4` from `ai/test`); a live-call eval would just be one more test file calling `createCodeReviewAgent({ modelId })` three times, asserting `recommendation`, and making one more agent call as judge. No new dependency at all.

**Why promptfoo still wins over "just write it in node:test":** the multi-model/deterministic/judge assertion machinery, file-based fixture loading, and CI exit-code/JSON-output/caching behavior promptfoo provides out of the box would otherwise have to be hand-built and hand-maintained — and it's also literally the tool the user already picked and the course prompt names. Reach for Evalite's caching specifically (layered on top, or as a swap-in later) only if live-call cost/iteration friction turns out to be a real problem once the promptfoo config exists — not as a reason to skip promptfoo now.

## Code References

- `packages/code-reviewer/src/agent.ts:32-78` — `createCodeReviewAgent`, the eval target; `modelId` already parameterizes model choice
- `packages/code-reviewer/src/prompts/code-review.ts:1-33` — reusable system prompt
- `packages/code-reviewer/src/schemas/review.ts` — `codeReviewResultSchema` / `CodeReviewResult` type
- `packages/code-reviewer/src/index.ts:1-42` — existing CLI entrypoint pattern (for reference on how the package is invoked outside tests)
- `packages/code-reviewer/test/agent.test.ts` — existing `MockLanguageModelV4` test pattern to follow for any non-live eval scaffolding
- `packages/code-reviewer/.env.example` — only `OPENROUTER_API_KEY`; `OPENROUTER_MODEL` undocumented
- `packages/code-reviewer/package.json:8-14` — script conventions (`tsx`, `node --import tsx --test`) an eval script should match

## Architecture Insights

- The agent's `modelId`/`model` injection seam (`CreateCodeReviewAgentOptions`) was *already* built with this eval task in mind — `context/changes/tool-loop-agent/plan-brief.md:22` states directly: "Needed for m5l3's promptfoo multi-model comparison without code changes." No agent refactor is needed to support the eval; the seam is ready.
- This repo's established pattern is "cheap default model + explicit override," never a hardcoded expensive model — an eval config listing 3 specific OpenRouter model IDs should follow the same `OPENROUTER_MODEL`-style externalization rather than hardcoding, so the model list can change without touching the eval provider code.
- This repo has an established "never spend real API money in CI automatically" posture (label-gated `ai-cr:review` trigger, `ci-placeholder-key` for the Anthropic-based backend tests). A promptfoo eval that calls 3 live OpenRouter models plus a judge model is a real-money operation by design and should follow the same pattern — manual/label-gated invocation, not automatic on every push, with promptfoo's disk caching leaned on to avoid re-paying for unchanged inputs.

## Historical Context (from prior changes)

- `context/changes/tool-loop-agent/plan.md:38` and `plan-brief.md:22,31` — promptfoo eval configuration (multi-model comparison, LLM-as-judge) was explicitly named and deferred to "m5l3's second half," i.e., this exact task.
- `context/archive/2026-08-30-ci-cd-code-review/plan.md:38` and `plan-brief.md:35,38` — same deferral, confirmed again from the CI/CD side: "Not building promptfoo evals or multi-model comparison tooling — that's m5l3's own separate scope."
- `context/foundation/lessons.md:35-40` ("A stubbed AI client cannot tell you the model's output is usable") — directly relevant: this eval, once built, should itself be validated with real API calls before being trusted, not just checked for schema validity. The lesson's rule ("run it against the real API before calling the feature done... count how many produce a usable result, not just a parseable one") applies as much to the eval harness as it did to the original feature.
- `context/changes/tool-loop-agent/plan.md:128-148` — Phase 3 ("Manual live verification") of the original agent build is **still unchecked/not yet done** as of this research (`- [ ] 3.1`, `- [ ] 3.2` in that plan's Progress section). Worth flagging: a live-verification gap in the underlying agent predates the eval work and isn't this change's job to fix, but the eval's own live run will incidentally exercise the same path.
- `.claude/prompts/m5l3-promptfoo.md` — the literal source spec for this task; asks for "three different models" but names only two (`z-ai/glm-5.1`, `deepseek/deepseek-v4-flash`) — open question for planning.
- `.claude/prompts/m5l3-requirements.md` — the six-criterion rubric spec `code-review.ts`/`review.ts` were built from; unchanged by this task, just background.

## Related Research

- `context/archive/2026-08-30-ci-cd-code-review/research.md` — sibling m5l3 research on wiring the same agent into GitHub Actions
- `context/changes/tool-loop-agent/plan.md`, `plan-brief.md` — the agent this eval will exercise

## Open Questions

- The source prompt asks for "three different models" but names only two (`z-ai/glm-5.1`, `deepseek/deepseek-v4-flash`) — a third needs to be chosen during planning.
- Whether promptfoo's TS loader is fully compatible with this project's exact TypeScript 7 configuration (`erasableSyntaxOnly` + `verbatimModuleSyntax` + `nodenext`) is unconfirmed by documentation alone — worth a quick smoke test early in implementation.
- Whether `llm-rubric` can be pointed at a structured field directly (vs. the flattened-text-view workaround identified here) is not shown in promptfoo's own examples — assume the workaround is needed unless disproven during implementation.
- Whether this eval should run in CI at all (vs. purely local/on-demand) — and if so, whether it should be label-gated like `ci-cd-code-review`'s workflow — is a planning decision, not yet made.
