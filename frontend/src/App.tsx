import { useEffect, useState } from 'react'
import type { User } from 'oidc-client-ts'
import { getUser, handleLoginCallback, login, logout, userManager } from './auth/cognito'
import './App.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [pingResult, setPingResult] = useState<string | null>(null)
  const [pingError, setPingError] = useState<string | null>(null)

  useEffect(() => {
    async function init() {
      if (window.location.pathname === '/callback') {
        const loggedInUser = await handleLoginCallback()
        window.history.replaceState({}, '', '/')
        setUser(loggedInUser)
      } else {
        setUser(await getUser())
      }
      setLoading(false)
    }
    void init()
  }, [])

  async function callApi() {
    setPingError(null)
    setPingResult(null)

    const currentUser = await userManager.getUser()
    if (!currentUser) {
      setPingError('Not signed in')
      return
    }

    const res = await fetch(`${API_BASE_URL}/api/ping`, {
      headers: { Authorization: `Bearer ${currentUser.id_token}` }
    })

    if (!res.ok) {
      setPingError(`${res.status} ${res.statusText}`)
      return
    }

    setPingResult(JSON.stringify(await res.json(), null, 2))
  }

  if (loading) {
    return <p>Loading…</p>
  }

  return (
    <section id="center">
      <h1>InkLingo</h1>
      {user ? (
        <>
          <p>Signed in as {user.profile.email}</p>
          <button type="button" onClick={() => void logout()}>Log out</button>
          <button type="button" onClick={() => void callApi()}>Call API</button>
          {pingResult && <pre>{pingResult}</pre>}
          {pingError && <p style={{ color: 'red' }}>{pingError}</p>}
        </>
      ) : (
        <button type="button" onClick={() => void login()}>Log in</button>
      )}
    </section>
  )
}

export default App
