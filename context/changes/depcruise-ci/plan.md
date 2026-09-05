# Wire dependency-cruiser into CI — Implementation Plan

## Overview

`.dependency-cruiser.cjs` already declares every cross-app boundary rule this repo cares about (`extension-popup-stays-off-the-network`, `backend-plugins-are-below-routes`, `no-cross-app-imports`, `backend-no-cross-route-imports`, `frontend-api-is-below-pages`, `observability-stays-a-leaf`, `no-test-code-in-production-code`, plus stock hygiene rules) — all at `severity: error`, and each was verified by deliberate break (`1477298`). `scripts/depcruise.mjs` already wraps the correct invocation (`npx -p dependency-cruiser -p typescript depcruise --config .dependency-cruiser.cjs`, cruising all four apps in one pass so cross-app edges are visible). None of it runs in any CI or hook layer — `grep -rn 'depcruise\|dependency-cruiser' .github/ .githooks/ scripts/quality/` returns zero hits, and `AGENTS.md` says so outright. This plan adds exactly one CI step, in two workflows, that runs the existing script and gates the job on it — preceded by a small Phase 1 that clears a pre-existing violation the plan-review pass found, so the gate starts green rather than red.

## Current State Analysis

- **`node scripts/depcruise.mjs` does not pass clean on `main` today**, contrary to `refactor-opportunities/research.md`'s framing (that research was verified against a commit that predates this). Confirmed live: `error no-circular: backend/src/domain/translationDraft.ts → backend/src/domain/translator.ts → backend/src/domain/translationDraft.ts`, `exit 1`. `translationDraft.ts` imports the value classes `DegenerateDraftError`/`MalformedDraftError` from `translator.ts` (a real runtime edge); `translator.ts` imports `TranslationDraft`/`DraftSenseTranslation`/`RequestedLanguages` from `translationDraft.ts` type-only (erased at runtime — deliberately, per that file's own comment). `tsPreCompilationDeps: true` in `.dependency-cruiser.cjs` counts the type-only leg as a graph edge too, so the pair reads as a cycle to the cruiser even though there is no runtime cycle. This landed via the `anti-corruption-layer`/`invariant-aggregate-refactor` changes (2026-08-23 onward), after `research.md`'s verification commit. Landing the CI wiring without fixing this would fail the very first run, for a reason unrelated to whatever that run's actual diff is — Phase 1 below closes this before Phase 2 turns the gate on.
- `.github/workflows/pr-diff.yml`'s `diff` job runs backend build+tests, then installs `infra/` deps, then runs frontend tests (`npm ci && npm test`), then extension tests (`npm ci && npm test && npm run lint && npm run build`), then writes the frontend env and builds it, then runs `cdk diff`.
- `.github/workflows/deploy.yml`'s `diff` job is a near-exact structural mirror — its own comments say so verbatim ("Same rationale as pr-diff.yml", "See pr-diff.yml for why this rides inside `diff`") — and gates the `deploy` job via `needs: [diff, print-tests]`.
- The earliest point in either job where all four apps' `node_modules` exist is right after the extension-tests step: backend's `npm ci` runs in "Build backend", infra's in "Install infra deps", frontend's in "Run frontend tests", extension's in "Run extension tests". `scripts/depcruise.mjs` needs all four (`SOURCES` spans `frontend/`, `backend/`, `extension/`, `infra/`, `scripts/`).
- The `diff` job in `pr-diff.yml` is already a required status-check context on the `PR-Needed` ruleset; the `diff` job in `deploy.yml` already gates `deploy` via `needs:`. A new step inside either job inherits that gating automatically — no ruleset or branch-protection change needed, the same pattern the extension-tests step already relies on.
- Only the "Diff" step (`cdk diff`) writes to `$GITHUB_STEP_SUMMARY` today; every other step (backend/frontend/extension tests) reports through the plain job log only.
- `scripts/depcruise.mjs` already defaults to `--output-type err-long` when no reporter flag is forwarded, and exits with dependency-cruiser's own status code — no change needed to the script itself.

## Desired End State

