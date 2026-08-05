import { test } from 'node:test'
import * as assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { build } from '../../helper.js'
import { jwks, signToken } from '../../helpers/jwks.js'
import { createUserRow, createCollectionRow } from '../../helpers/fixtures.js'
import { stubAnthropicSuccess, stubAnthropicSequence, stubAnthropicFailure } from '../../helpers/anthropic.js'
import { type TranslationResult, type TranslationVariant } from '../../../src/ai/translate.js'

function variant (meaningText: string): TranslationVariant {
  return {
    meaningText,
    phoneticTranscription: `/${meaningText}/`,
    sentences: [{ targetText: `A sentence with ${meaningText}.`, nativeGlossText: 'Zdanie po polsku.' }]
  }
}

test('POST /api/collections/:id/translate returns one block per target language', async (t) => {
  const app = await build(t)
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Multi language translate', 'pl', ['en', 'de', 'fr'])

  stubAnthropicSuccess(app, {
    normalizedNativeText: 'pies',
    languages: [
      { languageCode: 'en', variants: [variant('dog')] },
      { languageCode: 'de', variants: [variant('Hund')] },
      { languageCode: 'fr', variants: [variant('chien')] }
    ]
  })

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub })

  const res = await app.inject({
    url: `/api/collections/${collectionId}/translate`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { text: 'pies' }
  })

  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.payload) as TranslationResult
  assert.equal(body.normalizedNativeText, 'pies')
  assert.deepStrictEqual(body.languages.map((language) => language.languageCode), ['en', 'de', 'fr'])
  assert.equal(body.languages[1].variants[0].meaningText, 'Hund')
})

test('POST /api/collections/:id/translate still works for a single-target collection', async (t) => {
  const app = await build(t)
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Single language translate', 'pl', ['en'])

  stubAnthropicSuccess(app, {
    normalizedNativeText: 'pies',
    languages: [{ languageCode: 'en', variants: [variant('dog')] }]
  })

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub })

  const res = await app.inject({
    url: `/api/collections/${collectionId}/translate`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { text: 'pies' }
  })

  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.payload) as TranslationResult
  assert.equal(body.languages.length, 1)
  assert.equal(body.languages[0].variants[0].meaningText, 'dog')
})

// The model picks the order and can drop a language entirely; the route
// rebuilds the list against what was requested so the client always gets a
// predictable array.
test('POST /api/collections/:id/translate reorders and backfills what the model returns', async (t) => {
  const app = await build(t)
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Reordered translate', 'pl', ['en', 'de', 'fr'])

  stubAnthropicSuccess(app, {
    normalizedNativeText: 'pies',
    languages: [
      { languageCode: 'fr', variants: [variant('chien')] },
      { languageCode: 'en', variants: [variant('dog')] }
    ]
  })

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub })

  const res = await app.inject({
    url: `/api/collections/${collectionId}/translate`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { text: 'pies' }
  })

  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.payload) as TranslationResult
  assert.deepStrictEqual(body.languages.map((language) => language.languageCode), ['en', 'de', 'fr'])
  assert.equal(body.languages[0].variants[0].meaningText, 'dog')
  assert.deepStrictEqual(body.languages[1].variants, [])
  assert.equal(body.languages[2].variants[0].meaningText, 'chien')
})

// The real model intermittently returns a structurally-valid response with
// every `variants` array empty (~3 in 34 measured calls). That's a bad roll,
// not an answer, so the client asks once more rather than rendering nothing.
test('POST /api/collections/:id/translate retries once when every language comes back empty', async (t) => {
  const app = await build(t)
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Empty then populated', 'pl', ['en', 'de'])

  const empty = {
    normalizedNativeText: 'pies',
    languages: [{ languageCode: 'en', variants: [] }, { languageCode: 'de', variants: [] }]
  }
  const populated = {
    normalizedNativeText: 'pies',
    languages: [
      { languageCode: 'en', variants: [variant('dog')] },
      { languageCode: 'de', variants: [variant('Hund')] }
    ]
  }
  const stub = stubAnthropicSequence(app, [empty, populated])

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub })

  const res = await app.inject({
    url: `/api/collections/${collectionId}/translate`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { text: 'pies' }
  })

  assert.equal(res.statusCode, 200)
  assert.equal(stub.calls(), 2)
  const body = JSON.parse(res.payload) as TranslationResult
  assert.equal(body.languages[0].variants[0].meaningText, 'dog')
  assert.equal(body.languages[1].variants[0].meaningText, 'Hund')
})

test('POST /api/collections/:id/translate stops retrying after one extra attempt', async (t) => {
  const app = await build(t)
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Always empty', 'pl', ['en'])

  const stub = stubAnthropicSequence(app, [
    { normalizedNativeText: 'pies', languages: [{ languageCode: 'en', variants: [] }] }
  ])

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub })

  const res = await app.inject({
    url: `/api/collections/${collectionId}/translate`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { text: 'pies' }
  })

  // Two attempts total, then it gives up and hands back what it has rather
  // than looping or erroring — the popup renders the empty-language copy.
  assert.equal(stub.calls(), 2)
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.payload) as TranslationResult
  assert.deepStrictEqual(body.languages[0].variants, [])
})

// A partially-populated response is a real answer, not a bad roll.
test('POST /api/collections/:id/translate does not retry when only some languages are empty', async (t) => {
  const app = await build(t)
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Partially populated', 'pl', ['en', 'de'])

  const stub = stubAnthropicSequence(app, [{
    normalizedNativeText: 'pies',
    languages: [{ languageCode: 'en', variants: [variant('dog')] }, { languageCode: 'de', variants: [] }]
  }])

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub })

  const res = await app.inject({
    url: `/api/collections/${collectionId}/translate`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { text: 'pies' }
  })

  assert.equal(res.statusCode, 200)
  assert.equal(stub.calls(), 1)
})

test('POST /api/collections/:id/translate rejects a blank text with 400', async (t) => {
  const app = await build(t)
  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub: randomUUID() })

  const res = await app.inject({
    url: `/api/collections/${randomUUID()}/translate`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { text: '   ' }
  })

  assert.equal(res.statusCode, 400)
})

test('POST /api/collections/:id/translate returns 404 for a collection owned by a different user', async (t) => {
  const app = await build(t)
  const ownerId = await createUserRow(app, t)
  const collectionId = await createCollectionRow(app, ownerId, 'Someone elses translate target')

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub: randomUUID() })

  const res = await app.inject({
    url: `/api/collections/${collectionId}/translate`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { text: 'pies' }
  })

  assert.equal(res.statusCode, 404)
})

// One call covers every target language, so a failure blanks the whole
// capture rather than one language's section.
test('POST /api/collections/:id/translate returns a clean 502 (not a raw exception) when the Anthropic call fails', async (t) => {
  const app = await build(t)
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Failing translate test', 'pl', ['en', 'de'])
  stubAnthropicFailure(app)

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub })

  const res = await app.inject({
    url: `/api/collections/${collectionId}/translate`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { text: 'pies' }
  })

  assert.equal(res.statusCode, 502)
  const body = JSON.parse(res.payload) as { message: string }
  assert.equal(body.message, 'could not generate a translation — try again')
})
