# Backend CI Safety Net Implementation Plan

## Overview

Phase 1 of the frozen test-plan rollout (`context/foundation/test-plan.md` §3). Three deliverables against Risk #1 and Risk #7: prove the existing AI-route rate-limit guard actually rejects excess traffic, add a deterministic check that every backend route is reachable through the real API Gateway wiring, and wire `npm test` into CI — both `pr-diff.yml` (for PRs) and `deploy.yml` (for direct pushes to `main`, the actual practice on this repo today) — so all of it actually gates merges/deploys.

## Current State Analysis

- **Risk #7 (AI-route cost cap) is already mitigated, just untested.** `@fastify/rate-limit` is registered (`backend/src/plugins/rate-limit.ts`, `global: false`) and applied to both Anthropic-calling routes via a `translateRateLimit` config (`backend/src/routes/api/collections/index.ts:60-66`, `max: 20/minute`, keyed by `request.authUser.id`). No test anywhere proves the guard rejects a 21st request — `backend/test/` has zero filesystem/config-inspection style tests and no test fires more than a handful of requests at one route.
- **Risk #1 (route reachability) has no check at all.** `infra/lib/constructs/api-construct.ts` hand-registers 7 `addRoutes` calls (lines 143-193); `backend/src/routes/` currently defines exactly those 7 (plus one extra, `GET /`, that has no gateway entry). They're in sync today by manual discipline only — the same failure mode already shipped twice per `context/foundation/lessons.md`.
- **`GET /` (`backend/src/routes/root.ts`) is dead code**, not a deliberate exemption. It's the unmodified Fastify-CLI scaffold default (`{ root: true }`), has no callers in `frontend/` or `extension/`, and is redundant with `GET /health`. The codebase's actual sanctioned pattern for a future public route is a `config.public` opt-out inside `routes/api/autohooks.ts` (deliberately deferred, per prior `account-auth` decision) — not an unauthenticated route sitting outside `routes/api/`. Deleting it removes the only asymmetry between the two route sets, so the reachability check can be a plain 1:1 diff with no exemption mechanism.
- **CI runs no tests today.** Neither `.github/workflows/pr-diff.yml` (PR-triggered) nor `deploy.yml` (post-merge) invokes `npm test` or `npm run lint` for any app — both are build-then-`cdk diff`/`deploy` only.
- **The backend's database plugin (`backend/src/plugins/neon.ts`) uses `@neondatabase/serverless`'s HTTP driver**, not a TCP `pg` client — deliberately, because Lambda's ephemeral execution environment doesn't tolerate a pooled TCP connection well. This means a generic GitHub Actions `postgres:` service container cannot serve as the CI test database; it has to be a real Neon database.
- `backend/src/plugins/config.ts` never validates `ANTHROPIC_API_KEY`'s format, only its presence — booting the app under test needs *a* string, not a working key, since the only test that would make a real call (`translate.test.ts`) already stubs `app.anthropicClient`.

### Key Discoveries:

