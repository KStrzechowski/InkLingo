# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-08-05

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in area Y"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `backend/src`, `frontend/src`,
`extension/src`, `infra/lib` (45 commits/30d — sufficient signal).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | A backend route is added or changed and passes the full test suite, but is unreachable through the real deployed API — the route was never registered with the API Gateway wiring | High | High | lessons.md "Every new backend API route needs a matching api-construct.ts entry" (hit twice already); interview Q1, Q2 |
| 2 | A print/A4 export regresses silently after a CSS or component change — broken pagination, wrong colors under dark-mode OS preference, or content clipped outside the printable area | High | High | PRD Primary Success Criteria (print output is part of the north-star flow); interview Q3 (lowest-confidence area); archive/2026-08-02-printable-export/plan.md (global stylesheet documented as actively hostile to print) |
| 3 | An AI translate/capture call returns a structurally valid but empty or unusable result (no variants, no sentences), and the user sees a silently broken outcome instead of an explicit error | High | Medium | lessons.md "A stubbed AI client cannot tell you the model's output is usable" (measured ~9% failure rate on real calls); interview Q1, Q2 |
| 4 | An expired or invalid auth token is sent with a request and the failure surfaces as an opaque CORS error instead of a clean re-authentication prompt | High | Medium | lessons.md CORS/auth incident, 2026-08-04 (`fix/auth-token-refresh`); interview Q1, Q2 |
| 5 | A user requests another user's collection or entry by ID and the request succeeds instead of being rejected (IDOR) — ownership for entries flows only through a join, not a direct column | High | Medium | archive/2026-07-23-word-collections/plan.md ("entries has no user_id column — ownership only flows through entries.collection_id → collections.user_id"); abuse-lens: authorization/access |
| 6 | Frontend or extension business logic (collection language-gap detection, extension popup variant/sentence selection state) breaks silently — both areas have zero test coverage and own the highest recent churn in the repo | Medium | High | interview Q4 ("both equally"); hot-spot dirs `frontend/src/pages` (21 commits/30d), `extension/src` (11 commits/30d); test-base profile (`sparse`) |
| 7 | Repeated or automated calls to the AI-calling route(s) are not capped per user, so an accidental retry loop or a leaked/scraped endpoint can run up real Anthropic + AWS cost with no built-in ceiling | Medium | Medium | interview Q1 (explicit cost worry); infrastructure.md Risk Register ("denial-of-wallet... not yet implemented, tracked here as an open item"); abuse-lens: resource abuse |

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|---|---|---|---|---|---|
| #1 | A route added or changed under the backend's route tree is actually reachable through the real API Gateway wiring, not just resolvable in-process | "Green backend tests" is evidence the route works — the test app never goes through the gateway, so this is false | How routes are registered against the gateway construct (explicit entries, no catch-all); whether any CI step already verifies this | Deterministic static check cross-referencing route files against gateway registrations, or a `cdk synth`/diff step in CI | An integration test that still only calls the app in-process — reproduces the exact blind spot that caused this twice |
| #2 | The print view keeps A4-safe geometry, black-on-white color, and header/row integrity across a CSS or component change, in both light and dark OS theme | "Looks right on screen" proves nothing about print — the global stylesheet actively overrides colors and layout for print | The print stylesheet mechanism (media/page rules), how dark-mode variables are overridden for print, current verification approach | Deterministic visual diff/snapshot of the rendered print view (light + dark); manual print-to-paper spot check as the final gate | A snapshot test that locks in the current, possibly-still-wrong layout with no independent check against real A4 output |
| #3 | A translate/capture call against the real Anthropic API returns usable (non-empty) output at a measured rate, and an unusable result surfaces as a visible error rather than an empty section | Stubbed tests prove the integration works — they only prove our code handles a response shape we invented ourselves | Current handling of empty variants/sentences arrays; whether the tool schema constrains array length at all | Keep stubs for logic/error-path coverage; add a one-off empirical script (dozen+ real calls, varied inputs) run as part of this phase | More stub-based tests whose expected values are copied from the implementation (oracle problem) — raises coverage without closing the gap |
| #4 | A request made with an expired/invalid token triggers silent renewal before reaching the API, and a token that fails renewal drops the session with a clear re-login prompt | A CORS error means a CORS config problem — here it means an expired token, since the JWT authorizer's rejection carries no CORS headers of its own | Current token-expiry check before attaching auth headers; whether concurrent renewal calls are deduped; client behavior on a 401 that survives renewal | Frontend unit/integration test around token-attachment and renewal logic (mock an expired token, assert renewal + dedupe) | Testing only the happy path (valid token → 200) — that case was already covered and did not catch this |
| #5 | A cross-user request for a collection or entry ID (guessed or otherwise obtained) is rejected (404/403) for every endpoint that accepts such an ID | Being authenticated is enough — a query that forgets the ownership join/filter silently returns or mutates another user's data | Every route accepting a collection/entry ID; which ones filter by the authenticated user's ownership versus row existence only | Integration test per ownership-sensitive endpoint: two seeded users, cross-user request, assert rejection | Testing only "unauthenticated request is rejected" (401) and treating that as authorization coverage — it is a different failure mode entirely |
| #6 | The language-gap detection and popup variant/sentence selection logic produce correct output on documented edge cases (missing-language entries, multi-language collections, collection-switch mid-selection), not just the happy path | The UI looking right during manual testing proves the state logic is right — it doesn't prove state transitions (e.g. stale selection after switching collections) are handled | Which components/hooks own this logic; what edge cases are currently handled versus assumed | Component/unit tests once a test runner is bootstrapped for `frontend/` and `extension/` | Reaching for e2e/browser tests to cover a zero-coverage gap that a cheaper unit/component test would catch just as well |
| #7 | Repeated/rapid requests to the AI-calling route(s) from one user are capped before reaching Anthropic, with a clear client-visible response when capped | Platform-level throttling already covers this — it bounds AWS-side blast radius only; the Anthropic-side per-call cost is uncapped until an application-level limit exists | Which routes call Anthropic; confirm no rate-limit plugin is registered yet; what a sane per-user limit looks like at this project's scale | Plugin-level integration test asserting the rate-limit guard is registered and enforces a cap on the AI-calling route(s) | Verifying the guard by making real Anthropic calls in a loop — burns the exact budget the guard exists to protect |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Backend CI safety net | Make every backend route provably gateway-reachable, cap the AI route's cost exposure, and make `npm test` actually gate merges in CI | #1, #7 | static route-registration check, rate-limit plugin integration test, CI wiring | change opened | context/changes/testing-backend-ci-safety-net/ |
| 2 | AI usability + cross-user isolation | Confirm AI output is measurably usable and no endpoint lets one user reach another user's data | #3, #5 | empirical real-API script, backend integration tests (IDOR) | not started | — |
| 3 | Auth resilience | An expired/invalid token never surfaces as an opaque failure — it renews silently or drops the session cleanly | #4 | frontend unit/integration tests (bootstraps Vitest for `frontend/`) | not started | — |
| 4 | Print output correctness | Print/A4 layout changes are verifiable without a manual print-preview every time, in both OS themes | #2 | deterministic visual diff/snapshot, manual print spot-check | not started | — |
| 5 | Frontend/extension logic coverage | The zero-coverage, highest-churn UI logic has tests for its documented edge cases | #6 | component/unit tests (extends Vitest; bootstraps a test runner for `extension/`) | not started | — |

