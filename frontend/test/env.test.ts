import { describe, expect, it } from 'vitest'

// CI writes a real frontend/.env.production from deployed stack outputs in the
// same job that runs these tests, and cognito.ts reads VITE_COGNITO_* at module
// load. Vite only loads the files for the current mode, so a `test` run never
// reads .env.production — and prefers this .env.test over a generic .env for
// the same key. This asserts that rather than trusting it.
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
