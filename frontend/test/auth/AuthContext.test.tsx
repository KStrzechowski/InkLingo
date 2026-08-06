import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { AuthProvider } from '../../src/auth/AuthContext'
import { useAuth } from '../../src/auth/useAuth'
import { createFakeUser } from '../helpers/oidc'
import type { FakeUserManager } from '../helpers/oidc'

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
  })
})
