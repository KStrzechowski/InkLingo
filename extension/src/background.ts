import { API_BASE_URL } from './config.ts'
import { getIdToken, isAuthenticated, login, logout } from './auth.ts'
import type { Message, MessageResponse } from './messages.ts'
import type { Collection, SavedEntry, TranslationResult } from './types.ts'

// Every backend call runs here rather than in the popup. Requests issued
// by the background script go out under manifest.json's host_permissions
// and aren't subject to the page-level CORS preflight a popup fetch()
// would trigger — which is why the API Gateway's single-origin CORS
// allowlist (infra/lib/constructs/api-construct.ts) needs no
// moz-extension:// entry.

async function errorMessage (response: Response): Promise<string> {
  if (response.status === 429) {
    return 'Too many requests — wait a minute and try again.'
  }
  try {
    const body = await response.json() as { message?: string }
    if (typeof body.message === 'string') {
      return body.message
    }
  } catch {
    // Non-JSON body — e.g. an API Gateway 404 for an unregistered route.
  }
  return `Request failed (${response.status})`
}

async function apiFetch<T> (path: string, body?: unknown): Promise<T> {
  const idToken = await getIdToken()
  if (idToken === null) {
    throw new Error('Your session expired — log in again.')
  }

  // Bearer ID token, exactly what backend/src/routes/api/autohooks.ts
  // expects on every route under /api.
  const headers: Record<string, string> = { Authorization: `Bearer ${idToken}` }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  if (!response.ok) {
    throw new Error(await errorMessage(response))
  }
  return await response.json() as T
}

async function run (message: Message): Promise<unknown> {
  switch (message.type) {
    case 'auth-status':
      return { authenticated: await isAuthenticated() }
    case 'login':
      await login()
      return { authenticated: true }
    case 'logout':
      await logout()
      return null
    case 'list-collections':
      return (await apiFetch<{ collections: Collection[] }>('/api/collections')).collections
    case 'translate':
      return await apiFetch<TranslationResult>(
        `/api/collections/${message.collectionId}/translate`,
        { text: message.text }
      )
    case 'save-entry':
      return await apiFetch<SavedEntry>(
        `/api/collections/${message.collectionId}/entries`,
        message.entry
      )
  }
}

async function handle (message: Message): Promise<MessageResponse<unknown>> {
  try {
    return { ok: true, data: await run(message) }
  } catch (err) {
    console.error('background handler failed', message.type, err)
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}

browser.runtime.onMessage.addListener((message: Message) => handle(message))
