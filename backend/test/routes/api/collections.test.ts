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

test('GET /api/collections/:id returns correctly nested translations/sentences for entries with more than one of each', async (t) => {
  const app = await build(t)
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Nested contents test')
  const entryId = await createEntryRow(app, collectionId, 'jedzenie')

  const senseId = await createSenseRow(app, entryId, 'jedzenie')
  const enId = await createTranslationRow(app, entryId, senseId, 'en', 'food')
  const ruId = await createTranslationRow(app, entryId, senseId, 'ru', 'eda')
  // The `pl` sentence this fixture used to carry was a sentence in the
  // collection's own native language with no translation to hang off — the
  // exact orphan Phase 0 found in the live data, and now unrepresentable.
  await createSentenceRow(app, entryId, enId, 'I like this food.')
  await createSentenceRow(app, entryId, ruId, 'Мне нравится эта еда.')

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub })

  const res = await app.inject({ url: `/api/collections/${collectionId}`, headers: { authorization: `Bearer ${token}` } })
  assert.equal(res.statusCode, 200)

  const body = JSON.parse(res.payload) as {
    id: string
    name: string
    entries: Array<{
      id: string
      wordOrPhrase: string
      translations: Array<{ languageCode: string, meaningText: string }>
      sentences: Array<{ languageCode: string, sentenceText: string }>
    }>
  }

  assert.equal(body.id, collectionId)
  assert.equal(body.entries.length, 1)
  const [entry] = body.entries
  assert.equal(entry.wordOrPhrase, 'jedzenie')
  assert.deepStrictEqual(
    entry.translations.map((tr) => tr.languageCode).sort(),
    ['en', 'ru']
  )
  assert.deepStrictEqual(
    entry.sentences.map((s) => s.languageCode).sort(),
    ['en', 'ru']
  )
})
