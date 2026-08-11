// vitest/config's defineConfig is a superset of vite's — same config shape
// plus the `test` field, so it type-checks without a second config file.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // Narrowed from Vitest's default `**/*.{test,spec}.?(c|m)[jt]s?(x)`, which
    // would also collect browser-tests/*.spec.ts and fail on their
    // @playwright/test import. Vitest owns test/**/*.test.*; Playwright owns
    // browser-tests/**/*.spec.ts.
    include: ['test/**/*.test.{ts,tsx}']
  }
})