- `backend/src/app.ts:39-45` autoloads `routes/` with no prefix override — folder path becomes URL prefix, but most of the API's sub-routes live as in-file `fastify.get/post()` calls inside one file (`backend/src/routes/api/collections/index.ts:68,91,146,213,251,361`), so any route-enumeration logic must parse route-registration calls, not just list folders.
- `backend/test/tsconfig.json`'s `include` only covers `../src/**/*.ts`, `../migrations/**/*.ts`, and `**/*.ts` (relative to `test/`) — it does not include `infra/`. The reachability check must read `infra/lib/constructs/api-construct.ts` as plain text (`fs.readFileSync`), not import it as a TS module.
- `backend/package.json`'s `migrate:up` script (`node-pg-migrate -d NEON_DATABASE_URL --envPath .env up`) already shows the CLI convention: `-d <ENV_VAR_NAME>` names the env var holding the connection string. In CI, the same binary can run without `--envPath` once the workflow sets `NEON_DATABASE_URL` directly.
- Both workflows currently pin `node-version: 22`, while `context/foundation/test-plan.md`'s Stack table (§4) documents the suite as developed and run on Node 24 locally — a real, previously-untested version mismatch that a new CI test step would otherwise inherit silently.
- `neondatabase/create-branch-action`'s `parent_branch` input names a **Neon** branch, not a git branch — this project's Neon primary branch isn't actually named `main` (confirmed live: `parent_branch: main` failed with "Parent branch main not found"). Fixed by omitting `parent_branch` entirely, which defaults to the project's actual primary branch regardless of its name.
- `NEON_API_KEY`/`NEON_PROJECT_ID` must be **repository**-level secrets/vars, not environment-scoped ones — GitHub only exposes environment secrets to jobs declaring `environment: <name>`, and the `diff` job in both workflows (where these steps live) has no `environment:` field. Only `deploy.yml`'s `deploy` job does.
- `backend/src/plugins/auth.ts:17-21` builds a `CognitoJwtVerifier` eagerly at boot (not lazily on first auth check), which regex-validates `userPoolId`'s shape (`aws-jwt-verify`'s `USER_POOL_ID_REGEX`: `<region>_<alphanumeric>`, e.g. `eu-central-1_XXXXX`) — a missed env var here fails every test, not just auth-related ones, since `build(t)` constructs the whole app per test. `COGNITO_USER_POOL_ID`/`COGNITO_CLIENT_ID` need CI placeholders too, alongside `ANTHROPIC_API_KEY` — confirmed locally that `eu-central-1_ciplaceholder1`/`ci-placeholder-client-id` satisfy the verifier's format check without pointing at a real Cognito pool, since tests inject their own local JWKS (`test/helpers/jwks.ts`) rather than fetching from AWS.
- `deploy.yml`'s `deploy` job (`:69-72`) is gated by the "production" GitHub Environment's required reviewers, and `needs: diff` — the `deploy` job is automatically skipped if the `diff` job fails. **Revised mid-implementation**: this phase originally wired tests into `pr-diff.yml` only, reasoning that the `deploy` job's human-approval gate already covered a bypassed-PR-check scenario. That reasoning assumed a PR-based workflow; actual practice on this repo is pushing directly to `main`, which never triggers `pr-diff.yml` at all (it only fires on `pull_request` events). So the test step is added to **both** workflows: `pr-diff.yml` for if/when PRs are used, and `deploy.yml`'s `diff` job for the direct-push path — where `needs: diff` makes a test failure automatically skip `deploy`, no branch-protection configuration required.

## Desired End State

- `npm test` in `backend/` includes a test proving the rate-limit guard rejects a 21st request, and a test proving every backend route has a matching, correctly-pathed entry in `infra/lib/constructs/api-construct.ts` (and vice versa).
- `backend/src/routes/root.ts` and its test no longer exist; every backend route has a real gateway entry.
- `.github/workflows/pr-diff.yml` and `.github/workflows/deploy.yml` both run the full backend suite (including both new tests) against a disposable, freshly-migrated Neon branch on every PR and every push to `main` respectively, and fail their `diff` job if any test fails — in `deploy.yml`'s case, automatically skipping the `deploy` job via `needs: diff`.
- `context/foundation/test-plan.md`'s §5 and §6 no longer say "TBD — see §3 Phase 1" for the three items this phase covers.

**Verification**: `cd backend && npm test` passes locally; a PR opened against `main` shows the new CI step run, create a Neon branch, run migrations, run tests, and tear the branch down; deliberately breaking a route/gateway entry or the rate-limit config locally makes the corresponding new test fail with a message naming the specific problem.

## What We're NOT Doing

- ~~Not touching `deploy.yml`~~ — revised: see the note under Key Discoveries. The test step now lands in both workflows since direct pushes to `main` are actual practice here, not just a hypothetical bypass.
- Not adding test/lint gating for `frontend/` or `extension/` — those are test-plan.md Phase 3 and Phase 5's scope, not this phase's.
- Not building a `config.public` route-exemption mechanism in `routes/api/autohooks.ts` — no real public route exists yet to justify it (a prior, deliberate decision from `account-auth`); deleting the one route that would have needed an exemption removes the immediate need.
- Not changing the rate limit's actual threshold (`max: 20`, `1 minute`) — this phase proves the existing guard works, it doesn't retune it.
- Not configuring GitHub branch-protection required-status-checks — that's a repo Settings action the plan can document as a manual completing step but cannot make as a code change.

## Implementation Approach

