import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getFreshUser } from '../../src/auth/cognito'
import { createFakeUser } from '../helpers/oidc'
import type { FakeUserManager } from '../helpers/oidc'

// The whole oidc-client-ts module is replaced so nothing here touches real
// storage, timers or network — cognito.ts's own logic is what's under test.
// The factory builds the fake itself because it runs before the test body,
// at the moment cognito.ts is first imported and constructs its UserManager.
const state = vi.hoisted(() => ({
  manager: null as unknown as FakeUserManager,
  constructorSettings: [] as Array<Record<string, unknown>>
}))

vi.mock('oidc-client-ts', async () => {
  const { createFakeUserManager } = await import('../helpers/oidc')
  state.manager = createFakeUserManager()
  // `function`, not an arrow: cognito.ts calls both of these with `new`.
  return {
    UserManager: vi.fn(function (settings: Record<string, unknown>) {
      state.constructorSettings.push(settings)
      return state.manager
    }),
    WebStorageStateStore: vi.fn(function () {})
  }
})

beforeEach(() => {
  // Restores each vi.fn() to the implementation the fixture gave it and
  // clears call history, so no test inherits another's stubbing.
  vi.resetAllMocks()
})

describe('getFreshUser', () => {
  it('returns a cached user that has not expired, without renewing', async () => {
    const user = createFakeUser()
    state.manager.getUser.mockResolvedValue(user)

    await expect(getFreshUser()).resolves.toBe(user)
    expect(state.manager.signinSilent).not.toHaveBeenCalled()
  })

  it('renews when the cached token is expired and returns the renewed user', async () => {
    const renewed = createFakeUser({ idToken: 'renewed-id-token' })
    state.manager.getUser.mockResolvedValue(createFakeUser({ expired: true }))
    state.manager.signinSilent.mockResolvedValue(renewed)

    await expect(getFreshUser()).resolves.toBe(renewed)
    expect(state.manager.signinSilent).toHaveBeenCalledTimes(1)
  })

  // The regression this exists to catch: a page load fires several requests
  // at once, and without the `renewal ??=` dedupe each one starts its own
  // refresh-token grant against Cognito.
  it('dedupes concurrent renewals into a single signinSilent call', async () => {
    const renewed = createFakeUser({ idToken: 'renewed-id-token' })
    state.manager.getUser.mockResolvedValue(createFakeUser({ expired: true }))
    state.manager.signinSilent.mockResolvedValue(renewed)

    const results = await Promise.all([getFreshUser(), getFreshUser(), getFreshUser()])

    expect(state.manager.signinSilent).toHaveBeenCalledTimes(1)
    expect(results).toEqual([renewed, renewed, renewed])
  })

  // The dedupe latch has to clear once the grant settles, or a token that
  // expires later in the same session would resolve to the stale promise.
  it('starts a fresh renewal once the previous one has settled', async () => {
    state.manager.getUser.mockResolvedValue(createFakeUser({ expired: true }))
    state.manager.signinSilent.mockResolvedValue(createFakeUser({ idToken: 'renewed-id-token' }))

    await getFreshUser()
    await getFreshUser()

    expect(state.manager.signinSilent).toHaveBeenCalledTimes(2)
  })

  it('drops the session and resolves null when the renewal fails', async () => {
    state.manager.getUser.mockResolvedValue(createFakeUser({ expired: true }))
    state.manager.signinSilent.mockRejectedValue(new Error('refresh token expired'))

    await expect(getFreshUser()).resolves.toBeNull()
    expect(state.manager.removeUser).toHaveBeenCalledTimes(1)
  })

  it('passes null through when nothing is stored', async () => {
    state.manager.getUser.mockResolvedValue(null)

    await expect(getFreshUser()).resolves.toBeNull()
    expect(state.manager.signinSilent).not.toHaveBeenCalled()
  })
})

describe('userManager configuration', () => {
  // Config assertion only. The timer mechanics behind automaticSilentRenew
  // belong to oidc-client-ts, and with the module mocked, "testing" them
  // would only exercise the fake's own scripted behavior.
  it('is constructed with automaticSilentRenew enabled', () => {
    expect(state.constructorSettings).toHaveLength(1)
    expect(state.constructorSettings[0]).toMatchObject({
      automaticSilentRenew: true,
      response_type: 'code',
      scope: 'openid email profile'
    })
  })
})
