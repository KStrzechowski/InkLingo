import { type FastifyInstance } from 'fastify'
import { type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { NeonDbError } from '@neondatabase/serverless'
import { SUPPORTED_LANGUAGE_CODES } from '../../../languages.ts'
import { createCollectionBodySchema, collectionParamsSchema } from './schemas.ts'

const UNIQUE_VIOLATION = '23505'

interface TargetLanguageRow {
  collection_id: string
  language_code: string
}

async function targetLanguagesByCollectionId (fastify: FastifyInstance, collectionIds: string[]): Promise<TargetLanguageRow[]> {
  return await fastify.sql`
    SELECT collection_id, language_code
    FROM collection_target_languages
    WHERE collection_id = ANY(${collectionIds})
  ` as TargetLanguageRow[]
}

const collections: FastifyPluginAsyncTypebox = async (fastify): Promise<void> => {
  fastify.get('/', async (request) => {
    const rows = await fastify.sql`
      SELECT id, name, native_language_code, created_at
      FROM collections
      WHERE user_id = ${request.authUser.id}
      ORDER BY name ASC
    `
    const collectionIds = rows.map((row) => row.id)
    const targetLanguages = await targetLanguagesByCollectionId(fastify, collectionIds)

    return {
      collections: rows.map((row) => ({
        id: row.id,
        name: row.name,
        nativeLanguageCode: row.native_language_code,
        targetLanguageCodes: targetLanguages
          .filter((target) => target.collection_id === row.id)
          .map((target) => target.language_code),
        createdAt: row.created_at
      }))
    }
  })

  fastify.post('/', {
    schema: {
      body: createCollectionBodySchema
    }
  }, async (request, reply) => {
    const name = request.body.name.trim()
    if (name.length === 0) {
      return reply.badRequest('name must not be blank')
    }
    const nativeLanguageCode = request.body.nativeLanguageCode.trim().toLowerCase()
    const targetLanguageCodes = request.body.targetLanguageCodes.map((code) => code.trim().toLowerCase())
    if (
      !SUPPORTED_LANGUAGE_CODES.includes(nativeLanguageCode) ||
      targetLanguageCodes.some((code) => !SUPPORTED_LANGUAGE_CODES.includes(code))
    ) {
      return reply.badRequest('unsupported language code')
    }

    try {
      const [row] = await fastify.sql`
        INSERT INTO collections (user_id, name, native_language_code)
        VALUES (${request.authUser.id}, ${name}, ${nativeLanguageCode})
        RETURNING id, name, native_language_code, created_at
      `
      for (const languageCode of targetLanguageCodes) {
        await fastify.sql`
          INSERT INTO collection_target_languages (collection_id, language_code)
          VALUES (${row.id}, ${languageCode})
        `
      }
      return await reply.code(201).send({
        id: row.id,
        name: row.name,
        nativeLanguageCode: row.native_language_code,
        targetLanguageCodes,
        createdAt: row.created_at
      })
    } catch (err) {
      if (err instanceof NeonDbError && err.code === UNIQUE_VIOLATION) {
        return reply.conflict('a collection with this name already exists')
      }
      throw err
    }
  })

  fastify.get('/:id', {
    schema: {
      params: collectionParamsSchema
    }
  }, async (request, reply) => {
    const [collection] = await fastify.sql`
      SELECT id, name, native_language_code, created_at
      FROM collections
      WHERE id = ${request.params.id} AND user_id = ${request.authUser.id}
    `
    if (collection === undefined) {
      return reply.notFound()
    }

    const targetLanguages = await targetLanguagesByCollectionId(fastify, [collection.id])

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
      nativeLanguageCode: collection.native_language_code,
      targetLanguageCodes: targetLanguages.map((target) => target.language_code),
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
