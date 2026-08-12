# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-08-06

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
| 2 | A print/A4 export regresses silently after a CSS or component change — broken pagination, wrong colors under dark-mode OS preference, or content clipped outside the printable area | High | High | PRD Primary Success Criteria (print output is part of the north-star flow); interview Q3 (lowest-confidence area); archive/2026-08-02-printable-export/plan.md (global stylesheet documented as actively hostile to print, and its own Open Risks: "nothing automated will catch a regression in this page"). Sharpened 2026-08-10: of the four commits that built this surface, **two were post-ship fixes** landing 1h and 25h later, both found by manually printing after `build` + `lint` had gone green |
| 3 | An AI translate/capture call returns a structurally valid but empty or unusable result (no variants, no sentences), and the user sees a silently broken outcome instead of an explicit error | High | Medium | lessons.md "A stubbed AI client cannot tell you the model's output is usable" (measured ~9% failure rate on real calls); interview Q1, Q2 |
| 4 | An expired or invalid auth token is sent with a request and the failure surfaces as an opaque CORS error instead of a clean re-authentication prompt | High | Medium | lessons.md CORS/auth incident, 2026-08-04 (`fix/auth-token-refresh`); interview Q1, Q2 |
| 5 | A user requests another user's collection or entry by ID and the request succeeds instead of being rejected (IDOR) — ownership for entries flows only through a join, not a direct column | High | Medium | archive/2026-07-23-word-collections/plan.md ("entries has no user_id column — ownership only flows through entries.collection_id → collections.user_id"); abuse-lens: authorization/access |
| 6 | Frontend or extension business logic (collection language-gap detection, extension popup variant/sentence selection state) breaks silently — both areas have zero test coverage and own the highest recent churn in the repo | Medium | High | interview Q4 ("both equally"); hot-spot dirs `frontend/src/pages` (21 commits/30d), `extension/src` (11 commits/30d); test-base profile (`sparse`). Refined 2026-08-11 by research: the `frontend/src/pages` figure is **majority print churn** already covered by Phase 4 — the surface this risk still owns there is `CollectionDetailPage` (7 commits/60d) and `CollectionsListPage` (4). The `extension/src` figure holds up. Confirmed not speculative: grounding found three live races in the popup and one still-open list-page defect |
| 7 | Repeated or automated calls to the AI-calling route(s) are not capped per user, so an accidental retry loop or a leaked/scraped endpoint can run up real Anthropic + AWS cost with no built-in ceiling | Medium | Medium | interview Q1 (explicit cost worry); infrastructure.md Risk Register ("denial-of-wallet... not yet implemented, tracked here as an open item"); abuse-lens: resource abuse |

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|---|---|---|---|---|---|
| #1 | A route added or changed under the backend's route tree is actually reachable through the real API Gateway wiring, not just resolvable in-process | "Green backend tests" is evidence the route works — the test app never goes through the gateway, so this is false | How routes are registered against the gateway construct (explicit entries, no catch-all); whether any CI step already verifies this | Deterministic static check cross-referencing route files against gateway registrations, or a `cdk synth`/diff step in CI | An integration test that still only calls the app in-process — reproduces the exact blind spot that caused this twice |
| #2 | The print view keeps A4-safe geometry, black-on-white color, and header/row integrity across a CSS or component change, in both light and dark OS theme. Three distinct targets, not one — see the layer split opposite | "Looks right on screen" proves nothing about print — the global stylesheet actively overrides colors and layout for print. Sharper (research, 2026-08-10): Firefox's *print preview* is not the printout either | The print stylesheet mechanism (media/page rules), how dark-mode variables are overridden for print, current verification approach | **Corrected 2026-08-10 by research** — cheapest is browser-free and covers most of the risk: pure unit tests on the pagination packer, a static `print.css` geometry-invariant check (the A4 constants are duplicated in three places and drift silently), and native-language furniture tests in the existing jsdom runner. A browser is needed *only* for dark-theme print color, language-column overflow measurement, and real page count — and it is Chromium-bound, while 2 of the 4 print defects this project shipped were Firefox-only and provably invisible to Chromium. Manual print-to-paper stays as the final gate | A snapshot test that locks in the current, possibly-still-wrong layout with no independent check against real A4 output. Second anti-pattern (research, 2026-08-10): a jsdom `getComputedStyle` assertion against `print.css` — Vitest loads no stylesheet, so it asserts jsdom's defaults and passes whatever the CSS says |
| #3 | A translate/capture call against the real Anthropic API returns usable (non-empty) output at a measured rate, and an unusable result surfaces as a visible error rather than an empty section | Stubbed tests prove the integration works — they only prove our code handles a response shape we invented ourselves | Current handling of empty variants/sentences arrays; whether the tool schema constrains array length at all | Keep stubs for logic/error-path coverage; add a one-off empirical script (dozen+ real calls, varied inputs) run as part of this phase | More stub-based tests whose expected values are copied from the implementation (oracle problem) — raises coverage without closing the gap |
| #4 | A request made with an expired/invalid token triggers silent renewal before reaching the API, and a token that fails renewal drops the session with a clear re-login prompt | A CORS error means a CORS config problem — here it means an expired token, since the JWT authorizer's rejection carries no CORS headers of its own | Current token-expiry check before attaching auth headers; whether concurrent renewal calls are deduped; client behavior on a 401 that survives renewal | Frontend unit/integration test around token-attachment and renewal logic (mock an expired token, assert renewal + dedupe) | Testing only the happy path (valid token → 200) — that case was already covered and did not catch this |
| #5 | A cross-user request for a collection or entry ID (guessed or otherwise obtained) is rejected (404/403) for every endpoint that accepts such an ID | Being authenticated is enough — a query that forgets the ownership join/filter silently returns or mutates another user's data | Every route accepting a collection/entry ID; which ones filter by the authenticated user's ownership versus row existence only | Integration test per ownership-sensitive endpoint: two seeded users, cross-user request, assert rejection | Testing only "unauthenticated request is rejected" (401) and treating that as authorization coverage — it is a different failure mode entirely |
| #6 | The language-gap detection and popup variant/sentence selection logic produce correct output on documented edge cases (missing-language entries, multi-language collections, collection-switch mid-selection), not just the happy path | The UI looking right during manual testing proves the state logic is right — it doesn't prove state transitions (e.g. stale selection after switching collections) are handled. Sharper (research, 2026-08-11): manual testing *cannot* reach these — they need a race against a ~5s AI call, and Firefox destroys the popup document the moment it loses focus, which is why three commits of churn never surfaced them | Which components/hooks own this logic; what edge cases are currently handled versus assumed | **Refined 2026-08-11 by research** — component tests in the existing RTL + jsdom setup, confirmed; but the highest-value cases are *async state-transition races* needing a promise the test resolves by hand, not pure-function cases. A pure-unit reading of "unit/component tests" would miss exactly the failures worth catching | Reaching for e2e/browser tests to cover a zero-coverage gap that a cheaper unit/component test would catch just as well. Second (research, 2026-08-11): asserting the current copy as the oracle — the gap button renders the raw code (`Add EN`), so a test pinning that label is about copy, not behaviour |
| #7 | Repeated/rapid requests to the AI-calling route(s) from one user are capped before reaching Anthropic, with a clear client-visible response when capped | Platform-level throttling already covers this — it bounds AWS-side blast radius only; the Anthropic-side per-call cost is uncapped until an application-level limit exists | Which routes call Anthropic; confirm no rate-limit plugin is registered yet; what a sane per-user limit looks like at this project's scale | Plugin-level integration test asserting the rate-limit guard is registered and enforces a cap on the AI-calling route(s) | Verifying the guard by making real Anthropic calls in a loop — burns the exact budget the guard exists to protect |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Backend CI safety net | Make every backend route provably gateway-reachable, cap the AI route's cost exposure, and make `npm test` actually gate merges in CI | #1, #7 | static route-registration check, rate-limit plugin integration test, CI wiring | complete | context/changes/testing-backend-ci-safety-net/ |
| 2 | AI usability + cross-user isolation | Confirm AI output is measurably usable and no endpoint lets one user reach another user's data | #3, #5 | empirical real-API script, backend integration tests (IDOR) | complete | context/changes/testing-ai-usability-cross-user-isolation/ |
| 3 | Auth resilience | An expired/invalid token never surfaces as an opaque failure — it renews silently or drops the session cleanly | #4 | frontend unit/integration tests (bootstraps Vitest for `frontend/`) | complete | context/changes/testing-auth-resilience/ |
| 4 | Print output correctness | Print/A4 layout changes are verifiable without a manual print-preview every time, in both OS themes | #2 | browser-free unit + static CSS-invariant checks, two-engine Playwright assertions (no pixel baselines), reduced manual paper gate | complete | context/changes/testing-print-output-correctness/ |
| 5 | Frontend/extension logic coverage | The zero-coverage, highest-churn UI logic has tests for its documented edge cases | #6 | component/unit tests (extends Vitest; bootstraps a test runner for `extension/`) | complete | context/changes/testing-frontend-extension-logic/ |

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
| unit + integration (frontend/extension) | Vitest + `@testing-library/react` + jsdom, in both apps | vitest ^4.1.10, @testing-library/react ^16.3.2, @testing-library/jest-dom ^7, jsdom ^30 | Shipped for `frontend/` in `testing-auth-resilience` p1 and for `extension/` in `testing-frontend-extension-logic` p1, deliberately identical: `test` field on each app's existing `vite.config.ts` (no second config), tests under `<app>/test/` mirroring `backend/test/`, no Vitest globals (explicit `describe`/`it`/`expect`/`vi` imports, matching the backend's `node:test` style), and a `tsconfig.vitest.json` project putting `test/` under `tsc -b`. The extension adds one thing the frontend does not need: a `globalThis.browser` fake (§6.3), since jsdom provides no WebExtension APIs. Note `extension/vite.config.ts`'s `writeManifest` plugin is `apply: 'build'` — Vitest runs a Vite dev server and fired its `closeBundle` on every environment, rewriting `dist/manifest.json` with wildcard placeholders on each test run; checked: 2026-08-11 |
| API mocking | none | — | Backend tests hit a real database directly and stub only the Anthropic client at the network edge; no HTTP-mocking library installed anywhere |
| browser (print only) | Playwright, Chromium + Firefox | @playwright/test ^1.62.1 | Shipped in `testing-print-output-correctness` p3-p4. Runs `frontend/browser-tests/*.spec.ts` against `print-harness.html` on the Vite dev server — no auth, no backend, committed fixtures. Assertions only, **no pixel baselines**: every check has an independent oracle (ISO 216, the black-and-white requirement, arithmetic). Both engines because `page.pdf()` is Chromium-only while the sheet is printed from Firefox. `npm run test:print`, never `npm test`; checked: 2026-08-10 |
| e2e (app-level) | Playwright, Chromium only | @playwright/test ^1.62.1 | Added 2026-08-12 for Risk #4 only, after re-running the whole risk map through an E2E fit gate: every other top-7 risk is either already covered at a cheaper layer or (the extension) undriveable by Playwright at all, since Firefox MV3 add-ons need `web-ext`/Marionette. Runs `frontend/e2e/*.spec.ts` via `npm run test:e2e` against the **real** app — real router, real `AuthProvider`, real axios interceptors — with two things faked: the session is seeded straight into localStorage (`e2e/support/session.ts`) rather than driven through Cognito's hosted UI, and `/api/*` is stubbed with `page.route()`. Deterministic because the server runs `vite --mode test`, so the app boots the committed `.env.test` placeholders and the OIDC storage key is a constant. No backend, no Neon branch, no credentials, no Anthropic calls. Chromium only: this risk is JS/render wiring, which does not vary by engine. **Not yet in CI** — see §5; checked: 2026-08-12 |
| accessibility | none | — | Not in scope for any top-7 risk; revisit only if a future risk names it |
| visual diff (print) | deliberately none | — | Considered for Risk #2 and rejected during `testing-print-output-correctness` planning: a blessed baseline has no independent oracle, and the failures that actually shipped were measurable (page count, text width, computed colour) rather than merely visible. Covered instead by the browser row above plus the static `print.css` checks in `frontend/test/pages/printCssGeometry.test.ts` |
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
| backend unit + integration (`npm test`) | local + CI — both `pr-diff.yml` and `deploy.yml`'s `diff` jobs, each against its own ephemeral Neon branch per run (shipped in `testing-backend-ci-safety-net` p3) | enforced — `NEON_API_KEY`/`NEON_PROJECT_ID` are set, and a real push to `main` confirmed `deploy.yml`'s `diff` job runs tests and `deploy` is auto-skipped via `needs: diff` on failure. The PR path is enforced too as of 2026-08-10: the `diff` context is a required status check on the `PR-Needed` ruleset. **Note the location** — this repo has no classic branch protection (`main` reports "Branch not protected"); the gate lives under Settings → Rules → Rulesets, not Settings → Branches | logic regressions in the one app with real coverage today |
| route-reachability check | `backend/test/route-reachability.test.ts`, runs as part of `npm test` | required (shipped in `testing-backend-ci-safety-net` p2) | a route that passes tests but 404s through the real gateway (Risk #1) |
| AI-route rate-limit check | `backend/test/routes/api/collections-rate-limit.test.ts`, runs as part of `npm test` | required (shipped in `testing-backend-ci-safety-net` p1) | an unregistered or misconfigured cost guard on the AI-calling route (Risk #7) — the guard itself (`@fastify/rate-limit`) already existed; this phase added the test proving it works |
| IDOR ownership guard | `backend/test/route-ownership.test.ts`, runs as part of `npm test` | required (shipped in `testing-ai-usability-cross-user-isolation` p2) | a route accepting a collection/entry ID without calling the shared ownership helper (Risk #5) — mirrors the route-reachability check's static-source-comparison approach, applied to authorization instead of gateway registration |
| frontend unit + integration (`npm test` in `frontend/`) | local + CI — the "Run frontend tests" step in both `pr-diff.yml` and `deploy.yml`'s `diff` jobs (shipped in `testing-auth-resilience` p4) | enforced — needs no database or credentials, so unlike the backend gate there is nothing to configure. `deploy.yml` is auto-gated (`deploy` `needs: diff`); the PR path is covered by the `diff` required status check, since the frontend step lives inside that same job | logic regressions in auth/token handling, and — since Phase 5 — the collections list's language picker and its recovery from a failed load |
| print document tests (`npm test` in `frontend/`) | local + CI — part of the existing "Run frontend tests" step (shipped in `testing-print-output-correctness` p1-p3) | enforced by the same rule as the frontend gate above — no separate configuration | row-model regressions (backfill gaps, legacy uppercase codes, sort order), a supported language with no native headings, pagination-packer logic, and drift between the three places `print.css` encodes the A4 geometry |
| print browser tests (`npm run test:print`) | CI — its own `print-tests` job in both `pr-diff.yml` and `deploy.yml` (shipped in `testing-print-output-correctness` p5) | enforced — `deploy.yml` is auto-gated (`deploy` `needs: [diff, print-tests]`), and the PR path has `print-tests` as its own required status check on the `PR-Needed` ruleset as of 2026-08-10. It needed a separate context because, unlike the frontend/backend rows, it is not inside the `diff` job | grey-on-dark printouts under a dark OS theme, a language name overflowing the Language column, and a preview whose page count no longer matches the printed PDF |
| extension unit + component (`npm test` in `extension/`) | local + CI — the "Run extension tests" step in both `pr-diff.yml` and `deploy.yml`'s `diff` jobs (shipped in `testing-frontend-extension-logic` p6) | enforced by the same rule as the frontend gate above — it needs no database, credentials or browsers, so there is nothing to configure, and it sits inside the already-required `diff` context | stale-AI-result races in the popup (a translate landing under the wrong collection, a regeneration overwriting a newer capture or reverting a variant pick) and the variant/sentence selection model (Risk #6) |
| extension lint + build (`npm run lint`, `npm run build` in `extension/`) | CI — the same "Run extension tests" step (shipped in `testing-frontend-extension-logic` p6) | enforced | the extension had **no** CI presence before this phase, so this is the first automated proof that it compiles and lints at all. `npm run build` is also what type-checks `extension/test/` via `tsconfig.vitest.json` |
| app-level e2e (`npm run test:e2e` in `frontend/`) | local only — **not wired into CI yet** | not enforced | Risk #4's assembled-app half: that a blocked (CORS-shaped) API failure raises the re-auth banner, and that a 401 drops the session to the signed-out view. Phase 3's unit tests cover each piece with the others mocked; these two specs are the only thing proving the four boundaries between them (axios interceptor → `connectionIssue` module → `AuthProvider` → render) are actually wired together. Both were break-verified on 2026-08-12: inverting each behaviour turns the matching spec red. Until it is added to `pr-diff.yml`/`deploy.yml` this gate protects nothing automatically |
| e2e on other critical flows | — | not planned | Still not justified. A full journey (create collection → capture → print) needs a live backend and would assert against stubbed responses the test itself invented — the oracle problem §2 names for Risk #3. The extension is out of reach for Playwright entirely |
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

- **Frontend — shipped** (`testing-auth-resilience` p1-p3). Tests live under
  `frontend/test/`, mirroring the source tree (`test/auth/cognito.test.ts`
  covers `src/auth/cognito.ts`) rather than colocated beside the source —
  the cross-app convention `backend/test/` already sets. `npm test` runs
  `vitest run` (single pass, no watch); `npm run dev`-style watching is
  `npx vitest` when you want it.
- Import `describe`/`it`/`expect`/`vi` explicitly from `'vitest'`. There are
  no test globals on purpose, so nothing needs teaching to oxlint or tsc.
- Shared fakes go in `frontend/test/helpers/` — `helpers/oidc.ts` exports
  `createFakeUser()` and `createFakeUserManager()` (the `oidc-client-ts`
  subset this codebase actually reads, plus `emitUserLoaded`/`emitUserUnloaded`
  for firing events a component subscribes to). Same role as
  `backend/test/helpers/fixtures.ts`; extend it rather than re-mocking ad hoc.
- Mock at the seam the module under test actually imports from. `cognito.ts`
  and anything rendering `AuthProvider` mock `'oidc-client-ts'` itself so the
  real renewal logic stays in the path; `client.ts` imports `getFreshUser`
  from `cognito.ts` directly, so *that* module is its seam. The mock factory
  builds the fake itself, because it runs at the moment the module under test
  is first imported:

  ```ts
  const state = vi.hoisted(() => ({ manager: null as unknown as FakeUserManager }))
  vi.mock('oidc-client-ts', async () => {
    const { createFakeUserManager } = await import('../helpers/oidc')
    state.manager = createFakeUserManager()
    // `function`, not an arrow — cognito.ts calls these with `new`.
    return {
      UserManager: vi.fn(function () { return state.manager }),
      WebStorageStateStore: vi.fn(function () {})
    }
  })
  ```

- `vi.resetAllMocks()` in `beforeEach` restores each `vi.fn(impl)` to the
  implementation the fixture gave it, so no test inherits another's stubbing.
- For anything touching `apiClient`, override `apiClient.defaults.adapter`
  instead of mocking axios — the interceptors are the thing under test and a
  custom adapter leaves them running. See `frontend/test/api/client.test.ts`.
- Component tests use `@testing-library/react` against jsdom. Cleanup is
  registered in `frontend/test/setup.ts` (RTL only auto-registers it when
  test globals are injected, which this project doesn't do).
- `frontend/.env.test` is committed and holds dummy Cognito values;
  `frontend/test/env.test.ts` asserts they win over a real `.env`, which is
  what keeps CI's deployed-stack env out of the test run.
- **Extension — shipped** (`testing-frontend-extension-logic` p1-p3). Same
  shape as the frontend: tests under `extension/test/` mirroring the source
  tree, explicit `vitest` imports, `afterEach(cleanup)` registered by hand in
  `test/setup.ts`, shared fakes in `test/helpers/`. Imports carry the `.ts`
  extension, matching the extension's own source style. Four things are
  specific to it:
- **Fake `globalThis.browser`, don't mock `messages.ts`.** jsdom provides no
  WebExtension APIs, while `@types/firefox-webext-browser` declares `browser`
  globally — so TypeScript is satisfied and the runtime value is simply
  missing. `test/helpers/webext.ts`'s `installFakeBrowser()` supplies
  `runtime.sendMessage` and `storage.local` (the popup calls the latter
  directly), and its `sendMessage` speaks the real `{ ok, data } / { ok, error }`
  envelope — mirroring `background.ts`'s `handle()`, where a thrown handler
  becomes `{ ok: false }` rather than a rejection. That keeps
  `messages.ts`'s unwrapping in the path, which the popup's entire error UI
  depends on. Script responses per message type via `fake.handlers`, seed
  `fake.store`, and assert what was requested via `fake.sent`.
- **`deferred()` is how the races are tested.** The popup's interesting bugs
  are all "a call landed after the user moved on", so a test needs to hold a
  response open, act, then resolve it inside `await act(...)`. Every guard in
  `popup/App.tsx` — the generation ref, the functional writes — is only
  observable that way.
- **No `speechSynthesis` stub is needed, and that has a visible consequence.**
  `src/speech.ts:25-27` degrades to an empty voice list when the API is absent,
  so `useSpeech` settles ready-with-no-voices and *every* language block renders
  "No `<Language>` voice is installed on this computer" with its play button
  disabled. Locate by role and accessible name; a loose text query will collide
  with that copy, and a "no error is shown" assertion must not count it.
- **Radio accessible names come from the whole label.** A variant radio's name
  is its meaning text (plus `/phonetic/` when present) — match exactly. A
  sentence radio's name concatenates target text and gloss with no separator,
  so match those with a regex on a distinctive fragment.

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
  actually rejects excess requests. If the endpoint accepts a collection or
  entry ID in its path, it must fetch that resource through the shared
  ownership helper (§6.6) — `route-ownership.test.ts` fails naming the
  specific route if it doesn't.

### 6.5 Adding a print-document test

There is no visual diff — see §4 for why. Pick the cheapest layer that can
actually observe the failure; three of the four are browser-free.

- **Row model, labels, pagination logic → Vitest** (`frontend/test/pages/`).
  `printRows.ts`, `printLabels.ts` and `printPagination.ts`'s `packPrintPages`
  are all pure. Build inputs with `frontend/test/helpers/collections.ts`
  (`createCollection` / `createEntry` / `createTranslation` / `createSentence`)
  rather than hand-rolled literals. Expected page counts are worked out by hand
  from synthetic band heights — never read back from the function under test.
- **A rule that must hold across files → a static check** on the model of
  `printCssGeometry.test.ts`, which is the frontend's version of §6.2/§6.6's
  idiom: read the file as text, regex-extract, compare, and carry a tripwire
  asserting the parser still matches what it expects. The tripwire is not
  optional — it caught a real vacuous pass during this rollout, when a
  Vite `?raw` import returned an object and every extraction silently produced
  `null`.
- **Colour, real geometry, real text measurement → Playwright**
  (`frontend/browser-tests/*.spec.ts`). jsdom computes no layout
  (`getBoundingClientRect` is all zeros) and loads no stylesheet
  (`document.styleSheets.length === 0`), so a `getComputedStyle` assertion in
  Vitest tests jsdom's defaults and passes whatever the CSS says. That is the
  trap this section exists to name.

Four things that will bite when writing a browser spec:

- **Screen media vs print media.** Use `openPreview` from `browser-tests/support.ts`
  for anything measuring layout — under `emulateMedia({ media: 'print' })` the
  sheet collapses to a plain block (`@page` supplies the geometry instead), the
  table spans the viewport, and a column measures roughly twice its width on
  paper. Use `openPrintedSheet` only for print-medium concerns like colour.
- **Set `colorScheme` before navigating.** `openPrintedSheet` does. Firefox does
  not apply a colour-scheme change to a loaded page without a reload
  (microsoft/playwright#2352), so emulating after `goto` passes in Chromium
  while silently asserting light-mode values in Firefox.
- **`scrollWidth` cannot detect overflow in this table.** `table-layout: fixed`
  cells never scroll, so `scrollWidth === clientWidth` even while text visibly
  crosses the border. Measure with a `Range` over the cell's contents, against
  the content box (`clientWidth` minus horizontal padding). This reproduces the
  archived 2026-08-03 numbers exactly — `французский` at 90.1px.
- **`page.pdf()` is headless-Chromium-only.** Scope page-count assertions with
  `test.skip(({ browserName }) => browserName !== 'chromium', ...)` so the
  Firefox run reports them as skipped-with-reason rather than passing.

Locators follow the project rule (`getByRole`/`getByText`), but scope them to
one sheet — `page.locator('.print-page').first()` — because the column header
repeats on every page, and pass `exact: true`, because `getByRole`'s `name` is a
case-insensitive **substring** match (`'Tłumaczenie'` also matches
`'Zdanie (tłumaczenie)'`).

The harness (`frontend/print-harness.html` → `browser-tests/harness/main.tsx`)
mounts the production `PrintDocument` with committed fixtures — no auth, no
network. It is reachable only because Vite's dev server serves any root-level
`.html` while `vite build`'s default input is `index.html` alone;
`test/pages/harnessBuild.test.ts` asserts both that it mounts the real component
and that it never reaches `dist/`. Add fixtures to
`browser-tests/harness/fixtures.ts`, never point a test at the dev database.

### 6.6 Adding an ownership-checked (IDOR-safe) route

- Shipped: `backend/src/routes/api/collections/ownership.ts` exports
  `fetchOwnedCollection(fastify, collectionId, userId)` and
  `fetchOwnedEntry(fastify, entryId, collectionId)` — the single source of
  truth for "fetch this row only if the requesting user owns it." Any new
  route accepting a `:id` (collection) or `:entryId` (entry) path param must
  call the matching helper instead of writing its own ownership query.
  `backend/test/route-ownership.test.ts` is a static source comparison (not
  an HTTP test, same style as §6.2's reachability check): it enumerates
  `:id`/`:entryId`-accepting routes and asserts each one's handler source
  contains the expected helper call, failing with the specific route name if
  not. No exemption list — every ID-accepting route needs the helper call,
  full stop.

### 6.7 Running the AI-usability empirical check

- Not a committed script — per the "stubbed AI client" lesson
  (`context/foundation/lessons.md`), this is a one-off, uncommitted script
  run manually with explicit live permission before trusting a change to
  the AI translate path. Call `generateTranslation()`
  (`backend/src/ai/translate.ts`) directly with a real Anthropic client
  (bypass HTTP/auth/DB — the risk lives in the AI call itself), for a dozen+
  varied word/phrase inputs, and record whether `isEmpty()` was still true
  after the built-in retry, plus latency and token usage. Never add this to
  `npm test` or any CI workflow — it costs real Anthropic spend per run.
  Last measured: `checked: 2026-08-05` — 14/14 calls usable (100%), avg
  latency 4965ms, $0.0597 total (~$0.0043/call) against
  `claude-haiku-4-5-20251001`. This single run is a spot-check, not a
  statistically confident rate — the archived pre-retry measurement
  (~9% empty) implies roughly 1-in-14 empty results is still expected on
  average; re-run before trusting a change to the retry/empty-handling
  logic itself.

### 6.8 Per-rollout-phase notes

**Phase 5 — Frontend/extension logic coverage** (`testing-frontend-extension-logic`,
2026-08-11). Four defects were found by grounding a risk that had been written
up as a coverage gap, and all four are the same shape: **a value read before an
`await` and written after it, with the control that changes it left enabled
meanwhile.** Three were in the popup (a translate landing under a collection the
user had switched away from — which the backend's target-language guard only
catches when the two collections' targets differ; a regeneration rebuilding
state from a pre-await closure; the same continuation forcing back a variant
index the user had changed). The fourth was the list page's failed-load state,
already written up in `lessons.md` and still live. See §7's new entry.

Two method notes worth carrying forward. First, **defense in depth defeats
non-vacuity checks**: the first pass at the regeneration tests passed with
*either* of its two guards removed, because each masked the other. Splitting
into a case that only the generation guard can satisfy (a late result landing
on a *different* word, where a functional write is no protection) was what made
each guard independently provable. Second, when a fix's guard makes a path
unreachable through the UI, the test has to drive the seam instead — otherwise
it silently tests the `disabled` attribute and the real guard can rot.

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
- **`oidc-client-ts`'s `automaticSilentRenew` timer mechanics** — the
  frontend auth tests assert only that `UserManager` is *constructed* with
  `automaticSilentRenew: true`, never that its timer actually fires a
  renewal. The timers belong to `oidc-client-ts`, which tests them itself,
  and since these tests mock that module wholesale, "testing" the renewal
  would only exercise the fake's own scripted behavior — coverage with no
  oracle. (Source: `testing-auth-resilience` plan, What We're NOT Doing.)
  Re-evaluate if this project ever stops mocking the module — e.g. if a
  future phase drives real token lifetimes against a live Cognito pool.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-08-11
- Stack versions last verified: 2026-08-11
- AI-native tool references last verified: 2026-08-05 (none in use)
- Print browser tooling (Playwright, both engines) verified: 2026-08-10
- Extension test runner (Vitest + RTL + `browser` fake) verified: 2026-08-11

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
