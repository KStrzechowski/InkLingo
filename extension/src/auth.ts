import { COGNITO_CLIENT_ID, COGNITO_DOMAIN } from './config.ts'

// Cognito auth for a WebExtension. The web app's redirect + localStorage
// flow (frontend/src/auth/cognito.ts) doesn't port here: a popup that
// loses focus is torn down, and localStorage isn't available to the
// background script. This uses the identity API's own auth window
// instead, with tokens in browser.storage.local (isolated per-extension).
//
// No new Cognito App Client — this reuses the one AuthConstruct already
// deploys, which is a public client (no secret), so PKCE is what protects
// the authorization code in transit.

const STORAGE_KEY = 'auth'
const SCOPES = 'openid email profile'
// Refresh slightly early so a call that starts just under the wire
// doesn't arrive at the API already expired.
const EXPIRY_SKEW_SECONDS = 60

interface StoredAuth {
  idToken: string
  refreshToken: string | null
}

interface TokenResponse {
  id_token: string
  access_token: string
  // Absent on a refresh_token grant — Cognito reuses the existing one.
  refresh_token?: string
  expires_in: number
  token_type: string
}

// Firefox derives this from browser_specific_settings.gecko.id in
// manifest.json as https://<sha1(id)>.extensions.allizom.org/ and
// launchWebAuthFlow rejects any other redirect_uri (a moz-extension://
// URL can't be used: its UUID is regenerated per install). The identical
// value is registered as a Cognito callback URL in
// infra/lib/stacks/auth-stack.ts — the two must stay in sync, so changing
// the gecko id means changing that stack too.
function redirectUri (): string {
  return browser.identity.getRedirectURL()
}

function base64UrlEncode (bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function createPkcePair (): Promise<{ verifier: string, challenge: string }> {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64UrlEncode(new Uint8Array(digest)) }
}

// Only ever read for `exp` — the token itself is verified server-side by
// backend/src/plugins/auth.ts, never here.
function expiresAtSeconds (idToken: string): number {
  const payload = idToken.split('.')[1]
  if (payload === undefined) {
    return 0
  }
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as { exp?: number }
    return claims.exp ?? 0
  } catch {
    return 0
  }
}

async function read (): Promise<StoredAuth | null> {
  const stored = await browser.storage.local.get(STORAGE_KEY)
  return (stored[STORAGE_KEY] as StoredAuth | undefined) ?? null
}

async function write (auth: StoredAuth): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: auth })
}

async function clear (): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEY)
}

async function requestTokens (body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!response.ok) {
    throw new Error(`Cognito rejected the token request (${response.status})`)
  }
  return await response.json() as TokenResponse
}

export async function login (): Promise<void> {
  const { verifier, challenge } = await createPkcePair()
  // CSRF guard on the authorization response. PKCE already binds the code to
  // this call — launchWebAuthFlow hands the redirect URL straight back here
  // rather than to an ambient endpoint — but proving the response belongs to
  // the request we made is the OAuth baseline, so send and check it anyway.
  const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)))
  const params = new URLSearchParams({
    client_id: COGNITO_CLIENT_ID,
    response_type: 'code',
    scope: SCOPES,
    redirect_uri: redirectUri(),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  })

  const responseUrl = await browser.identity.launchWebAuthFlow({
    url: `${COGNITO_DOMAIN}/oauth2/authorize?${params.toString()}`,
    interactive: true
  })

  const returned = new URL(responseUrl).searchParams
  if (returned.get('state') !== state) {
    throw new Error('Login response did not match the request — try again')
  }

  const code = returned.get('code')
  if (code === null) {
    throw new Error('Login finished without an authorization code')
  }

  const tokens = await requestTokens(new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: COGNITO_CLIENT_ID,
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier
  }))
  await write({ idToken: tokens.id_token, refreshToken: tokens.refresh_token ?? null })
}

// Local-only: drops the stored tokens without hitting Cognito's /logout
// endpoint, so no logout URL needs registering in AuthConstruct. The
// hosted-UI session cookie survives, which for a single-user PoC just
// means the next login round-trips without re-entering a password.
export async function logout (): Promise<void> {
  await clear()
}

// Returns a usable ID token, refreshing first when the stored one is at
// or past its `exp`. Null means "the user has to log in again" — either
// nothing is stored, or the refresh token is gone/rejected.
export async function getIdToken (): Promise<string | null> {
  const stored = await read()
  if (stored === null) {
    return null
  }
  if (expiresAtSeconds(stored.idToken) - EXPIRY_SKEW_SECONDS > Date.now() / 1000) {
    return stored.idToken
  }
  if (stored.refreshToken === null) {
    await clear()
    return null
  }

  try {
    const tokens = await requestTokens(new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: COGNITO_CLIENT_ID,
      refresh_token: stored.refreshToken
    }))
    await write({ idToken: tokens.id_token, refreshToken: tokens.refresh_token ?? stored.refreshToken })
    return tokens.id_token
  } catch {
    await clear()
    return null
  }
}

export async function isAuthenticated (): Promise<boolean> {
  return await getIdToken() !== null
}
