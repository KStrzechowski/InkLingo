import { describe, expect, it } from 'vitest'

// CI writes a real frontend/.env from deployed stack outputs in the same job
// that runs these tests, and cognito.ts reads VITE_COGNITO_* at module load.
// Vite resolves the mode-specific .env.test over the generic .env for the
// same key, so the dummy values below are what a test run sees either way —
// this asserts that precedence rather than trusting it.
describe('test environment', () => {
  it('loads .env.test values, not a real .env or .env.development', () => {
    expect(import.meta.env.MODE).toBe('test')
    expect(import.meta.env.VITE_COGNITO_USER_POOL_ID).toBe('eu-central-1_testplaceholder')
    expect(import.meta.env.VITE_COGNITO_CLIENT_ID).toBe('testplaceholderclientid')
    expect(import.meta.env.VITE_COGNITO_DOMAIN).toBe(
      'https://test-placeholder.auth.eu-central-1.amazoncognito.com'
    )
  })
})
