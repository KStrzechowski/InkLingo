import { defineConfig, devices } from '@playwright/test'

// Browser tests for the printable sheet. These cover only what the Vitest suite
// provably cannot see: jsdom computes no layout (every getBoundingClientRect is
// zero) and loads no stylesheet, so real geometry, real print-media colour and
// real text measurement need a real engine.
//
// Both engines, on purpose. page.pdf() is headless-Chromium-only, so only
// Chromium can answer "how many pages"; but the sheet is printed from Firefox,
// and two of the four print defects this project has shipped were Firefox-only
// (sub-pixel border rounding, and a collapsed-border table left open at a page
// break — Chromium's PDF output was measured against the latter and could not
// see it). See context/changes/testing-print-output-correctness/research.md.
export default defineConfig({
  testDir: './browser-tests',
  // Vitest's default include is **/*.{test,spec}.* — the Vitest suite narrows
  // itself to test/**/*.test.* (see vite.config.ts) so these .spec.ts files are
  // never collected by `npm test`, where the @playwright/test import would fail.
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } }
  ],
  webServer: {
    // The harness is served by the dev server, not a production build — it is
    // deliberately absent from dist/.
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173/print-harness.html',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  }
})
