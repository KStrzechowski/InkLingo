import { test } from 'node:test'
import * as assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { build } from '../../helper.js'
import { jwks, signToken } from '../../helpers/jwks.js'
import { createUserRow, createCollectionRow } from '../../helpers/fixtures.js'
import { stubTranslator, fakeTranslator, failingTranslator, draftFrom } from '../../helpers/fakeTranslator.js'
import { captureLogs } from '../../helpers/logs.js'
import type { TranslateResponseBody } from '../../../src/routes/api/collections/schemas.js'

// These tests drive the `Translator` port through a fake. The retry and
// alignment cases that used to live here have moved down to the layers that
// now own them — alignment to test/domain/translationDraft.test.ts, the
// empty-draft retry to test/adapters/anthropicTranslator.test.ts — where they
// can be asserted directly instead of inferred through HTTP.
type TranslationResult = TranslateResponseBody

function variant (meaningText: string): unknown {
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

  stubTranslator(app, {
    normalizedNativeText: 'pies',
    languages: [
      { languageCode: 'en', variants: [variant('dog')] },
      { languageCode: 'de', variants: [variant('Hund')] },
      { languageCode: 'fr', variants: [variant('chien')] }
    ]
  }, 'pl', ['en', 'de', 'fr'])

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

  stubTranslator(app, {
    normalizedNativeText: 'pies',
    languages: [{ languageCode: 'en', variants: [variant('dog')] }]
  }, 'pl', ['en'])

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

  stubTranslator(app, {
    normalizedNativeText: 'pies',
    languages: [
      { languageCode: 'fr', variants: [variant('chien')] },
      { languageCode: 'en', variants: [variant('dog')] }
    ]
  }, 'pl', ['en', 'de', 'fr'])

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

// The empty-draft retry itself now lives in the adapter, where it can be
// observed directly — see test/adapters/anthropicTranslator.test.ts. What the
// route owns is what an all-empty draft *means*, and the answer changed: it
// used to be a 200 that rendered five "Nothing came back for this language"
// sections, which is a failure the user can see but no other layer can.
test('POST /api/collections/:id/translate returns 502 when every language comes back empty', async (t) => {
  const app = await build(t)
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Always empty', 'pl', ['en'])

  stubTranslator(app, {
    normalizedNativeText: 'pies',
    languages: [{ languageCode: 'en', variants: [] }]
  }, 'pl', ['en'])

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

// A partially-populated response is a real answer, not a bad roll. It stays a
// 200 — and it is now counted server-side, because the popup no longer reports
// it and this log line is the only remaining record that it happened.
test('POST /api/collections/:id/translate serves a partial draft and logs the degradation', async (t) => {
  const logs = captureLogs()
  const app = await build(t, { logger: { level: 'warn', stream: logs.stream } })
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Partially populated', 'pl', ['en', 'de'])

  const translator = fakeTranslator([draftFrom({
    normalizedNativeText: 'pies',
    languages: [{ languageCode: 'en', variants: [variant('dog')] }, { languageCode: 'de', variants: [] }]
  }, 'pl', ['en', 'de'])])
  app.translator = translator

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub })

  const res = await app.inject({
    url: `/api/collections/${collectionId}/translate`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { text: 'pies' }
  })

  assert.equal(res.statusCode, 200)
  assert.equal(translator.calls(), 1)
  const body = JSON.parse(res.payload) as TranslationResult
  assert.equal(body.languages[0].variants[0].meaningText, 'dog')
  assert.deepStrictEqual(body.languages[1].variants, [])

  const line = logs.find('translator returned no senses for some languages')
  assert.ok(line !== undefined, 'the partial-degradation line was not emitted')
  assert.deepStrictEqual(line.degradedLanguageCodes, ['de'])
  assert.equal(line.languageCount, 2)
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
test('POST /api/collections/:id/translate returns a clean 502 (not a raw exception) when the translator call fails', async (t) => {
  const app = await build(t)
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Failing translate test', 'pl', ['en', 'de'])
  app.translator = failingTranslator(new Error('translator unavailable'))

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
