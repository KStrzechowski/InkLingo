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

function translation (languageCode: string, meaningText: string): unknown {
  return {
    languageCode,
    meaningText,
    phoneticTranscription: `/${meaningText}/`,
    sentences: [{ targetText: `A sentence with ${meaningText}.`, nativeGlossText: 'Zdanie po polsku.' }]
  }
}

test('POST /api/collections/:id/translate returns each meaning with its per-language words', async (t) => {
  const app = await build(t)
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Multi language translate', 'pl', ['en', 'de', 'fr'])

  stubTranslator(app, {
    normalizedNativeText: 'zamek',
    senses: [
      {
        glossText: 'budowla obronna',
        translations: [translation('en', 'castle'), translation('de', 'Burg'), translation('fr', 'chateau')]
      },
      {
        glossText: 'urzadzenie do zamykania',
        translations: [translation('en', 'lock'), translation('de', 'Schloss'), translation('fr', 'serrure')]
      }
    ]
  }, 'pl', ['en', 'de', 'fr'])

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub })

  const res = await app.inject({
    url: `/api/collections/${collectionId}/translate`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { text: 'zamek' }
  })

  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.payload) as TranslationResult
  assert.equal(body.normalizedNativeText, 'zamek')
  // Both meanings survive the round trip. Under the language-first shape this
  // response could not distinguish them at all: `castle` and `lock` were two
  // entries in one English list with nothing tying either to its German twin.
  assert.deepStrictEqual(body.senses.map((sense) => sense.glossText), ['budowla obronna', 'urzadzenie do zamykania'])
  assert.deepStrictEqual(
    body.senses.map((sense) => sense.translations.map((entry) => entry.languageCode)),
    [['en', 'de', 'fr'], ['en', 'de', 'fr']]
  )
  assert.equal(body.senses[1].translations[1].meaningText, 'Schloss')
})

test('POST /api/collections/:id/translate still works for a single-target collection', async (t) => {
  const app = await build(t)
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Single language translate', 'pl', ['en'])

  stubTranslator(app, {
    normalizedNativeText: 'pies',
    senses: [{ glossText: 'zwierze domowe', translations: [translation('en', 'dog')] }]
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
  assert.equal(body.senses.length, 1)
  assert.equal(body.senses[0].translations[0].meaningText, 'dog')
})

// The model picks the order and can drop a language from a meaning; the route
// re-keys each meaning's translations against what was requested, so the client
// always gets them in a predictable order. A language the model left out of one
// meaning is a sparse spoke and stays absent rather than being materialized
// empty - that is the semantic the inversion changed.
test('POST /api/collections/:id/translate reorders each meaning against the requested languages', async (t) => {
  const app = await build(t)
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Reordered translate', 'pl', ['en', 'de', 'fr'])

  stubTranslator(app, {
    normalizedNativeText: 'zamek',
    senses: [{
      glossText: 'budowla obronna',
      translations: [translation('fr', 'chateau'), translation('en', 'castle')]
    }]
  }, 'pl', ['en', 'de', 'fr'])

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub })

  const res = await app.inject({
    url: `/api/collections/${collectionId}/translate`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { text: 'zamek' }
  })

  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.payload) as TranslationResult
  const [sense] = body.senses
  assert.deepStrictEqual(sense.translations.map((entry) => entry.languageCode), ['en', 'fr'])
  assert.equal(sense.translations[0].meaningText, 'castle')
  assert.equal(sense.translations[1].meaningText, 'chateau')
})

// The empty-draft retry itself now lives in the adapter, where it can be
// observed directly — see test/adapters/anthropicTranslator.test.ts. What the
// route owns is what an all-empty draft *means*, and the answer changed: it
// used to be a 200 that rendered five "Nothing came back for this language"
// sections, which is a failure the user can see but no other layer can.
test('POST /api/collections/:id/translate returns 502 when no meaning comes back at all', async (t) => {
  const app = await build(t)
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Always empty', 'pl', ['en'])

  stubTranslator(app, {
    normalizedNativeText: 'pies',
    senses: []
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

  // `de` is absent from every meaning, which is the gap worth counting - not a
  // sparse spoke, which is absent from one meaning and legal.
  const translator = fakeTranslator([draftFrom({
    normalizedNativeText: 'pies',
    senses: [{ glossText: 'zwierze domowe', translations: [translation('en', 'dog')] }]
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
  assert.equal(body.senses[0].translations.length, 1)
  assert.equal(body.senses[0].translations[0].meaningText, 'dog')

  const line = logs.find('translator returned no translations for some languages')
  assert.ok(line !== undefined, 'the partial-degradation line was not emitted')
  assert.deepStrictEqual(line.degradedLanguageCodes, ['de'])
  assert.equal(line.senseCount, 1)
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

// Fastify strips any property a response schema does not declare, so a missing
// declaration drops a field silently rather than erroring. A spot check on a
// few fields is exactly the shape of test that misses that — this asserts the
// entire body.
test('POST /api/collections/:id/translate serializes the full body, stripping nothing', async (t) => {
  const app = await build(t)
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Full body serialization', 'pl', ['en', 'de'])

  stubTranslator(app, {
    normalizedNativeText: 'pies',
    senses: [{
      glossText: 'zwierze domowe',
      translations: [
        translation('en', 'dog'),
        {
          languageCode: 'de',
          meaningText: 'Hund',
          phoneticTranscription: null,
          sentences: [{ targetText: 'Der Hund rennt.', nativeGlossText: 'Pies biegnie.' }]
        }
      ]
    }]
  }, 'pl', ['en', 'de'])

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub })

  const res = await app.inject({
    url: `/api/collections/${collectionId}/translate`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { text: 'pies' }
  })

  assert.equal(res.statusCode, 200)
  assert.deepStrictEqual(JSON.parse(res.payload), {
    normalizedNativeText: 'pies',
    senses: [{
      glossText: 'zwierze domowe',
      translations: [
        {
          languageCode: 'en',
          meaningText: 'dog',
          phoneticTranscription: '/dog/',
          sentences: [{ targetText: 'A sentence with dog.', nativeGlossText: 'Zdanie po polsku.' }]
        },
        {
          languageCode: 'de',
          meaningText: 'Hund',
          // A null phonetic must survive serialization as null, not vanish.
          phoneticTranscription: null,
          sentences: [{ targetText: 'Der Hund rennt.', nativeGlossText: 'Pies biegnie.' }]
        }
      ]
    }]
  })
})
