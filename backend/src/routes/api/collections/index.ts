import { randomUUID } from 'node:crypto'
import { type FastifyInstance, type FastifyBaseLogger } from 'fastify'
import { type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { NeonDbError } from '@neondatabase/serverless'
import { SUPPORTED_LANGUAGE_CODES } from '../../../languages.ts'
import {
  createCollectionBodySchema,
  collectionParamsSchema,
  entryParamsSchema,
  translateBodySchema,
  createEntryBodySchema,
  addEntryTranslationBodySchema,
  translateResponseSchema,
  addEntryTranslationResponseSchema
} from './schemas.ts'
import { RequestedLanguages, type TranslationDraft } from '../../../domain/translationDraft.ts'
import { fetchOwnedCollection, fetchOwnedEntry } from './ownership.ts'
// Type-only import, erased at runtime. Forces ts-node/esm to load
// fastify.d.ts's ambient FastifyInstance augmentation before checking this
// file (context/foundation/lessons.md — the trap this repo has now hit three
// times). This file got away without one until now only by luck of ordering:
// plugins/anthropic.ts carried the import and sorted *first* in
// @fastify/autoload's alphabetical order. Renaming it to plugins/translator.ts
// moved it to *last*, and this file started failing 9 of 127 tests
// non-deterministically depending on which test's import graph ran first.
import type { AuthUser as _AuthUser } from '../../../fastify.d.ts'

const UNIQUE_VIOLATION = '23505'
// One call now covers every target language, so it generates more than the
// single-language version did. Still comfortably under the 29s ceiling API
// Gateway imposes on the Lambda (infra/lib/constructs/api-construct.ts:75).
const TRANSLATE_TIMEOUT_MS = 20_000
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

function hasDuplicates (codes: string[]): boolean {
  return new Set(codes).size !== codes.length
}

// Wraps the translator call in the request timeout and turns any failure into
// null, so callers reply with a clean error instead of leaking an exception.
// Shared by the capture route and FR-018's per-entry backfill.
//
// The AbortController stays here rather than moving behind the port: 20s is an
// *application* deadline derived from API Gateway's 29s ceiling
// (infra/lib/constructs/api-construct.ts:75), not a provider setting. The
// adapter's own 15s per-request timeout sits below it.
//
// Takes the *request's* logger, not fastify.log. This is the line carrying the
// correlationId a user can quote, joining "a user says it broke" to the
// adapter's provider-level line; the 502 the caller returns carries only the
// generic "could not generate a translation". Logged through the root logger it
// had no reqId and no correlationId, so the id the user could quote pointed at
// the useless half of the pair and the informative half was unfindable.
//
// Both a provider failure and an all-empty draft arrive here as an exception,
// so both collapse to null and to the same 502. That is deliberate: a draft
// with nothing in it is not an answer.
async function draftWithTimeout (
  fastify: FastifyInstance,
  log: FastifyBaseLogger,
  correlationId: string,
  params: { text: string, languages: RequestedLanguages }
): Promise<TranslationDraft | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => { controller.abort() }, TRANSLATE_TIMEOUT_MS)
  try {
    return await fastify.translator.draft({ ...params, signal: controller.signal })
  } catch (err) {
    log.error({ err, requestId: correlationId }, 'translator draft failed')
    return null
  } finally {
    clearTimeout(timeout)
  }
}

