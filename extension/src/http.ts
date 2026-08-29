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

export async function doFetch (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return await (override ?? fetch)(input, init)
}
