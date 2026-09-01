# Code Review Evals (promptfoo) Implementation Plan

## Overview

Add a promptfoo configuration to `packages/code-reviewer` that runs the existing, unchanged code-review agent against 3 OpenRouter models on one fixed, deliberately-flawed React 16→19 migration diff — with a dedicated judge model verifying each review caught all 3 injected bugs, plus a deterministic check that the agent's own `recommendation` field comes back `'fail'`.

## Current State Analysis

- `packages/code-reviewer/src/agent.ts:32` — `createCodeReviewAgent({ modelId })` already supports per-call model selection; this seam was built specifically for this eval (`context/changes/tool-loop-agent/plan-brief.md:22`). No agent code changes are needed.
- `packages/code-reviewer/src/format-review-comment.ts` — already produces a markdown-formatted, judge-readable rendering of a `CodeReviewResult` (six criteria + summary + bold verdict), already unit-tested including pipe/newline escaping. This eval reuses it as-is rather than inventing a second formatting path.
- No eval tooling, `promptfoo` config, or eval-related devDependency exists anywhere in the repo (`context/changes/code-review-evals/research.md`, item 5).
- `packages/code-reviewer/tsconfig.json` only includes `src/**/*.ts`; `test/tsconfig.json` only includes `../src/**/*.ts` and `test/**/*.ts` — neither currently covers a new `evals/` directory.
- `packages/code-reviewer/package.json` scripts load `.env` via `tsx --env-file=.env` or `node --env-file=.env`; promptfoo's CLI is a plain Node script and does not read `.env` on its own — the new `eval` script needs the same `--env-file` wrapping.

## Desired End State

Running `npm run eval` inside `packages/code-reviewer` executes `promptfoo eval` against the checked-in config, producing a report showing, for each of the 3 models: whether the deterministic assertion passed (it always should, since the fixture diff is unambiguously broken) and whether the LLM-judge confirms the review caught all 3 injected flaws. `npm run eval:validate` checks the config's structure with zero API calls. A mocked, zero-network `node:test` file covers the custom provider's own adapter logic.

Verified by: a real `npm run eval` run (Phase 2, gated on your go-ahead) producing a sane report, plus a manual spot-check that the judge's verdict for at least one model matches what that model's raw review actually said.

### Key Discoveries

- `packages/code-reviewer/src/agent.ts:32` and `context/changes/tool-loop-agent/plan-brief.md:22` — model injection already exists; nothing to build there.
- promptfoo's custom-provider contract (confirmed against current docs): the provider file must **export a class** implementing `id()` and `callApi(prompt, context)`; per-provider `config:` from the YAML arrives via the **constructor**'s `options.config`, not as a `callApi` argument. Getting this backwards silently makes every provider entry use the same/undefined model.
- `promptfoo validate config -c <file>` validates the YAML schema with **zero API calls** — a genuine free automated check for Phase 1.
- `promptfoo eval` exit codes: `0` success, `100` on any failed assertion (configurable via `PROMPTFOO_FAILED_TEST_EXIT_CODE`), `1` on other errors.
- Current promptfoo npm version is `0.122.2`, requires Node `>=22.22.0` — compatible with this package's Node 24.

## What We're NOT Doing

- Not wiring this into CI — per your decision, this stays local/manual-only for its first configuration. A future label-gated workflow (mirroring `ai-cr:review`) is a one-line addition later if the design proves valuable.
- Not adding a hard spend/token cap — relying on manual invocation plus promptfoo's own disk caching as the safeguard, consistent with this repo's existing pattern of gating cost through *when something runs*, not a numeric ceiling.
- Not adding more than the one required fixture diff — broader test-case coverage is future work once this first configuration is validated.
- Not modifying `createCodeReviewAgent`, the review prompt, or the Zod schema — the eval targets the existing, unchanged agent end to end.
- Not building partial-credit/0–3 scoring — the judge bar is binary (all 3 flaws explicitly caught, or fail), per your decision.

## Implementation Approach

Two phases: (1) every artifact that can be built and verified without spending money — the custom provider, the fixture diff, the promptfoo config, a mocked unit test, and the schema-only `validate config` check; (2) the actual live, paid run, which cannot be automated and is gated on your explicit go-ahead, mirroring the original agent's Phase 3 gate.

## Critical Implementation Details

**Provider config arrives via the constructor, not `callApi`.** Per promptfoo's confirmed contract, a custom provider file exports a class; each `providers:` entry's own `config:` block (e.g. `{ modelId: 'z-ai/glm-5.1' }`) is passed into `new ProviderClass(options)` as `options.config`, not as an argument to `callApi(prompt, context)`. Read `this.config.modelId` in the constructor and store it on the instance — do not look for it inside `callApi`'s `context`.

