import { test } from 'node:test'
import * as assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { build } from '../helper.js'
import {
  createUserRow,
  createCollectionRow,
  createEntryRow,
  createSenseRow,
  createTranslationRow,
  createSentenceRow
} from '../helpers/fixtures.js'

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

// INVERTED by add-entry-senses. What this file used to prove was rejected is
// exactly what must now be accepted: `zamek` is a castle AND a lock, both in
// English, and the schema has to be able to hold that.
test('entry_translations accepts a second distinct meaning in the same language', async (t) => {
  const app = await build(t)
  const userId = await createUserRow(app, t)
  const collectionId = await createCollectionRow(app, userId, 'Test collection')
  const entryId = await createEntryRow(app, collectionId, 'zamek')
  const castleId = await createSenseRow(app, entryId, 'budowla obronna')
  const lockId = await createSenseRow(app, entryId, 'zamknięcie')

  await createTranslationRow(app, entryId, castleId, 'en', 'castle')
  await createTranslationRow(app, entryId, lockId, 'en', 'lock')

  const rows = await app.sql.query(
    'SELECT meaning_text FROM entry_translations WHERE entry_id = $1 ORDER BY meaning_text',
    [entryId]
  ) as Array<{ meaning_text: string }>
  assert.deepStrictEqual(rows.map((row) => row.meaning_text), ['castle', 'lock'])
})

// The uniqueness rule did not disappear, it moved one level down: within a
// single meaning, a language still gets exactly one word.
test("entry_translations rejects a second word inside one meaning's language", async (t) => {
  const app = await build(t)
  const userId = await createUserRow(app, t)
  const collectionId = await createCollectionRow(app, userId, 'Test collection')
  const entryId = await createEntryRow(app, collectionId, 'jedzenie')
  const senseId = await createSenseRow(app, entryId, 'jedzenie')

  await createTranslationRow(app, entryId, senseId, 'en', 'food')

  await assert.rejects(
    createTranslationRow(app, entryId, senseId, 'en', 'food (again)')
  )
})

test('entry_translations allows one meaning in multiple languages', async (t) => {
  const app = await build(t)
  const userId = await createUserRow(app, t)
  const collectionId = await createCollectionRow(app, userId, 'Test collection')
  const entryId = await createEntryRow(app, collectionId, 'jedzenie')
  const senseId = await createSenseRow(app, entryId, 'jedzenie')

  await createTranslationRow(app, entryId, senseId, 'en', 'food')
  await createTranslationRow(app, entryId, senseId, 'ru', 'eda')

  const rows = await app.sql.query(
    'SELECT language_code FROM entry_translations WHERE entry_id = $1 ORDER BY language_code',
    [entryId]
  ) as Array<{ language_code: string }>
  assert.deepStrictEqual(rows.map((row) => row.language_code), ['en', 'ru'])
})

test('entry_senses rejects a duplicate (entry_id, sense_key)', async (t) => {
  const app = await build(t)
  const userId = await createUserRow(app, t)
  const collectionId = await createCollectionRow(app, userId, 'Test collection')
  const entryId = await createEntryRow(app, collectionId, 'zamek')

  await createSenseRow(app, entryId, 'budowla obronna')

  // senseKey() is trim().toLowerCase(), so this is the same meaning twice.
  await assert.rejects(
    createSenseRow(app, entryId, '  Budowla Obronna  ')
  )
})

test('entry_translations.sense_id rejects null', async (t) => {
  const app = await build(t)
  const userId = await createUserRow(app, t)
  const collectionId = await createCollectionRow(app, userId, 'Test collection')
  const entryId = await createEntryRow(app, collectionId, 'jedzenie')

  await assert.rejects(
    app.sql.query(
      'INSERT INTO entry_translations (entry_id, sense_id, language_code, meaning_text) VALUES ($1, $2, $3, $4)',
      [entryId, null, 'en', 'food']
    )
  )
})

test('entry_translations.sense_id rejects a nonexistent sense', async (t) => {
  const app = await build(t)
  const userId = await createUserRow(app, t)
  const collectionId = await createCollectionRow(app, userId, 'Test collection')
  const entryId = await createEntryRow(app, collectionId, 'jedzenie')

  await assert.rejects(
    createTranslationRow(app, entryId, randomUUID(), 'en', 'food')
  )
})

test('entry_sentences.translation_id rejects null', async (t) => {
  const app = await build(t)
  const userId = await createUserRow(app, t)
  const collectionId = await createCollectionRow(app, userId, 'Test collection')
  const entryId = await createEntryRow(app, collectionId, 'jedzenie')

  await assert.rejects(
    app.sql.query(
      'INSERT INTO entry_sentences (entry_id, translation_id, language_code, sentence_text) VALUES ($1, $2, $3, $4)',
      [entryId, null, 'en', 'I like this food.']
    )
  )
})

test('entry_sentences.translation_id rejects a nonexistent translation', async (t) => {
  const app = await build(t)
  const userId = await createUserRow(app, t)
  const collectionId = await createCollectionRow(app, userId, 'Test collection')
  const entryId = await createEntryRow(app, collectionId, 'jedzenie')

  await assert.rejects(
    app.sql.query(
      'INSERT INTO entry_sentences (entry_id, translation_id, language_code, sentence_text) VALUES ($1, $2, $3, $4)',
      [entryId, randomUUID(), 'en', 'I like this food.']
    )
  )
})

