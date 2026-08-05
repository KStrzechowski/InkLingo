# Backend CI Safety Net — Plan Brief

> Full plan: `context/changes/testing-backend-ci-safety-net/plan.md`
> Research: `context/changes/testing-backend-ci-safety-net/research.md`

## What & Why

Phase 1 of the frozen test rollout (`context/foundation/test-plan.md` §3): make backend routes provably reachable through the real API Gateway, prove the existing AI-route rate-limit guard actually rejects excess traffic, and make `npm test` gate PRs in CI. Two of the three risks this addresses have already caused real problems — routes have shipped unreachable twice, and `npm test` has never once run in CI.

## Starting Point

Route registrations (`infra/lib/constructs/api-construct.ts`) and backend route files are in sync today, 7-for-7, but only by manual discipline with nothing checking it. The AI-route rate limiter (`@fastify/rate-limit`) is already built and applied — research found it already implemented, contradicting the test-plan's original assumption that it needed to be added. Neither PR-triggered nor post-merge CI workflows run `npm test` today.

## Desired End State

Every backend route has a gateway entry, enforced by a test that fails with a specific route name if one goes missing. The rate-limit guard has a test that proves it rejects a 21st request, not just that it's configured. Every PR runs the full backend suite against a real, disposable Neon database and fails the check if anything breaks.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| CI test database | Ephemeral Neon branch per run, via Neon's GitHub Action | The backend's DB driver is Neon's HTTP client, not TCP `pg` — a generic Postgres container won't work, and a shared persistent branch risks cross-run collisions. | Plan |
| Reachability check mechanism | Static source comparison (parse route files + `api-construct.ts`, diff) | Fast, runs anywhere, gives a precise "this route is missing" error — no AWS calls needed. | Plan |
| Check location | `backend/test/`, `node:test` | One test runner for the whole backend suite; `infra/test/`'s only existing file is unmodified boilerplate with no real precedent either way. | Plan |
| Rate-limit test depth | Functional — fire 21 requests, assert 429 on the last | Proves the guard actually rejects traffic; the Anthropic client stays stubbed so this costs nothing even though it's a real functional test. | Plan |
| `GET /` route | Delete it | Unmodified Fastify-CLI scaffold, no callers, redundant with `/health` — keeping it as an "exemption" would ship permanent special-case logic to protect one line of dead code. | Plan |
| CI scope | Both `pr-diff.yml` and `deploy.yml` | Revised mid-implementation: actual practice on this repo is pushing directly to `main`, which never triggers `pr-diff.yml` — the test step had to land in `deploy.yml`'s `diff` job too, where `needs: diff` makes a failure automatically skip `deploy`. | Plan |

## Scope

**In scope:**
- A test proving the existing rate-limit guard works
- A static route-vs-gateway reachability check
- Deleting the dead `GET /` scaffold route
- Wiring `npm test` into `pr-diff.yml` via an ephemeral Neon branch
- Updating `test-plan.md`'s cookbook/quality-gate placeholders for this phase

**Out of scope:**
- Frontend/extension test or lint gating (later rollout phases own this)
- Retuning the rate limit's actual threshold
- Building a `config.public` route-exemption mechanism (no real public route exists yet)
- Configuring GitHub branch-protection required-status-checks (a Settings action, not code — called out as a manual completing step)

## Architecture / Approach

Two independent, cheap checks first (rate-limit test, reachability test — either order), then CI wiring that runs the now-complete suite against a disposable database, then a documentation pass. The riskiest, least-reversible piece (secrets, ephemeral infra) lands last, fully informed by what actually needs to run.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Rate-limit guard test | Functional proof the 20/min cap rejects excess requests | Test could pass trivially if not wired to the guard's real behavior — mitigated by a manual "lower the limit and watch it track" check |
| 2. Reachability check | Static test failing on any route/gateway mismatch, dead root route removed | Regex-based parsing is a new pattern with no precedent — mitigated by a manual "break a gateway entry and watch it fail" check |
| 3. CI wiring | `npm test` runs and gates both `pr-diff.yml` and `deploy.yml` via an ephemeral Neon branch | Needs `NEON_API_KEY`/`NEON_PROJECT_ID` secrets added manually before it can run at all (now done) |
| 4. test-plan.md bookkeeping | Cookbook/quality-gate sections reflect what shipped | None — pure documentation |

**Prerequisites:** `NEON_API_KEY` and `NEON_PROJECT_ID` must be added as repo secrets/vars before Phase 3 can run in CI (cannot be automated by this plan).
**Estimated effort:** ~1-2 sessions across 4 phases; Phase 3 is the only one with an external dependency (secrets) blocking full completion.

## Open Risks & Assumptions

- Assumes Neon's official branch-create/branch-delete GitHub Actions are usable as-is for this repo's Neon project — not verified against a live Neon account in this planning session.
- The regex-based route parser (Phase 2) is a first version; an unusually-structured future route file could theoretically slip past it undetected until someone extends the parser.
- Branch-protection required-status-check configuration (the step that makes "gate merges" literally true) is a manual GitHub Settings action outside this plan's code changes — documented as Phase 3's final manual step, not guaranteed to happen automatically.

## Success Criteria (Summary)

- A route added without a matching `api-construct.ts` entry fails CI with a message naming it, instead of shipping unreachable.
- A 21st request to an AI-calling route within a minute gets rejected, and a test proves it.
- Every PR against `main` runs the backend test suite against a real, isolated database and fails the check if tests fail.