**`file://` provider paths resolve relative to the config file, not the package root.** Keep `provider.ts` and `promptfooconfig.yaml` as siblings inside `evals/` so `file://provider.ts` resolves correctly regardless of the invoking working directory.

**Deterministic-assertion field access needs a quick verification pass.** The `javascript` assertion type can inspect the provider's raw `ProviderResponse` (including our custom `metadata.recommendation` field) via its context argument, but promptfoo's fetched docs didn't show a full worked example of the exact accessor path. Confirm the precise syntax (e.g. `context.providerResponse.metadata.recommendation`, or whatever the installed version's `AssertionParams` type actually names it) against `node_modules/promptfoo`'s TypeScript types at implementation time, rather than assuming the path in this plan is exact.

**`.env` isn't read automatically by the promptfoo CLI.** Every other script in this package that needs secrets wraps its command in `tsx --env-file=.env` or `node --env-file=.env` (see `package.json`'s `dev`/`start` scripts) — the `eval` script needs the same treatment (`node --env-file=.env node_modules/.bin/promptfoo eval ...`), since `--env-file` populates `process.env` for the whole Node process, covering both the custom provider and promptfoo's native `openrouter:` judge provider.

## Phase 1: Provider, fixture, and config

### Overview

Every artifact that can be built and verified without a live model call: the custom promptfoo provider wrapping the existing agent, the deliberately-flawed diff fixture, the promptfoo config wiring 3 providers + the judge rubric + the deterministic assertion, a mocked unit test for the provider's own adapter logic, and project wiring (tsconfig, package.json).

### Changes Required:

#### 1. Diff fixture with 3 deliberate, mixed-category flaws

**File**: `packages/code-reviewer/evals/fixtures/react-migration.diff`

**Intent**: A self-contained, fictitious unified diff migrating a `UserProfileCard` class component (React 16) to a function component (React 19), containing exactly 3 flaws — one from each category discussed in planning: a legacy-API-removal bug, a hooks-correctness bug, and a prop-regression bug. This is the fixed test case both the deterministic assertion and the LLM-judge grade against.

**Contract**: The diff content, verbatim:

```diff
diff --git a/src/components/UserProfileCard.jsx b/src/components/UserProfileCard.jsx
index 1a2b3c4..5d6e7f8 100644
--- a/src/components/UserProfileCard.jsx
+++ b/src/components/UserProfileCard.jsx
@@ -1,32 +1,24 @@
-import React from 'react';
+import { useEffect, useState } from 'react';
 
-class UserProfileCard extends React.Component {
-  static defaultProps = {
-    avatarUrl: '/default-avatar.png',
-  };
+function UserProfileCard({ userId, avatarUrl, displayName }) {
+  const [stats, setStats] = useState(null);
 
-  componentDidMount() {
-    this.fetchStats(this.props.userId);
-  }
+  useEffect(() => {
+    fetchUserStats(userId).then(setStats);
+  }, []);
 
-  componentDidUpdate(prevProps) {
-    if (prevProps.userId !== this.props.userId) {
-      this.fetchStats(this.props.userId);
-    }
-  }
-
-  fetchStats(userId) {
-    fetchUserStats(userId).then((stats) => this.setState({ stats }));
-  }
-
-  render() {
-    return (
-      <div className="profile-card">
-        <img src={this.props.avatarUrl} alt={this.props.displayName} />
-        <h2>{this.props.displayName}</h2>
-        <StatsPanel stats={this.state?.stats} />
-      </div>
-    );
-  }
+  return (
+    <div className="profile-card">
+      <img src={avatarUrl} alt={displayName} />
+      <h2>{displayName}</h2>
+      <StatsPanel stats={stats} />
+    </div>
+  );
 }
 
 export function mountUserProfileCard(container, props) {
   ReactDOM.render(<UserProfileCard {...props} />, container);
 }
 
 export default UserProfileCard;
```

