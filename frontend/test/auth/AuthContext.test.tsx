import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { AuthProvider } from '../../src/auth/AuthContext'
import { useAuth } from '../../src/auth/useAuth'
import { createFakeUser } from '../helpers/oidc'
import type { FakeUserManager } from '../helpers/oidc'
import { flush, resetForTests, type BufferedReport } from '../../src/observability/reporter'

// Mocking oidc-client-ts rather than cognito.ts leaves the real getFreshUser
// in the path, so these cases exercise the provider *and* the renewal it
// depends on — which is what makes case 1 able to tell the two apart.
const state = vi.hoisted(() => ({
  manager: null as unknown as FakeUserManager
}))

vi.mock('oidc-client-ts', async () => {
  const { createFakeUserManager } = await import('../helpers/oidc')
  state.manager = createFakeUserManager()
  return {
    UserManager: vi.fn(function () {
      return state.manager
    }),
    WebStorageStateStore: vi.fn(function () {})
  }
})

function Consumer () {
  const { user, loading } = useAuth()
  if (loading) {
    return <p>loading</p>
  }
  return <p>{user ? user.profile.email : 'signed out'}</p>
}

function renderProvider () {
  return render(
    <AuthProvider>
      <Consumer />
    </AuthProvider>
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  // Reports persist in localStorage, so without this a report raised by one
  // case is delivered during another and the counts stop meaning anything.
  resetForTests()
})

describe('AuthProvider', () => {
  // The distinguishing case: getUser() alone would hand back the stale user
  // and render the signed-in shell around a dead token — the exact failure
  // the shipped fix exists to prevent.
  it('bootstraps through getFreshUser, not the raw getUser', async () => {
    state.manager.getUser.mockResolvedValue(
      createFakeUser({ expired: true, email: 'stale@example.com' })
    )
    state.manager.signinSilent.mockResolvedValue(
      createFakeUser({ email: 'renewed@example.com' })
    )

    renderProvider()

    expect(screen.getByText('loading')).toBeInTheDocument()
    expect(await screen.findByText('renewed@example.com')).toBeInTheDocument()
    expect(screen.queryByText('stale@example.com')).not.toBeInTheDocument()
    expect(state.manager.signinSilent).toHaveBeenCalledTimes(1)
  })

  it('settles loading to false with a null user when nothing is stored', async () => {
    state.manager.getUser.mockResolvedValue(null)

    renderProvider()

    expect(await screen.findByText('signed out')).toBeInTheDocument()
  })

  // automaticSilentRenew fires this from a timer, outside React — without the
  // subscription the context would keep serving whichever user it read at mount.
  it('picks up a renewed user from the userLoaded event', async () => {
    state.manager.getUser.mockResolvedValue(null)

    renderProvider()
    await screen.findByText('signed out')

    act(() => {
      state.manager.emitUserLoaded(createFakeUser({ email: 'renewed@example.com' }))
    })

    expect(screen.getByText('renewed@example.com')).toBeInTheDocument()
  })

  // removeUser() from the api client's 401 handler raises this.
  it('drops back to the signed-out view on the userUnloaded event', async () => {
    state.manager.getUser.mockResolvedValue(createFakeUser({ email: 'signed-in@example.com' }))

    renderProvider()
    await screen.findByText('signed-in@example.com')

    act(() => {
      state.manager.emitUserUnloaded()
    })

    expect(screen.getByText('signed out')).toBeInTheDocument()
  })

  it('unsubscribes from both events on unmount', async () => {
    state.manager.getUser.mockResolvedValue(null)

    const { unmount } = renderProvider()
    await screen.findByText('signed out')
    unmount()

    expect(state.manager.events.removeUserLoaded).toHaveBeenCalledTimes(1)
    expect(state.manager.events.removeUserUnloaded).toHaveBeenCalledTimes(1)
    expect(state.manager.events.removeSilentRenewError).toHaveBeenCalledTimes(1)
  })

  // The other half of the blind spot: getFreshUser's own renewal, on the path
  // taken when a page is opened with an already-expired token. Its catch ends
  // the session, which destroys the evidence — so the report has to happen
  // before removeUser().
  it('reports a failed renewal before dropping the session', async () => {
    state.manager.getUser.mockResolvedValue(createFakeUser({ expired: true }))
    state.manager.signinSilent.mockRejectedValue(new Error('refresh token revoked'))

    renderProvider()
    await screen.findByText('signed out')

    const batches: BufferedReport[][] = []
    await flush(async (reports) => {
      batches.push(reports)
      return reports.map((entry) => entry.eventId)
    })

    expect(batches[0]).toHaveLength(1)
    expect(batches[0][0].message).toBe('refresh token revoked')
    expect(batches[0][0].routePath).toBe('auth:signinSilent')
    // The session still ends — this adds evidence, it does not change behavior.
    expect(state.manager.removeUser).toHaveBeenCalledTimes(1)
  })

  // automaticSilentRenew (cognito.ts) renews on a timer. When that path fails,
  // oidc-client-ts raises this event and does nothing else — so before this
  // subscriber existed, a long-open tab could quietly stop working with no
  // trace anywhere. This is the failure the evidence layer was built for.
  it('reports a silent-renew failure that the library would otherwise swallow', async () => {
    state.manager.getUser.mockResolvedValue(null)
    renderProvider()
    await screen.findByText('signed out')

    act(() => {
      state.manager.emitSilentRenewError(new Error('token endpoint unreachable'))
    })

    const batches: BufferedReport[][] = []
    await flush(async (reports) => {
      batches.push(reports)
      return reports.map((entry) => entry.eventId)
    })

    expect(batches[0]).toHaveLength(1)
    expect(batches[0][0].message).toBe('token endpoint unreachable')
    expect(batches[0][0].routePath).toBe('auth:silentRenewError')
  })

  it('does not treat a failed renewal as a logout on its own', async () => {
    state.manager.getUser.mockResolvedValue(createFakeUser({ email: 'still@example.com' }))
    renderProvider()
    await screen.findByText('still@example.com')

    act(() => {
      state.manager.emitSilentRenewError(new Error('transient blip'))
    })

    // A renewal failing is evidence, not a verdict. oidc-client-ts raises
    // userUnloaded separately when the session actually ends; signing the user
    // out here would turn a recoverable blip into a forced re-login.
    expect(screen.getByText('still@example.com')).toBeInTheDocument()
  })
})
