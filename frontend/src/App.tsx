import { useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router'
import { AuthProvider } from './auth/AuthContext'
import { useAuth } from './auth/useAuth'
import { handleLoginCallback, login, logout } from './auth/cognito'
import CollectionsListPage from './pages/CollectionsListPage'
import CollectionDetailPage from './pages/CollectionDetailPage'
import PrintCollectionPage from './pages/PrintCollectionPage'
import './App.css'

function CallbackPage () {
  const navigate = useNavigate()
  const { refresh } = useAuth()

  useEffect(() => {
    async function completeLogin () {
      await handleLoginCallback()
      await refresh()
      navigate('/', { replace: true })
    }
    void completeLogin()
  }, [navigate, refresh])

  return <p>Loading…</p>
}

// Risk #4's "clean re-authentication prompt". Without it, a token the API
// Gateway authorizer rejects for a non-expiry reason leaves the signed-in
// shell up while every request underneath fails as an opaque CORS error.
// Not a forced logout: the same evidence is also consistent with the user's
// own wifi dropping, and it clears itself the moment a request succeeds.
function ConnectionIssueBanner () {
  return (
    <div role="alert">
      <p>
        We can&apos;t reach the server. This is usually a connection problem, but
        your session may also have ended.
      </p>
      <button type="button" onClick={() => void login()}>Sign in again</button>
    </div>
  )
}

function AuthenticatedLayout () {
  const { user, loading, connectionIssue } = useAuth()

  if (loading) {
    return <p>Loading…</p>
  }

  if (!user) {
    return (
      <section id="center">
        <h1>InkLingo</h1>
        <button type="button" onClick={() => void login()}>Log in</button>
      </section>
    )
  }

  return (
    <section id="center">
      <h1>InkLingo</h1>
      {connectionIssue && <ConnectionIssueBanner />}
      <p>Signed in as {user.profile.email}</p>
      <button type="button" onClick={() => void logout()}>Log out</button>
      <Outlet />
    </section>
  )
}

// The print page needs the same auth gate as the rest of the app but none of
// its chrome — the on-screen preview has to match what actually prints, so no
// heading, no "Signed in as", no log-out control wraps the document.
function PrintLayout () {
  const { user, loading } = useAuth()

  if (loading) {
    return <p>Loading…</p>
  }

  if (!user) {
    return (
      <section id="center">
        <h1>InkLingo</h1>
        <button type="button" onClick={() => void login()}>Log in</button>
      </section>
    )
  }

  return <Outlet />
}

function App () {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/callback" element={<CallbackPage />} />
        <Route element={<AuthenticatedLayout />}>
          <Route path="/" element={<CollectionsListPage />} />
          <Route path="/collections/:id" element={<CollectionDetailPage />} />
        </Route>
        <Route element={<PrintLayout />}>
          <Route path="/collections/:id/print" element={<PrintCollectionPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}

export default App
