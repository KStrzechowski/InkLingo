import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError } from 'axios'
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { apiClient } from '../../src/api/client'
import { createFakeUser } from '../helpers/oidc'

// client.ts imports getFreshUser/userManager from cognito.ts directly, so
// that module — not oidc-client-ts underneath it — is the seam here.
const state = vi.hoisted(() => ({
  getFreshUser: vi.fn(),
  removeUser: vi.fn()
}))

vi.mock('../../src/auth/cognito', () => ({
  getFreshUser: state.getFreshUser,
  userManager: { removeUser: state.removeUser }
}))

// A custom adapter replaces the network entirely: axios still runs both
// interceptors around it, which is the part under test.
let sentConfigs: InternalAxiosRequestConfig[] = []

function respondWith (status: number) {
  apiClient.defaults.adapter = async (config) => {
    sentConfigs.push(config as InternalAxiosRequestConfig)
    const response = {
      data: {},
      status,
      statusText: String(status),
      headers: {},
      config
    } as AxiosResponse
    if (status >= 400) {
      // A rejection carrying a response is what a *real*, CORS-headered
      // status looks like to the client — as opposed to a CORS-blocked
      // one, where error.response is undefined.
      throw new AxiosError(`Request failed with status code ${status}`, String(status), config, {}, response)
    }
    return response
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  sentConfigs = []
  state.getFreshUser.mockResolvedValue(null)
  state.removeUser.mockResolvedValue(undefined)
})

describe('request interceptor', () => {
  it('attaches the fresh id_token as a bearer token', async () => {
    state.getFreshUser.mockResolvedValue(createFakeUser({ idToken: 'fresh-id-token' }))
    respondWith(200)

    await apiClient.get('/collections')

    expect(state.getFreshUser).toHaveBeenCalledTimes(1)
    expect(sentConfigs[0].headers.Authorization).toBe('Bearer fresh-id-token')
  })

  it('sends no Authorization header when there is no user', async () => {
    state.getFreshUser.mockResolvedValue(null)
    respondWith(200)

    await apiClient.get('/collections')

    expect(sentConfigs[0].headers.Authorization).toBeUndefined()
  })
})

describe('response interceptor', () => {
  // A 401 that survives the renewal in getFreshUser means the session is
  // genuinely unusable — dropping it is what flips the UI out of the
  // signed-in shell instead of leaving it over an API rejecting every call.
  it('drops the session on a 401', async () => {
    state.getFreshUser.mockResolvedValue(createFakeUser())
    respondWith(401)

    await expect(apiClient.get('/collections')).rejects.toThrow()

    expect(state.removeUser).toHaveBeenCalledTimes(1)
  })

  it('leaves the session alone on a non-401 error status', async () => {
    state.getFreshUser.mockResolvedValue(createFakeUser())
    respondWith(500)

    await expect(apiClient.get('/collections')).rejects.toThrow()

    expect(state.removeUser).not.toHaveBeenCalled()
  })

  it('passes a successful response straight through', async () => {
    state.getFreshUser.mockResolvedValue(createFakeUser())
    respondWith(200)

    const response = await apiClient.get('/collections')

    expect(response.status).toBe(200)
    expect(state.removeUser).not.toHaveBeenCalled()
  })
})
