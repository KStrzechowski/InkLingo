import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError } from 'axios'
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { AI_REQUEST_TIMEOUT_MS, apiClient } from '../../src/api/client'
import { addEntryTranslation, listCollections } from '../../src/api/collections'
import { clearConnectionIssue, onConnectionIssueChange } from '../../src/auth/connectionIssue'
import { createFakeUser } from '../helpers/oidc'

// client.ts imports getFreshUser/userManager from cognito.ts directly, so
// that module — not oidc-client-ts underneath it — is the seam here.
// connectionIssue.ts is deliberately left real: its pub/sub contract is what
// the retry-then-signal cases below are asserting through.
const state = vi.hoisted(() => ({
  getFreshUser: vi.fn(),
  removeUser: vi.fn()
}))

vi.mock('../../src/auth/cognito', () => ({
  getFreshUser: state.getFreshUser,
  userManager: { removeUser: state.removeUser }
}))

// A custom adapter replaces the network entirely; axios still runs both
// interceptors around it, which is the part under test. 'network' models a
// response-less failure — a CORS-blocked authorizer rejection and a dropped
// connection both arrive exactly this way. 'timeout' is response-less too, but
// carries ECONNABORTED: our own deadline firing while the server is still
// working, which must never be replayed.
type Step = number | 'network' | 'timeout'

let attempts = 0
let sentConfigs: InternalAxiosRequestConfig[] = []

function respondWith (...steps: Step[]) {
  attempts = 0
  apiClient.defaults.adapter = async (config) => {
    const step = steps[Math.min(attempts, steps.length - 1)]
    attempts += 1
    sentConfigs.push(config as InternalAxiosRequestConfig)

    if (step === 'network') {
      throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config, {})
    }

    if (step === 'timeout') {
      throw new AxiosError(
        `timeout of ${String(config.timeout)}ms exceeded`,
        AxiosError.ECONNABORTED,
        config,
        {}
      )
    }

    const response = {
      data: {},
      status: step,
      statusText: String(step),
      headers: {},
      config
    } as AxiosResponse
    if (step >= 400) {
      // A rejection carrying a response is what a *real*, CORS-headered
      // status looks like to the client.
      throw new AxiosError(
        `Request failed with status code ${step}`,
        String(step),
        config,
        {},
        response
      )
    }
    return response
  }
}

let connectionIssue = false
let unsubscribe: () => void

beforeEach(() => {
  vi.resetAllMocks()
  attempts = 0
  sentConfigs = []
  state.getFreshUser.mockResolvedValue(null)
  state.removeUser.mockResolvedValue(undefined)
  clearConnectionIssue()
  connectionIssue = false
  unsubscribe = onConnectionIssueChange((active) => {
    connectionIssue = active
  })
})

afterEach(() => {
  unsubscribe()
})

describe('request interceptor', () => {
  it('attaches the fresh id_token as a bearer token', async () => {
    state.getFreshUser.mockResolvedValue(createFakeUser({ idToken: 'fresh-id-token' }))
    respondWith(200)

    await apiClient.get('/api/collections')

    expect(state.getFreshUser).toHaveBeenCalledTimes(1)
    expect(sentConfigs[0].headers.Authorization).toBe('Bearer fresh-id-token')
  })

  it('sends no Authorization header when there is no user', async () => {
    state.getFreshUser.mockResolvedValue(null)
    respondWith(200)

    await apiClient.get('/api/collections')

    expect(sentConfigs[0].headers.Authorization).toBeUndefined()
  })
})

describe('response interceptor — session handling', () => {
  // A 401 that survives the renewal in getFreshUser means the session is
  // genuinely unusable — dropping it is what flips the UI out of the
  // signed-in shell instead of leaving it over an API rejecting every call.
  it('drops the session on a 401', async () => {
    state.getFreshUser.mockResolvedValue(createFakeUser())
    respondWith(401)

    await expect(apiClient.get('/api/collections')).rejects.toThrow()

    expect(state.removeUser).toHaveBeenCalledTimes(1)
  })

  it('leaves the session alone on a non-401 error status', async () => {
    state.getFreshUser.mockResolvedValue(createFakeUser())
    respondWith(500)

    await expect(apiClient.get('/api/collections')).rejects.toThrow()

    expect(state.removeUser).not.toHaveBeenCalled()
  })

  it('passes a successful response straight through', async () => {
    state.getFreshUser.mockResolvedValue(createFakeUser())
    respondWith(200)

    const response = await apiClient.get('/api/collections')

    expect(response.status).toBe(200)
    expect(state.removeUser).not.toHaveBeenCalled()
  })
})