Both `pr-diff.yml`'s and `deploy.yml`'s `diff` jobs run `node scripts/depcruise.mjs` as a step immediately after "Run extension tests". A cross-app or layering violation fails that step (and therefore the job) exactly like a failing test does today, and its `err-long` output is also appended to `$GITHUB_STEP_SUMMARY` under a `## Dependency Cruise` heading when the step fails, so a violation is visible on the PR/run summary page without opening the step log.

### Key Discoveries

- `scripts/depcruise.mjs:82` — `process.exit(result.status ?? 1)` — the script already propagates dependency-cruiser's exit code, so a plain `run: node scripts/depcruise.mjs` step fails the job on any `error`-severity violation with no extra flags.
- `.github/workflows/pr-diff.yml:215-225` — the "Diff" step's `$GITHUB_STEP_SUMMARY` pattern (`echo '## ...' >> "$GITHUB_STEP_SUMMARY"`, fenced code block, `|| true` only on the informational `cdk diff` call) is the template to follow for the failure-path summary write.
- **Verified during plan review (empirically, not reasoned)**: extracting `TranslatorUnavailableError`, `MalformedDraftError`, `DegenerateDraftError` out of `backend/src/domain/translator.ts` into a new `backend/src/domain/translatorErrors.ts` — with `translator.ts` re-exporting them so `anthropicTranslator.ts`'s existing import keeps working unchanged, and `translationDraft.ts` importing the two it throws directly from the new module — was tested live (edit → `node scripts/depcruise.mjs` → `exit 0` → revert). This is the smallest fix that removes the cycle without touching `.dependency-cruiser.cjs`. A narrower per-rule config filter (`dependencyTypesNot: ['type-only']` on the `no-circular` rule) was also tried and does **not** work — dependency-cruiser reports the cycle via whichever edge it traverses first, which is the non-type-only one here, so that filter is a dead end.

## What We're NOT Doing

- Not adding a `--output-type` flag or any other change to `scripts/depcruise.mjs` — its existing default (`err-long`) is already the right verbosity for a CI failure.
- Not wiring dependency-cruiser into `.githooks/pre-push` or any local hook — the repo's own research (`context/changes/refactor-opportunities/research.md` §5.1 C-12, quoting the deliberate-at-the-time note) explicitly defers that to "if it starts catching things"; this change is CI-only.
- Not adding a new required-status-check context to the `PR-Needed` ruleset — the step rides inside the existing `diff` job, which is already required.
- Not changing any `.dependency-cruiser.cjs` rule, adding new rules, or scoping any exception — the one pre-existing violation is fixed at its source (Phase 1) instead of carved around in config.
- Not touching `print-tests` (either workflow) — it has no relationship to first-party module graphs.
- Not changing `Translator`, `TranslationRequest`, or `SenseTranslationRequest` in `translator.ts`, nor any behavior of the error classes themselves — Phase 1 is a verbatim move, not a redesign.

## Implementation Approach

**Phase 1 first, then Phase 2.** Plan review surfaced a pre-existing `no-circular` violation on `main` (see Current State Analysis) that would fail Phase 2's gate on its very first run, unrelated to whatever a future PR actually changes. Phase 1 removes that violation at its source — a verbatim, zero-behavior-change extraction — so Phase 2 turns on a gate that starts green.

Phase 2 adds one step, worded identically in both workflows (mirroring the existing pattern where extension-tests and frontend-tests comments already cross-reference each other), right after "Run extension tests" and before "Write frontend env from deployed stack outputs". The step runs `node scripts/depcruise.mjs` from the job's default working directory (the checkout root — `scripts/depcruise.mjs` resolves its own `REPO_ROOT` and does not need a `working-directory:` override, unlike the per-app steps). On failure, a second `if: failure()` step appends the same command's `err-long` output to the step summary under a `## Dependency Cruise` heading, using the same `>> "$GITHUB_STEP_SUMMARY"` pattern the "Diff" step already uses, so the failure path is visible without re-reading the job log.

Verification that the gate actually gates happens locally, once, as part of Phase 2: temporarily add a single cross-app import violating an existing `error`-severity rule, confirm `node scripts/depcruise.mjs` exits non-zero and names that rule, then revert the violation — proving the wiring works before it ships, rather than discovering a scoping mistake (wrong `SOURCES`, wrong config path) only on the first real CI run.

## Phase 1: Break the pre-existing domain cycle

