import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flush, report, resetForTests, type BufferedReport } from '../../src/observability/reporter'

function aFailure (overrides: Partial<Parameters<typeof report>[0]> = {}) {
  return {
    name: 'AxiosError',
    message: 'Network Error',
    routePath: '/api/collections',
    ...overrides
  }
}

// Accepts everything it is given, and records what it saw.
function acceptingSender () {
  const batches: BufferedReport[][] = []
  const send = vi.fn(async (reports: BufferedReport[]) => {
    batches.push(reports)
    return reports.map((entry) => entry.eventId)
  })
  return { send, batches }
}

beforeEach(() => {
  resetForTests()
  vi.restoreAllMocks()
})

describe('buffering', () => {
  it('holds a report until something flushes it', async () => {
    report(aFailure())
    const { send, batches } = acceptingSender()

    await flush(send)

    expect(batches[0]).toHaveLength(1)
    expect(batches[0][0].message).toBe('Network Error')
    expect(batches[0][0].app).toBe('frontend')
  })

  it('survives a reload — the buffer is not in memory', async () => {
    report(aFailure())

    // What a fresh page load sees. The dead-session case depends on this: the
    // report is raised in one session and delivered in the next.
    const stored = window.localStorage.getItem('inklingo.error-reports.v1')
    expect(stored).not.toBeNull()
    expect(stored).toContain('Network Error')
  })

  it('timestamps the failure, not the delivery', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T10:00:00.000Z'))
    report(aFailure())

    vi.setSystemTime(new Date('2026-08-12T10:45:00.000Z'))
    const { send, batches } = acceptingSender()
    await flush(send)
    vi.useRealTimers()

    // A report buffered through a dead session and flushed after re-auth would
    // otherwise be stamped minutes late, which is exactly the case it exists for.
    expect(batches[0][0].occurredAt).toBe('2026-08-12T10:00:00.000Z')
  })
})

describe('dedupe', () => {
  it('counts the interceptor retry as one failure, not two', async () => {
    // api/client.ts retries a safe request once, so one user-visible failure
    // reaches the reporter twice.
    report(aFailure())
    report(aFailure())

    const { send, batches } = acceptingSender()
    await flush(send)

    expect(batches[0]).toHaveLength(1)
  })

  it('keeps genuinely different failures apart', async () => {
    report(aFailure())
    report(aFailure({ routePath: '/api/collections/1/translate' }))

    const { send, batches } = acceptingSender()
    await flush(send)

    expect(batches[0]).toHaveLength(2)
  })

  it('does not collapse the same failure recurring much later', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T10:00:00.000Z'))
    report(aFailure())

    vi.setSystemTime(new Date('2026-08-12T10:05:00.000Z'))
    report(aFailure())
    vi.useRealTimers()

    const { send, batches } = acceptingSender()
    await flush(send)

    // A failure that comes back five minutes later is a second incident, not
    // an echo of the first.
    expect(batches[0]).toHaveLength(2)
  })
})

describe('draining', () => {
  it('keeps a report the server did not acknowledge', async () => {
    report(aFailure())
    report(aFailure({ routePath: '/api/me' }))

    const partial = vi.fn(async (reports: BufferedReport[]) => [reports[0].eventId])
    await flush(partial)

    const { send, batches } = acceptingSender()
    await flush(send)

    // Exactly the one that was never accepted — a partial acceptance must not
    // discard the rest.
    expect(batches[0]).toHaveLength(1)
    expect(batches[0][0].routePath).toBe('/api/me')
  })

  it('keeps everything when delivery fails outright', async () => {
    report(aFailure())

    await flush(async () => { throw new Error('ingest is down') })

    const { send, batches } = acceptingSender()
    await flush(send)

    expect(batches[0]).toHaveLength(1)
  })

  it('does not lose a report raised while a flush is in flight', async () => {
    report(aFailure())

    // The read-before-await-write shape from context/foundation/lessons.md:
    // the buffer is read, a request awaits, and the buffer is written back. A
    // report arriving in that window is lost if the write is a pre-await
    // snapshot.
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })

    const slowSender = vi.fn(async (reports: BufferedReport[]) => {
      await gate
      return reports.map((entry) => entry.eventId)
    })

    const flushing = flush(slowSender)
    report(aFailure({ routePath: '/api/collections/1/entries' }))
    release()
    await flushing

    const { send, batches } = acceptingSender()
    await flush(send)

    expect(batches[0]).toHaveLength(1)
    expect(batches[0][0].routePath).toBe('/api/collections/1/entries')
  })

  it('runs one flush at a time', async () => {
    report(aFailure())
    const { send } = acceptingSender()

    await Promise.all([flush(send), flush(send)])

    // Two concurrent drains would send the same report twice and race each
    // other's writes.
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('sends nothing when there is nothing buffered', async () => {
    const { send } = acceptingSender()
    await flush(send)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('overflow', () => {
  it('surfaces dropped reports instead of discarding them quietly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Past the cap. Each is distinct so dedupe does not absorb them.
    for (let i = 0; i < 60; i++) {
      report(aFailure({ routePath: `/api/collections/${String(i)}` }))
    }

    // A gate that can silently not run is worse than no gate
    // (context/foundation/lessons.md) — the drop has to be visible.
    expect(warn).toHaveBeenCalled()

    const { send, batches } = acceptingSender()
    await flush(send)

    // And it reaches the server, not only the local console.
    expect(batches[0][0].name).toBe('ReportBufferOverflow')
    expect(batches[0][0].message).toContain('dropped')
  })

  it('counts reports that age out undelivered instead of dropping them silently', async () => {
    // Regression: the age-out filter used to discard silently while the
    // overflow path warned. That inverted the priority — a session that never
    // recovers is precisely the case the buffer exists for, so its evidence
    // expiring unnoticed is the worst possible loss.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-14T10:00:00.000Z'))
    report(aFailure())

    // Past MAX_AGE_MS (24h) without ever reaching a working session.
    vi.setSystemTime(new Date('2026-08-15T11:00:00.000Z'))
    report(aFailure({ routePath: '/api/me' }))
    vi.useRealTimers()

    expect(warn).toHaveBeenCalled()

    const { send, batches } = acceptingSender()
    await flush(send)

    // And the loss reaches the server, not just the local console.
    expect(batches[0].some((entry) => entry.name === 'ReportBufferOverflow')).toBe(true)
  })

  it('clears the overflow signal once it has been delivered', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < 60; i++) {
      report(aFailure({ routePath: `/api/collections/${String(i)}` }))
    }

    const first = acceptingSender()
    await flush(first.send)

    report(aFailure({ routePath: '/api/me' }))
    const second = acceptingSender()
    await flush(second.send)

    expect(second.batches[0].some((entry) => entry.name === 'ReportBufferOverflow')).toBe(false)
  })
})
