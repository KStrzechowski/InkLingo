import { createContext, useContext } from 'react'
import type { User } from 'oidc-client-ts'

export interface AuthContextValue {
  user: User | null
  loading: boolean
  refresh: () => Promise<void>
  // Set when a request failed twice with no readable response — either a
  // token the API Gateway authorizer rejected (whose 401 the browser hides
  // behind a CORS block) or a real network outage. See auth/connectionIssue.
  connectionIssue: boolean
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function useAuth (): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
