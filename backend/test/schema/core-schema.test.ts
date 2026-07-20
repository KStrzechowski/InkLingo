import { test } from 'node:test'
import * as assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { build } from '../helper.js'

async function createUser (app: Awaited<ReturnType<typeof build>>, t: Parameters<typeof build>[0]): Promise<string> {
  const cognitoSub = `test-${randomUUID()}`
  const rows = await app.sql.query(
    'INSERT INTO users (cognito_sub) VALUES ($1) RETURNING id',
    [cognitoSub]
  ) as Array<{ id: string }>
  const userId = rows[0].id
  t.after(async () => {
    await app.sql.query('DELETE FROM users WHERE id = $1', [userId])
  })
  return userId
}

async function createCollection (app: Awaited<ReturnType<typeof build>>, userId: string): Promise<string> {
  const rows = await app.sql.query(
    'INSERT INTO collections (user_id, name) VALUES ($1, $2) RETURNING id',
    [userId, 'Test collection']
  ) as Array<{ id: string }>
  return rows[0].id
}

async function createEntry (app: Awaited<ReturnType<typeof build>>, collectionId: string): Promise<string> {
  const rows = await app.sql.query(
    'INSERT INTO entries (collection_id, word_or_phrase, source_language_code) VALUES ($1, $2, $3) RETURNING id',
    [collectionId, 'jedzenie', 'pl']
  ) as Array<{ id: string }>
  return rows[0].id
}

test('users.cognito_sub is unique', async (t) => {
  const app = await build(t)
  const cognitoSub = `test-${randomUUID()}`

  await app.sql.query('INSERT INTO users (cognito_sub) VALUES ($1)', [cognitoSub])
  t.after(async () => {
    await app.sql.query('DELETE FROM users WHERE cognito_sub = $1', [cognitoSub])
  })

  await assert.rejects(
    app.sql.query('INSERT INTO users (cognito_sub) VALUES ($1)', [cognitoSub])
  )
})

test('users.cognito_sub rejects null', async (t) => {
  const app = await build(t)

  await assert.rejects(
    app.sql.query('INSERT INTO users (cognito_sub) VALUES ($1)', [null])
  )
})

test('entries.collection_id foreign key rejects a nonexistent collection', async (t) => {
  const app = await build(t)

  await assert.rejects(
    app.sql.query(
      'INSERT INTO entries (collection_id, word_or_phrase, source_language_code) VALUES ($1, $2, $3)',
      [randomUUID(), 'word', 'en']
    )
  )
})

test('entry_translations rejects a duplicate (entry_id, language_code) pair', async (t) => {
  const app = await build(t)
  const userId = await createUser(app, t)
  const collectionId = await createCollection(app, userId)
  const entryId = await createEntry(app, collectionId)

  await app.sql.query(
    'INSERT INTO entry_translations (entry_id, language_code, meaning_text) VALUES ($1, $2, $3)',
    [entryId, 'en', 'food']
  )

  await assert.rejects(
    app.sql.query(
      'INSERT INTO entry_translations (entry_id, language_code, meaning_text) VALUES ($1, $2, $3)',
      [entryId, 'en', 'food (again)']
    )
  )
})

test('entry_translations allows the same entry in multiple languages', async (t) => {
  const app = await build(t)
  const userId = await createUser(app, t)
  const collectionId = await createCollection(app, userId)
  const entryId = await createEntry(app, collectionId)

  await app.sql.query(
    'INSERT INTO entry_translations (entry_id, language_code, meaning_text) VALUES ($1, $2, $3)',
    [entryId, 'en', 'food']
  )
  await app.sql.query(
    'INSERT INTO entry_translations (entry_id, language_code, meaning_text) VALUES ($1, $2, $3)',
    [entryId, 'ru', 'eda']
  )

  const rows = await app.sql.query(
    'SELECT language_code FROM entry_translations WHERE entry_id = $1 ORDER BY language_code',
    [entryId]
  ) as Array<{ language_code: string }>
  assert.deepStrictEqual(rows.map((row) => row.language_code), ['en', 'ru'])
})

test('entry_sentences.sentence_text rejects null', async (t) => {
  const app = await build(t)
  const userId = await createUser(app, t)
  const collectionId = await createCollection(app, userId)
  const entryId = await createEntry(app, collectionId)

  await assert.rejects(
    app.sql.query(
      'INSERT INTO entry_sentences (entry_id, language_code, sentence_text) VALUES ($1, $2, $3)',
      [entryId, 'en', null]
    )
  )
})

test('deleting a collection cascades to its entries, translations, and sentences', async (t) => {
  const app = await build(t)
  const userId = await createUser(app, t)
  const collectionId = await createCollection(app, userId)
  const entryId = await createEntry(app, collectionId)
  await app.sql.query(
    'INSERT INTO entry_translations (entry_id, language_code, meaning_text) VALUES ($1, $2, $3)',
    [entryId, 'en', 'food']
  )
  await app.sql.query(
    'INSERT INTO entry_sentences (entry_id, language_code, sentence_text) VALUES ($1, $2, $3)',
    [entryId, 'en', 'I like this food.']
  )

  await app.sql.query('DELETE FROM collections WHERE id = $1', [collectionId])

  const entryRows = await app.sql.query('SELECT id FROM entries WHERE id = $1', [entryId])
  const translationRows = await app.sql.query('SELECT id FROM entry_translations WHERE entry_id = $1', [entryId])
  const sentenceRows = await app.sql.query('SELECT id FROM entry_sentences WHERE entry_id = $1', [entryId])

  assert.deepStrictEqual(entryRows, [])
  assert.deepStrictEqual(translationRows, [])
  assert.deepStrictEqual(sentenceRows, [])
})

test('deleting a user cascades to their collections', async (t) => {
  const app = await build(t)
  const userId = await createUser(app, t)
  const collectionId = await createCollection(app, userId)

  await app.sql.query('DELETE FROM users WHERE id = $1', [userId])

  const collectionRows = await app.sql.query('SELECT id FROM collections WHERE id = $1', [collectionId])
  assert.deepStrictEqual(collectionRows, [])
})