### Overview

Extracts `translator.ts`'s three error classes into a standalone module so the value edge from `translationDraft.ts` back to `translator.ts` disappears, leaving only the one-directional (type-only) edge `translator.ts → translationDraft.ts` — which is not a cycle. Verbatim move, no behavior change, no other callers need to change.

### Changes Required:

#### 1. New error-classes module

**File**: `backend/src/domain/translatorErrors.ts` (new)

**Intent**: House the translator error taxonomy on its own, so both `translator.ts` (the port interface) and `translationDraft.ts` (which throws two of them) can depend on it without depending on each other for it.

**Contract**: Exports `TranslatorUnavailableError`, `MalformedDraftError`, `DegenerateDraftError` — identical class bodies (same constructor signatures, same `.name` assignment, same `readonly languageCodes` field on `DegenerateDraftError`, same doc comments) to what `translator.ts` currently defines. A verbatim move, not a rewrite.

#### 2. `translator.ts` re-exports instead of defining

**File**: `backend/src/domain/translator.ts`

**Intent**: Stop defining the error classes; re-export them from the new module so every existing importer (`anthropicTranslator.ts`) needs no change.

**Contract**: Replace the three `export class ...` blocks with a single `export { TranslatorUnavailableError, MalformedDraftError, DegenerateDraftError } from './translatorErrors.ts'`, placed after the existing type-only import of `translationDraft.ts`. The `Translator`, `TranslationRequest`, and `SenseTranslationRequest` interfaces are untouched.

#### 3. `translationDraft.ts` imports from the new module

**File**: `backend/src/domain/translationDraft.ts`

**Intent**: Throw the same two errors it already throws, sourced from the new module instead of `translator.ts` — this is the edit that actually removes the cycle.

**Contract**: Change `import { DegenerateDraftError, MalformedDraftError } from './translator.ts'` to `import { DegenerateDraftError, MalformedDraftError } from './translatorErrors.ts'`. No other line changes.

### Success Criteria:

#### Automated Verification:

- [ ] Dependency cruise passes clean after the extraction: `node scripts/depcruise.mjs` exits 0 (verified during plan review — this exact extraction produced exit 0 against current `main`)
- [ ] Backend typecheck passes: `cd backend && npm run build:ts`
- [ ] Backend test suite passes unchanged: `cd backend && npm test`

## Phase 2: Wire the cruise into both CI workflows

### Overview

Adds the depcruise step (plus its failure-path summary write) to `pr-diff.yml` and `deploy.yml`, and proves locally that a violation actually fails the check.

### Changes Required:

#### 1. `pr-diff.yml`'s `diff` job

**File**: `.github/workflows/pr-diff.yml`

**Intent**: Run the existing dependency-cruiser wrapper as a gating step, then surface a failure on the step summary.

**Contract**: Two new steps inserted between the existing "Run extension tests" step and the existing "Write frontend env from deployed stack outputs" step:

```yaml
      - name: Dependency cruise (architectural boundaries)
        run: node scripts/depcruise.mjs

      - name: Surface dependency-cruise violations in step summary
        if: failure()
        run: |
          echo '## Dependency Cruise' >> "$GITHUB_STEP_SUMMARY"
          echo '```' >> "$GITHUB_STEP_SUMMARY"
          node scripts/depcruise.mjs >> "$GITHUB_STEP_SUMMARY" 2>&1 || true
          echo '```' >> "$GITHUB_STEP_SUMMARY"
