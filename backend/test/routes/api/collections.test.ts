import { test } from 'node:test'
import * as assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { build } from '../../helper.js'
import { jwks, signToken } from '../../helpers/jwks.js'
import {
  createUserRow,
  createCollectionRow,
  createEntryRow,
  createSenseRow,
  createTranslationRow,
  createSentenceRow
} from '../../helpers/fixtures.js'

async function authedUser (app: Awaited<ReturnType<typeof build>>, t: Parameters<typeof build>[0]): Promise<{ sub: string, token: string }> {
  app.jwtVerifier.cacheJwks(jwks)
  const sub = randomUUID()
  t.after(async () => { await app.sql.query('DELETE FROM users WHERE cognito_sub = $1', [sub]) })
  const token = await signToken({ sub })
  return { sub, token }
}

test('GET /api/collections returns an empty list for a fresh user', async (t) => {
  const app = await build(t)
  const { token } = await authedUser(app, t)

  const res = await app.inject({ url: '/api/collections', headers: { authorization: `Bearer ${token}` } })

  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.payload) as { collections: unknown[] }
  assert.deepStrictEqual(body.collections, [])
})

test('a created collection appears in a subsequent list call', async (t) => {
  const app = await build(t)
  const { token } = await authedUser(app, t)

  const createRes = await app.inject({
    url: '/api/collections',
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Food words', nativeLanguageCode: 'pl', targetLanguageCodes: ['en'] }
  })
  assert.equal(createRes.statusCode, 201)
  const created = JSON.parse(createRes.payload) as { id: string, name: string, nativeLanguageCode: string, targetLanguageCodes: string[], createdAt: string }
  assert.equal(created.name, 'Food words')
  assert.equal(created.nativeLanguageCode, 'pl')
  assert.deepStrictEqual(created.targetLanguageCodes, ['en'])
  assert.ok(created.id)
  assert.ok(created.createdAt)

  const listRes = await app.inject({ url: '/api/collections', headers: { authorization: `Bearer ${token}` } })
  const body = JSON.parse(listRes.payload) as { collections: Array<{ id: string, name: string, nativeLanguageCode: string, targetLanguageCodes: string[] }> }
  assert.deepStrictEqual(body.collections.map((c) => c.id), [created.id])
  assert.equal(body.collections[0].nativeLanguageCode, 'pl')
  assert.deepStrictEqual(body.collections[0].targetLanguageCodes, ['en'])
})

test('POST /api/collections rejects a missing nativeLanguageCode/targetLanguageCodes with 400', async (t) => {
  const app = await build(t)
  const { token } = await authedUser(app, t)

  const res = await app.inject({
    url: '/api/collections',
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'No languages' }
  })
  assert.equal(res.statusCode, 400)
})

test('POST /api/collections rejects an unsupported language code with 400', async (t) => {
  const app = await build(t)
  const { token } = await authedUser(app, t)

  const res = await app.inject({
    url: '/api/collections',
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Garbage language', nativeLanguageCode: 'SFEFZESF', targetLanguageCodes: ['en'] }
  })
  assert.equal(res.statusCode, 400)
})

test('POST /api/collections accepts a supported language code regardless of case', async (t) => {
  const app = await build(t)
  const { token } = await authedUser(app, t)

  const res = await app.inject({
    url: '/api/collections',
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Mixed case language', nativeLanguageCode: 'PL', targetLanguageCodes: ['En'] }
  })
  assert.equal(res.statusCode, 201)
  const created = JSON.parse(res.payload) as { nativeLanguageCode: string, targetLanguageCodes: string[] }
  assert.equal(created.nativeLanguageCode, 'pl')
  assert.deepStrictEqual(created.targetLanguageCodes, ['en'])
})

test('POST /api/collections accepts up to five target languages', async (t) => {
  const app = await build(t)
  const { token } = await authedUser(app, t)

  const res = await app.inject({
    url: '/api/collections',
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Five languages', nativeLanguageCode: 'pl', targetLanguageCodes: ['en', 'de', 'fr', 'es', 'it'] }
  })
  assert.equal(res.statusCode, 201)
  const created = JSON.parse(res.payload) as { id: string, targetLanguageCodes: string[] }
  assert.deepStrictEqual(created.targetLanguageCodes, ['en', 'de', 'fr', 'es', 'it'])

  const detail = await app.inject({ url: `/api/collections/${created.id}`, headers: { authorization: `Bearer ${token}` } })
  const body = JSON.parse(detail.payload) as { targetLanguageCodes: string[] }
  assert.deepStrictEqual(body.targetLanguageCodes.slice().sort(), ['de', 'en', 'es', 'fr', 'it'])
})