test('entry_translations.phonetic_transcription and entry_sentences.native_gloss_text are nullable', async (t) => {
  const app = await build(t)
  const userId = await createUserRow(app, t)
  const collectionId = await createCollectionRow(app, userId, 'Test collection')
  const entryId = await createEntryRow(app, collectionId, 'jedzenie')
  const senseId = await createSenseRow(app, entryId, 'jedzenie')
  const translationId = await createTranslationRow(app, entryId, senseId, 'en', 'food')

  await createSentenceRow(app, entryId, translationId, 'I like this food.', null)

  const translationRows = await app.sql.query(
    'SELECT phonetic_transcription FROM entry_translations WHERE entry_id = $1',
    [entryId]
  ) as Array<{ phonetic_transcription: string | null }>
  const sentenceRows = await app.sql.query(
    'SELECT native_gloss_text FROM entry_sentences WHERE entry_id = $1',
    [entryId]
  ) as Array<{ native_gloss_text: string | null }>

  assert.deepStrictEqual(translationRows, [{ phonetic_transcription: null }])
  assert.deepStrictEqual(sentenceRows, [{ native_gloss_text: null }])
})

test('entry_sentences.sentence_text rejects null', async (t) => {
  const app = await build(t)
  const userId = await createUserRow(app, t)
  const collectionId = await createCollectionRow(app, userId, 'Test collection')
  const entryId = await createEntryRow(app, collectionId, 'jedzenie')
  const senseId = await createSenseRow(app, entryId, 'jedzenie')
  const translationId = await createTranslationRow(app, entryId, senseId, 'en', 'food')

  await assert.rejects(
    app.sql.query(
      'INSERT INTO entry_sentences (entry_id, translation_id, language_code, sentence_text) VALUES ($1, $2, $3, $4)',
      [entryId, translationId, 'en', null]
    )
  )
})

// The second cascade path add-entry-senses introduces, which the
// collection-level test below reaches only transitively.
test('deleting a sense cascades to its translations and their sentences', async (t) => {
  const app = await build(t)
  const userId = await createUserRow(app, t)
  const collectionId = await createCollectionRow(app, userId, 'Test collection')
  const entryId = await createEntryRow(app, collectionId, 'zamek')
  const castleId = await createSenseRow(app, entryId, 'budowla obronna')
  const lockId = await createSenseRow(app, entryId, 'zamknięcie')
  const castleEn = await createTranslationRow(app, entryId, castleId, 'en', 'castle')
  const lockEn = await createTranslationRow(app, entryId, lockId, 'en', 'lock')
  await createSentenceRow(app, entryId, castleEn, 'The castle stands on a hill.', 'Zamek stoi na wzgórzu.')
  await createSentenceRow(app, entryId, lockEn, 'The lock is broken.', 'Zamek jest zepsuty.')

  await app.sql.query('DELETE FROM entry_senses WHERE id = $1', [castleId])

  // The castle side is gone; the lock side, sharing the same entry and the same
  // language, is untouched.
  const translationRows = await app.sql.query(
    'SELECT id FROM entry_translations WHERE entry_id = $1',
    [entryId]
  ) as Array<{ id: string }>
  const sentenceRows = await app.sql.query(
    'SELECT translation_id FROM entry_sentences WHERE entry_id = $1',
    [entryId]
  ) as Array<{ translation_id: string }>

  assert.deepStrictEqual(translationRows.map((row) => row.id), [lockEn])
  assert.deepStrictEqual(sentenceRows.map((row) => row.translation_id), [lockEn])
})

test('deleting a collection cascades to its entries, senses, translations, and sentences', async (t) => {
  const app = await build(t)
  const userId = await createUserRow(app, t)
  const collectionId = await createCollectionRow(app, userId, 'Test collection')
  const entryId = await createEntryRow(app, collectionId, 'jedzenie')
  const senseId = await createSenseRow(app, entryId, 'jedzenie')
  const translationId = await createTranslationRow(app, entryId, senseId, 'en', 'food')
  await createSentenceRow(app, entryId, translationId, 'I like this food.', 'Lubię to jedzenie.')

  await app.sql.query('DELETE FROM collections WHERE id = $1', [collectionId])

  const entryRows = await app.sql.query('SELECT id FROM entries WHERE id = $1', [entryId])
  const senseRows = await app.sql.query('SELECT id FROM entry_senses WHERE entry_id = $1', [entryId])
  const translationRows = await app.sql.query('SELECT id FROM entry_translations WHERE entry_id = $1', [entryId])
  const sentenceRows = await app.sql.query('SELECT id FROM entry_sentences WHERE entry_id = $1', [entryId])

  assert.deepStrictEqual(entryRows, [])
  assert.deepStrictEqual(senseRows, [])
  assert.deepStrictEqual(translationRows, [])
  assert.deepStrictEqual(sentenceRows, [])
})

test('deleting a user cascades to their collections', async (t) => {
  const app = await build(t)
  const userId = await createUserRow(app, t)
  const collectionId = await createCollectionRow(app, userId, 'Test collection')

  await app.sql.query('DELETE FROM users WHERE id = $1', [userId])

  const collectionRows = await app.sql.query('SELECT id FROM collections WHERE id = $1', [collectionId])
  assert.deepStrictEqual(collectionRows, [])
})
