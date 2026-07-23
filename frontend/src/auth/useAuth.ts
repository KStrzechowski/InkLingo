import { createContext, useContext } from 'react'
import type { User } from 'oidc-client-ts'

export interface AuthContextValue {
  user: User | null
  loading: boolean
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function useAuth (): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
