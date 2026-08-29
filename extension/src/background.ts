import { API_BASE_URL } from './config.ts'
import { AI_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, doFetch } from './http.ts'
import { getIdToken, isAuthenticated, login, logout } from './auth.ts'
import type { Message, MessageResponse, MessageResults } from './messages.ts'
import type { Collection, SavedEntry, TranslationResult } from './types.ts'
import { bodyKeysOf } from './observability/bodyKeys.ts'
import { flush, report, type BufferedReport } from './observability/reporter.ts'

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

// The ingest route. Reporting runs here in the background script, never from
// the popup, for the same reason every other backend call does (see the note
// at the top of this file) — and because the popup document dies on focus loss.
const REPORT_PATH = '/api/client-errors'

async function sendReports (reports: BufferedReport[]): Promise<string[]> {
  const { accepted } = await apiFetch<{ accepted: string[] }>(REPORT_PATH, { reports })
  return accepted
}

// A backend failure passes two catch blocks on its way out — apiFetch's, which
// knows the route and status, and handle()'s, which knows only the message
// type. Without this the same failure is reported twice under two different
// routePaths, which the reporter's dedupe cannot collapse because the reports
// genuinely differ. The first one to see it wins; it has the better context.
const alreadyReported = new WeakSet<object>()

function markReported (err: unknown): void {
  if (typeof err === 'object' && err !== null) alreadyReported.add(err)
}

function wasReported (err: unknown): boolean {
  return typeof err === 'object' && err !== null && alreadyReported.has(err)
}

async function apiFetch<T> (path: string, body?: unknown, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<T> {
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

  const method = body === undefined ? 'GET' : 'POST'
  // Reporting never reports its own delivery, and a successful delivery never
  // triggers another flush — either would recurse.
  const observed = path !== REPORT_PATH

  let response: Response
  try {
    response = await doFetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    }, timeoutMs)
  } catch (err) {
    // No response at all. Nothing to correlate against, which is itself the
    // signal — this is the shape a blocked or dropped request takes.
    if (observed) {
      await report({
        name: err instanceof Error ? err.name : 'FetchError',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        routePath: path,
        request: { method, bodyKeys: bodyKeysOf(body) }
      })
      markReported(err)
    }
    throw err
  }

  if (!response.ok) {
    if (observed) {
      await report({
        name: 'HttpError',
        message: await errorMessage(response.clone()),
        routePath: path,
        // The backend stamps this on every response
        // (backend/src/plugins/error-handler.ts) — it is what joins this
        // report to the server's own line for the same failure.
        requestId: response.headers.get('x-request-id') ?? undefined,
        request: { method, status: response.status, bodyKeys: bodyKeysOf(body) }
      })
    }
    const httpError = new Error(await errorMessage(response))
    if (observed) markReported(httpError)
    throw httpError
  }

  // A working authenticated call is the moment buffered reports can be
  // delivered — including any raised while the session was dead. Not awaited:
  // reporting stays off the caller's path.
  if (observed) {
    void flush(sendReports)
  }
  return await response.json() as T
}

// A new Message variant added to messages.ts without a matching case below
// stops compiling here rather than silently returning undefined at runtime —
// the failure mode run()'s old `Promise<unknown>` return type allowed.
function assertNever (value: never): never {
  throw new Error(`Unhandled message type: ${JSON.stringify(value)}`)
}

async function run (message: Message): Promise<MessageResults[Message['type']]> {
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
        { text: message.text },
        AI_REQUEST_TIMEOUT_MS
      )
    case 'save-entry':
      return await apiFetch<SavedEntry>(
        `/api/collections/${message.collectionId}/entries`,
        message.entry
      )
    case 'report-error':
      // A failure the popup saw itself — a render crash, a storage read, a
      // degraded AI result. It never touched the network, so nothing else in
      // this file would ever have seen it.
      await report({ ...message.report })
      return null
    default:
      return assertNever(message)
  }
}

async function handle (message: Message): Promise<MessageResponse<unknown>> {
  try {
    return { ok: true, data: await run(message) }
  } catch (err) {
    // The console line stays useful during local development; the report is
    // what survives into somewhere queryable.
    console.error('background handler failed', message.type, err)
    // apiFetch already reported anything that came from a backend call, with
    // better context than this block has. This catches the rest — auth flows,
    // storage failures, anything thrown by run() that never touched the network.
    if (!wasReported(err)) {
      await report({
        name: err instanceof Error ? err.name : 'Error',
        message: err instanceof Error ? err.message : 'Something went wrong',
        stack: err instanceof Error ? err.stack : undefined,
        routePath: `message:${message.type}`
      })
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}

browser.runtime.onMessage.addListener((message: Message) => handle(message))
