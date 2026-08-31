import { afterEach, describe, expect, it, vi } from 'vitest'
import { doFetch, resetForTests, setFetchForTests } from '../src/http.ts'

afterEach(() => {
  resetForTests()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('doFetch', () => {
  it('delegates to globalThis.fetch by default', async () => {
    const response = new Response('ok')
    const fetchMock = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetchMock)

    const result = await doFetch('https://example.test/a')

    expect(fetchMock).toHaveBeenCalledWith('https://example.test/a', undefined)
    expect(result).toBe(response)
  })

  it('resolves fetch live, not at import time — a fetch reassigned after this module loaded still takes effect', async () => {
    const first = vi.fn(async () => new Response('first'))
    vi.stubGlobal('fetch', first)
    await doFetch('https://example.test/a')
    expect(first).toHaveBeenCalledTimes(1)

    const second = vi.fn(async () => new Response('second'))
    vi.stubGlobal('fetch', second)
    await doFetch('https://example.test/b')

    expect(second).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(1)
  })

  it('lets setFetchForTests intercept calls ahead of the global', async () => {
    const globalFetch = vi.fn(async () => new Response('global'))
    vi.stubGlobal('fetch', globalFetch)
    const override = vi.fn(async () => new Response('override'))
    setFetchForTests(override)

    const result = await doFetch('https://example.test/a')

    expect(override).toHaveBeenCalledTimes(1)
    expect(globalFetch).not.toHaveBeenCalled()
    expect(await result.text()).toBe('override')
  })

  it('reverts to delegating to global fetch after resetForTests', async () => {
    setFetchForTests(vi.fn(async () => new Response('override')))
    resetForTests()

    const globalFetch = vi.fn(async () => new Response('global'))
    vi.stubGlobal('fetch', globalFetch)

    await doFetch('https://example.test/a')

    expect(globalFetch).toHaveBeenCalledTimes(1)
  })

  it('passes init through unchanged', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const init = { method: 'POST', body: '{}' }

    await doFetch('https://example.test/a', init)

    expect(fetchMock).toHaveBeenCalledWith('https://example.test/a', init)
  })

  // C-03's incremental path step 3 (context/changes/refactor-opportunities/
  // research.md): nothing in extension/src constructed an AbortController
  // before this. timeoutMs is opt-in — the four tests above pin the
  // no-timeout call shape byte-for-byte; these pin the deadline itself.
  describe('timeoutMs', () => {
    it('omits any signal when timeoutMs is not given, matching the tests above', async () => {
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('ok'))
      vi.stubGlobal('fetch', fetchMock)

      await doFetch('https://example.test/a', { method: 'GET' })

      const [, init] = fetchMock.mock.calls[0]
      expect(init?.signal).toBeUndefined()
    })

    it('attaches an AbortSignal when timeoutMs is given', async () => {
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('ok'))
      vi.stubGlobal('fetch', fetchMock)

      await doFetch('https://example.test/a', { method: 'GET' }, 8_000)

      const [, init] = fetchMock.mock.calls[0]
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      expect(init?.signal?.aborted).toBe(false)
    })

    it('aborts the signal once timeoutMs elapses, before the request settles', async () => {
      vi.useFakeTimers()
      let capturedSignal: AbortSignal | undefined
      vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined
        return await new Promise<Response>(() => {}) // never resolves on its own
      }))

      void doFetch('https://example.test/a', {}, 5_000)
      await vi.advanceTimersByTimeAsync(0)

      expect(capturedSignal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(capturedSignal?.aborted).toBe(true)
    })

    it('does not abort before timeoutMs elapses', async () => {
      vi.useFakeTimers()
      let capturedSignal: AbortSignal | undefined
      vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined
        return await new Promise<Response>(() => {})
      }))

      void doFetch('https://example.test/a', {}, 5_000)
      await vi.advanceTimersByTimeAsync(4_999)

      expect(capturedSignal?.aborted).toBe(false)
    })

    it('clears the timeout once the request settles, so it cannot abort a later call on the same signal object', async () => {
      vi.useFakeTimers()
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('ok'))
      vi.stubGlobal('fetch', fetchMock)

      const response = await doFetch('https://example.test/a', {}, 5_000)
      const [, init] = fetchMock.mock.calls[0]

      expect(response.status).toBe(200)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(init?.signal?.aborted).toBe(false)
    })
  })
})
