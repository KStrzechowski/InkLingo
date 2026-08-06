// vitest/config's defineConfig is a superset of vite's — same config shape
// plus the `test` field, so it type-checks without a second config file.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts']
  }
})
