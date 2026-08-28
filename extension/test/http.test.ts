import { afterEach, describe, expect, it, vi } from 'vitest'
import { doFetch, resetForTests, setFetchForTests } from '../src/http.ts'

afterEach(() => {
  resetForTests()
  vi.unstubAllGlobals()
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
})
