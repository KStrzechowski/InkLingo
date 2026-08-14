// The load-bearing half of the privacy promise: user vocabulary data never
// leaves the browser, because only key *names* are ever put into a report.
// The server bounds what arrives (backend/src/routes/api/client-errors/
// redact.ts) but cannot tell a key name from a value mislabelled as one — so
// this is where the guarantee is actually made.
//
// Duplicated in extension/src/observability/bodyKeys.ts. There is no shared
// types package between the apps (see CLAUDE.md); response shapes are already
// duplicated the same way.

const MAX_DEPTH = 3
const MAX_KEYS = 25

function isPlainObject (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Primitives contribute nothing — a string, a number, a date is a *value*.
export function toBodyKeys (value: unknown, depth = 0): string[] {
  if (depth > MAX_DEPTH) return []

  if (Array.isArray(value)) {
    // Union across elements: two entries of the same shape log one set of
    // keys, not one per index.
    const keys = new Set<string>()
    for (const element of value) {
      for (const key of toBodyKeys(element, depth + 1)) keys.add(key)
    }
    return [...keys]
  }

  if (!isPlainObject(value)) return []

  const keys: string[] = []
  for (const [key, nested] of Object.entries(value)) {
    const nestedKeys = toBodyKeys(nested, depth + 1)
    if (nestedKeys.length === 0) {
      keys.push(key)
    } else {
      for (const nestedKey of nestedKeys) keys.push(`${key}.${nestedKey}`)
    }
  }
  return keys
}

// axios serializes a request body to a JSON string before it reaches the
// interceptor, so the raw config data has to be parsed back before keys can be
// read off it.
export function bodyKeysOf (data: unknown): string[] | undefined {
  if (data === undefined || data === null) return undefined

  let parsed: unknown = data
  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data)
    } catch {
      // Not JSON — a form body or plain text. No keys to read, and the content
      // itself must not be reported.
      return undefined
    }
  }

  const keys = toBodyKeys(parsed)
  return keys.length === 0 ? undefined : keys.slice(0, MAX_KEYS)
}