Two independent, cheap checks first (Phases 1 and 2 — either order, no shared dependency), then CI wiring that runs the now-complete suite (Phase 3, which depends on both), then documentation cleanup (Phase 4). This keeps the riskiest, least-reversible piece (CI/secrets/infra wiring) last and fully informed by what actually needs to run in CI.

## Critical Implementation Details

**Rate-limit store isolation across tests**: `@fastify/rate-limit`'s default store is in-memory, scoped to the Fastify instance. Every backend test calls `build(t)` to construct a fresh app, so the new rate-limit test's 21 requests never interact with counters from any other test file — no shared-state reset or cleanup logic is needed between tests.

## Phase 1: Prove the AI-route rate-limit guard (Risk #7)

### Overview

Add a functional test that fires 21 requests at `POST /api/collections/:id/translate` as the same authenticated user within the rate limiter's 1-minute window and asserts the 21st is rejected with 429 — proving the existing guard (`translateRateLimit`, `backend/src/routes/api/collections/index.ts:60-66`) actually enforces its cap, not just that it's declared.

### Changes Required:

#### 1. Extract shared Anthropic-stub helpers

**File**: `backend/test/helpers/anthropic.ts` (new)

**Intent**: `translate.test.ts` already defines `stubAnthropicSuccess`/`stubAnthropicSequence`/`stubAnthropicFailure` locally; the new rate-limit test needs the same stub. Extracting matches the existing `test/helpers/` convention (`fixtures.ts`, `jwks.ts`) instead of duplicating the stub inline.

**Contract**: Move the three functions and their `App` type alias out of `backend/test/routes/api/translate.test.ts` verbatim into this new file, exported.

#### 2. Update the import in the existing test

**File**: `backend/test/routes/api/translate.test.ts`

**Intent**: Use the extracted helpers instead of local definitions.

**Contract**: Replace the local `stubAnthropicSuccess`/`stubAnthropicSequence`/`stubAnthropicFailure`/`App` definitions with an import from `../../helpers/anthropic.js`. No test bodies change.

#### 3. New rate-limit test

**File**: `backend/test/routes/api/collections-rate-limit.test.ts` (new)

**Intent**: Prove the 20-per-minute cap on `POST /api/collections/:id/translate` is enforced per-user, not just configured.

**Contract**: Follows `translate.test.ts`'s existing pattern exactly — `build(t)`, `createUserRow`/`createCollectionRow` fixtures, `jwks`/`signToken` auth, `stubAnthropicSuccess` (imported from the new helper) so none of the 20 permitted requests hit a real API. Sends 21 sequential `app.inject` POST requests to the same collection's `/translate` endpoint with the same bearer token; asserts requests 1–20 return `200` and request 21 returns `429`.

### Success Criteria:

#### Automated Verification:

- `cd backend && npm test` passes, including the new `collections-rate-limit.test.ts` and the unchanged `translate.test.ts`

#### Manual Verification:

- Temporarily lower `TRANSLATE_RATE_LIMIT_MAX` (`backend/src/routes/api/collections/index.ts:21`) to 2 locally, confirm the new test's assertion point shifts correctly and still passes conceptually (proves the test isn't hardcoded to pass regardless of the guard's actual behavior), then revert

---

## Phase 2: Remove dead root route + add the route-reachability check (Risk #1)

### Overview

Delete the unused `GET /` scaffold route so the route/gateway comparison has no asymmetry to special-case, then add a static test that parses route registrations out of `backend/src/routes/**` and gateway registrations out of `infra/lib/constructs/api-construct.ts`, normalizes their path-param syntax, and fails on any mismatch in either direction.

### Changes Required:

#### 1. Delete the dead root route

**File**: `backend/src/routes/root.ts` (delete)

**Intent**: Remove unused Fastify-CLI scaffold code with no callers and no gateway entry.

**Contract**: File deleted. Confirm first (`grep`) that nothing imports it directly — autoload picks it up by directory scan, so no import statements should exist to clean up elsewhere.

#### 2. Delete its test

**File**: `backend/test/routes/root.test.ts` (delete)

**Intent**: Remove the test for the now-deleted route.

**Contract**: File deleted.

#### 3. Route-reachability check

**File**: `backend/test/route-reachability.test.ts` (new)

