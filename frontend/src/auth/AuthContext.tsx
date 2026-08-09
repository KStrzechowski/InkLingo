import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { User } from 'oidc-client-ts'
import { getFreshUser, userManager } from './cognito'
import { onConnectionIssueChange } from './connectionIssue'
import { AuthContext } from './useAuth'

export function AuthProvider ({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [connectionIssue, setConnectionIssue] = useState(false)

  // getFreshUser, not getUser: reopening the app after an hour away would
  // otherwise render the signed-in shell around a dead token, and every API
  // call underneath it would fail as an unexplained CORS error.
  const refresh = useCallback(async () => {
    setUser(await getFreshUser())
  }, [])

  useEffect(() => {
    void refresh().then(() => setLoading(false))
  }, [refresh])

  // Renewals and session drops happen outside React — automaticSilentRenew
  // on a timer, and removeUser() from the api client's 401 handler. Without
  // these the context keeps serving whichever user it read at mount.
  useEffect(() => {
    const onLoaded = (renewed: User) => setUser(renewed)
    const onUnloaded = () => setUser(null)
    userManager.events.addUserLoaded(onLoaded)
    userManager.events.addUserUnloaded(onUnloaded)
    return () => {
      userManager.events.removeUserLoaded(onLoaded)
      userManager.events.removeUserUnloaded(onUnloaded)
    }
  }, [])

  // The api client's interceptor signals from outside React too — same
  // subscribe/unsubscribe shape as the userManager events above.
  useEffect(() => onConnectionIssueChange(setConnectionIssue), [])

  // A fresh object here re-renders every consumer whenever any one field
  // changes, whether or not that consumer reads it — PrintLayout takes the
  // context but never looks at connectionIssue, so without this the print view
  // re-renders each time the banner toggles.
  const value = useMemo(
    () => ({ user, loading, refresh, connectionIssue }),
    [user, loading, refresh, connectionIssue]
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
