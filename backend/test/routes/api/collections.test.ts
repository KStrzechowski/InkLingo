import { test } from 'node:test'
import * as assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { build } from '../../helper.js'
import { jwks, signToken } from '../../helpers/jwks.js'

async function authedUser (app: Awaited<ReturnType<typeof build>>, t: Parameters<typeof build>[0]): Promise<{ sub: string, token: string }> {
  app.jwtVerifier.cacheJwks(jwks)
  const sub = randomUUID()
  t.after(async () => { await app.sql.query('DELETE FROM users WHERE cognito_sub = $1', [sub]) })
  const token = await signToken({ sub })
  return { sub, token }
}

async function createUserRow (app: Awaited<ReturnType<typeof build>>, t: Parameters<typeof build>[0], cognitoSub = `test-${randomUUID()}`): Promise<string> {
  const rows = await app.sql.query(
    'INSERT INTO users (cognito_sub) VALUES ($1) RETURNING id',
    [cognitoSub]
  ) as Array<{ id: string }>
  const userId = rows[0].id
  t.after(async () => { await app.sql.query('DELETE FROM users WHERE id = $1', [userId]) })
  return userId
}

async function createCollectionRow (app: Awaited<ReturnType<typeof build>>, userId: string, name: string): Promise<string> {
  const rows = await app.sql.query(
    'INSERT INTO collections (user_id, name) VALUES ($1, $2) RETURNING id',
    [userId, name]
  ) as Array<{ id: string }>
  return rows[0].id
}

async function createEntryRow (app: Awaited<ReturnType<typeof build>>, collectionId: string, wordOrPhrase: string): Promise<string> {
  const rows = await app.sql.query(
    'INSERT INTO entries (collection_id, word_or_phrase, source_language_code) VALUES ($1, $2, $3) RETURNING id',
    [collectionId, wordOrPhrase, 'pl']
  ) as Array<{ id: string }>
  return rows[0].id
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
    payload: { name: 'Food words' }
  })
  assert.equal(createRes.statusCode, 201)
  const created = JSON.parse(createRes.payload) as { id: string, name: string, createdAt: string }
  assert.equal(created.name, 'Food words')
  assert.ok(created.id)
  assert.ok(created.createdAt)

  const listRes = await app.inject({ url: '/api/collections', headers: { authorization: `Bearer ${token}` } })
  const body = JSON.parse(listRes.payload) as { collections: Array<{ id: string, name: string }> }
  assert.deepStrictEqual(body.collections.map((c) => c.id), [created.id])
})

test('POST /api/collections rejects a duplicate name for the same user, case-insensitively, with 409', async (t) => {
  const app = await build(t)
  const { token } = await authedUser(app, t)

  const first = await app.inject({
    url: '/api/collections',
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Travel phrases' }
  })
  assert.equal(first.statusCode, 201)

  const second = await app.inject({
    url: '/api/collections',
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'travel phrases' }
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
    payload: { name: '   ' }
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
    payload: { name: 'a'.repeat(101) }
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

test('GET /api/collections/:id returns correctly nested translations/sentences for entries with more than one of each', async (t) => {
  const app = await build(t)
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Nested contents test')
  const entryId = await createEntryRow(app, collectionId, 'jedzenie')

  await app.sql.query(
    'INSERT INTO entry_translations (entry_id, language_code, meaning_text) VALUES ($1, $2, $3)',
    [entryId, 'en', 'food']
  )
  await app.sql.query(
    'INSERT INTO entry_translations (entry_id, language_code, meaning_text) VALUES ($1, $2, $3)',
    [entryId, 'ru', 'eda']
  )
  await app.sql.query(
    'INSERT INTO entry_sentences (entry_id, language_code, sentence_text) VALUES ($1, $2, $3)',
    [entryId, 'en', 'I like this food.']
  )
  await app.sql.query(
    'INSERT INTO entry_sentences (entry_id, language_code, sentence_text) VALUES ($1, $2, $3)',
    [entryId, 'pl', 'Lubię to jedzenie.']
  )

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
    ['en', 'pl']
  )
})
