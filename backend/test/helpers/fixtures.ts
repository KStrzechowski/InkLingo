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
