import { test } from 'node:test'
import * as assert from 'node:assert'
import {
  toBodyKeys,
  redactRequestContext,
  MAX_BODY_KEYS,
  MAX_KEY_LENGTH
} from '../../../../src/routes/api/client-errors/redact.js'

// The invariant this module exists for. Collects every primitive *value* in a
// structure so the test can assert none of them survives key extraction.
function collectValues (value: unknown, sink: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const element of value) collectValues(element, sink)
  } else if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value)) collectValues(nested, sink)
  } else if (value !== null && value !== undefined) {
    sink.push(String(value))
  }
  return sink
}

test('key extraction never emits a value, at any nesting depth', () => {
  // Values are sentinel-tagged on purpose. A realistic short value like the
  // language code 'de' is a substring of the legitimate key name
  // 'languageCode', so a substring assertion over real data reports a leak
  // that isn't one. Tagging keeps the assertion the strong form — no value
  // appears anywhere in the output — without the false positive.
  const body = {
    wordOrPhrase: 'VALUE-niedzwiedz',
    translations: [
      { languageCode: 'VALUE-en', meaningText: 'VALUE-bear', phoneticTranscription: 'VALUE-ber' },
      { languageCode: 'VALUE-de', meaningText: 'VALUE-baer', phoneticTranscription: null }
    ],
    meta: { source: 'VALUE-extension', attempt: 987654 }
  }

  const keys = toBodyKeys(body)
  const serialized = JSON.stringify(keys)

  for (const value of collectValues(body)) {
    assert.ok(
      !serialized.includes(value),
      `value ${JSON.stringify(value)} leaked into the extracted keys`
    )
  }
})

test('nested object keys are dot-joined, and array elements union rather than index', () => {
  const keys = toBodyKeys({
    translations: [
      { languageCode: 'en', meaningText: 'bear' },
      { languageCode: 'de', meaningText: 'Bär' }
    ]
  })

  // The same shape twice logs once — not translations.0.* and translations.1.*.
  assert.deepStrictEqual(
    [...keys].sort(),
    ['translations.languageCode', 'translations.meaningText']
  )
})

test('primitives and empty structures contribute no keys', () => {
  assert.deepStrictEqual(toBodyKeys('a string'), [])
  assert.deepStrictEqual(toBodyKeys(42), [])
  assert.deepStrictEqual(toBodyKeys(null), [])
  assert.deepStrictEqual(toBodyKeys(undefined), [])
  assert.deepStrictEqual(toBodyKeys([]), [])
  assert.deepStrictEqual(toBodyKeys({}), [])
})

test('deep nesting terminates instead of recursing without bound', () => {
  let deep: unknown = { leaf: 'value' }
  for (let i = 0; i < 50; i++) {
    deep = { level: deep }
  }

  const keys = toBodyKeys(deep)

  assert.ok(keys.length > 0)
  assert.ok(!JSON.stringify(keys).includes('value'), 'the leaf value must not survive')
})

test('a client that sends a whole body has it reduced to keys, not logged', () => {
  const redacted = redactRequestContext({
    method: 'POST',
    status: 500,
    body: { wordOrPhrase: 'niedźwiedź', translations: [{ meaningText: 'bear' }] }
  })

  assert.deepStrictEqual(
    [...(redacted?.bodyKeys ?? [])].sort(),
    ['translations.meaningText', 'wordOrPhrase']
  )
})

test('key count and key length are bounded', () => {
  const manyKeys = Array.from({ length: MAX_BODY_KEYS + 40 }, (_, i) => `key${i}`)
  const longKey = 'k'.repeat(MAX_KEY_LENGTH + 200)

  const redacted = redactRequestContext({ bodyKeys: [longKey, ...manyKeys] })

  assert.equal(redacted?.bodyKeys.length, MAX_BODY_KEYS)
  assert.equal(redacted?.bodyKeys[0].length, MAX_KEY_LENGTH)
})

test('unknown methods and out-of-range statuses are dropped, not echoed', () => {
  const redacted = redactRequestContext({ method: 'TRACEROUTE', status: 9000, bodyKeys: [] })

  assert.equal(redacted?.method, undefined)
  assert.equal(redacted?.status, undefined)
})

test('a known method is normalized and kept', () => {
  const redacted = redactRequestContext({ method: 'post', status: 401, bodyKeys: ['text'] })

  assert.equal(redacted?.method, 'POST')
  assert.equal(redacted?.status, 401)
  assert.deepStrictEqual(redacted?.bodyKeys, ['text'])
})

test('non-object and non-string input is discarded rather than trusted', () => {
  assert.equal(redactRequestContext('not an object'), undefined)
  assert.equal(redactRequestContext(null), undefined)
  assert.equal(redactRequestContext(undefined), undefined)

  const redacted = redactRequestContext({ bodyKeys: ['ok', 42, null, { nested: true }] })
  assert.deepStrictEqual(redacted?.bodyKeys, ['ok'])
})