describe('response interceptor — retry then signal', () => {
  it('retries once and signals when the same request fails response-less twice', async () => {
    state.getFreshUser.mockResolvedValue(createFakeUser())
    respondWith('network')

    await expect(apiClient.get('/api/collections')).rejects.toThrow()

    // Exactly two: the marker on the retried config is what stops the
    // response interceptor from re-retrying its own retry forever.
    expect(attempts).toBe(2)
    expect(connectionIssue).toBe(true)
  })

  it('stays quiet when the retry succeeds', async () => {
    state.getFreshUser.mockResolvedValue(createFakeUser())
    respondWith('network', 200)

    const response = await apiClient.get('/api/collections')

    expect(response.status).toBe(200)
    expect(attempts).toBe(2)
    expect(connectionIssue).toBe(false)
  })

  it('clears a standing signal on the next successful request', async () => {
    state.getFreshUser.mockResolvedValue(createFakeUser())
    respondWith('network')
    await expect(apiClient.get('/api/collections')).rejects.toThrow()
    expect(connectionIssue).toBe(true)

    respondWith(200)
    await apiClient.get('/api/collections')

    expect(connectionIssue).toBe(false)
  })

  it('does not retry or signal when the failure carries a real status code', async () => {
    state.getFreshUser.mockResolvedValue(createFakeUser())
    respondWith(500)

    await expect(apiClient.get('/api/collections')).rejects.toThrow()

    expect(attempts).toBe(1)
    expect(connectionIssue).toBe(false)
  })

  // Nothing to re-authenticate into if the request never carried a token —
  // that failure is a plain connectivity problem and belongs to the caller.
  it('does not retry a request that carried no token', async () => {
    state.getFreshUser.mockResolvedValue(null)
    respondWith('network')

    await expect(apiClient.get('/api/collections')).rejects.toThrow()

    expect(attempts).toBe(1)
    expect(connectionIssue).toBe(false)
  })
})

describe('response interceptor — write safety', () => {
  // The failure this guards against: a POST that reached the server and
  // committed, whose response was lost on the way back. Replaying it runs the
  // side effect twice — on the translate routes, a second billed model call.
  it('does not replay a POST, but still signals', async () => {
    state.getFreshUser.mockResolvedValue(createFakeUser())
    respondWith('network')

    await expect(apiClient.post('/api/collections', { name: 'x' })).rejects.toThrow()

    expect(attempts).toBe(1)
    // Legibility does not depend on the retry: an unreplayable write that
    // fails opaquely still earns the banner, it just earns it one attempt
    // sooner than a GET does.
    expect(connectionIssue).toBe(true)
  })

  it('replays a write that explicitly opts in via replaySafe', async () => {
    state.getFreshUser.mockResolvedValue(createFakeUser())
    respondWith('network')

    await expect(
      apiClient.post('/api/collections', { name: 'x' }, { replaySafe: true })
    ).rejects.toThrow()

    expect(attempts).toBe(2)
    expect(connectionIssue).toBe(true)
  })

  it('leaves an opted-in write alone once its replay succeeds', async () => {
    state.getFreshUser.mockResolvedValue(createFakeUser())
    respondWith('network', 200)

    const response = await apiClient.post(
      '/api/collections',
      { name: 'x' },
      { replaySafe: true }
    )

    expect(response.status).toBe(200)
    expect(attempts).toBe(2)
    expect(connectionIssue).toBe(false)
  })

  // A deadline firing means the request is very likely still being worked on,
  // so a replay would double the work rather than recover anything, and the
  // session is not in doubt either way.
  it('never replays or signals on a client-side timeout', async () => {
    state.getFreshUser.mockResolvedValue(createFakeUser())
    respondWith('timeout')

    await expect(apiClient.get('/api/collections')).rejects.toThrow()

    expect(attempts).toBe(1)
    expect(connectionIssue).toBe(false)
  })
})

// The client must never be the first to give up on a model-backed route: the
// route abandons its own generation at 20s and answers badGateway, so a
// shorter client deadline abandons work the server completes and reports it to
// the user as a failure.
describe('request deadlines', () => {
  it('outlasts the translate route’s own generation budget', async () => {
    state.getFreshUser.mockResolvedValue(createFakeUser())
    respondWith(200)

    await addEntryTranslation('c1', 'e1', 'de').catch(() => undefined)

    expect(sentConfigs[0].timeout).toBe(AI_REQUEST_TIMEOUT_MS)
    // 20s budget + room for a cold start, the writes and the round trip. The
    // assertion is the floor, not the value — tightening below this re-creates
    // the bug where a successful generation surfaces as a client failure.
    expect(AI_REQUEST_TIMEOUT_MS).toBeGreaterThan(22_000)
  })

  it('leaves ordinary routes on the short default', async () => {
    state.getFreshUser.mockResolvedValue(createFakeUser())
    respondWith(200)

    await listCollections().catch(() => undefined)

    expect(sentConfigs[0].timeout).toBe(8000)
  })
})