test('POST /api/collections rejects a sixth target language with 400', async (t) => {
  const app = await build(t)
  const { token } = await authedUser(app, t)

  const res = await app.inject({
    url: '/api/collections',
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Six languages', nativeLanguageCode: 'pl', targetLanguageCodes: ['en', 'de', 'fr', 'es', 'it', 'ru'] }
  })
  assert.equal(res.statusCode, 400)
})

// Would otherwise trip UNIQUE(collection_id, language_code) and surface as
// the name-conflict 409, which tells the caller the wrong thing.
test('POST /api/collections rejects duplicate target languages with 400', async (t) => {
  const app = await build(t)
  const { token } = await authedUser(app, t)

  const res = await app.inject({
    url: '/api/collections',
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Duplicate targets', nativeLanguageCode: 'pl', targetLanguageCodes: ['en', 'EN'] }
  })
  assert.equal(res.statusCode, 400)
})

test('POST /api/collections rejects the native language appearing as a target with 400', async (t) => {
  const app = await build(t)
  const { token } = await authedUser(app, t)

  const res = await app.inject({
    url: '/api/collections',
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Native as target', nativeLanguageCode: 'pl', targetLanguageCodes: ['en', 'pl'] }
  })
  assert.equal(res.statusCode, 400)
})

test('POST /api/collections rejects a duplicate name for the same user, case-insensitively, with 409', async (t) => {
  const app = await build(t)
  const { token } = await authedUser(app, t)

  const first = await app.inject({
    url: '/api/collections',
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Travel phrases', nativeLanguageCode: 'pl', targetLanguageCodes: ['en'] }
  })
  assert.equal(first.statusCode, 201)

  const second = await app.inject({
    url: '/api/collections',
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'travel phrases', nativeLanguageCode: 'pl', targetLanguageCodes: ['en'] }
  })
  assert.equal(second.statusCode, 409)
})

test('POST /api/collections rejects a blank/whitespace-only name with 400', async (t) => {
  const app = await build(t)
  const { token } = await authedUser(app, t)

  const res = await app.inject({
    url: '/api/collections',
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: '   ', nativeLanguageCode: 'pl', targetLanguageCodes: ['en'] }
  })
  assert.equal(res.statusCode, 400)
})

test('POST /api/collections rejects an over-max-length name with 400', async (t) => {
  const app = await build(t)
  const { token } = await authedUser(app, t)

  const res = await app.inject({
    url: '/api/collections',
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'a'.repeat(101), nativeLanguageCode: 'pl', targetLanguageCodes: ['en'] }
  })
  assert.equal(res.statusCode, 400)
})

test('GET /api/collections/:id returns 404 for a collection owned by a different user', async (t) => {
  const app = await build(t)
  const ownerId = await createUserRow(app, t)
  const collectionId = await createCollectionRow(app, ownerId, 'Someone elses collection')

  const { token } = await authedUser(app, t)
  const res = await app.inject({ url: `/api/collections/${collectionId}`, headers: { authorization: `Bearer ${token}` } })

  assert.equal(res.statusCode, 404)
})

test('GET /api/collections/:id returns an empty entries array for a collection with no entries', async (t) => {
  const app = await build(t)
  const { token } = await authedUser(app, t)

  const createRes = await app.inject({
    url: '/api/collections',
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Empty collection', nativeLanguageCode: 'pl', targetLanguageCodes: ['en'] }
  })
  const created = JSON.parse(createRes.payload) as { id: string }

  const res = await app.inject({ url: `/api/collections/${created.id}`, headers: { authorization: `Bearer ${token}` } })
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.payload) as { entries: unknown[], nativeLanguageCode: string, targetLanguageCodes: string[] }
  assert.deepStrictEqual(body.entries, [])
  assert.equal(body.nativeLanguageCode, 'pl')
  assert.deepStrictEqual(body.targetLanguageCodes, ['en'])
})

interface ReadSense {
  id: string
  glossText: string
  translations: Array<{
    id: string
    languageCode: string
    meaningText: string
    phoneticTranscription: string | null
    sentences: Array<{ id: string, sentenceText: string, nativeGlossText: string }>
  }>
}

interface ReadEntry {
  id: string
  wordOrPhrase: string
  sourceLanguageCode: string
  createdAt: string
  senses: ReadSense[]
}

