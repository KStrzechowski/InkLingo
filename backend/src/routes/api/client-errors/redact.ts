// Where this change's privacy promise lives. Pure — no Fastify dependency —
// so it is testable directly and cannot quietly grow a dependency on request
// state.
//
// The boundary, stated honestly: clients send *key names*, never values, so
// user vocabulary data never leaves the browser. A server cannot tell a key
// name from a value that was mislabelled as one, so this module does not
// pretend to. What it guarantees is narrower and still worth having:
//
//   1. `toBodyKeys` derives key names from a structure and provably never
//      emits a value from it — this is what each client uses to build its
//      report, and what the invariant test pins down.
//   2. `redactRequestContext` bounds whatever arrives: unknown methods and
//      statuses are dropped, key lists are capped in count and length, so a
//      buggy or hostile client cannot write unbounded text into CloudWatch.

const KNOWN_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

export const MAX_BODY_KEYS = 25
export const MAX_KEY_LENGTH = 64
// Deep enough for the nested shapes these apps actually post (a translations
// array of objects), shallow enough that a pathological structure cannot make
// key extraction expensive.
const MAX_DEPTH = 3

export interface RedactedRequestContext {
  method?: string
  status?: number
  bodyKeys: string[]
}

function isPlainObject (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Reduces any structure to the names of the keys it contains, dot-joined for
// nesting. Primitives contribute nothing — that is the point: a string, a
// number, or a date is a *value*, and values never appear in the output.
export function toBodyKeys (value: unknown, depth = 0): string[] {
  if (depth > MAX_DEPTH) return []

  if (Array.isArray(value)) {
    // Union across elements, not per-index — `translations.0.meaningText` and
    // `translations.1.meaningText` are the same shape and should log once.
    const keys = new Set<string>()
    for (const element of value) {
      for (const key of toBodyKeys(element, depth + 1)) {
        keys.add(key)
      }
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
      for (const nestedKey of nestedKeys) {
        keys.push(`${key}.${nestedKey}`)
      }
    }
  }
  return keys
}

function boundKeys (input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((key): key is string => typeof key === 'string')
    .slice(0, MAX_BODY_KEYS)
    .map((key) => key.slice(0, MAX_KEY_LENGTH))
}

// Accepts what a client sent and returns only what is safe and bounded to log.
// A client that sends a whole `body` instead of `bodyKeys` — a mistake a future
// version could make — has it reduced to keys here rather than logged.
export function redactRequestContext (input: unknown): RedactedRequestContext | undefined {
  if (!isPlainObject(input)) return undefined

  const method = typeof input.method === 'string' ? input.method.toUpperCase() : undefined
  const status = typeof input.status === 'number' && Number.isInteger(input.status) &&
    input.status >= 100 && input.status <= 599
    ? input.status
    : undefined

  const bodyKeys = input.bodyKeys !== undefined
    ? boundKeys(input.bodyKeys)
    : boundKeys(toBodyKeys(input.body))

  return {
    method: method !== undefined && KNOWN_METHODS.has(method) ? method : undefined,
    status,
    bodyKeys
  }
}
