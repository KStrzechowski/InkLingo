import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_BASE_URL } from '../../src/config.ts'
import { fakeIdToken, loadBackground, unloadBackground, type BackgroundHarness } from '../helpers/backgroundHarness.ts'

// Characterizes apiFetch (background.ts) exactly as it behaves today, before
// extension-http-seam's Phase 3 routes its fetch() call through the new seam
// (src/http.ts). This file must pass unmodified after that migration — that
// is the plan's proof the refactor is non-breaking.

let harness: BackgroundHarness

function seedValidToken (): string {
  const idToken = fakeIdToken(3600)
  harness.store.auth = { idToken, refreshToken: null }
  return idToken
}

function stubFetch (impl: typeof fetch): void {
  vi.stubGlobal('fetch', vi.fn(impl))
}

function buffered (): Array<Record<string, unknown>> {
  return (harness.store['inklingo.error-reports.v1'] as Array<Record<string, unknown>> | undefined) ?? []
}

beforeEach(async () => {
  harness = await loadBackground()
})

afterEach(() => {
  unloadBackground()
  vi.unstubAllGlobals()
})

describe('success', () => {
  it('sends a GET with the bearer token and returns the unwrapped payload', async () => {
    const idToken = seedValidToken()
    const collections = [{ id: '1', name: 'Polish', nativeLanguageCode: 'en', targetLanguageCodes: ['pl'], createdAt: '2026-01-01' }]
    stubFetch(async () => new Response(JSON.stringify({ collections }), { status: 200 }))

    const response = await harness.invoke({ type: 'list-collections' })

    expect(response).toEqual({ ok: true, data: collections })
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe(`${API_BASE_URL}/api/collections`)
    expect(init).toMatchObject({ method: 'GET', headers: { Authorization: `Bearer ${idToken}` } })
    expect((init as RequestInit).body).toBeUndefined()
  })

  it('sends a POST with a JSON body and Content-Type when the message carries one', async () => {
    const idToken = seedValidToken()
    const saved = { id: 'e1', wordOrPhrase: 'dom', sourceLanguageCode: 'pl', createdAt: '2026-01-01' }
    stubFetch(async () => new Response(JSON.stringify(saved), { status: 201 }))

    const entry = { wordOrPhrase: 'dom', senses: [] }
    const response = await harness.invoke({ type: 'save-entry', collectionId: 'c1', entry })

    expect(response).toEqual({ ok: true, data: saved })
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe(`${API_BASE_URL}/api/collections/c1/entries`)
    expect(init).toMatchObject({
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    })
  })
})

describe('error shaping', () => {
  it('reports rate limiting with a fixed message regardless of body content', async () => {
    seedValidToken()
    stubFetch(async () => new Response(JSON.stringify({ message: 'ignored' }), { status: 429 }))

    const response = await harness.invoke({ type: 'list-collections' })

    expect(response).toEqual({ ok: false, error: 'Too many requests — wait a minute and try again.' })
  })

  it('uses the JSON error body message when present', async () => {
    seedValidToken()
    stubFetch(async () => new Response(JSON.stringify({ message: 'Collection not found' }), { status: 404 }))

    const response = await harness.invoke({ type: 'list-collections' })

    expect(response).toEqual({ ok: false, error: 'Collection not found' })
  })

  it('falls back to a generic message for a non-JSON error body', async () => {
    seedValidToken()
    stubFetch(async () => new Response('<html>not found</html>', { status: 404 }))

    const response = await harness.invoke({ type: 'list-collections' })

    expect(response).toEqual({ ok: false, error: 'Request failed (404)' })
  })
})

describe('reporting', () => {
  it('reports a network-level failure exactly once, not twice', async () => {
    seedValidToken()
    stubFetch(async () => { throw new Error('NetworkDown') })

    const response = await harness.invoke({ type: 'list-collections' })

    expect(response).toEqual({ ok: false, error: 'NetworkDown' })
    // Regression: apiFetch's catch and handle()'s catch-all both see this
    // failure — the alreadyReported/wasReported dedupe must stop it being
    // buffered twice.
    expect(buffered()).toHaveLength(1)
    expect(buffered()[0]).toMatchObject({
      name: 'Error',
      message: 'NetworkDown',
      routePath: '/api/collections',
      request: { method: 'GET', bodyKeys: undefined }
    })
  })

  it('captures the backend correlation id when the response carries one', async () => {
    seedValidToken()
    stubFetch(async () => new Response(JSON.stringify({ message: 'boom' }), {
      status: 500,
      headers: { 'x-request-id': 'req-abc' }
    }))

    await harness.invoke({ type: 'list-collections' })

    expect(buffered()[0].requestId).toBe('req-abc')
  })

  it('leaves the correlation id undefined when the response has none', async () => {
    seedValidToken()
    stubFetch(async () => new Response(JSON.stringify({ message: 'boom' }), { status: 500 }))

    await harness.invoke({ type: 'list-collections' })

    expect(buffered()[0].requestId).toBeUndefined()
  })

  it('reports a session-expired failure through the generic message route, without ever calling fetch', async () => {
    // No auth token seeded — getIdToken() returns null before apiFetch's try
    // block, so this never even reaches the network.
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await harness.invoke({ type: 'list-collections' })

    expect(response).toEqual({ ok: false, error: 'Your session expired — log in again.' })
    expect(fetchMock).not.toHaveBeenCalled()

    expect(buffered()).toHaveLength(1)
    expect(buffered()[0]).toMatchObject({
      name: 'Error',
      message: 'Your session expired — log in again.',
      // handle()'s catch-all routePath, not a real API path — apiFetch never
      // got far enough to report this one itself.
      routePath: 'message:list-collections'
    })
    expect(buffered()[0].request).toBeUndefined()
  })
})
