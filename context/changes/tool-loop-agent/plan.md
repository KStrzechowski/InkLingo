# Tool Loop Agent Implementation Plan

## Overview

This is a **retrofit plan**: `packages/code-reviewer/` (the Module 5 team agent — an AI code-review agent built on the Vercel AI SDK's `ToolLoopAgent`, OpenRouter, and Zod) was already scaffolded and committed (`f48bcc7`) before this plan was written, skipping the normal plan-first workflow. This plan documents what was built, records the decisions made after the fact with the user's actual input, and adds the hardening work (tests, cost-aware defaults) that a proper plan would have called for.

## Current State Analysis

`packages/code-reviewer/` exists as an independent npm project (matching the repo's pattern of decoupled apps with no root `package.json`):

- `src/schemas/review.ts` — a Zod schema (`codeReviewResultSchema`) mirroring the six graded criteria from `.claude/prompts/m5l3-requirements.md` (implementation correctness, idiomaticity, complexity, test/risk coverage, documentation, security and safety), each with a 1–10 `score` and a `reasoning` string, plus a `summary` and a `recommendation: 'pass' | 'fail'`.
- `src/prompts/code-review.ts` — the system prompt, carrying the same rubric text (1 and 10 anchors) verbatim from the course's requirements doc, instructing the model to call `recordReview` exactly once.
- `src/agent.ts` — `createCodeReviewAgent(modelId?)` builds a `ToolLoopAgent` (OpenRouter as the model provider via `openrouter.chat(modelId)`, `instructions` set to the system prompt, one tool `recordReview` whose `execute` captures its input into a closure variable, `stopWhen: isStepCount(4)`). `review(input)` calls `agent.generate()` and returns the captured result, throwing if the tool was never called.
- `src/index.ts` — a CLI entry point (`tsx src/index.ts <diff-file> [title] [description]`) plus re-exports of `createCodeReviewAgent` and the schema/types for the CI workflow (m5l3) to import directly. Guards for missing args and a missing `OPENROUTER_API_KEY` both exit 1 with a clear message (verified manually — see Phase 1 below).

Package versions were pinned to the latest resolved from the npm registry at build time: `ai@^7.0.85`, `@openrouter/ai-sdk-provider@^3.0.0`, `zod@^4.5.4`, `typescript@^7.0.2`, `tsx@^4.23.13`, `@types/node@^26.4.0`, plus `@types/json-schema@^7.0.15` (a transitive type-only dependency `@ai-sdk/provider` needs but doesn't declare).

`npm run typecheck` (`tsc --noEmit`) passes clean. No unit tests exist. No live model call has ever been made — there is no `OPENROUTER_API_KEY` yet.

### Key Discoveries:

- The AI SDK's real API differs from the version briefly referenced during scaffolding: the agent's system prompt field is `instructions`, not `system` (`node_modules/ai/dist/index.d.ts:4997`), and the step-limit helper is `isStepCount(n)`, not `stepCountIs(n)` (`node_modules/ai/dist/index.d.ts:1800`). Both were caught by `tsc` and fixed before the first commit.
- `backend/` (the only other TypeScript-only, non-frontend app in this repo) tests with Node's built-in `node --test` runner rather than vitest/jest (`backend/package.json:11`) — Phase 2 follows that convention rather than introducing a new test runner for a single package.
- The user flagged a real cost concern before this plan was finalized: OpenRouter is billed per token, separately from both the Claude Code session itself and InkLingo's own Anthropic-based translation feature. The original scaffold defaulted to `anthropic/claude-sonnet-4.5`; this plan's Phase 1 already corrected that to a cheap-tier default (`deepseek/deepseek-v4-flash`, one of the models the course's own promptfoo lesson references) with an `OPENROUTER_MODEL` env var override, and the retry-on-failure question below was decided against specifically to avoid doubling cost on a flaky response.

## Desired End State

`packages/code-reviewer` has: a cost-aware default model (done), unit test coverage for the schema and prompt that runs with zero network calls and zero cost, and a documented, explicitly-deferred manual step for the first live verification once the user has an OpenRouter key. Nothing in this phase requires spending any money.

Verification: `npm run typecheck` and `npm test` both pass with no network access; `git log` shows the scaffold commit this plan documents.

## What We're NOT Doing

- Wiring this agent into GitHub Actions or any CI trigger — that's m5l3.
- Formatting `CodeReviewResult` into PR-comment markdown or computing labels — deferred to m5l3 per the user's explicit decision (this package stays a clean structured-output library).
- Adding a spending cap / max-diff-size guard — the user chose the cheap-default-plus-env-var approach as sufficient for now.
- Adding automatic retry when the model fails to call `recordReview` — the user chose to keep the cheaper, fully deterministic throw-immediately behavior.
- promptfoo eval configuration (multi-model comparison, LLM-as-judge) — that's m5l3's second half.

## Implementation Approach

Phase 1 records the existing scaffold as-built (no new code beyond the cost-default fix already applied). Phase 2 adds a test file using the AI SDK's mock-model test utilities so the schema and prompt are exercised without any real API call. Phase 3 is a manual-only phase, explicitly blocked on the user obtaining an `OPENROUTER_API_KEY`, and is not to be started until they say so.

## Phase 1: Core agent scaffold (retro-documented)

### Overview

Records the already-built and committed agent package as this plan's first phase, so the change folder has a complete trail from decision to code.

### Changes Required:

#### 1. Agent package (already implemented)

**File**: `packages/code-reviewer/src/agent.ts`, `src/schemas/review.ts`, `src/prompts/code-review.ts`, `src/index.ts`, `package.json`, `tsconfig.json`

**Intent**: Already landed in commit `f48bcc7` (scaffold) plus a follow-up edit changing `DEFAULT_MODEL` to `deepseek/deepseek-v4-flash` with an `OPENROUTER_MODEL` env var override (not yet committed — see Progress). No further changes required for this phase.

**Contract**: `createCodeReviewAgent(modelId?: string): { review(input: CodeReviewInput): Promise<CodeReviewResult> }`, exported from `src/index.ts` alongside `CodeReviewResult`/`codeReviewResultSchema` for m5l3 to import directly.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `cd packages/code-reviewer && npm run typecheck`
- CLI usage guard exits 1 with no args: `npx tsx src/index.ts`
- CLI missing-key guard exits 1 without `OPENROUTER_API_KEY` set: `npx tsx src/index.ts nonexistent.diff title desc`

#### Manual Verification:

- Both guard messages read clearly and point at the right fix (`.env.example`, OpenRouter key URL)

---

## Phase 2: Unit test coverage (schema + prompt, no network)

### Overview

Adds automated tests that catch schema or prompt regressions without ever calling OpenRouter, matching the user's decision to defer all network/cost exposure to a manual step.

### Changes Required:

#### 1. Test runner wiring

**File**: `packages/code-reviewer/package.json`, `packages/code-reviewer/tsconfig.json` (or a sibling `test/tsconfig.json` if type-checking test files needs different settings, following `backend/test/tsconfig.json`'s pattern)

**Intent**: Add a `test` script running Node's built-in test runner over `test/**/*.ts`, mirroring `backend/package.json`'s convention rather than introducing vitest/jest for a single small package.

**Contract**: `npm test` in `packages/code-reviewer/` runs and exits 0 on success, exits non-zero on any failing assertion.

#### 2. Schema validation tests

**File**: `packages/code-reviewer/test/review-schema.test.ts`

**Intent**: Verify `codeReviewResultSchema` accepts a well-formed review object covering all six criteria plus `summary` and `recommendation`, and rejects structurally invalid input (a score outside 1–10, a missing criterion, an invalid `recommendation` value).

**Contract**: Exercises `codeReviewResultSchema.safeParse(...)` directly — no agent, no model, no network.

#### 3. Prompt content test

**File**: `packages/code-reviewer/test/code-review-prompt.test.ts`

**Intent**: Guard against silently dropping a criterion from the prompt if it's ever edited — assert `CODE_REVIEW_SYSTEM_PROMPT` mentions all six criterion names and the instruction to call `recordReview` exactly once.

**Contract**: A plain string-content assertion against the exported prompt constant.

#### 4. Agent capture/throw behavior test

**File**: `packages/code-reviewer/test/agent.test.ts`

**Intent**: Verify `createCodeReviewAgent(...).review(...)` (a) resolves with the tool's captured input when the model calls `recordReview`, and (b) throws the documented error when it doesn't — both without a real network call, using the AI SDK's mock language model test utilities (`ai/test`, or the package's documented equivalent at the pinned `ai@^7.0.85` version) in place of `openrouter.chat(...)`.

**Contract**: Two test cases exercising `review()`'s two documented outcomes; whichever mock/DI approach is used, it must not require `OPENROUTER_API_KEY` or reach the network.

### Success Criteria:

#### Automated Verification:

- `npm test` passes in `packages/code-reviewer/`
- Typecheck still passes: `npm run typecheck`
- No test opens a network connection (verified by running with no `OPENROUTER_API_KEY` set and no network available)

#### Manual Verification:

- Reading the four test files, each one's failure message would clearly point at what broke (schema, prompt, or capture/throw behavior)

---

## Phase 3: Manual live verification (blocked on API key)

### Overview

The first real call to a live model, done once — confirms the schema/prompt actually produce a usable review, not just a structurally valid one. Explicitly blocked until the user has an `OPENROUTER_API_KEY`; do not start this phase without the user's go-ahead.

### Changes Required:

None — no code changes, unless the live run surfaces a real defect (schema too strict/loose, prompt ambiguity), in which case that fix would be scoped as a new, small follow-up change rather than folded in here.

### Success Criteria:

#### Automated Verification:

- N/A — this phase is manual by design

#### Manual Verification:

- With `OPENROUTER_API_KEY` set, `npm run dev -- <a small real diff> "title" "description"` completes and prints a `CodeReviewResult` with plausible scores/reasoning for that diff (a stubbed client cannot tell you the model's output is usable — this is the one real check for that, matching the lesson already recorded in `context/foundation/lessons.md`)
- The user confirms the recommendation (`pass`/`fail`) and per-criterion reasoning look sane, not just schema-valid

---

## Testing Strategy

### Unit Tests:

- Schema accepts a valid full review; rejects out-of-range scores, missing criteria, and an invalid `recommendation` enum value
- Prompt contains all six criterion names and the "call recordReview exactly once" instruction
- Agent resolves with the captured review when the tool is called; throws the documented error when it isn't

### Integration Tests:

- None in this plan — the only "integration" surface (a live OpenRouter call) is Phase 3's manual, one-off verification, not an automated integration suite, to avoid recurring cost.

### Manual Testing Steps:

1. Run the CLI with no arguments — confirm the usage message and exit code 1.
2. Run the CLI with a diff path but no `OPENROUTER_API_KEY` set — confirm the key-missing message and exit code 1.
3. (Phase 3, once a key exists) Run the CLI against a real, small diff and read the output for plausibility.

## Performance Considerations

None beyond cost: `stopWhen: isStepCount(4)` bounds the worst-case number of model calls per review to 4, and the cheap default model plus `OPENROUTER_MODEL` override are the agreed cost controls for this phase.

## Migration Notes

Not applicable — new package, no existing data or callers.

## References

- Course requirements this agent implements: `.claude/prompts/m5l3-requirements.md`, `.claude/prompts/m5l2-agent.md`
- Prior lesson on stubbed-vs-live AI verification: `context/foundation/lessons.md` § "A stubbed AI client cannot tell you the model's output is usable"
- Backend's Node-test-runner convention: `backend/package.json:11`
- Opportunity map / Mom Test that led here: `context/team/opportunity-map.md`, `context/team/mom-test-validation.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Core agent scaffold (retro-documented)

#### Automated

- [x] 1.1 Typecheck passes — `f48bcc7`
- [x] 1.2 CLI usage guard exits 1 with no args — `f48bcc7`
- [x] 1.3 CLI missing-key guard exits 1 without `OPENROUTER_API_KEY` — `f48bcc7`

#### Manual

- [x] 1.4 Guard messages read clearly — verified in-session before this plan was written

### Phase 2: Unit test coverage (schema + prompt, no network)

#### Automated

- [x] 2.1 `npm test` passes in `packages/code-reviewer/` — a5d8a03
- [x] 2.2 Typecheck still passes — a5d8a03
- [x] 2.3 No test opens a network connection — a5d8a03

#### Manual

- [x] 2.4 Each test file's failure message clearly points at what broke — a5d8a03

### Phase 3: Manual live verification (blocked on API key)

#### Manual

- [x] 3.1 Live CLI run produces a plausible `CodeReviewResult` for a real diff
- [x] 3.2 User confirms recommendation and reasoning look sane
