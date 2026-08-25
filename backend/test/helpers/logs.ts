import { Writable } from 'node:stream'

// Captures the app's own pino output so a test can assert that a structured
// line was emitted, not merely that the response looked right. Needed for the
// partial-degradation line, which is now the only record that some languages
// came back empty — the popup used to count that client-side and no longer
// does.

export interface LogCapture {
  stream: Writable
  lines: () => Array<Record<string, unknown>>
  find: (msg: string) => Record<string, unknown> | undefined
}

export function captureLogs (): LogCapture {
  const lines: Array<Record<string, unknown>> = []
  const stream = new Writable({
    write (chunk: Buffer, _encoding, callback) {
      for (const line of String(chunk).split('\n')) {
        if (line.trim().length === 0) continue
        try {
          lines.push(JSON.parse(line) as Record<string, unknown>)
        } catch {
          // A non-JSON line (pino-pretty, a raw write) is not what we assert on.
        }
      }
      callback()
    }
  })

  return {
    stream,
    lines: () => lines,
    find: (msg: string) => lines.find((line) => line.msg === msg)
  }
}