**Intent**: Fail CI when a backend route is added, renamed, or removed without a matching change to `infra/lib/constructs/api-construct.ts` — the exact failure mode that has already shipped twice (`context/foundation/lessons.md`).

**Contract**:
- Enumerate backend routes: walk `backend/src/routes/` (excluding `api/autohooks.ts`, which is a hook, not a route), read each `.ts` file's source, regex-match `fastify.(get|post|put|delete|patch)\(\s*(['"`])(.*?)\2` call expressions, and combine each match with the file's directory-derived URL prefix (mirroring `@fastify/autoload`'s convention — e.g. `routes/api/collections/index.ts` → prefix `/api/collections`).
- Enumerate gateway routes: read `infra/lib/constructs/api-construct.ts` as text, regex-match each `addRoutes({ path: ..., methods: [...] })` call block, extracting the path and HTTP method(s).
- Normalize Fastify's `:param` segments to API Gateway's `{param}` segments (or vice versa) before comparing, so the two sets use one path-syntax convention.
- Assert the normalized (method, path) sets are exactly equal. On mismatch, the failure message names the specific route and which side (backend routes vs. gateway) it's missing from — this is what makes the check actionable rather than a bare boolean failure.
- No exemption list: after Phase 2's first change, every backend route has a gateway entry, so the comparison is a plain set-equality assertion with no special-casing.

### Success Criteria:

#### Automated Verification:

- `cd backend && npm test` passes, including the new `route-reachability.test.ts`
- `cd backend && npm run build:ts` succeeds after `root.ts`'s removal (confirms nothing else referenced it)

#### Manual Verification:

- Temporarily comment out one `addRoutes` call in `infra/lib/constructs/api-construct.ts` (e.g. the `/api/collections/{id}/translate` entry), re-run `npm test`, and confirm `route-reachability.test.ts` fails with a message naming that exact route — then revert. This is the single proof that the check catches the failure it exists to catch, not just that it passes against today's already-in-sync state.

---

## Phase 3: Wire `npm test` into CI via an ephemeral Neon branch

### Overview

Add a test step to `pr-diff.yml` and `deploy.yml` that provisions a disposable Neon database branch for the run, migrates it, runs the full backend suite (now including both new tests) against it, and tears the branch down afterward — so `npm test` failures fail the `diff` job in either workflow instead of going unchecked. `deploy.yml`'s `deploy` job (`needs: diff`) is automatically skipped on a `diff` failure, so this is a real, self-enforcing gate on the direct-push-to-`main` path with no branch-protection configuration required.

### Changes Required:

#### 1. PR workflow

**File**: `.github/workflows/pr-diff.yml`

**Intent**: Make `npm test` (and everything it now covers) an actual gate on the PR-triggered workflow, using a database that matches production's driver (Neon's HTTP-based serverless client, not a generic Postgres container) and that leaves no persistent state behind between runs.

**Contract**: After the existing `Build backend` step (`:29-33`), insert:
- A step using Neon's official branch-creation GitHub Action, branching off a designated parent (e.g. `main`), producing the new branch's Postgres connection string as a step output.
- A step running `node-pg-migrate -d NEON_DATABASE_URL up` (no `--envPath`) against that connection string, in `backend/`, to bring the fresh branch's schema current.
- A step running `npm test` in `backend/`, with `NEON_DATABASE_URL` set to the ephemeral branch's connection string and `ANTHROPIC_API_KEY` set to a placeholder value (config.ts only checks presence).
- A final step guarded by `if: always()` using Neon's branch-deletion Action, so a failed test step still tears the branch down.

Also bump this workflow's `node-version` (`:19`) from `22` to `24`, matching what the suite is actually developed and run against locally (`context/foundation/test-plan.md` §4) — otherwise the new step would be the first thing in this repo ever run on a different Node major version than local dev.

#### 2. Deploy workflow's `diff` job

**File**: `.github/workflows/deploy.yml`

**Intent**: Mirror change 1 into the `diff` job of the post-merge workflow, since pushing directly to `main` (not opening a PR) is this repo's actual practice and never triggers `pr-diff.yml` at all.

