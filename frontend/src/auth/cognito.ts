import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts'

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
  userStore: new WebStorageStateStore({ store: window.localStorage })
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
