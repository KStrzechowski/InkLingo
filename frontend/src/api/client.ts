import axios from 'axios'
import type { InternalAxiosRequestConfig } from 'axios'
import { getFreshUser, userManager } from '../auth/cognito'
import { clearConnectionIssue, signalConnectionIssue } from '../auth/connectionIssue'

// axios re-runs every response interceptor on a manually retried request,
// including the one that issued the retry — so the retry has to leave a mark
// on the config, or a persistently failing request retries forever instead of
// failing once and signaling.
interface RetryableConfig extends InternalAxiosRequestConfig {
  _connectionRetried?: boolean
}

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 8000
})

apiClient.interceptors.request.use(async (config) => {
  // getFreshUser, not getUser — an expired id_token comes back from API
  // Gateway's authorizer as a CORS-header-less 401, which the browser
  // surfaces as an unexplained CORS failure. See cognito.ts.
  const user = await getFreshUser()
  if (user) {
    config.headers.Authorization = `Bearer ${user.id_token}`
  }
  return config
})

apiClient.interceptors.response.use(
  (response) => {
    // Any success clears a standing signal, including the retry below that
    // turns out to succeed — so a genuine one-off blip never reaches the user.
    clearConnectionIssue()
    return response
  },
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) {
      return Promise.reject(error)
    }

    // A 401 that survives the renewal above means the session is unusable —
    // drop it rather than leaving the UI looking signed in over an API that
    // rejects every call. removeUser() raises userUnloaded, which AuthProvider
    // turns into the logged-out view. The error still propagates, so the
    // calling page's own error handling runs unchanged.
    if (error.response?.status === 401) {
      await userManager.removeUser()
      return Promise.reject(error)
    }

    // No response at all means the browser blocked it before any status could
    // be read. That is what an authorizer rejection looks like when the 401
    // comes back without Access-Control-Allow-Origin — and it is also exactly
    // what a dropped connection looks like. They cannot be told apart from a
    // single request, so retry once: a transient outage usually clears, an
    // authorizer rejection fails identically and is then worth surfacing.
    const config = error.config as RetryableConfig | undefined
    if (error.response === undefined && config !== undefined) {
      const carriedToken = config.headers?.Authorization !== undefined
      if (carriedToken && config._connectionRetried !== true) {
        config._connectionRetried = true
        return apiClient.request(config)
      }
      if (config._connectionRetried === true) {
        // Failed the same way twice. Not proof of a rejected token, but
        // enough to stop failing silently — AuthProvider turns this into a
        // banner offering a fresh sign-in.
        signalConnectionIssue()
      }
    }

    return Promise.reject(error)
  }
)