```

Add a one-line comment above the first step naming what it enforces and pointing at `.dependency-cruiser.cjs`, matching this file's existing comment density (see the extension-tests step's comment for the house style). No `working-directory:` key — the job's default `cwd` is the checkout root, which is what `scripts/depcruise.mjs`'s own `REPO_ROOT` resolution expects.

#### 2. `deploy.yml`'s `diff` job

**File**: `.github/workflows/deploy.yml`

**Intent**: Same two steps, in the same position relative to "Run extension tests", keeping the two workflows' `diff` jobs mirrored the way their existing comments already claim they are.

**Contract**: Identical step bodies to Phase 2 item 1. Comment style: follow this file's existing convention of "See pr-diff.yml for why..." cross-references rather than re-explaining the rationale.

### Success Criteria:

#### Automated Verification:

- [ ] Dependency cruise passes clean (now that Phase 1 removed the pre-existing violation): `node scripts/depcruise.mjs` exits 0
- [ ] `pr-diff.yml` stays valid YAML after the edit: `npx --yes -p js-yaml js-yaml .github/workflows/pr-diff.yml`
- [ ] `deploy.yml` stays valid YAML after the edit: `npx --yes -p js-yaml js-yaml .github/workflows/deploy.yml`
- [ ] The gate actually gates — deliberate break and revert, run from repo root:
  ```bash
  echo "import '../../backend/src/app.ts';" >> frontend/src/main.tsx
  node scripts/depcruise.mjs; echo "exit=$?"
  git checkout -- frontend/src/main.tsx
  ```
  Expect a non-zero exit naming `no-cross-app-imports` (`frontend/` → `backend/`), then confirm `git status --porcelain frontend/src/main.tsx` is empty after the revert.

#### Manual Verification:

- [ ] On the next real PR, confirm the "Dependency cruise (architectural boundaries)" step appears in `pr-diff.yml`'s `diff` job and reports green
- [ ] On the next push to `main` (or the next deploy run), confirm the same step appears and reports green in `deploy.yml`'s `diff` job, ahead of the `deploy` job's manual-approval gate

## Testing Strategy

### Unit Tests:

None — this is CI configuration, not application code; there is no unit-testable behavior to add.

### Integration Tests:

None new for Phase 2. The deliberate-break-and-revert command above is the closest thing to an integration test this change has, and it runs once during implementation rather than as a standing suite. Phase 1's safety net is the existing backend test suite (`npm test`) plus `tsc` — it is a pure structural move with no new behavior to test.

### Manual Testing Steps:

1. Open (or push to) a PR touching any file and watch `pr-diff.yml`'s Actions run — confirm the new step name appears in the job's step list and passes.
2. Confirm the CI run's summary page has no `## Dependency Cruise` section when the step passes (it should only append on failure).
3. On a subsequent push to `main`, confirm the equivalent step in `deploy.yml` passes ahead of the `deploy` job's manual-approval gate.

## Performance Considerations

Matches the existing measurement in `context/changes/refactor-opportunities/research.md` (§4, §5.1 C-12): ~17s per run, no new credentials, no database, no browsers — it rides inside a job that is already running for other reasons, so it adds wall-clock time to that job but no new job, no new required-status-check context, and no new secret.

## Migration Notes

Not applicable — no data, no schema, no deployed system state.

## References

- Related research: `context/changes/refactor-opportunities/research.md` § 5.1 C-12, § 5.2 (C-12 considered-and-not-ranked entry), § 4 (Step zero — the shared prerequisite, C-12's companion)
- Plan review: `context/changes/depcruise-ci/reviews/plan-review.md` — F1, the pre-existing `no-circular` violation Phase 1 fixes
- Existing invocation being wired in: `scripts/depcruise.mjs`
- Existing summary-write pattern being followed: `.github/workflows/pr-diff.yml`'s "Diff" step (and its mirror in `deploy.yml`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Break the pre-existing domain cycle

#### Automated

- [x] 1.1 Dependency cruise passes clean after the extraction: `node scripts/depcruise.mjs` exits 0 — 0c7d98c5
- [x] 1.2 Backend typecheck passes: `cd backend && npm run build:ts` — 0c7d98c5
- [x] 1.3 Backend test suite passes unchanged: `cd backend && npm test` — 0c7d98c5

### Phase 2: Wire the cruise into both CI workflows

#### Automated

- [ ] 2.1 Dependency cruise passes clean: `node scripts/depcruise.mjs` exits 0
- [ ] 2.2 `pr-diff.yml` stays valid YAML after the edit
- [ ] 2.3 `deploy.yml` stays valid YAML after the edit
- [ ] 2.4 The gate actually gates — deliberate break and revert proves a violation fails the check and the revert is clean

#### Manual

- [ ] 2.5 Next real PR shows the new step passing in `pr-diff.yml`'s `diff` job
- [ ] 2.6 Next push to `main` / deploy run shows the new step passing in `deploy.yml`'s `diff` job, ahead of `deploy`
