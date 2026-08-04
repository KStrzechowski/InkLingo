import axios from 'axios'
import { getFreshUser, userManager } from '../auth/cognito'

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 8000
})

apiClient.interceptors.request.use(async (config) => {
  // getFreshUser, not getUser — an expired id_token comes back from API
  // Gateway's authorizer as a CORS-header-less 401, which the browser
  // surfaces as an unexplained CORS failure. See cognito.ts.
  const user = await getFreshUser()
  if (user) {
    config.headers.Authorization = `Bearer ${user.id_token}`
  }
  return config
})

// A 401 that survives the renewal above means the session is unusable —
// drop it rather than leaving the UI looking signed in over an API that
// rejects every call. removeUser() raises userUnloaded, which AuthProvider
// turns into the logged-out view. The error still propagates, so the
// calling page's own error handling runs unchanged.
apiClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      await userManager.removeUser()
    }
    return Promise.reject(error)
  }
)
