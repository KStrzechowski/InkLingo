# E2E Testing Rules

Read this before writing or generating anything in `frontend/e2e/`. `seed.spec.ts`
is the worked exemplar — model new specs on it. What the seed shows is what gets
generated, so neither file drifts without the other.

## The rules

- Use `getByRole`, `getByLabel`, `getByText` as primary locators. Fall back to
  `getByTestId` only when accessibility attributes are ambiguous.
- Never use CSS selectors, XPath, or DOM structure for locating elements.
- Each test must be independently runnable — no shared state between tests.
- Never use `page.waitForTimeout()`. Wait for specific conditions:
  `toBeVisible()`, `waitForURL()`, `waitForResponse()`.
- Assert the business outcome, not implementation details.
- Use unique identifiers (timestamp suffix) for test data so parallel runs and
  re-runs don't collide. Clean up in `afterEach`.
- Authenticate via `seedSession()` from `support/session.ts` — never through the
  Cognito hosted UI.
- **The assertion must fail if the risk materializes.** Control question for
  every assertion: would this go red if the `test-plan.md` risk it names came
  true? If not, it is decorative. Prove it by breaking the behaviour on purpose
  once, watching the test go red, then reverting.
- Name the test after the risk, and cite the `test-plan.md` risk number in a
  header comment. `test('test 1', ...)` is not a name.

## What is real and what is mocked here

E2E does not mean zero mocking — it means the *internal* boundaries stay real,
because that is where integration risk hides. In this suite:

| Boundary | Treatment | Why |
|---|---|---|
| React render, router, `AuthProvider`, axios interceptors | **real** | This is the wiring the specs exist to prove. Unit tests already cover each piece with the others mocked out; only the assembled app can show they agree. |
| Session / Cognito | **seeded**, not driven | `seedSession()` writes the same localStorage entry oidc-client-ts would. The hosted UI is a third party, needs real credentials, and proves nothing about our code. |
| Backend HTTP (`/api/*`) | **stubbed** via `page.route()` | The backend needs a live Neon branch, and the AI routes cost real money per call. Stub the transport, keep everything above it real. |

Stubbing the backend has a cost worth stating: a spec that asserts values it
also invented is testing itself (the oracle problem — `test-plan.md` §2 names it
for Risk #3). So specs here assert **behaviour the frontend owns** — what the UI
does in response to a network condition — never business data the backend would
have computed.

## Scope of this suite vs. the others

- `frontend/e2e/` (this dir, `npm run test:e2e`) — app-level flows through the
  real router and auth wiring, Chromium only. The risks here are JavaScript and
  render logic, which do not vary by engine.
- `frontend/browser-tests/` (`npm run test:print`) — the printable sheet, driven
  against a static harness in **both** Chromium and Firefox, because that risk
  is real-engine layout and two of the four print defects this project shipped
  were Firefox-only. Don't merge the two suites; they need different engines and
  different servers.
- `frontend/test/`, `extension/test/` (`npm test`) — everything a jsdom unit or
  component test can prove. Always prefer these: they are ~100x cheaper. Reach
  for E2E only when a risk crosses several real boundaries at once.
