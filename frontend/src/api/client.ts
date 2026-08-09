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

declare module 'axios' {
  interface AxiosRequestConfig {
    // Opts a write back into the retry below. The default is no replay for
    // anything that isn't a safe method, so set this only where sending the
    // same request twice is genuinely harmless — an endpoint that upserts, or
    // one that returns the original resource instead of a conflict. Anything
    // that costs money per call (the translate routes) should never carry it.
    replaySafe?: boolean
  }
}

// Routes that call the model need their own deadline. The Lambda is capped at
// 29s by API Gateway's hard limit (infra/lib/constructs/api-construct.ts:75)
// and the generation itself budgets 20s inside that, so waiting just past the
// Lambda's ceiling means the server always gets to deliver its own verdict —
// a translation, or a clean "could not generate". Below it, the client quits
// first and reports a failure for a request that goes on to succeed.
export const AI_REQUEST_TIMEOUT_MS = 30_000

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  // Everything except the model-backed routes above answers in well under a
  // second; 8s is the point past which something is wrong, not slow.
  timeout: 8000
})

apiClient.interceptors.request.use(async (config) => {
  // getFreshUser, not getUser — an expired id_token comes back from API
  // Gateway's authorizer as a CORS-header-less 401, which the browser
  // surfaces as an unexplained CORS failure. See cognito.ts.
  const user = await getFreshUser()
  if (user) {
    config.headers.Authorization = `Bearer ${user.id_token}`
  } else {
    // The retry below reuses the failed attempt's config, header and all. If
    // the session died in between, leaving the old header in place would send
    // a token we already know is dead instead of going out unauthenticated.
    delete config.headers.Authorization
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

    // Our own timeout also arrives with no response, but it is not evidence of
    // a rejected token — the server may have the request and still be working
    // on it. The translate routes budget 20s against this client's 8s, so a
    // slow generation lands here routinely; replaying one would bill a second
    // model call for a request that was about to succeed.
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
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
      // Only replay what is safe to send twice. request() re-sends the original
      // verb and body, and a response-less failure cannot tell us whether the
      // server already committed the write — so a retried POST can duplicate it.
      // Writes are excluded by default and opt back in via replaySafe, rather
      // than being retried by default and opting out: forgetting the flag on a
      // new route should cost a spurious banner, not a duplicated side effect.
      const method = (config.method ?? 'get').toLowerCase()
      const safeMethod = method === 'get' || method === 'head' || method === 'options'
      const safeToReplay = safeMethod || config.replaySafe === true
      const carriedToken = config.headers?.Authorization !== undefined
      if (safeToReplay && carriedToken && config._connectionRetried !== true) {
        config._connectionRetried = true
        return apiClient.request(config)
      }
      if (carriedToken && (config._connectionRetried === true || !safeToReplay)) {
        // Either it failed the same way twice, or it was a write we could not
        // safely replay. Neither is proof of a rejected token, but both are
        // worth surfacing rather than failing silently — AuthProvider turns
        // this into a banner offering a fresh sign-in. A write that failed on a
        // one-off blip raises it wrongly, which the next success clears.
        signalConnectionIssue()
      }
    }

    return Promise.reject(error)
  }
)