**Status vocabulary** (fixed — parser literals):

| Value | Meaning |
|---|---|
| `not started` | No change folder for this rollout phase yet. |
| `change opened` | `context/changes/<id>/` exists with `change.md`; research not done. |
| `researched` | `research.md` exists in the change folder. |
| `planned` | `plan.md` exists with a `## Progress` section. |
| `implementing` | Progress section has at least one `[x]` and at least one `[ ]`. |
| `complete` | Progress section is fully `[x]`. |

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.
Recommendations in this section are grounded in local manifests/configs plus
the MCP/tools actually exposed in the current session.

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit + integration (backend) | Node built-in `node:test` + `c8` | Node 24, c8 ^11.0.0 | 12 test files across routes/plugins/schema — real coverage, hits a real Neon DB via `test/helper.ts`'s `build(t)`; not currently run in CI (see §5) |
| unit + integration (frontend/extension) | none yet — see §3 Phase 3 (frontend), Phase 5 (extension) | — | Both apps build on Vite ^8.1.1 + React 19; Vitest is the natural fit (shares Vite config/transform, zero new bundler) |
| API mocking | none | — | Backend tests hit a real database directly and stub only the Anthropic client at the network edge; no HTTP-mocking library installed anywhere |
| e2e | none | — | Not currently justified by cost × signal — no rollout phase names a failure mode that requires the full deployed shape over a cheaper layer |
| accessibility | none | — | Not in scope for any top-7 risk; revisit only if a future risk names it |
| visual diff (print) | none yet — see §3 Phase 4 | — | Needed specifically for Risk #2; no existing tooling in the repo does this today |
| infra | Jest ^30 + `@swc/jest` + `aws-cdk-lib` testhelpers | Jest 30 | 1 test file (`infra/test/infra.test.ts`); not tied to any top-7 risk, so no dedicated rollout phase |

