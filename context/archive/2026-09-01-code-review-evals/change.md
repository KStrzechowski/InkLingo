---
change_id: code-review-evals
title: Code review evals
status: archived
created: 2026-09-01
updated: 2026-09-04
archived_at: 2026-09-04T11:48:22Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Phase 1 implementation-time deviations (2026-09-01)

- **`package.json`'s `eval`/`eval:validate` scripts don't match the plan's literal
  `node_modules/.bin/promptfoo ...` command.** That path is a POSIX shebang shim (plus separate
  `.cmd`/`.ps1` wrappers) and isn't directly `node`-executable on Windows. The scripts instead
  invoke `node_modules/promptfoo/dist/src/entrypoint.js` directly — the same file promptfoo's own
  `package.json` `bin` field points at — which works cross-platform via `node`. Verified working:
  both live Phase 2 `npm run eval` runs succeeded through this path.

### Phase 2 live run findings (2026-09-01)

Two live `npm run eval` runs against `z-ai/glm-5.1`, `deepseek/deepseek-v4-flash`,
`anthropic/claude-sonnet-4.5` (judge: `openai/gpt-5.1`). Full JSON of the second run inspected
directly (per-assertion breakdown, raw outputs).

- **Deterministic assertion (`recommendation === 'fail'`) is reliable when the agent completes**:
  passed 5/5 times it was actually reached across both runs (glm run 1, deepseek x2, claude x2).
  Never produced a false pass/fail — only failure mode was upstream (see next point).
- **`z-ai/glm-5.1` is flaky at the tool-calling step**: passed cleanly in run 1, but in run 2 it
  finished its turn without ever calling `recordReview`, throwing `agent.ts`'s
  "finished without calling recordReview" error (visible as `[ERROR]` in the promptfoo report,
  not a normal fail). This is a reliability property of that specific model against this repo's
  `ToolLoopAgent`/`stopWhen: isStepCount(4)` shape, not a bug in the eval or the agent's error
  handling (the error correctly propagated, per Phase 1's contract).
- **Judge accuracy spot-checked and confirmed accurate** (satisfies the "don't trust the judge
  without checking real output" rule from `context/foundation/lessons.md`): in run 2, both
  `deepseek-v4-flash` and `claude-sonnet-4.5` reviews explicitly caught flaw #1 (hooks stale
  closure) and flaw #2 (dropped `defaultProps`), but neither mentioned flaw #3
  (`ReactDOM.render` removal) anywhere in their output. The judge failed both for exactly that
  reason, worded precisely and matching the raw review text on manual read-through — not a
  rubber-stamp verdict.
- **promptfoo's disk cache does NOT prevent re-billing for this custom-provider architecture** —
  contrary to this plan's "Performance Considerations" assumption. Confirmed empirically: run 2
  made fresh, real (30-45s latency) calls to all 3 review models with no `cached: true` on any
  response. Traced the cause in `node_modules/promptfoo/dist/src/evaluator-*.js`
  (`callActiveProvider`): promptfoo calls `activeProvider.callApi(...)` directly with no wrapping
  cache lookup — caching is opt-in *per provider*, via that provider's own use of promptfoo's
  `fetchWithCache`. promptfoo's built-in providers (and the `openrouter:` judge provider) use it
  internally; our custom `evals/provider.ts` goes through the Vercel AI SDK's own `fetch` via
  `createCodeReviewAgent`, which promptfoo has no visibility into. **Every `npm run eval` run
  re-bills all 3 review-model calls in full**; only the llm-rubric judge call is cacheable
  (it's promptfoo's own `openrouter:` provider), and even that wasn't observed to hit cache
  across these two runs (different review-output text each time, one being an error, means
  different cache keys anyway).
- **promptfoo's "Total Tokens" summary undercounts actual spend for this eval**: it only reports
  tokens for calls promptfoo itself makes (the `llm-rubric` judge — 4048 / 2354 tokens across the
  two runs). Our custom provider doesn't populate `ProviderResponse.cost`/`tokenUsage`, so the 3
  review-model calls' own token usage (the larger share of real spend, given 3 full agentic
  tool-loop turns per run) is invisible to promptfoo's reported totals. The two runs' *reported*
  numbers (4048 and 2354 tokens) should not be read as the true cost of a run.
- **Model behavior varies run-to-run** (expected, but worth recording concretely): run 1 had
  `glm-5.1` pass both checks and `deepseek`/`claude-sonnet-4.5` fail the rubric; run 2 had
  `glm-5.1` error out entirely and `deepseek`/`claude-sonnet-4.5` fail the rubric again but for
  a documented, consistent reason (missing flaw #3 both times).
- **Not yet done**: a full cost-in-dollars figure (OpenRouter's own usage dashboard would be the
  accurate source, not promptfoo's per-run token summary, per the undercounting note above).
