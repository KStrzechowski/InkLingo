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
  name: string
): Promise<string> {
  const rows = await app.sql.query(
    'INSERT INTO collections (user_id, name) VALUES ($1, $2) RETURNING id',
    [userId, name]
  ) as Array<{ id: string }>
  return rows[0].id
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
