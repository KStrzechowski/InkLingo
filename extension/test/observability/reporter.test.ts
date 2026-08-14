import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flush, report, resetForTests, type BufferedReport } from '../../src/observability/reporter'
import { installFakeBrowser, uninstallFakeBrowser, type FakeBrowser } from '../helpers/webext'

const STORAGE_KEY = 'inklingo.error-reports.v1'

let fake: FakeBrowser

function aFailure (overrides: Partial<Parameters<typeof report>[0]> = {}) {
  return {
    name: 'HttpError',
    message: 'Request failed (502)',
    routePath: '/api/collections/1/translate',
    ...overrides
  }
}

function acceptingSender () {
  const batches: BufferedReport[][] = []
  const send = vi.fn(async (reports: BufferedReport[]) => {
    batches.push(reports)
    return reports.map((entry) => entry.eventId)
  })
  return { send, batches }
}

beforeEach(() => {
  fake = installFakeBrowser()
  resetForTests()
  vi.restoreAllMocks()
})

afterEach(() => {
  uninstallFakeBrowser()
})

describe('buffering', () => {
  it('persists to storage.local, not to the popup document', async () => {
    await report(aFailure())

    // Firefox destroys the popup document on focus loss, so a buffer the popup
    // owned would evaporate mid-flush. storage.local belongs to the extension.
    const stored = fake.store[STORAGE_KEY] as BufferedReport[]
    expect(stored).toHaveLength(1)
    expect(stored[0].app).toBe('extension')
  })

  it('delivers what it buffered', async () => {
    await report(aFailure())
    const { send, batches } = acceptingSender()

    await flush(send)

    expect(batches[0]).toHaveLength(1)
    expect(batches[0][0].message).toBe('Request failed (502)')
  })

  it('carries the backend correlation id when the failure had one', async () => {
    await report(aFailure({ requestId: 'server-side-id' }))
    const { send, batches } = acceptingSender()

    await flush(send)

    expect(batches[0][0].requestId).toBe('server-side-id')
  })
})

describe('concurrency', () => {
  it('does not lose a report when two arrive together', async () => {
    // storage.local is async, so two concurrent reports would otherwise read
    // the same buffer and the second write would erase the first.
    await Promise.all([
      report(aFailure({ routePath: '/api/collections' })),
      report(aFailure({ routePath: '/api/me' }))
    ])

    const { send, batches } = acceptingSender()
    await flush(send)

    expect(batches[0]).toHaveLength(2)
  })

  it('does not lose a report raised while a flush is in flight', async () => {
    await report(aFailure())

    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const slowSender = vi.fn(async (reports: BufferedReport[]) => {
      await gate
      return reports.map((entry) => entry.eventId)
    })

    const flushing = flush(slowSender)
    await report(aFailure({ routePath: '/api/collections' }))
    release()
    await flushing

    const { send, batches } = acceptingSender()
    await flush(send)

    // The read-before-await-write shape from context/foundation/lessons.md.
    expect(batches[0]).toHaveLength(1)
    expect(batches[0][0].routePath).toBe('/api/collections')
  })

  it('runs one flush at a time', async () => {
    await report(aFailure())
    const { send } = acceptingSender()

    await Promise.all([flush(send), flush(send)])

    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('draining', () => {
  it('keeps a report the server did not acknowledge', async () => {
    await report(aFailure({ routePath: '/api/collections' }))
    await report(aFailure({ routePath: '/api/me' }))

    const partial = vi.fn(async (reports: BufferedReport[]) => [reports[0].eventId])
    await flush(partial)

    const { send, batches } = acceptingSender()
    await flush(send)

    expect(batches[0]).toHaveLength(1)
    expect(batches[0][0].routePath).toBe('/api/me')
  })

  it('keeps everything when delivery fails outright', async () => {
    await report(aFailure())

    await flush(async () => { throw new Error('session is dead') })

    // The dead-session case: nothing could be delivered, nothing was lost.
    const { send, batches } = acceptingSender()
    await flush(send)
    expect(batches[0]).toHaveLength(1)
  })
})

describe('storage failure', () => {
  // Regression: report() used to let a browser.storage.local rejection escape.
  // background.ts awaits it from inside its own catch blocks, so the storage
  // error replaced the user's real error on its way out — the evidence layer
  // corrupting the thing it exists to observe.
  function breakStorage (): void {
    const api = (globalThis as unknown as { browser: { storage: { local: Record<string, unknown> } } }).browser
    api.storage.local.get = async () => { throw new Error('storage unavailable') }
    api.storage.local.set = async () => { throw new Error('QuotaExceededError') }
  }

  it('never rejects, so the caller’s original error survives', async () => {
    breakStorage()

    await expect(report(aFailure())).resolves.toBeUndefined()
  })

  it('keeps reporting in memory once storage is unusable', async () => {
    breakStorage()
    await report(aFailure())

    const { send, batches } = acceptingSender()
    await flush(send)

    // Degraded, not dead: the report does not survive a restart, but it is not
    // silently thrown away either.
    expect(batches[0]).toHaveLength(1)
  })
})

describe('dedupe and overflow', () => {
  it('counts one failure once', async () => {
    await report(aFailure())
    await report(aFailure())

    const { send, batches } = acceptingSender()
    await flush(send)

    expect(batches[0]).toHaveLength(1)
  })

  it('surfaces dropped reports instead of discarding them quietly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    for (let i = 0; i < 60; i++) {
      await report(aFailure({ routePath: `/api/collections/${String(i)}` }))
    }

    expect(warn).toHaveBeenCalled()

    const { send, batches } = acceptingSender()
    await flush(send)

    expect(batches[0][0].name).toBe('ReportBufferOverflow')
  })
})
