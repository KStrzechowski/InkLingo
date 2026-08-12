import { defineConfig, devices } from '@playwright/test'

// App-level E2E, separate from playwright.config.ts on purpose. That one drives
// a static print harness in two engines; this one drives the real app — real
// router, real AuthProvider, real axios interceptors — with the backend stubbed
// at the network layer. Different server, different mode, different engine set,
// so folding them into one config would mean a matrix where most cells are
// meaningless.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry'
  },
  // Chromium only. These risks live in JavaScript and render logic, which do
  // not vary by engine — unlike the print suite, where two of the four defects
  // this project shipped were Firefox-only layout bugs and both engines earn
  // their runtime.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: {
    // `--mode test` is what makes the suite deterministic: Vite then reads the
    // committed frontend/.env.test, so the Cognito user pool and client id the
    // app boots with are the placeholders e2e/support/session.ts keys its
    // seeded session against. A dev-mode server would read the developer's own
    // .env.development and the session would go unread.
    command: 'npm run dev -- --mode test --port 5174 --strictPort',
    url: 'http://localhost:5174/',
    // Never reuse: a server already up on this port might be running in another
    // mode, which would break the session seeding in a confusing way. The print
    // suite's 5173 is left free so both can run at once.
    reuseExistingServer: false,
    timeout: 60_000
  }
})
