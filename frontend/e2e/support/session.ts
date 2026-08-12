import type { Page } from '@playwright/test'

// Authentication for the app-level E2E suite, without the hosted UI.
//
// Driving Cognito's login page in a test would make a third party we don't
// control part of every run, and would need real credentials in CI. Instead we
// hand the app a session directly, which is the `storageState` idea adapted to
// where oidc-client-ts actually keeps its session: localStorage.

// playwright.e2e.config.ts runs Vite in `test` mode, so the app reads
// frontend/.env.test — committed placeholder values, no real user pool. That is
// what makes the storage key below a constant rather than something the test
// has to discover at runtime.
const AUTHORITY = 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_testplaceholder'
const CLIENT_ID = 'testplaceholderclientid'

// oidc-client-ts keys the session `${prefix}user:${authority}:${client_id}`,
// where prefix defaults to 'oidc.' — verified against oidc-client-ts 3.5.0
// (UserManager._userStoreKey and WebStorageStateStore's default prefix). If a
// major upgrade changes either, the seeded session goes unread and the specs
// fail at the "signed in" assertion rather than silently testing the logged-out
// view.
export const SESSION_STORAGE_KEY = `oidc.user:${AUTHORITY}:${CLIENT_ID}`

// Every backend call the frontend makes goes through apiClient's baseURL
// (http://localhost:3000 under .env.test) to /api/*. The two globs are
// deliberately distinct: '**/api/collections' does not match a path with a
// further segment, so a list stub never swallows a detail request.
export const API_COLLECTIONS = '**/api/collections'
export const API_COLLECTION_DETAIL = '**/api/collections/*'

export interface SeedSessionOptions {
  email?: string
  /** Seconds until the token expires. Negative values seed an already-dead one. */
  expiresInSeconds?: number
}

/**
 * Put a signed-in session in localStorage before the app boots.
 *
 * Returns the email it seeded, which is unique per call so parallel workers
 * and re-runs never assert on each other's session.
 */
export async function seedSession (page: Page, options: SeedSessionOptions = {}): Promise<string> {
  const {
    email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    expiresInSeconds = 3600
  } = options

  // Only the fields this codebase reads: cognito.ts checks .expired (derived
  // from expires_at), client.ts sends .id_token, App.tsx renders .profile.email.
  const session = {
    id_token: 'e2e-id-token',
    access_token: 'e2e-access-token',
    token_type: 'Bearer',
    scope: 'openid email profile',
    profile: { email, sub: 'e2e-user' },
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds
  }

  // addInitScript, not an evaluate() after goto: the session has to be in
  // storage before AuthProvider's first getFreshUser() runs, and it has to
  // survive page.reload() the same way a real one would.
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value)
    },
    [SESSION_STORAGE_KEY, JSON.stringify(session)] as const
  )

  return email
}
