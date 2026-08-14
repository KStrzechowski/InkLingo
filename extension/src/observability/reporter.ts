// The extension's half of the evidence layer. Same contract as
// frontend/src/observability/reporter.ts — buffer, dedupe, flush, surface an
// overflow — with two differences that rule out sharing one module:
//
//   1. Storage is browser.storage.local, not localStorage. Firefox destroys
//      the popup document the instant it loses focus, so anything the popup
//      owned would evaporate mid-flush. storage.local belongs to the
//      extension, not the document.
//   2. It is therefore asynchronous, which makes every read-modify-write a
//      race between concurrent reports — serialized below.

export interface ReportInput {
  name: string
  message: string
  stack?: string
  routePath?: string
  requestId?: string
  request?: {
    method?: string
    status?: number
    // Key names only; see bodyKeys.ts.
    bodyKeys?: string[]
  }
}

export interface BufferedReport extends ReportInput {
  eventId: string
  app: 'extension'
  appVersion: string
  occurredAt: string
}

export type ReportSender = (reports: BufferedReport[]) => Promise<string[]>

const STORAGE_KEY = 'inklingo.error-reports.v1'
const OVERFLOW_KEY = 'inklingo.error-reports.dropped.v1'
const MAX_BUFFERED = 50
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const DEDUPE_WINDOW_MS = 10_000
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? 'dev'

// Every storage read-modify-write runs through this chain. Two failures
// arriving together would otherwise both read the same buffer and the second
// write would erase the first report.
let queue: Promise<unknown> = Promise.resolve()
let inFlight: Promise<void> | null = null

function serialize<T> (work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work)
  queue = next.catch(() => undefined)
  return next
}

// browser.storage.local can reject (quota, a torn-down context). Nothing in
// this module may let that escape: background.ts awaits report() from inside
// its own catch blocks, so a rejection here would *replace* the user's real
// error with a storage error — the evidence layer corrupting the thing it
// exists to observe. Same memory fallback the frontend reporter uses.
let memoryFallback: BufferedReport[] | null = null
let droppedFallback = 0

async function readBuffer (): Promise<BufferedReport[]> {
  if (memoryFallback !== null) return memoryFallback
  try {
    const stored = await browser.storage.local.get(STORAGE_KEY)
    const raw = stored[STORAGE_KEY]
    return Array.isArray(raw) ? raw as BufferedReport[] : []
  } catch {
    memoryFallback = []
    return memoryFallback
  }
}

async function writeBuffer (reports: BufferedReport[]): Promise<void> {
  if (memoryFallback !== null) {
    memoryFallback = reports
    return
  }
  try {
    await browser.storage.local.set({ [STORAGE_KEY]: reports })
  } catch {
    memoryFallback = reports
  }
}

async function readDropped (): Promise<number> {
  if (memoryFallback !== null) return droppedFallback
  try {
    const stored = await browser.storage.local.get(OVERFLOW_KEY)
    const raw = stored[OVERFLOW_KEY]
    return typeof raw === 'number' ? raw : 0
  } catch {
    return droppedFallback
  }
}

async function writeDropped (count: number): Promise<void> {
  droppedFallback = count
  if (memoryFallback !== null) return
  try {
    await browser.storage.local.set({ [OVERFLOW_KEY]: count })
  } catch {
    // droppedFallback above is the remaining record.
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

// Never rejects. Callers await this from inside their own catch blocks, so a
// throw here would displace the error they were handling.
export async function report (input: ReportInput): Promise<void> {
  try {
    await reportInner(input)
  } catch {
    // Reporting is best-effort by construction; the caller's original failure
    // is what matters and must survive intact.
  }
}

async function reportInner (input: ReportInput): Promise<void> {
  await serialize(async () => {
    const now = Date.now()
    const buffered = (await readBuffer())
      .filter((entry) => now - Date.parse(entry.occurredAt) < MAX_AGE_MS)

    const key = dedupeKey(input)
    const duplicate = buffered.some(
      (entry) => dedupeKey(entry) === key && now - Date.parse(entry.occurredAt) < DEDUPE_WINDOW_MS
    )
    if (duplicate) return

    buffered.push({
      ...input,
      eventId: newEventId(),
      app: 'extension',
      appVersion: APP_VERSION,
      occurredAt: new Date(now).toISOString()
    })

    if (buffered.length > MAX_BUFFERED) {
      const dropped = buffered.length - MAX_BUFFERED
      buffered.splice(0, dropped)
      const total = (await readDropped()) + dropped
      await writeDropped(total)
      // Silently discarding evidence is the failure mode this layer exists to
      // prevent (context/foundation/lessons.md).
      console.warn(`[observability] error report buffer overflowed; ${total} report(s) dropped`)
    }

    await writeBuffer(buffered)
  })
}

function overflowReport (dropped: number): BufferedReport {
  return {
    eventId: newEventId(),
    app: 'extension',
    appVersion: APP_VERSION,
    occurredAt: new Date().toISOString(),
    name: 'ReportBufferOverflow',
    message: `${dropped} client error report(s) were dropped before delivery`
  }
}

export async function flush (send: ReportSender): Promise<void> {
  if (inFlight !== null) return inFlight

  // Assigned synchronously, before the first await. Reading storage first
  // would let a second caller past the guard above while this one was still
  // waiting on it, and both would send the same batch.
  inFlight = (async () => {
    try {
      const pending = await readBuffer()
      const dropped = await readDropped()
      if (pending.length === 0 && dropped === 0) return

      const batch = dropped > 0 ? [overflowReport(dropped), ...pending] : pending

      const accepted = new Set(await send(batch))
      if (accepted.size === 0) return

      // Re-read instead of writing back `pending`: a report raised while the
      // request was in flight is in storage now and has to survive the drain.
      await serialize(async () => {
        await writeBuffer((await readBuffer()).filter((entry) => !accepted.has(entry.eventId)))
        if (dropped > 0) await writeDropped(0)
      })
    } catch {
      // Delivery failed; the buffer stays put and the next successful request
      // retries. Not reported — a failing reporter reporting itself recurses.
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

// Test seam. Production code never calls this.
export function resetForTests (): void {
  queue = Promise.resolve()
  inFlight = null
  memoryFallback = null
  droppedFallback = 0
}
