import { useEffect, useState } from 'react'
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router'
import axios from 'axios'
import { AuthProvider } from './auth/AuthContext'
import { useAuth } from './auth/useAuth'
import { handleLoginCallback, login, logout } from './auth/cognito'
import { apiClient } from './api/client'
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

function HomePage () {
  const [apiResult, setApiResult] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)

  async function callApi () {
    setApiError(null)
    setApiResult(null)

    try {
      const res = await apiClient.get('/api/me')
      setApiResult(JSON.stringify(res.data, null, 2))
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        setApiError(`${err.response.status} ${err.response.statusText}`)
      } else {
        setApiError('Request failed')
      }
    }
  }

  return (
    <>
      <button type="button" onClick={() => void callApi()}>Call API</button>
      {apiResult && <pre>{apiResult}</pre>}
      {apiError && <p style={{ color: 'red' }}>{apiError}</p>}
    </>
  )
}

function App () {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/callback" element={<CallbackPage />} />
        <Route element={<AuthenticatedLayout />}>
          <Route path="/" element={<HomePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}

export default App
