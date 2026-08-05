---
date: 2026-08-05T14:10:39+00:00
researcher: Claude
git_commit: dd777fa4ff053fe4c09a7d65c075c0755f33d808
branch: main
repository: KStrzechowski/InkLingo
topic: "Backend CI safety net (test-plan §3 Phase 1) — route-reachability check, AI-route rate-limit guard, CI test gating"
tags: [research, codebase, backend, ci, api-gateway, rate-limit, testing]
status: complete
last_updated: 2026-08-05
last_updated_by: Claude
---

# Research: Backend CI safety net (test-plan §3 Phase 1)

**Date**: 2026-08-05T14:10:39+00:00
**Researcher**: Claude
**Git Commit**: dd777fa4ff053fe4c09a7d65c075c0755f33d808
**Branch**: main
**Repository**: KStrzechowski/InkLingo

## Research Question

`context/foundation/test-plan.md` §3 Phase 1 ("Backend CI safety net") names three deliverables against Risk #1 and Risk #7:

1. A deterministic check that every backend route is reachable through the real API Gateway wiring (Risk #1 — routes have twice shipped that pass the full backend suite but 404 in production, per `lessons.md`).
2. A cap on per-user request rate for AI-calling routes so a retry loop or leaked endpoint can't run up uncapped Anthropic/AWS cost (Risk #7).
3. CI wiring so `npm test` actually gates merges for the backend, which it currently does not.

The user had no further scoping preference ("not sure") — this document grounds the phase directly against the frozen test-plan scope, per its own instruction that `/10x-research` produces the ground truth if it disagrees with the plan.

## Summary

**Deliverable 1 (route reachability) is a real, unaddressed gap.** Routes and gateway registrations are currently in sync 1:1 (7/7), but purely by manual discipline — no check exists anywhere, and the failure mode has already bitten twice (`lessons.md`). A static check is buildable but non-trivial: it must parse in-file `fastify.get/post()` calls inside multi-route files like `collections/index.ts`, not just infer paths from folder structure, and normalize `:id` vs `{id}` path-param syntax against `infra/lib/constructs/api-construct.ts`'s hand-written `addRoutes` calls.

**Deliverable 2 (AI-route rate limiting) is already implemented — contradicts the test-plan's stated premise.** `@fastify/rate-limit` is installed, registered (`backend/src/plugins/rate-limit.ts`, `global: false`), and applied to both Anthropic-calling routes via a `translateRateLimit` config (`max: 20/minute`, keyed by `request.authUser.id`) in `backend/src/routes/api/collections/index.ts`. Per test-plan.md §1 principle #3, this research supersedes the plan's assumption. The remaining open question is whether a *test* asserting the guard is registered and enforced exists — it does not (no static-check-style test exists anywhere in `backend/test/`) — so the deliverable narrows from "add a rate-limit plugin" to "add a test proving the existing plugin is wired and effective," which is cheaper.

**Deliverable 3 (CI test gating) is a real gap with an extra wrinkle.** Neither `pr-diff.yml` (PR-triggered) nor `deploy.yml` (post-merge) runs `npm test`, `npm run lint`, or any backend/frontend test/lint step — both are build+diff/deploy only. Wiring this in isn't just "add a step": `npm test` boots a real Fastify app against a real Neon Postgres DB and requires a real `ANTHROPIC_API_KEY` (`backend/README.md`, `backend/src/plugins/config.ts`), and **neither secret is currently wired into either workflow** (`grep` for `secrets.*` found zero hits — only AWS OIDC role ARNs as `vars.*`). A test-gating step needs a test database provisioned and both secrets added to GitHub Actions before `npm test` can run in CI at all.

## Detailed Findings

### Risk #1 — Route-to-gateway reachability

- Route registration in `infra/lib/constructs/api-construct.ts` is fully manual: 7 separate `this.httpApi.addRoutes({...})` calls, no loop/table/import from the backend driving it ([api-construct.ts:143-193](infra/lib/constructs/api-construct.ts)). Comments at lines 139-140 and 172-174 explicitly justify the manual, explicit-path approach over a `{proxy+}` catch-all — this is a deliberate structural choice, not an oversight, so any fix should work *with* explicit-path registration rather than propose replacing it with a catch-all.
- Backend routes autoload from `backend/src/routes/` with no path prefix override (`backend/src/app.ts:39-45`); the folder path becomes the URL prefix. Critically, `routes/api/collections/index.ts` alone hosts **5** of the 6 API sub-routes as in-file `fastify.get/post(subpath, handler)` calls (lines 68, 91, 146, 213, 251, 361) — folder structure alone does not reveal the full route surface. A static checker must parse route-registration call expressions inside each autoloaded file.
- Current state: routes and gateway entries match 1:1, 7 for 7 (`GET /health`, `GET /api/me`, `GET+POST /api/collections`, `GET /api/collections/{id}`, `POST /api/collections/{id}/translate`, `POST /api/collections/{id}/entries`, `POST /api/collections/{id}/entries/{entryId}/translations`). `GET /` (`routes/root.ts:4`) has no gateway entry, but this looks intentional (outside `/api`, no CORS/authorizer targeting it) rather than stale.
- No existing check of any kind verifies this today. `infra/test/infra.test.ts` is unmodified `aws-cdk-lib` starter-template boilerplate — a single empty `test('SQS Queue Created', () => {})` with no assertions, using Jest's global `test` (the file's own `infra/package.json:7` runs `"test": "jest"`, unrelated to the backend's `node:test`). Neither `pr-diff.yml` nor `deploy.yml` greps or compares the two directories; both just run `cdk diff`/`cdk deploy` blind to route drift.
- Route-file shape for a parser to target: files export `FastifyPluginAsync` (or `FastifyPluginAsyncTypebox` for typed schemas), with routes registered via `fastify.get(path, [opts,] handler)` / `fastify.post(...)`. Gateway shape: `this.httpApi.addRoutes({ path: string, methods: [apigatewayv2.HttpMethod.X], integration, authorizer? })`. Path-param syntax differs (`:id` in Fastify vs `{id}` in HTTP API) and must be normalized for comparison.

### Risk #7 — AI-route cost cap

- Exactly one file calls Anthropic: `backend/src/routes/api/collections/index.ts`, via a shared `generateWithTimeout` helper (lines 43-57) wrapping `fastify.anthropicClient` (decorated in `backend/src/plugins/anthropic.ts:19`). Two routes call it: `POST /:id/translate` (line 240) and `POST /:id/entries/:entryId/translations` (line 402).
- `backend/src/plugins/rate-limit.ts` already registers `@fastify/rate-limit` (`^11.1.0`, already in `backend/package.json:30`) with `global: false` — opt-in per route. Both AI-calling routes opt in via a shared `translateRateLimit` object (`collections/index.ts:60-66`): `max: 20` (`TRANSLATE_RATE_LIMIT_MAX`, line 21), `timeWindow: '1 minute'`, `keyGenerator: (request) => request.authUser.id`. Applied via `config: translateRateLimit` on both routes (lines 218, 366). The plugin's own comment (`rate-limit.ts:8-11`) cites `infrastructure.md`'s denial-of-wallet risk-register entry as the reason it exists — i.e., this was already built specifically to address the concern test-plan.md's Risk #7 restates.
- `request.authUser.id` (the stable per-user key the limiter uses) is set in `backend/src/routes/api/autohooks.ts:38`, an `onRequest` hook cascaded to all `api/` routes via `autoHooks: true, cascadeHooks: true` (`app.ts:43-44`) — a hook-order dependency, not a plugin-registration dependency (`rate-limit.ts` declares no `dependencies` on `auth`).
- No test anywhere asserts the guard is registered or enforces the cap (grepped `backend/test/` for filesystem/config-inspection patterns — zero matches; all existing tests are `app.inject` HTTP tests). This is the actual gap: not "add rate limiting" but "add a test that proves the existing guard is wired to both AI routes and actually rejects the 21st request in a window."

### CI test gating

- Only two workflows exist, both fully read: `.github/workflows/pr-diff.yml` (triggers on `pull_request` → `main`) and `.github/workflows/deploy.yml` (triggers on `push` → `main`, i.e. post-merge).
- `pr-diff.yml`'s `diff` job builds backend (`npm ci && npm run build:ts` only, lines 29-33), builds infra, builds frontend (`npm ci && npm run build`, lines 47-51), then runs `cdk diff` to the PR summary (lines 53-63). **No `npm test`, no `npm run lint`, anywhere.** This is the only workflow that runs on PRs, so today nothing but a successful *build* gates a PR.
- `deploy.yml` mirrors the same build steps post-merge, then a `deploy` job (`needs: diff`, gated only by the GitHub "production" Environment's required reviewers) runs `cdk deploy`. Also no test/lint step.
- `extension/` has no build or test step in either workflow at all.
- `backend/package.json:11`'s `test` script (`build:ts && tsc -p test/tsconfig.json && ... node --test --experimental-test-coverage test/**/*.ts`) requires a real Neon Postgres connection and a real Anthropic API key — `backend/src/plugins/config.ts:35-36` reads `NEON_DATABASE_URL`/`ANTHROPIC_API_KEY` from `process.env`, sourced from a local gitignored `backend/.env` (`backend/README.md:21-30`); no `.env.example` exists in the repo to document the shape.
- Neither workflow references any `secrets.*` today (confirmed via grep — zero hits); only `vars.AWS_DIFF_ROLE_ARN` / `vars.AWS_DEPLOY_ROLE_ARN` for AWS OIDC role assumption. So a CI test step needs, at minimum: a test-tier Neon DB (or equivalent), that DB's URL added as a GitHub secret, and `ANTHROPIC_API_KEY` added as a GitHub secret — none of this exists yet.
- Insertion point: both workflows have a self-contained `Build backend` step block (`working-directory: backend`) — `pr-diff.yml:29-33`, `deploy.yml:32-36` and `:90-94` — a test step slots immediately after it, before the `cdk`/infra steps begin.

### Backend test/plugin conventions (for matching house style)

- `backend/test/helper.ts`'s `build(t)` (lines 24-38) boots the **real** Fastify app via `fastify-cli`'s `helper.build([AppPath], { skipOverride: true })`, hitting the real Neon DB configured by `dotenv/config` loading `backend/.env`. Teardown (`t.after`) only closes the app — no DB cleanup at the helper level; each test file cleans up its own rows (e.g. `DELETE FROM users WHERE cognito_sub = $1` relying on `ON DELETE CASCADE`, per `collections.test.ts:11`).
- All backend tests use bare `node:test`'s `test()` (no `describe()` blocks anywhere) and `node:assert`. Auth is simulated via `backend/test/helpers/jwks.ts` (`cacheJwks` + `signToken`); fixtures come from `backend/test/helpers/fixtures.ts` (`createUserRow`/`createCollectionRow`/`createEntryRow`, direct `app.sql.query` inserts). `app.anthropicClient` is stubbed in `translate.test.ts` via `stubAnthropicSuccess`/`stubAnthropicSequence`/`stubAnthropicFailure` helpers (object cast `as unknown as Anthropic`).
- Plugin registration order is governed by `fastify-plugin`'s `dependencies` array (e.g. `auth.ts`/`neon.ts` depend on `config`), not filename order, though autoload alphabetizes by default absent that.
- **No precedent exists for a filesystem/source-reading static-check test** anywhere in the repo — confirmed by grepping `backend/test/` for `fs.`/`readFileSync`/`readdirSync` (zero matches). This means Deliverable 1's test (comparing route files against `api-construct.ts`) would be a new pattern for this codebase, not an extension of an existing one. It will need to decide: does it live under `backend/test/` (reading `infra/` from there) or `infra/test/` (the only precedent there is unmodified Jest boilerplate, so effectively no precedent either way)?

## Code References

- `infra/lib/constructs/api-construct.ts:143-193` — all 7 manual `addRoutes` calls
- `infra/lib/constructs/api-construct.ts:139-140,172-174` — comments justifying explicit-path over `{proxy+}`
- `backend/src/app.ts:39-45` — routes autoload config (`autoHooks`, `cascadeHooks`, no prefix override)
- `backend/src/routes/api/collections/index.ts:68,91,146,213,251,361` — 6 in-file route registrations (5 of 6 API sub-routes live in this one file)
- `backend/src/routes/api/collections/index.ts:43-57` — `generateWithTimeout` helper wrapping the Anthropic call
- `backend/src/routes/api/collections/index.ts:60-66,218,366` — `translateRateLimit` config and its application to both AI routes
- `backend/src/plugins/rate-limit.ts` — `@fastify/rate-limit` registration (`global: false`)
- `backend/src/plugins/anthropic.ts:19` — `fastify.anthropicClient` decoration
- `backend/src/routes/api/autohooks.ts:38` — `request.authUser` set (rate-limit key source)
- `backend/src/plugins/config.ts:35-36` — reads `NEON_DATABASE_URL`/`ANTHROPIC_API_KEY` from `process.env`
- `.github/workflows/pr-diff.yml:29-33,47-51,53-63` — backend/frontend build + `cdk diff`, no test step
- `.github/workflows/deploy.yml:32-36,90-94,114-120` — mirrors build steps, `cdk deploy`, no test step
- `backend/package.json:11` — `npm test` script definition
- `backend/test/helper.ts:24-38` — `build(t)` test-app bootstrap against real Neon DB
- `infra/test/infra.test.ts` — unmodified Jest boilerplate, no real assertions
- `context/foundation/lessons.md:26-31` — prior incident: routes shipped green but unreachable, twice

## Architecture Insights

- API Gateway registration is intentionally hand-written and explicit-path (no catch-all) — any Deliverable 1 solution should treat this as a constraint to check against, not a design to replace.
- Fastify plugins in this codebase follow a strict `fp()` + `dependencies` convention; `rate-limit.ts` is the precedent for how a cross-cutting guard is wired without becoming globally mandatory (`global: false`, per-route opt-in via `config`).
- Backend tests uniformly hit a real Neon DB with no mocking layer except the Anthropic client at the network edge (matches `context/foundation/test-plan.md` §4's characterization). There is no lighter-weight/mocked test tier to fall back to for CI — CI wiring inherently means provisioning real DB access.
- The "5 routes in one file" structure in `collections/index.ts` means route enumeration for Deliverable 1 needs source parsing (regex or lightweight AST), not directory-listing.

## Historical Context (from prior changes)

- `context/foundation/lessons.md` "Every new backend API route needs a matching api-construct.ts entry" — the exact failure this phase's Deliverable 1 exists to prevent; already hit twice (`POST /:id/translate` and `POST /:id/entries`, both caught late in `capture-translate-save` phases).
- `context/foundation/test-plan.md` §3 Phase 1 — the frozen scope this research grounds; its Risk Response Guidance table (§2) for Risk #1 and #7 is the direct source of the "must ground" questions this document answers.
- `context/foundation/test-plan.md` §1 principle #3 — "If the plan and research disagree about where the failure lives, research is the ground truth." Directly invoked by the Risk #7 finding below.

## Related Research

None yet — this is the first `research.md` for any test-plan rollout phase.

## Open Questions

1. **Risk #7 scope correction**: since rate limiting is already implemented, should this phase's plan drop "add a rate-limit plugin" entirely and scope Deliverable 2 down to "add an integration test proving the existing guard is registered on both AI routes and rejects over-limit requests"? (Test-plan.md's own Risk Response Guidance for #7 already says "Likely cheapest layer: Plugin-level integration test asserting the rate-limit guard is registered and enforces a cap" — this is consistent with the plugin already existing; the plan just didn't know that.)
2. **Test-tier database provisioning**: wiring `npm test` into CI needs a real Postgres instance reachable from GitHub Actions. Options (ephemeral `postgres` service container vs. a dedicated Neon branch/project for CI) aren't decided — this is a real infrastructure decision `/10x-plan` needs to make, not just a YAML edit.
3. **Where does the Deliverable 1 static check live** — `backend/test/` (reading into `infra/`) or `infra/test/` (currently unmodified boilerplate, `jest`-based)? No existing precedent points either way; `/10x-plan` should decide based on which test runner (`node:test` vs `jest`) and CI step should own it.
4. **`ANTHROPIC_API_KEY` in CI**: booting the app under test requires this even though no test in the two files researched calls Anthropic (stub used instead in `translate.test.ts`) — confirm whether every test file needs a live key just to construct the plugin, or whether a dummy/placeholder value satisfies `config.ts`'s validation at boot time (would avoid spending real Anthropic budget on every CI run).
