import { randomUUID } from 'node:crypto'
import type { build } from '../helper.js'

export async function createUserRow (
  app: Awaited<ReturnType<typeof build>>,
  t: Parameters<typeof build>[0],
  cognitoSub = `test-${randomUUID()}`
): Promise<string> {
  const rows = await app.sql.query(
    'INSERT INTO users (cognito_sub) VALUES ($1) RETURNING id',
    [cognitoSub]
  ) as Array<{ id: string }>
  const userId = rows[0].id
  t.after(async () => { await app.sql.query('DELETE FROM users WHERE id = $1', [userId]) })
  return userId
}

export async function createCollectionRow (
  app: Awaited<ReturnType<typeof build>>,
  userId: string,
  name: string,
  nativeLanguageCode = 'pl',
  targetLanguageCodes = ['en']
): Promise<string> {
  const rows = await app.sql.query(
    'INSERT INTO collections (user_id, name, native_language_code) VALUES ($1, $2, $3) RETURNING id',
    [userId, name, nativeLanguageCode]
  ) as Array<{ id: string }>
  const collectionId = rows[0].id
  for (const languageCode of targetLanguageCodes) {
    await app.sql.query(
      'INSERT INTO collection_target_languages (collection_id, language_code) VALUES ($1, $2)',
      [collectionId, languageCode]
    )
  }
  return collectionId
}

export async function createEntryRow (
  app: Awaited<ReturnType<typeof build>>,
  collectionId: string,
  wordOrPhrase: string
): Promise<string> {
  const rows = await app.sql.query(
    'INSERT INTO entries (collection_id, word_or_phrase, source_language_code) VALUES ($1, $2, $3) RETURNING id',
    [collectionId, wordOrPhrase, 'pl']
  ) as Array<{ id: string }>
  return rows[0].id
}

// The three helpers below exist because `entry_translations.sense_id` and
// `entry_sentences.translation_id` are NOT NULL from
// `add-entry-senses` onward: no test can hand-write those INSERTs any more
// without repeating the id wiring. Cleanup rides the `users` cascade, same as
// `createEntryRow`.

export async function createSenseRow (
  app: Awaited<ReturnType<typeof build>>,
  entryId: string,
  glossText: string
): Promise<string> {
  const rows = await app.sql.query(
    'INSERT INTO entry_senses (entry_id, gloss_text, sense_key) VALUES ($1, $2, $3) RETURNING id',
    [entryId, glossText, glossText.trim().toLowerCase()]
  ) as Array<{ id: string }>
  return rows[0].id
}

export async function createTranslationRow (
  app: Awaited<ReturnType<typeof build>>,
  entryId: string,
  senseId: string,
  languageCode: string,
  meaningText: string
): Promise<string> {
  const rows = await app.sql.query(
    'INSERT INTO entry_translations (entry_id, sense_id, language_code, meaning_text) VALUES ($1, $2, $3, $4) RETURNING id',
    [entryId, senseId, languageCode, meaningText]
  ) as Array<{ id: string }>
  return rows[0].id
}

// No `language_code` parameter, and `entry_sentences` no longer has a column
// for one (Phase 7 dropped it): a sentence's language is its translation's,
// via `translation_id`, so a fixture cannot produce the cross-wired sentence
// INV-12 exists to catch.
//
// `nativeGlossText` lost its `= null` default in Phase 4 without losing the
// null: the column is still nullable and `core-schema.test.ts` still proves it,
// but now that `GET` reconstructs through `Entry.capture` (decision A1) a null
// gloss is a `BlankTextError` and a fixture that picked one up by accident
// produces a 500 on read rather than the row it meant to set up. Passing it
// explicitly is the difference between choosing null and defaulting into it.
export async function createSentenceRow (
  app: Awaited<ReturnType<typeof build>>,
  entryId: string,
  translationId: string,
  sentenceText: string,
  nativeGlossText: string | null
): Promise<string> {
  const rows = await app.sql.query(
    'INSERT INTO entry_sentences (entry_id, translation_id, sentence_text, native_gloss_text) VALUES ($1, $2, $3, $4) RETURNING id',
    [entryId, translationId, sentenceText, nativeGlossText]
  ) as Array<{ id: string }>
  return rows[0].id
}
