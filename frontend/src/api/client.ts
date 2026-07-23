import axios from 'axios'
import { getUser } from '../auth/cognito'

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL
})

apiClient.interceptors.request.use(async (config) => {
  const user = await getUser()
  if (user) {
    config.headers.Authorization = `Bearer ${user.id_token}`
  }
  return config
})
