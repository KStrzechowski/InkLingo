import { randomUUID } from 'node:crypto'
import { type FastifyInstance } from 'fastify'
import { type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { NeonDbError } from '@neondatabase/serverless'
import { SUPPORTED_LANGUAGE_CODES } from '../../../languages.ts'
import { createCollectionBodySchema, collectionParamsSchema, translateBodySchema, createEntryBodySchema } from './schemas.ts'
import { generateTranslation } from '../../../ai/translate.ts'

const UNIQUE_VIOLATION = '23505'
const TRANSLATE_TIMEOUT_MS = 15_000
const TRANSLATE_RATE_LIMIT_MAX = 20

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
      SELECT id, entry_id, language_code, meaning_text, phonetic_transcription
      FROM entry_translations
      WHERE entry_id = ANY(${entryIds})
    `
    const sentences = await fastify.sql`
      SELECT id, entry_id, language_code, sentence_text, native_gloss_text, created_at
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
            meaningText: translation.meaning_text,
            phoneticTranscription: translation.phonetic_transcription
          })),
        sentences: sentences
          .filter((sentence) => sentence.entry_id === entry.id)
          .map((sentence) => ({
            id: sentence.id,
            languageCode: sentence.language_code,
            sentenceText: sentence.sentence_text,
            nativeGlossText: sentence.native_gloss_text,
            createdAt: sentence.created_at
          }))
      }))
    }
  })

  fastify.post('/:id/translate', {
    schema: {
      params: collectionParamsSchema,
      body: translateBodySchema
    },
    config: {
      rateLimit: {
        max: TRANSLATE_RATE_LIMIT_MAX,
        timeWindow: '1 minute',
        keyGenerator: (request) => request.authUser.id
      }
    }
  }, async (request, reply) => {
    const text = request.body.text.trim()
    if (text.length === 0) {
      return reply.badRequest('text must not be blank')
    }

    const [collection] = await fastify.sql`
      SELECT id, native_language_code
      FROM collections
      WHERE id = ${request.params.id} AND user_id = ${request.authUser.id}
    `
    if (collection === undefined) {
      return reply.notFound()
    }

    const targetLanguages = await targetLanguagesByCollectionId(fastify, [collection.id])
    const [targetLanguageCode] = targetLanguages.map((target) => target.language_code)

    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort() }, TRANSLATE_TIMEOUT_MS)
    try {
      return await generateTranslation(fastify.anthropicClient, {
        text,
        nativeLanguageCode: collection.native_language_code,
        targetLanguageCode,
        signal: controller.signal
      })
    } catch (err) {
      fastify.log.error({ err }, 'anthropic translate call failed')
      return reply.badGateway('could not generate a translation — try again')
    } finally {
      clearTimeout(timeout)
    }
  })

  fastify.post('/:id/entries', {
    schema: {
      params: collectionParamsSchema,
      body: createEntryBodySchema
    }
  }, async (request, reply) => {
    const wordOrPhrase = request.body.wordOrPhrase.trim()
    if (wordOrPhrase.length === 0) {
      return reply.badRequest('wordOrPhrase must not be blank')
    }

    const translations = request.body.translations.map((translation) => ({
      languageCode: translation.languageCode.trim().toLowerCase(),
      meaningText: translation.meaningText.trim(),
      phoneticTranscription: translation.phoneticTranscription?.trim() ?? ''
    }))
    const sentences = request.body.sentences.map((sentence) => ({
      languageCode: sentence.languageCode.trim().toLowerCase(),
      sentenceText: sentence.sentenceText.trim(),
      nativeGlossText: sentence.nativeGlossText.trim()
    }))
    if (
      translations.some((translation) => translation.meaningText.length === 0) ||
      sentences.some((sentence) => sentence.sentenceText.length === 0 || sentence.nativeGlossText.length === 0)
    ) {
      return reply.badRequest('translation and sentence texts must not be blank')
    }

    const [collection] = await fastify.sql`
      SELECT id, native_language_code
      FROM collections
      WHERE id = ${request.params.id} AND user_id = ${request.authUser.id}
    `
    if (collection === undefined) {
      return reply.notFound()
    }

    // A saved translation/sentence only makes sense in a language the
    // collection is actually configured to teach. Compared case-insensitively:
    // POST / lowercases on write, but rows created before that normalization
    // landed still hold codes like 'EN'.
    const targetLanguages = await targetLanguagesByCollectionId(fastify, [collection.id])
    const targetLanguageCodes = targetLanguages.map((target) => target.language_code.toLowerCase())
    if (
      translations.some((translation) => !targetLanguageCodes.includes(translation.languageCode)) ||
      sentences.some((sentence) => !targetLanguageCodes.includes(sentence.languageCode))
    ) {
      return reply.badRequest('language code is not one of the collection\'s target languages')
    }

    // The entry id is generated here rather than by the column default so
    // all three inserts can be built upfront and submitted as one
    // non-interactive transaction — the Neon HTTP driver can't feed a
    // RETURNING value from one statement into the next.
    const entryId = randomUUID()
    const [entryRows, ...rest] = await fastify.sql.transaction([
      // source_language_code is always the parent collection's native
      // language, never taken from the request body.
      fastify.sql`
        INSERT INTO entries (id, collection_id, word_or_phrase, source_language_code)
        VALUES (${entryId}, ${collection.id}, ${wordOrPhrase}, ${collection.native_language_code})
        RETURNING id, word_or_phrase, source_language_code, created_at
      `,
      ...translations.map((translation) => fastify.sql`
        INSERT INTO entry_translations (entry_id, language_code, meaning_text, phonetic_transcription)
        VALUES (${entryId}, ${translation.languageCode}, ${translation.meaningText}, ${translation.phoneticTranscription.length === 0 ? null : translation.phoneticTranscription})
        RETURNING id, language_code, meaning_text, phonetic_transcription
      `),
      ...sentences.map((sentence) => fastify.sql`
        INSERT INTO entry_sentences (entry_id, language_code, sentence_text, native_gloss_text)
        VALUES (${entryId}, ${sentence.languageCode}, ${sentence.sentenceText}, ${sentence.nativeGlossText})
        RETURNING id, language_code, sentence_text, native_gloss_text, created_at
      `)
    ])
    const [entry] = entryRows
    const translationRows = rest.slice(0, translations.length).map(([row]) => row)
    const sentenceRows = rest.slice(translations.length).map(([row]) => row)

    return await reply.code(201).send({
      id: entry.id,
      wordOrPhrase: entry.word_or_phrase,
      sourceLanguageCode: entry.source_language_code,
      createdAt: entry.created_at,
      translations: translationRows.map((row) => ({
        id: row.id,
        languageCode: row.language_code,
        meaningText: row.meaning_text,
        phoneticTranscription: row.phonetic_transcription
      })),
      sentences: sentenceRows.map((row) => ({
        id: row.id,
        languageCode: row.language_code,
        sentenceText: row.sentence_text,
        nativeGlossText: row.native_gloss_text,
        createdAt: row.created_at
      }))
    })
  })
}

export default collections
