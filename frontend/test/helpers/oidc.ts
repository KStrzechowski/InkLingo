import { vi } from 'vitest'
import type { User } from 'oidc-client-ts'

// The shared fakes every auth test builds on — the frontend counterpart of
// backend/test/helpers/fixtures.ts. Both live here rather than in each test
// file so the shape of "what oidc-client-ts looks like to this codebase" is
// stated once.

export interface FakeUserOptions {
  expired?: boolean
  idToken?: string
  email?: string
}

// oidc-client-ts's User carries a large surface (session_state, scopes, the
// full profile claim set) that this codebase never reads — only .expired,
// .id_token and .profile.email. The cast keeps the fake to that subset while
// still typing as User at the call sites that consume it.
export function createFakeUser (options: FakeUserOptions = {}): User {
  const {
    expired = false,
    idToken = 'fake-id-token',
    email = 'test@example.com'
  } = options
  return {
    expired,
    id_token: idToken,
    profile: { email }
  } as unknown as User
}

export function createFakeUserManager () {
  const userLoadedListeners = new Set<(user: User) => void>()
  const userUnloadedListeners = new Set<() => void>()

  return {
    getUser: vi.fn(async (): Promise<User | null> => null),
    signinSilent: vi.fn(async (): Promise<User | null> => createFakeUser()),
    removeUser: vi.fn(async (): Promise<void> => {}),
    events: {
      addUserLoaded: vi.fn((listener: (user: User) => void) => {
        userLoadedListeners.add(listener)
      }),
      removeUserLoaded: vi.fn((listener: (user: User) => void) => {
        userLoadedListeners.delete(listener)
      }),
      addUserUnloaded: vi.fn((listener: () => void) => {
        userUnloadedListeners.add(listener)
      }),
      removeUserUnloaded: vi.fn((listener: () => void) => {
        userUnloadedListeners.delete(listener)
      })
    },
    // AuthProvider subscribes through the events API above and never calls
    // anything else; these two let a test fire what oidc-client-ts itself
    // would fire on a silent renewal or a removeUser().
    emitUserLoaded (user: User) {
      for (const listener of userLoadedListeners) listener(user)
    },
    emitUserUnloaded () {
      for (const listener of userUnloadedListeners) listener()
    }
  }
}

export type FakeUserManager = ReturnType<typeof createFakeUserManager>