const collections: FastifyPluginAsyncTypebox = async (fastify): Promise<void> => {
  const translateRateLimit = {
    rateLimit: {
      max: TRANSLATE_RATE_LIMIT_MAX,
      timeWindow: '1 minute',
      keyGenerator: (request: { authUser: { id: string } }) => request.authUser.id
    }
  }

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
    // Both guards only became reachable once a collection could hold more than
    // one target language. Without the first, the duplicate trips
    // UNIQUE(collection_id, language_code) and surfaces as the name-conflict
    // 409 below, which is a misleading thing to tell the caller.
    if (hasDuplicates(targetLanguageCodes)) {
      return reply.badRequest('targetLanguageCodes must not contain duplicates')
    }
    if (targetLanguageCodes.includes(nativeLanguageCode)) {
      return reply.badRequest('nativeLanguageCode must not also be a target language')
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
    const collection = await fetchOwnedCollection(fastify, request.params.id, request.authUser.id)
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
      body: translateBodySchema,
      // Fastify serializes against this rather than against whatever object
      // the handler returns — impossible while the body *was* the model's
      // tool-call object, cheap now that one function produces it.
      response: { 200: translateResponseSchema }
    },
    config: translateRateLimit
  }, async (request, reply) => {
    const text = request.body.text.trim()
    if (text.length === 0) {
      return reply.badRequest('text must not be blank')
    }

    const collection = await fetchOwnedCollection(fastify, request.params.id, request.authUser.id)
    if (collection === undefined) {
      return reply.notFound()
    }

    const targetLanguages = await targetLanguagesByCollectionId(fastify, [collection.id])
    const targetLanguageCodes = targetLanguages.map((target) => target.language_code.toLowerCase())

    // One call covers every target language: the response is all-or-nothing,
    // so a failure blanks the whole capture rather than one language's
    // section. Decided during Phase 5 implementation — see change.md.
    const draft = await draftWithTimeout(fastify, request.log, request.correlationId, {
      text,
      languages: RequestedLanguages.of(collection.native_language_code, targetLanguageCodes)
    })
    // The Anthropic adapter already raises DegenerateDraftError rather than
    // returning an all-empty draft, so this is belt-and-braces — but the port's
    // type cannot express "non-degenerate", and the guarantee should hold for
    // whatever implements it, not just for today's one. This is the deliberate
    // behavior change: an all-empty response used to be a 200 rendering five
    // "nothing came back" sections.
    if (draft === null || draft.isDegenerate()) {
      return reply.badGateway('could not generate a translation — try again')
    }

    // A partial answer is still worth showing, but it is worth counting too.
    // This used to be counted client-side, which only ever saw the popups that
    // stayed open long enough to report; here it covers every user.
    const degradedLanguageCodes = draft.degenerateLanguageCodes()
    if (degradedLanguageCodes.length > 0) {
      request.log.warn({
        requestId: request.correlationId,
        degradedLanguageCodes,
        languageCount: draft.languages.length
      }, 'translator returned no senses for some languages')
    }

    return draft.toWire()
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
    // At most one of each per language. Without this the duplicate hits
    // UNIQUE(entry_id, language_code) mid-transaction and surfaces as a 500.
    if (
      hasDuplicates(translations.map((translation) => translation.languageCode)) ||
      hasDuplicates(sentences.map((sentence) => sentence.languageCode))
    ) {
      return reply.badRequest('only one translation and one sentence per language')
    }

    const collection = await fetchOwnedCollection(fastify, request.params.id, request.authUser.id)
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
    // all the inserts can be built upfront and submitted as one
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

  // FR-018: backfill one already-saved entry with a language the collection
  // gained after that entry was created. Deliberately per-entry and
  // user-triggered — the PRD's Non-Goals rule out an automatic bulk pass.
  fastify.post('/:id/entries/:entryId/translations', {
    schema: {
      params: entryParamsSchema,
      body: addEntryTranslationBodySchema,
      response: { 201: addEntryTranslationResponseSchema }
    },
    config: translateRateLimit
  }, async (request, reply) => {
    const languageCode = request.body.languageCode.trim().toLowerCase()

    const collection = await fetchOwnedCollection(fastify, request.params.id, request.authUser.id)
    if (collection === undefined) {
      return reply.notFound()
    }

    const entry = await fetchOwnedEntry(fastify, request.params.entryId, collection.id)
    if (entry === undefined) {
      return reply.notFound()
    }

    const targetLanguages = await targetLanguagesByCollectionId(fastify, [collection.id])
    const targetLanguageCodes = targetLanguages.map((target) => target.language_code.toLowerCase())
    if (!targetLanguageCodes.includes(languageCode)) {
      return reply.badRequest('language code is not one of the collection\'s target languages')
    }

    const existing = await fastify.sql`
      SELECT id FROM entry_translations
      WHERE entry_id = ${entry.id} AND lower(language_code) = ${languageCode}
    `
    if (existing.length > 0) {
      return reply.conflict('this entry already has a translation in that language')
    }

    const draft = await draftWithTimeout(fastify, request.log, request.correlationId, {
      text: entry.word_or_phrase,
      languages: RequestedLanguages.of(collection.native_language_code, [languageCode])
    })
    // Unlike the capture flow there's no user picking a variant here, so take
    // the draft's first sense and its first sentence. The value object owns
    // that choice, and the trimming and blank-to-null this route used to do
    // inline against the model's object.
    const rendering = draft?.renderingFor(languageCode) ?? null
    if (rendering === null) {
      return reply.badGateway('could not generate a translation — try again')
    }

    const [translationRows, sentenceRows] = await fastify.sql.transaction([
      fastify.sql`
        INSERT INTO entry_translations (entry_id, language_code, meaning_text, phonetic_transcription)
        VALUES (${entry.id}, ${languageCode}, ${rendering.meaningText}, ${rendering.phoneticTranscription})
        RETURNING id, language_code, meaning_text, phonetic_transcription
      `,
      fastify.sql`
        INSERT INTO entry_sentences (entry_id, language_code, sentence_text, native_gloss_text)
        VALUES (${entry.id}, ${languageCode}, ${rendering.sentenceText}, ${rendering.nativeGlossText})
        RETURNING id, language_code, sentence_text, native_gloss_text, created_at
      `
    ])
    const [translationRow] = translationRows
    const [sentenceRow] = sentenceRows

    return await reply.code(201).send({
      entryId: entry.id,
      translation: {
        id: translationRow.id,
        languageCode: translationRow.language_code,
        meaningText: translationRow.meaning_text,
        phoneticTranscription: translationRow.phonetic_transcription
      },
      sentence: {
        id: sentenceRow.id,
        languageCode: sentenceRow.language_code,
        sentenceText: sentenceRow.sentence_text,
        nativeGlossText: sentenceRow.native_gloss_text,
        createdAt: sentenceRow.created_at
      }
    })
  })
}

export default collections
