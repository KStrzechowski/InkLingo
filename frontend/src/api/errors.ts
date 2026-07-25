import axios from 'axios'

export function extractErrorMessage (err: unknown): string {
  if (axios.isAxiosError(err) && err.response) {
    const data = err.response.data as { message?: string } | undefined
    return data?.message ?? `${err.response.status} ${err.response.statusText}`
  }
  return 'Request failed'
}
