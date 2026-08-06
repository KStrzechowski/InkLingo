import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import App from '../src/App'
import { clearConnectionIssue, signalConnectionIssue } from '../src/auth/connectionIssue'
import { createFakeUser } from './helpers/oidc'
import type { FakeUserManager } from './helpers/oidc'

const state = vi.hoisted(() => ({
  manager: null as unknown as FakeUserManager,
  getFreshUser: vi.fn(),
  login: vi.fn(),
  logout: vi.fn()
}))

vi.mock('../src/auth/cognito', async () => {
  const { createFakeUserManager } = await import('./helpers/oidc')
  state.manager = createFakeUserManager()
  return {
    userManager: state.manager,
    getUser: vi.fn(),
    getFreshUser: state.getFreshUser,
    handleLoginCallback: vi.fn(),
    login: state.login,
    logout: state.logout
  }
})

// The landing route renders CollectionsListPage; stubbing its data layer
// keeps this file about the banner rather than about collections.
vi.mock('../src/api/collections', () => ({
  listCollections: vi.fn(async () => []),
  createCollection: vi.fn(),
  getCollection: vi.fn(),
  addEntryTranslation: vi.fn()
}))

function renderApp () {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  clearConnectionIssue()
  state.getFreshUser.mockResolvedValue(createFakeUser({ email: 'signed-in@example.com' }))
})

describe('AuthenticatedLayout connection banner', () => {
  it('shows no alert while requests are succeeding', async () => {
    renderApp()

    expect(await screen.findByText('Signed in as signed-in@example.com')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('surfaces an alert when the api client signals a connection issue', async () => {
    renderApp()
    await screen.findByText('Signed in as signed-in@example.com')

    act(() => {
      signalConnectionIssue()
    })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeInTheDocument()
  })

  it('starts a fresh sign-in from the alert', async () => {
    renderApp()
    await screen.findByText('Signed in as signed-in@example.com')
    act(() => {
      signalConnectionIssue()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }))

    expect(state.login).toHaveBeenCalledTimes(1)
  })

  // Self-clearing is the reason this is a banner rather than a forced
  // logout: a request succeeding again is proof the problem is over.
  it('removes the alert once the signal clears', async () => {
    renderApp()
    await screen.findByText('Signed in as signed-in@example.com')
    act(() => {
      signalConnectionIssue()
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()

    act(() => {
      clearConnectionIssue()
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the signed-out view free of the alert', async () => {
    state.getFreshUser.mockResolvedValue(null)

    renderApp()
    await screen.findByRole('button', { name: 'Log in' })

    act(() => {
      signalConnectionIssue()
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
