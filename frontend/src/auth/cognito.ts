import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts'
import { report } from '../observability/reporter'

const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID
const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN
const redirectUri = import.meta.env.VITE_COGNITO_REDIRECT_URI
const region = import.meta.env.VITE_COGNITO_REGION

export const userManager = new UserManager({
  authority: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: 'openid email profile',
  userStore: new WebStorageStateStore({ store: window.localStorage }),
  // Keeps a long-open tab's token alive. Already the library default; set
  // explicitly because it's load-bearing for auth and worth seeing at the
  // call site. It only covers a token expiring *while the page is open* — a
  // page opened with an already-expired token is getFreshUser()'s job.
  automaticSilentRenew: true
})

export function login (): Promise<void> {
  return userManager.signinRedirect()
}

export function handleLoginCallback (): Promise<User> {
  return userManager.signinRedirectCallback()
}

export function getUser (): Promise<User | null> {
  return userManager.getUser()
}

// getUser() hands back whatever is in localStorage without looking at
// expires_at, so after an hour away it returns a user whose id_token is
// already dead. Sending that token doesn't fail legibly: API Gateway's
// HttpUserPoolAuthorizer rejects it at the edge with a 401 carrying no
// Access-Control-Allow-Origin (corsPreflight covers the preflight and
// integration responses, not authorizer rejections), so the browser reports
// a CORS failure and the real cause is invisible. Renew before the token
// ever goes out.
//
// Cognito's code grant returns a refresh_token without offline_access in the
// scope, so signinSilent() renews over that grant — no hidden iframe and no
// silent_redirect_uri involved.
let renewal: Promise<User | null> | null = null

export async function getFreshUser (): Promise<User | null> {
  const user = await userManager.getUser()
  if (user === null || !user.expired) {
    return user
  }
  // A page load fires several requests at once; without this each one would
  // start its own refresh-token grant against Cognito.
  renewal ??= userManager.signinSilent()
    .catch(async (err: unknown) => {
      // Reported before the session is dropped, because dropping it destroys
      // the evidence. This catch cannot tell "refresh token genuinely expired"
      // from "Cognito had a bad minute" — both end the session identically, and
      // until this report existed the difference was invisible. It is the
      // failure the evidence layer was built for and the one it could not see.
      report({
        name: err instanceof Error ? err.name : 'SilentRenewError',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        routePath: 'auth:signinSilent'
      })
      // Refresh token expired too (30 days by default) or was revoked — the
      // session is genuinely over. removeUser() raises userUnloaded, which
      // AuthProvider listens for to drop back to the logged-out view.
      await userManager.removeUser()
      return null
    })
    .finally(() => {
      renewal = null
    })
  return renewal
}

// Cognito doesn't implement RP-Initiated Logout and doesn't expose
// end_session_endpoint via OIDC discovery, so oidc-client-ts's own
// signoutRedirect() doesn't work against it — redirect to Cognito's
// proprietary hosted-UI /logout endpoint by hand instead.
// https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html
export async function logout (): Promise<void> {
  await userManager.removeUser()
  const logoutRedirectUri = new URL(redirectUri).origin + '/'
  const params = new URLSearchParams({
    client_id: clientId,
    logout_uri: logoutRedirectUri
  })
  window.location.href = `${cognitoDomain}/logout?${params.toString()}`
}
