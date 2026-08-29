// A seam for the extension's one outbound-fetch call site — wired into
// background.ts's apiFetch (extension-http-seam Phase 3).
//
// Mirrors observability/reporter.ts's resetForTests() test-seam convention:
// a swappable-but-live-lookup reference. `override ?? fetch` resolves the
// real `fetch` at call time, on every call, rather than capturing
// globalThis.fetch once when this module is first imported — a test that
// stubs globalThis.fetch (as background.ts's apiFetch characterization suite
// already does, written before this seam existed) keeps working unchanged
// whether or not doFetch sits in front of it.

let override: typeof fetch | null = null

export function setFetchForTests (impl: typeof fetch): void {
  override = impl
}

// Test seam. Production code never calls this.
export function resetForTests (): void {
  override = null
}

// Sized like frontend/src/api/client.ts:27-41's default axios timeout: every
// route except the model-backed one below answers in well under a second, so
// 8s is the point past which something is wrong, not slow.
export const DEFAULT_TIMEOUT_MS = 8_000

// Mirrors frontend/src/api/client.ts:27-41's AI_REQUEST_TIMEOUT_MS and the
// same reasoning: bounded by the route's own TRANSLATE_TIMEOUT_MS (20s,
// backend/src/routes/api/collections/index.ts) plus headroom for a cold
// start and the round trip, so the server — not a client that quit early —
// is always the one to decide the outcome of a generation that goes on to
// succeed.
export const AI_REQUEST_TIMEOUT_MS = 25_000

// `timeoutMs` is opt-in: omitting it (as doFetch's own existing tests do)
// passes `init` through byte-for-byte, exactly as before this deadline
// existed. A caller that wants a bounded wait passes one explicitly —
// background.ts's apiFetch always does, defaulting to DEFAULT_TIMEOUT_MS and
// overriding to AI_REQUEST_TIMEOUT_MS for the translate route.
export async function doFetch (input: RequestInfo | URL, init?: RequestInit, timeoutMs?: number): Promise<Response> {
  if (timeoutMs === undefined) {
    return await (override ?? fetch)(input, init)
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    return await (override ?? fetch)(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}
