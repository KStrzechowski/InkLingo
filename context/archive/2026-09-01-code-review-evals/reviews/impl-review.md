<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Code Review Evals (promptfoo) Implementation Plan

- **Plan**: context/changes/code-review-evals/plan.md
- **Scope**: Phase 1 + Phase 2 (full plan)
- **Date**: 2026-09-02
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Provider doesn't validate `config.modelId` is present

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/code-reviewer/evals/provider.ts:13
- **Detail**: `this.modelId = options.config?.modelId;` has no validation that `modelId` is actually present/non-empty. If a promptfoo config entry typo'd the key (e.g. `modelID`), `modelId` becomes `undefined`, and `createCodeReviewAgent` (`src/agent.ts:36`) silently falls back to the `OPENROUTER_MODEL` env var or `DEFAULT_MODEL` — while the eval report still shows that provider entry's configured `label` (e.g. "claude-sonnet-4.5"). That produces a silently mislabeled model run, which is exactly the failure mode this eval harness exists to catch elsewhere.
- **Fix**: Throw in the constructor if `!options.config?.modelId`, mirroring the fail-fast pattern `src/agent.ts` already uses for its own `recordReview` invariant.
- **Decision**: FIXED — constructor now throws `'CodeReviewProvider requires config.modelId (check promptfooconfig.yaml provider entries).'` when `modelId` is falsy. Re-verified `npm run typecheck`, `npm test` (18/18), `npm run eval:validate` all still pass.

### F2 — Test-only `model` bypass lives on the generic `config` field

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency / latent risk
- **Location**: packages/code-reviewer/evals/provider.ts:8-10,14
- **Detail**: The `model: LanguageModel | undefined` field is a test-only escape hatch guarded only by a code comment ("never set by the real promptfoo config"). It mirrors the pre-existing, legitimate `CreateCodeReviewAgentOptions.model` seam in `agent.ts` and is not reachable via the checked-in YAML config (a `LanguageModel` instance can't be expressed in YAML). Risk is low today, but it lives on the same generic `options.config` object promptfoo threads from any config source, including a hypothetical `.js`/`.ts` promptfoo config that could construct a real `LanguageModel` object and silently bypass OpenRouter with no runtime guard.
- **Fix**: No action required now — this is intentionally low-risk and matches an established repo pattern. Flagged for awareness only.
- **Decision**: SKIPPED

### F3 — Windows npm-script fix not recorded in change.md

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence / Documentation
- **Location**: packages/code-reviewer/package.json (`eval`, `eval:validate` scripts)
- **Detail**: The plan specified `node_modules/.bin/promptfoo ...`. The actual scripts invoke `node_modules/promptfoo/dist/src/entrypoint.js` directly, because `.bin/promptfoo` is a POSIX shebang shim that isn't directly `node`-executable on Windows (confirmed via promptfoo's own `package.json` `bin` field, which points at that same `entrypoint.js`). This was explained to the user in the implementation conversation and is functionally verified (both live Phase 2 `npm run eval` runs succeeded), but `change.md`'s Notes section only records the caching/model-flakiness findings from Phase 2 — not this Phase 1 script fix and its reasoning.
- **Fix**: Append one line to `change.md`'s Notes documenting the Windows `.bin` shim issue and the `entrypoint.js` fix, for future readers who diff the plan's literal script text against what's actually committed.
- **Decision**: FIXED — added a "Phase 1 implementation-time deviations" section to `change.md`'s Notes.

## Sub-review summaries

**Plan drift** (all 6 Phase 1 "Changes Required" items + Phase 2): 3 MATCH (fixture diff — byte-identical to plan; promptfoo config — matches including the confirmed `context.metadata?.recommendation` accessor; mocked unit test — clean, well-isolated coverage of all 3 contract points), 3 ADAPTED (provider.ts's extra test-only `model` field — see F2; package.json's Windows-safe script rewrite — see F3; tsconfig's added `skipLibCheck` — documented in commit `dabab01`'s message). No DRIFT, MISSING, or EXTRA. Phase 2 confirmed no unplanned files.

**Safety & pattern compliance**: No CRITICAL issues. No hardcoded secrets, no injection vectors, no resource leaks. `evals/provider.ts` and `test/eval-provider.test.ts` follow `src/agent.ts`/`test/agent.test.ts`'s conventions exactly (`.ts` extensions, `import type`, error-propagation contract, `MockLanguageModelV4` mocking pattern) — no unjustified pattern drift. `tsconfig.json`'s `skipLibCheck: true` only affects `.d.ts` files (including transitively-pulled-in `drizzle-orm` types from `promptfoo`'s own type declarations) and does not weaken checking of this package's own `src/**`/`evals/**` source.

**Success criteria**: All 3 automated checks re-verified passing at review time (`npm run typecheck`, `npm test` — 18/18, `npm run eval:validate`). All 7 manual checks (1.4, 2.1–2.6) are checked `[x]` in the plan's Progress section with evidence in `change.md` — including an honest correction where 2.5 could not pass as originally worded (promptfoo's cache doesn't apply to this custom-provider architecture) and was checked off as "verified false, finding recorded" per explicit user direction rather than silently skipped or mis-marked as a clean pass.
