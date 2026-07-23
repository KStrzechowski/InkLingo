import { useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router'
import { AuthProvider } from './auth/AuthContext'
import { useAuth } from './auth/useAuth'
import { handleLoginCallback, login, logout } from './auth/cognito'
import CollectionsListPage from './pages/CollectionsListPage'
import CollectionDetailPage from './pages/CollectionDetailPage'
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

function AuthenticatedLayout () {
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

  return (
    <section id="center">
      <h1>InkLingo</h1>
      <p>Signed in as {user.profile.email}</p>
      <button type="button" onClick={() => void logout()}>Log out</button>
      <Outlet />
    </section>
  )
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}

export default App