The 3 flaws this diff must contain, precisely (needed verbatim for the judge rubric in change #3 below):

1. **Hooks correctness**: the `useEffect` fetching stats has an empty dependency array (`[]`) but reads `userId` from the component's props/closure — stats never refetch when a different user is viewed (stale closure / missing dependency).
2. **Prop regression**: `defaultProps` (which defaulted `avatarUrl` to `/default-avatar.png`) was dropped when converting to a function component, with no default-parameter or fallback replacement — callers that previously relied on the default now render a broken/undefined avatar.
3. **Legacy API removal**: `mountUserProfileCard` still calls `ReactDOM.render`, which is removed in React 19 in favor of `createRoot(container).render(...)` — this throws/fails at runtime.

#### 2. Custom promptfoo provider

**File**: `packages/code-reviewer/evals/provider.ts`

**Intent**: The adapter promptfoo calls once per `(provider entry, test case)` pair. Wraps `createCodeReviewAgent({ modelId })` (the model comes from this provider entry's own YAML `config:`, one entry per model under test) and formats the result with the existing, already-tested `formatReviewComment` — no new formatting logic, this eval reuses the exact PR-comment renderer.

**Contract**: Exports a `default class` implementing promptfoo's `ApiProvider` interface:
- `constructor(options: ProviderOptions)` — reads `options.config.modelId`, stores it on the instance. This is where the per-provider model selection is threaded through (see Critical Implementation Details — config arrives here, not in `callApi`).
- `id()` — returns a stable label incorporating the model id (e.g. `` `code-review:${this.modelId}` ``), so promptfoo's report distinguishes the 3 runs.
- `async callApi(prompt, context)` — reads `prTitle`, `prDescription`, `diff` from `context.vars`, calls `createCodeReviewAgent({ modelId: this.modelId }).review(...)`, and returns `{ output: formatReviewComment(result), metadata: { recommendation: result.recommendation } }`. Let a thrown error from `.review(...)` propagate (matches the existing no-retry convention from `ci-review.ts`/`agent.ts`) — do not catch and swallow it into a `{ error: ... }` response.

#### 3. Promptfoo configuration

**File**: `packages/code-reviewer/evals/promptfooconfig.yaml`

**Intent**: Wires the 3 models under test, the fixture diff, the deterministic assertion, and the LLM-judge rubric into one runnable eval.

**Contract**:
- `prompts:` — a single placeholder string satisfying promptfoo's schema requirement; the custom provider ignores it entirely and reads `context.vars` directly instead.
- `providers:` — 3 entries, all `id: file://provider.ts`, each with a distinct `label` and `config: { modelId: <one of z-ai/glm-5.1, deepseek/deepseek-v4-flash, anthropic/claude-sonnet-4.5> }`.
- `defaultTest.vars` — `prTitle` and `prDescription` as short inline strings describing the migration PR; `diff: file://fixtures/react-migration.diff`.
- `defaultTest.assert` — two entries:
  1. `type: javascript` checking the provider's `metadata.recommendation === 'fail'` (see Critical Implementation Details for the exact accessor to confirm at implementation time).
  2. `type: llm-rubric` with `provider: openrouter:openai/gpt-5.1` (a model distinct from all 3 under test, chosen specifically to avoid a model grading its own output) and a `value:` rubric instructing the judge that the review must explicitly call out **all three** flaws listed in change #1 above to pass — quote all three flaw descriptions verbatim in the rubric text so the judge has an unambiguous bar, and state explicitly that missing even one flaw fails the test regardless of other valid points raised.
- `tests:` — a single entry (`- {}`) that inherits everything from `defaultTest`, since this first configuration has exactly one fixture.

#### 4. Package wiring

**File**: `packages/code-reviewer/package.json`

**Intent**: Make the eval runnable and validatable via npm scripts, and declare promptfoo as a devDependency (needed both for its CLI and for type-only imports in `provider.ts`).

**Contract**:
- Add `"promptfoo": "^0.122.2"` to `devDependencies`.
- Add `"eval": "node --env-file=.env node_modules/.bin/promptfoo eval -c evals/promptfooconfig.yaml"`.
- Add `"eval:validate": "node_modules/.bin/promptfoo validate config -c evals/promptfooconfig.yaml"` (no `--env-file` needed — this makes zero API calls).

#### 5. TypeScript config coverage

**File**: `packages/code-reviewer/tsconfig.json`

**Intent**: `evals/**/*.ts` isn't covered by either existing tsconfig (`tsconfig.json` only includes `src/**/*.ts`; `test/tsconfig.json` only adds `test/**/*.ts`), so `npm run typecheck` would silently skip the new provider file.

**Contract**: Add `"evals/**/*.ts"` to the root `include` array alongside `"src/**/*.ts"`.

#### 6. Mocked unit test for the provider's adapter logic

**File**: `packages/code-reviewer/test/eval-provider.test.ts`

**Intent**: Cover the provider's own new logic — reading `config.modelId` from the constructor, threading it into `createCodeReviewAgent`, and shaping the `ProviderResponse` — without any live call, following the same `MockLanguageModelV4` pattern as `test/agent.test.ts`.

**Contract**: At minimum, verify: (a) the returned `output` string starts with `formatReviewComment`'s marker and contains the bold verdict line; (b) `metadata.recommendation` matches the mocked `CodeReviewResult.recommendation`; (c) a rejection from `createCodeReviewAgent().review(...)` propagates out of `callApi` rather than being swallowed.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes in `packages/code-reviewer/` (now covering `evals/**/*.ts`)
- `npm test` passes in `packages/code-reviewer/`, including the new `eval-provider.test.ts`, with zero network access
- `npm run eval:validate` passes (promptfoo's schema-only check, zero API calls)

#### Manual Verification:

- Read `evals/fixtures/react-migration.diff` and confirm it plausibly represents a React 16→19 migration containing exactly the 3 documented flaws — no more, no fewer, so the judge rubric stays precisely calibrated

---

## Phase 2: Live verification

### Overview

The actual paid run: 3 models reviewing the fixture diff, plus a judge model grading each review. Cannot be automated — this is a real-money operation by design.

### Changes Required:

None — this phase runs what Phase 1 built. No new files.

### Success Criteria:

#### Automated Verification:

- None applicable — verifying a live, cost-incurring promptfoo run cannot be automated.

#### Manual Verification:

- **BLOCKED pending explicit user go-ahead** — this step makes real, billed OpenRouter calls (3 review models + 1 judge model per run). Do not start until you confirm `OPENROUTER_API_KEY` is set and give the go-ahead to spend.
- Run `npm run eval`; confirm all 3 providers execute and produce output in the report.
- Confirm the deterministic assertion (`recommendation === 'fail'`) passes for all 3 models — the fixture diff is unambiguously broken, so this should never fail.
- For at least one model, read its raw formatted review (not just the judge's pass/fail) and confirm the judge's verdict actually matches what that review said — per `context/foundation/lessons.md`'s "a stubbed AI client cannot tell you the model's output is usable" rule, applied here to the judge itself: don't trust the judge's verdict without spot-checking it against real output at least once.
- Re-run `npm run eval` a second time with no changes and confirm promptfoo's cache avoids re-billing for unchanged provider/test pairs.
- Record the actual cost, token usage, and latency observed for the run in this change's notes — estimates are frequently off by several times actual usage.

**Implementation Note**: After Phase 1's automated verification is confirmed complete, pause here for the user's explicit manual go-ahead before triggering the real, cost-incurring live run.

---

## Testing Strategy

### Unit Tests:

- `evals/provider.ts`: mocked coverage of `modelId` threading, `ProviderResponse` shape, and error propagation — zero network, fixture-based, matching `test/agent.test.ts`'s pattern.

### Integration Tests:

- None automated — the live promptfoo run against 3 real models plus a judge model is this eval's own integration test, verified manually per Phase 2 (consistent with this repo's existing "no real LLM calls automatically" posture).

### Manual Testing Steps:

1. Confirm `OPENROUTER_API_KEY` is set.
2. Run `npm run eval`; confirm a report is produced covering all 3 models.
3. Confirm the deterministic assertion passes for all 3 (the diff is unambiguously broken).
4. Spot-check the judge's verdict against at least one model's raw review text.
5. Re-run and confirm caching avoids re-billing for unchanged inputs.
6. Record actual cost/tokens/latency.

## Performance Considerations

promptfoo's disk cache avoids repeat spend on unchanged provider/test-case pairs across re-runs. This first configuration has exactly one test case × 4 model calls per run (3 reviewers + 1 judge); cost is further bounded by the underlying agent's own `stopWhen: isStepCount(4)` cap on tool-loop steps per review.

## Migration Notes

None — net-new files and config, no existing behavior changed.

## References

- Research: `context/changes/code-review-evals/research.md`
- Agent under evaluation: `packages/code-reviewer/src/agent.ts`, `packages/code-reviewer/src/format-review-comment.ts`
- Existing mocked-model test pattern: `packages/code-reviewer/test/agent.test.ts`
- Sibling m5l3 work: `context/archive/2026-08-30-ci-cd-code-review/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Provider, fixture, and config

#### Automated

- [x] 1.1 `npm run typecheck` passes in `packages/code-reviewer/` (now covering `evals/**/*.ts`)
- [x] 1.2 `npm test` passes in `packages/code-reviewer/`, including the new `eval-provider.test.ts`, with zero network access
- [x] 1.3 `npm run eval:validate` passes (promptfoo's schema-only check, zero API calls)

#### Manual

- [ ] 1.4 `evals/fixtures/react-migration.diff` plausibly represents a React 16→19 migration containing exactly the 3 documented flaws

### Phase 2: Live verification

#### Manual

- [ ] 2.1 `OPENROUTER_API_KEY` set; explicit go-ahead given to spend
- [ ] 2.2 `npm run eval` runs all 3 providers and produces a report
- [ ] 2.3 Deterministic assertion passes for all 3 models
- [ ] 2.4 Judge verdict spot-checked against at least one model's raw review text
- [ ] 2.5 Re-run confirms caching avoids re-billing for unchanged inputs
- [ ] 2.6 Actual cost/tokens/latency recorded
