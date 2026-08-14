// Owns the buffer, the dedupe, the flush, and the overflow signal. Nothing
// else knows how reports are stored or sent.
//
// Why a buffer at all: the failure this layer most needs to see — a session
// whose token is dead — cannot be reported at the moment it happens, because
// the ingest route is authenticated like everything else under /api. So a
// report that cannot be delivered now is persisted and drained once a working
// session returns.

export interface ReportInput {
  name: string
  message: string
  stack?: string
  routePath?: string
  // The backend's x-request-id, when the failure came from a response that
  // carried one. Absent for a blocked request — which is the case this whole
  // module exists for.
  requestId?: string
  request?: {
    method?: string
    status?: number
    // Key names only. Values never leave the browser; see
    // backend/src/routes/api/client-errors/redact.ts for the other half.
    bodyKeys?: string[]
  }
}

export interface BufferedReport extends ReportInput {
  eventId: string
  app: 'frontend'
  appVersion: string
  occurredAt: string
}

export type ReportSender = (reports: BufferedReport[]) => Promise<string[]>

const STORAGE_KEY = 'inklingo.error-reports.v1'
const OVERFLOW_KEY = 'inklingo.error-reports.dropped.v1'
const MAX_BUFFERED = 50
const MAX_AGE_MS = 24 * 60 * 60 * 1000
// The response interceptor retries a safe request once (see api/client.ts), so
// one user-visible failure arrives here twice. Two identical failures inside
// this window are the same event.
const DEDUPE_WINDOW_MS = 10_000
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? 'dev'

// localStorage throws when it is disabled or full. Losing reports silently is
// the exact failure mode this layer exists to prevent, so a storage failure
// falls back to memory rather than dropping — the reports survive the session
// even if they don't survive a reload.
let memoryFallback: BufferedReport[] | null = null
let inFlight: Promise<void> | null = null

function readBuffer (): BufferedReport[] {
  if (memoryFallback !== null) return memoryFallback
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as BufferedReport[] : []
  } catch {
    // Unreadable or corrupt: start clean in memory rather than throwing from
    // an error path and taking the page down with it.
    memoryFallback = []
    return memoryFallback
  }
}

function writeBuffer (reports: BufferedReport[]): void {
  if (memoryFallback !== null) {
    memoryFallback = reports
    return
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(reports))
  } catch {
    memoryFallback = reports
  }
}

function readDropped (): number {
  try {
    return Number(window.localStorage.getItem(OVERFLOW_KEY) ?? '0') || 0
  } catch {
    return 0
  }
}

function writeDropped (count: number): void {
  try {
    if (count === 0) {
      window.localStorage.removeItem(OVERFLOW_KEY)
    } else {
      window.localStorage.setItem(OVERFLOW_KEY, String(count))
    }
  } catch {
    // Nothing further to do — the console.warn below is the remaining signal.
  }
}

function dedupeKey (report: ReportInput): string {
  return [report.name, report.message, report.routePath ?? '', report.request?.status ?? ''].join('|')
}

function newEventId (): string {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function report (input: ReportInput): void {
  const now = Date.now()
  const stored = readBuffer()
  const buffered = stored.filter((entry) => now - Date.parse(entry.occurredAt) < MAX_AGE_MS)

  // Aged-out reports are counted, not quietly discarded. This path matters more
  // than the overflow one below: a session that never recovers is exactly the
  // case the buffer exists for, and letting its evidence expire in silence is
  // the failure mode lessons.md warns about — a gate that stops running without
  // saying so.
  const expired = stored.length - buffered.length
  if (expired > 0) {
    const total = readDropped() + expired
    writeDropped(total)
    console.warn(`[observability] ${expired} error report(s) aged out undelivered; ${total} dropped in total`)
  }

  const key = dedupeKey(input)
  const duplicate = buffered.some(
    (entry) => dedupeKey(entry) === key && now - Date.parse(entry.occurredAt) < DEDUPE_WINDOW_MS
  )
  if (duplicate) return

  buffered.push({
    ...input,
    eventId: newEventId(),
    app: 'frontend',
    appVersion: APP_VERSION,
    occurredAt: new Date(now).toISOString()
  })

  if (buffered.length > MAX_BUFFERED) {
    const dropped = buffered.length - MAX_BUFFERED
    buffered.splice(0, dropped)
    const total = readDropped() + dropped
    writeDropped(total)
    // A gate that can silently not run is worse than no gate
    // (context/foundation/lessons.md). If reports are being discarded, that
    // fact has to be visible somewhere.
    console.warn(`[observability] error report buffer overflowed; ${total} report(s) dropped`)
  }

  writeBuffer(buffered)
}

// Emitted ahead of a flush so the dropped count reaches the server rather than
// only the local console.
function overflowReport (dropped: number): BufferedReport {
  return {
    eventId: newEventId(),
    app: 'frontend',
    appVersion: APP_VERSION,
    occurredAt: new Date().toISOString(),
    name: 'ReportBufferOverflow',
    message: `${dropped} client error report(s) were dropped before delivery`
  }
}

export async function flush (send: ReportSender): Promise<void> {
  // One flush at a time. Two concurrent drains would send the same reports
  // twice and race each other's writes.
  if (inFlight !== null) return inFlight

  const pending = readBuffer()
  const dropped = readDropped()
  if (pending.length === 0 && dropped === 0) return

  const batch = dropped > 0 ? [overflowReport(dropped), ...pending] : pending

  inFlight = (async () => {
    try {
      const accepted = new Set(await send(batch))
      if (accepted.size === 0) return

      // Re-read rather than writing back `pending`: a report raised while the
      // request was in flight is in storage now and must survive the drain.
      // Writing a pre-await snapshot would silently lose it — the failure
      // shape context/foundation/lessons.md calls out.
      writeBuffer(readBuffer().filter((entry) => !accepted.has(entry.eventId)))
      if (dropped > 0) writeDropped(0)
    } catch {
      // Delivery failed; the buffer stays as it is and the next successful
      // request tries again. Deliberately not reported — a failing reporter
      // reporting its own failure recurses.
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

// Test seam. Production code never calls this.
export function resetForTests (): void {
  memoryFallback = null
  inFlight = null
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    window.localStorage.removeItem(OVERFLOW_KEY)
  } catch {
    // Nothing stored, nothing to clear.
  }
}