test('GET /api/collections/:id nests each sentence under the word it belongs to', async (t) => {
  const app = await build(t)
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Nested contents test', 'pl', ['en', 'ru'])
  const entryId = await createEntryRow(app, collectionId, 'jedzenie')

  const senseId = await createSenseRow(app, entryId, 'jedzenie')
  const enId = await createTranslationRow(app, entryId, senseId, 'en', 'food')
  const ruId = await createTranslationRow(app, entryId, senseId, 'ru', 'eda')
  // The `pl` sentence this fixture used to carry was a sentence in the
  // collection's own native language with no translation to hang off — the
  // exact orphan Phase 0 found in the live data, and now unrepresentable.
  await createSentenceRow(app, entryId, enId, 'I like this food.', 'Lubię to jedzenie.')
  await createSentenceRow(app, entryId, ruId, 'Мне нравится эта еда.', 'Lubię to jedzenie.')

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub })

  const res = await app.inject({ url: `/api/collections/${collectionId}`, headers: { authorization: `Bearer ${token}` } })
  assert.equal(res.statusCode, 200)

  const body = JSON.parse(res.payload) as { id: string, entries: ReadEntry[] }

  assert.equal(body.id, collectionId)
  assert.equal(body.entries.length, 1)
  const [entry] = body.entries
  assert.equal(entry.wordOrPhrase, 'jedzenie')
  assert.equal(entry.senses.length, 1)
  const [sense] = entry.senses
  assert.equal(sense.glossText, 'jedzenie')
  assert.deepStrictEqual(sense.translations.map((tr) => tr.languageCode), ['en', 'ru'])
  // The pairing, which is the whole point: each sentence sits under its own
  // word rather than beside it in a sibling array joined by language code.
  assert.deepStrictEqual(
    sense.translations.map((tr) => tr.sentences.map((s) => s.sentenceText)),
    [['I like this food.'], ['Мне нравится эта еда.']]
  )
})

// Design test 20's read-side twin: a word with two meanings comes back as two
// meanings, each owning its own words and sentences.
test('GET /api/collections/:id returns every meaning of a multi-meaning entry', async (t) => {
  const app = await build(t)
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Multi meaning read test', 'pl', ['en'])
  const entryId = await createEntryRow(app, collectionId, 'zamek')

  const castleId = await createSenseRow(app, entryId, 'budowla obronna')
  const castleEn = await createTranslationRow(app, entryId, castleId, 'en', 'castle')
  await createSentenceRow(app, entryId, castleEn, 'The castle stands on a hill.', 'Zamek stoi na wzgórzu.')

  const lockId = await createSenseRow(app, entryId, 'zamknięcie drzwi')
  const lockEn = await createTranslationRow(app, entryId, lockId, 'en', 'lock')
  await createSentenceRow(app, entryId, lockEn, 'The lock is broken.', 'Zamek jest zepsuty.')

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub })

  const res = await app.inject({ url: `/api/collections/${collectionId}`, headers: { authorization: `Bearer ${token}` } })
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.payload) as { entries: ReadEntry[] }

  const [entry] = body.entries
  assert.deepStrictEqual(entry.senses.map((sense) => sense.glossText), ['budowla obronna', 'zamknięcie drzwi'])
  assert.deepStrictEqual(
    entry.senses.map((sense) => sense.translations[0].meaningText),
    ['castle', 'lock']
  )
})

// `GET /:id` hand-built its payload with no response schema until this change,
// so nothing was stripped and nothing could be. Now a field missing from
// `collectionDetailResponseSchema` vanishes **silently**, and a full-body
// deep-equal is the only shape of test that catches it.
test('GET /api/collections/:id serializes the full body, stripping nothing', async (t) => {
  const app = await build(t)
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Detail serialization', 'pl', ['en'])
  const entryId = await createEntryRow(app, collectionId, 'pies')
  const senseId = await createSenseRow(app, entryId, 'zwierzę domowe')
  const translationId = await createTranslationRow(app, entryId, senseId, 'en', 'dog')
  const sentenceId = await createSentenceRow(app, entryId, translationId, 'The dog runs.', 'Pies biegnie.')

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub })

  const res = await app.inject({ url: `/api/collections/${collectionId}`, headers: { authorization: `Bearer ${token}` } })
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.payload) as {
    id: string
    name: string
    nativeLanguageCode: string
    targetLanguageCodes: string[]
    createdAt: string
    entries: ReadEntry[]
  }

  assert.equal(typeof body.createdAt, 'string')
  assert.equal(typeof body.entries[0].createdAt, 'string')
  assert.deepStrictEqual(body, {
    id: collectionId,
    name: 'Detail serialization',
    nativeLanguageCode: 'pl',
    targetLanguageCodes: ['en'],
    createdAt: body.createdAt,
    entries: [{
      id: entryId,
      wordOrPhrase: 'pies',
      sourceLanguageCode: 'pl',
      createdAt: body.entries[0].createdAt,
      senses: [{
        id: senseId,
        glossText: 'zwierzę domowe',
        translations: [{
          id: translationId,
          languageCode: 'en',
          meaningText: 'dog',
          phoneticTranscription: null,
          sentences: [{
            id: sentenceId,
            sentenceText: 'The dog runs.',
            nativeGlossText: 'Pies biegnie.'
          }]
        }]
      }]
    }]
  })
})
