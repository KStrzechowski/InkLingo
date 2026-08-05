import { type FastifyInstance } from 'fastify'

export interface OwnedCollectionRow {
  id: string
  name: string
  native_language_code: string
  created_at: string
}

export interface OwnedEntryRow {
  id: string
  word_or_phrase: string
}

// Single source of truth for "fetch this collection only if the requesting
// user owns it" — every ID-accepting route must go through this rather than
// writing its own ownership query. backend/test/route-ownership.test.ts
// statically enforces that every :id route calls this.
export async function fetchOwnedCollection (fastify: FastifyInstance, collectionId: string, userId: string): Promise<OwnedCollectionRow | undefined> {
  const [collection] = await fastify.sql`
    SELECT id, name, native_language_code, created_at
    FROM collections
    WHERE id = ${collectionId} AND user_id = ${userId}
  ` as OwnedCollectionRow[]
  return collection
}

// Entries have no user_id column — ownership flows only through
// entries.collection_id -> collections.user_id, so callers must first
// resolve the owned collection via fetchOwnedCollection and pass its id here.
export async function fetchOwnedEntry (fastify: FastifyInstance, entryId: string, collectionId: string): Promise<OwnedEntryRow | undefined> {
  const [entry] = await fastify.sql`
    SELECT id, word_or_phrase
    FROM entries
    WHERE id = ${entryId} AND collection_id = ${collectionId}
  ` as OwnedEntryRow[]
  return entry
}
