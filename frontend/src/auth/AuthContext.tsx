import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { User } from 'oidc-client-ts'
import { getUser } from './cognito'
import { AuthContext } from './useAuth'

export function AuthProvider ({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setUser(await getUser())
  }, [])

  useEffect(() => {
    void refresh().then(() => setLoading(false))
  }, [refresh])

  return (
    <AuthContext.Provider value={{ user, loading, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}
