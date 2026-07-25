import { type FastifyPluginAsync } from 'fastify'
import { NeonDbError } from '@neondatabase/serverless'

const UNIQUE_VIOLATION = '23505'

interface CreateCollectionBody {
  name: string
}

interface CollectionParams {
  id: string
}

const collections: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.get('/', async (request) => {
    const rows = await fastify.sql`
      SELECT id, name, created_at
      FROM collections
      WHERE user_id = ${request.authUser.id}
      ORDER BY name ASC
    `

    return {
      collections: rows.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at
      }))
    }
  })

  fastify.post<{ Body: CreateCollectionBody }>('/', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 }
        }
      }
    }
  }, async (request, reply) => {
    const name = request.body.name.trim()
    if (name.length === 0) {
      return reply.badRequest('name must not be blank')
    }

    try {
      const [row] = await fastify.sql`
        INSERT INTO collections (user_id, name)
        VALUES (${request.authUser.id}, ${name})
        RETURNING id, name, created_at
      `
      return await reply.code(201).send({
        id: row.id,
        name: row.name,
        createdAt: row.created_at
      })
    } catch (err) {
      if (err instanceof NeonDbError && err.code === UNIQUE_VIOLATION) {
        return reply.conflict('a collection with this name already exists')
      }
      throw err
    }
  })

  fastify.get<{ Params: CollectionParams }>('/:id', {
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }
        }
      }
    }
  }, async (request, reply) => {
    const [collection] = await fastify.sql`
      SELECT id, name, created_at
      FROM collections
      WHERE id = ${request.params.id} AND user_id = ${request.authUser.id}
    `
    if (collection === undefined) {
      return reply.notFound()
    }

    const entries = await fastify.sql`
      SELECT id, word_or_phrase, source_language_code, created_at
      FROM entries
      WHERE collection_id = ${request.params.id}
      ORDER BY created_at DESC
    `
    const entryIds = entries.map((entry) => entry.id)

    const translations = await fastify.sql`
      SELECT id, entry_id, language_code, meaning_text
      FROM entry_translations
      WHERE entry_id = ANY(${entryIds})
    `
    const sentences = await fastify.sql`
      SELECT id, entry_id, language_code, sentence_text, created_at
      FROM entry_sentences
      WHERE entry_id = ANY(${entryIds})
    `

    return {
      id: collection.id,
      name: collection.name,
      createdAt: collection.created_at,
      entries: entries.map((entry) => ({
        id: entry.id,
        wordOrPhrase: entry.word_or_phrase,
        sourceLanguageCode: entry.source_language_code,
        createdAt: entry.created_at,
        translations: translations
          .filter((translation) => translation.entry_id === entry.id)
          .map((translation) => ({
            id: translation.id,
            languageCode: translation.language_code,
            meaningText: translation.meaning_text
          })),
        sentences: sentences
          .filter((sentence) => sentence.entry_id === entry.id)
          .map((sentence) => ({
            id: sentence.id,
            languageCode: sentence.language_code,
            sentenceText: sentence.sentence_text,
            createdAt: sentence.created_at
          }))
      }))
    }
  })
}

export default collections