**Contract**: Same four-step block (create branch → migrate → `npm test` → delete branch, `if: always()` on deletion) inserted after the `diff` job's own `Build backend` step, before its `Install infra deps` step. Also bump the `diff` job's `node-version` from `22` to `24` — but **not** the `deploy` job's, whose `node-version: 22 # matches the Lambda runtime (NODEJS_22_X)` is intentionally pinned to the Lambda runtime and unrelated to the test suite's Node version. The `deploy` job needs no other change: it already `needs: diff`, so a test failure there skips `deploy` automatically.

#### 3. Repository secrets/vars (manual, non-code prerequisite)

**Intent**: The new steps need `NEON_API_KEY` and `NEON_PROJECT_ID` to create/delete branches via Neon's API.

**Contract**: Added under the repo's Settings → Secrets and variables → Actions, before this workflow step can run successfully — the same one-time manual pattern already documented in `deploy.yml`'s comments for `AWS_DEPLOY_ROLE_ARN`. This plan cannot create these itself.

### Success Criteria:

#### Automated Verification:

- `.github/workflows/pr-diff.yml` parses as valid YAML (any YAML linter, or GitHub's own workflow validation on push)
- `.github/workflows/deploy.yml` parses as valid YAML

#### Manual Verification:

- `NEON_API_KEY` and `NEON_PROJECT_ID` are added as repo secrets/vars (prerequisite for everything below)
- Push to `main` and confirm in the Actions tab: `deploy.yml`'s `diff` job creates a Neon branch, migrates it, runs `npm test`, deletes the branch afterward, and (if tests pass) the `deploy` job proceeds to its approval gate
- On a scratch branch/commit, temporarily break a test, push to `main`, and confirm `deploy.yml`'s `diff` job fails and the `deploy` job is skipped (not just red-but-proceeding) — then revert
- Open a real PR and confirm the same create/migrate/test/delete cycle runs in `pr-diff.yml`'s `diff` job
- On a scratch branch, temporarily break a test to confirm `pr-diff.yml`'s `diff` job goes red (visible as a failed check on the PR), then revert
- In the repo's Settings → Branches, add or confirm a required status check for `pr-diff.yml`'s `diff` job — this is what makes it block a merge if a PR is used; `deploy.yml`'s `needs: diff` already self-enforces without any Settings change

---

## Phase 4: Close out test-plan.md bookkeeping

### Overview

Replace the "TBD — see §3 Phase 1" placeholders this phase resolves with the real patterns just established, so `context/foundation/test-plan.md` stays an accurate living reference for the next rollout phase.

### Changes Required:

#### 1. Cookbook and quality-gate updates

**File**: `context/foundation/test-plan.md`

**Intent**: Document the patterns this phase established so future changes (and future rollout phases) don't have to rediscover them.

**Contract**:
- §6.1 ("Adding a backend unit/integration test"): note the extracted `test/helpers/anthropic.ts` stub helpers alongside the existing `test/helper.ts` pattern reference.
- §6.2 ("Adding a route-reachability check"): replace "TBD" with a short description of `backend/test/route-reachability.test.ts`'s approach (static source comparison, normalized path syntax, no exemption list — every route needs a gateway entry, full stop).
- §6.4 ("Adding a test for a new backend API endpoint"): note that a new endpoint now must land with a matching `api-construct.ts` entry in the same change or `route-reachability.test.ts` fails it, and that an Anthropic-calling endpoint should attach a `rateLimit` config following `translateRateLimit`'s pattern.
- §5 Quality Gates table: update the "backend unit + integration", "route-reachability check", and "AI-route rate-limit check" rows to reflect they're now enforced (post this phase), not merely "required after §3 Phase 1."
- §8 Freshness Ledger: update "Strategy (§1–§5) last reviewed" to today's date.

### Success Criteria:

#### Automated Verification:

- `grep -c "TBD — see §3 Phase 1" context/foundation/test-plan.md` returns fewer matches than before this phase (the three sections this phase covers no longer say TBD)

#### Manual Verification:

- Read the updated §5/§6 sections and confirm they accurately describe what shipped in Phases 1–3

---

## Testing Strategy

### Unit Tests:

- N/A — this phase adds integration-level tests only (no new pure-logic units to isolate).

### Integration Tests:

- Rate-limit enforcement (Phase 1): full request/response cycle through `app.inject`, real rate-limit plugin, stubbed Anthropic client.
- Route reachability (Phase 2): source-level static comparison, not an HTTP test — verifies a build-time invariant, not runtime behavior.
- CI end-to-end (Phase 3): the workflow run itself is the integration test for "does the whole pipeline work," verified manually via a real PR.

### Manual Testing Steps:

1. Locally lower the rate limit and confirm the new test's pass/fail boundary tracks the guard's real behavior (Phase 1).
2. Locally break a gateway entry and confirm the reachability test names it (Phase 2).
3. Open a real PR and watch the new CI step provision, migrate, test, and tear down a Neon branch end-to-end (Phase 3).
4. Break a test on a scratch branch and confirm the PR shows a failing check (Phase 3).
5. Configure the required-status-check branch protection rule (Phase 3) — the step that makes the gate actually block merges.

## Performance Considerations

CI run time increases by roughly the time to create a Neon branch (typically seconds), run 4 migrations, and run the full backend suite — a few minutes added to `pr-diff.yml`'s total run time. No production runtime performance is affected; this phase touches only test code, CI config, and the deletion of an unused route.

## Migration Notes

No production data migration. CI runs the existing `backend/migrations/*.ts` files (via `node-pg-migrate`) against a freshly created, always-empty Neon branch on every run, so there's no migration-state drift to manage between runs.

## References

- Research: `context/changes/testing-backend-ci-safety-net/research.md`
- Rate-limit guard: `backend/src/plugins/rate-limit.ts`, `backend/src/routes/api/collections/index.ts:60-66,218,366`
- Existing Anthropic-stub pattern to extract: `backend/test/routes/api/translate.test.ts:12-44`
- Gateway registration pattern: `infra/lib/constructs/api-construct.ts:143-193`
- Prior incident this phase directly addresses: `context/foundation/lessons.md` ("Every new backend API route needs a matching api-construct.ts entry")
- Deferred public-route pattern (why `GET /` isn't a deliberate exemption): `backend/src/routes/api/autohooks.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Prove the AI-route rate-limit guard (Risk #7)

#### Automated

- [x] 1.1 `cd backend && npm test` passes, including the new `collections-rate-limit.test.ts` and the unchanged `translate.test.ts` — f0067a8

#### Manual

- [x] 1.2 Temporarily lower `TRANSLATE_RATE_LIMIT_MAX`, confirm the test's assertion point tracks the guard's real behavior, then revert — f0067a8

### Phase 2: Remove dead root route + add the route-reachability check (Risk #1)

#### Automated

- [x] 2.1 `cd backend && npm test` passes, including the new `route-reachability.test.ts` — 22ae8fa
- [x] 2.2 `cd backend && npm run build:ts` succeeds after `root.ts`'s removal — 22ae8fa

#### Manual

- [x] 2.3 Temporarily comment out one `addRoutes` call, confirm `route-reachability.test.ts` fails naming that route, then revert — 22ae8fa

### Phase 3: Wire `npm test` into CI via an ephemeral Neon branch

#### Automated

- [x] 3.1 `.github/workflows/pr-diff.yml` parses as valid YAML — 0e22262
- [x] 3.2 `.github/workflows/deploy.yml` parses as valid YAML — 9f35d96

#### Manual

- [x] 3.3 `NEON_API_KEY` and `NEON_PROJECT_ID` added as repo secrets/vars — confirmed already done by user — 9f35d96
- [x] 3.4 Push to `main`: `deploy.yml`'s `diff` job creates/migrates/tests/deletes a Neon branch, and `deploy` proceeds to its approval gate on success
- [x] 3.5 Scratch break on `main`: `deploy.yml`'s `diff` job fails and `deploy` is skipped (not just red-but-proceeding), then reverted
- [x] 3.6 Real PR run: `pr-diff.yml`'s `diff` job creates/migrates/tests/deletes a Neon branch
- [x] 3.7 Scratch-branch test failure shows as a failed check on the PR (`pr-diff.yml`), then reverted
- [x] 3.8 Required-status-check branch protection configured for `pr-diff.yml`'s `diff` job

### Phase 4: Close out test-plan.md bookkeeping

#### Automated

- [x] 4.1 `grep -c "TBD — see §3 Phase 1" context/foundation/test-plan.md` shows fewer matches than before — 10220cb

#### Manual

- [x] 4.2 Updated §5/§6 sections read accurately against what shipped — 10220cb