**Stack grounding tools (current session):**
- Docs: none available — no Context7 or framework-docs MCP in this session; checked: 2026-08-05
- Search: none available — no Exa.ai or comparable search MCP; only generic `WebSearch` exists and was not used for stack claims in this plan; checked: 2026-08-05
- Runtime/browser: no Playwright/browser MCP in this session; the `claude-in-chrome` skill is available separately for manual browser driving if a rollout phase needs it; checked: 2026-08-05
- Provider/platform: `atlassian` MCP (Jira) is available — relevant if a future quality gate should file follow-up issues; not used to ground any claim in this plan; checked: 2026-08-05

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required for §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint + typecheck | local (`npm run lint`, `tsc -b`/`npm run build:ts` per app) | required | syntactic / type drift |
| backend unit + integration (`npm test`) | local + CI — both `pr-diff.yml` and `deploy.yml`'s `diff` jobs, each against its own ephemeral Neon branch per run (shipped in `testing-backend-ci-safety-net` p3) | enforced — `NEON_API_KEY`/`NEON_PROJECT_ID` are set, and a real push to `main` confirmed `deploy.yml`'s `diff` job runs tests and `deploy` is auto-skipped via `needs: diff` on failure. Only a required-status-check rule on `pr-diff.yml`'s `diff` job (Settings → Branches) remains needed for the PR path specifically, since that job has no automatic dependent to gate | logic regressions in the one app with real coverage today |
| route-reachability check | `backend/test/route-reachability.test.ts`, runs as part of `npm test` | required (shipped in `testing-backend-ci-safety-net` p2) | a route that passes tests but 404s through the real gateway (Risk #1) |
| AI-route rate-limit check | `backend/test/routes/api/collections-rate-limit.test.ts`, runs as part of `npm test` | required (shipped in `testing-backend-ci-safety-net` p1) | an unregistered or misconfigured cost guard on the AI-calling route (Risk #7) — the guard itself (`@fastify/rate-limit`) already existed; this phase added the test proving it works |
| frontend unit + integration | local + CI | required after §3 Phase 3 | logic regressions in auth/token handling, then wider UI logic after Phase 5 |
| print visual diff | CI on PR | required after §3 Phase 4 | print/A4 layout regressions across OS themes |
| e2e on critical flows | — | not planned | no rollout phase currently justifies this layer over cheaper ones (see §4) |
| pre-prod smoke | — | not planned | no rollout phase names this; manual verification remains the practice for now |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a backend unit/integration test

- Follow `backend/test/routes/api/collections.test.ts`: full Fastify app via
  `test/helper.ts`'s `build(t)`, real Neon DB, cleanup in `t.after`. If the
  route calls Anthropic, stub `app.anthropicClient` via
  `backend/test/helpers/anthropic.ts`'s `stubAnthropicSuccess` /
  `stubAnthropicSequence` / `stubAnthropicFailure` (shared helpers, extracted
  from `translate.test.ts` in `testing-backend-ci-safety-net` p1) rather than
  redefining stubs locally.

### 6.2 Adding a route-reachability check

- Shipped: `backend/test/route-reachability.test.ts`. It's a static source
  comparison, not an HTTP test — it reads `backend/src/routes/**/*.ts` and
  `infra/lib/constructs/api-construct.ts` as plain text, regex-extracts
  route/gateway registrations, normalizes Fastify's `:param` syntax to API
  Gateway's `{param}` syntax, and asserts the two sets match exactly. There
  is no exemption list: every backend route needs a matching gateway entry,
  full stop. If a route is ever meant to be gateway-exempt on purpose,
  that's a design conversation for this check's next revision, not a config
  entry to add speculatively.

### 6.3 Adding a frontend or extension unit/component test

- TBD — see §3 Phase 3 (frontend bootstrap) and §3 Phase 5 (extension
  bootstrap + logic coverage).

### 6.4 Adding a test for a new backend API endpoint

- Follow the existing pattern in `backend/test/routes/api/entries.test.ts`.
  A new endpoint must land with a matching `this.httpApi.addRoutes({...})`
  entry in `infra/lib/constructs/api-construct.ts` in the same change —
  `route-reachability.test.ts` (§6.2) fails naming the specific route if it
  doesn't. If the endpoint calls Anthropic, attach a per-route
  `config: { rateLimit: {...} }` following `translateRateLimit`'s pattern in
  `backend/src/routes/api/collections/index.ts` (keyed by
  `request.authUser.id`), and add a functional test on the model of
  `backend/test/routes/api/collections-rate-limit.test.ts` proving it
  actually rejects excess requests.

### 6.5 Adding or updating the print visual diff

- TBD — see §3 Phase 4.

### 6.6 Per-rollout-phase notes

(Filled in as each phase lands.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5).

- **Infra/CDK stack wiring beyond route-reachability** — `infra/lib/constructs`
  is high-churn but mostly declarative AWS config; a deploy or `cdk synth`
  catches structural breaks cheaper than unit tests would. (Source: Phase 2
  interview Q5.) Re-evaluate if a construct starts carrying real conditional
  logic rather than declarative resource definitions.
- **Pronunciation playback (Web Speech API) beyond what already ships** —
  known, accepted per-OS voice-availability limitations are documented in
  its own archived plan; diminishing returns on hardening it further right
  now. (Source: Phase 2 interview Q5.) Re-evaluate if the product moves to a
  paid TTS provider (PRD Open Question 2 reopened).

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-08-05
- Stack versions last verified: 2026-08-05
- AI-native tool references last verified: 2026-08-05 (none in use)

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
