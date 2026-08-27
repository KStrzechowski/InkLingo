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
  entryResponseSchema,
  collectionDetailResponseSchema,
  type CreateEntryBody
} from './schemas.ts'
import {
  RequestedLanguages,
  type TranslationDraft,
  type DraftSenseTranslation
} from '../../../domain/translationDraft.ts'
import { Entry, type EntryDraft } from '../../../domain/entry.ts'
import { LanguageAlreadyPresentError, LanguageNotTaughtError } from '../../../domain/errors.ts'
import {
  appendLanguage,
  contractFor,
  insertEntry,
  loadContract,
  loadEntries,
  loadEntry
} from '../../../repositories/entryRepository.ts'
import { mapDomainError } from './mapDomainError.ts'
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

// D-2's per-meaning call, wrapped in the same deadline and the same
// failure-to-null collapse as `draftWithTimeout`. One of these runs per meaning
// the entry is missing this language for, and they run concurrently: three
// meanings sequentially at up to 20s each would blow API Gateway's 29s ceiling,
// while three in parallel cost one call's latency.
//
// A single meaning failing is not fatal — the caller keeps whatever came back
// and adds the language to those meanings only, leaving the rest as sparse
// spokes, which are legal. Only *all* of them failing is a 502.
async function senseTranslationWithTimeout (
  fastify: FastifyInstance,
  log: FastifyBaseLogger,
  correlationId: string,
  params: { text: string, glossText: string, languages: RequestedLanguages }
): Promise<DraftSenseTranslation | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => { controller.abort() }, TRANSLATE_TIMEOUT_MS)
  try {
    return await fastify.translator.translateSense({ ...params, signal: controller.signal })
  } catch (err) {
    log.error({ err, requestId: correlationId, glossText: params.glossText }, 'translator sense translation failed')
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// The wire body, renamed into the aggregate's vocabulary. The only rename is
// `sentenceText` → `targetText`: the wire inherited the column's name and the
// domain calls a sentence in the target language what it is. Nothing else here
// validates — every guard belongs to `Entry.capture`, which is the point.
function toDraft (body: CreateEntryBody): EntryDraft {
  return {
    wordOrPhrase: body.wordOrPhrase,
    senses: body.senses.map((sense) => ({
      glossText: sense.glossText,
      translations: sense.translations.map((translation) => ({
        languageCode: translation.languageCode,
        meaningText: translation.meaningText,
        phoneticTranscription: translation.phoneticTranscription,
        sentences: translation.sentences.map((sentence) => ({
          targetText: sentence.sentenceText,
          nativeGlossText: sentence.nativeGlossText
        }))
      }))
    }))
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
      params: collectionParamsSchema,
      // Newly declared, and a new hazard with it: this route hand-built its
      // payload with no schema until now, so nothing was stripped and nothing
      // could be. From here a field missing from the schema vanishes from the
      // body **silently**. `collections.test.ts` asserts the whole body with a
      // deep-equal, which is the only shape of test that catches that.
      response: { 200: collectionDetailResponseSchema }
    }
  }, async (request, reply) => {
    const collection = await fetchOwnedCollection(fastify, request.params.id, request.authUser.id)
    if (collection === undefined) {
      return reply.notFound()
    }

    const targetLanguages = await targetLanguagesByCollectionId(fastify, [collection.id])
    const targetLanguageCodes = targetLanguages.map((target) => target.language_code)

    // Decision A1: the read runs through the same strict `Entry.capture` path
    // as the write, so the nesting a client sees is the nesting the aggregate
    // vouches for rather than a second, looser projection of the same rows.
    const entries = await loadEntries(fastify.sql, contractFor(collection, targetLanguageCodes))

    return {
      id: collection.id,
      name: collection.name,
      nativeLanguageCode: collection.native_language_code,
      // As stored, not as the contract normalizes them: legacy rows hold codes
      // like 'EN', and what a read reports is not this change's business.
      targetLanguageCodes,
      createdAt: collection.created_at,
      entries: entries.map((entry) => entry.toResponse())
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
        senseCount: draft.senses.length,
        languageCount: targetLanguageCodes.length
      }, 'translator returned no translations for some languages')
    }

    return draft.toWire()
  })

  fastify.post('/:id/entries', {
    schema: {
      params: collectionParamsSchema,
      body: createEntryBodySchema,
      // See the note on GET /:id — newly declared, so newly able to strip.
      response: { 201: entryResponseSchema }
    }
  }, async (request, reply) => {
    const collection = await fetchOwnedCollection(fastify, request.params.id, request.authUser.id)
    if (collection === undefined) {
      return reply.notFound()
    }

    // Everything this handler used to do between here and the INSERTs — the
    // blank guards, the per-language duplicate guard, the membership check, the
    // id generation, the sentence-to-translation pairing — is now one call. The
    // route fetches ownership, loads the contract, and hands the body over.
    const contract = await loadContract(fastify.sql, collection)
    try {
      const entry = Entry.capture(contract, toDraft(request.body))
      await insertEntry(fastify.sql, entry)
      return await reply.code(201).send(entry.toResponse())
    } catch (err) {
      return mapDomainError(err, reply)
    }
  })

  // FR-018: backfill one already-saved entry with a language the collection
  // gained after that entry was created. Deliberately per-entry and
  // user-triggered — the PRD's Non-Goals rule out an automatic bulk pass.
  //
  // Under decision D-2 this adds the language to **every** meaning the entry
  // holds, one model call per meaning, which is what makes this path and the
  // capture path answer "how many meanings does an entry keep?" the same way.
  fastify.post('/:id/entries/:entryId/translations', {
    schema: {
      params: entryParamsSchema,
      body: addEntryTranslationBodySchema,
      // Decision A9: the whole updated entry, not a partial shape the client
      // merges by hand. With N meanings there is no single "the translation"
      // left to return.
      response: { 201: entryResponseSchema }
    },
    config: translateRateLimit
  }, async (request, reply) => {
    const languageCode = request.body.languageCode.trim().toLowerCase()

    const collection = await fetchOwnedCollection(fastify, request.params.id, request.authUser.id)
    if (collection === undefined) {
      return reply.notFound()
    }

    const owned = await fetchOwnedEntry(fastify, request.params.entryId, collection.id)
    if (owned === undefined) {
      return reply.notFound()
    }

    const contract = await loadContract(fastify.sql, collection)
    const entry = await loadEntry(fastify.sql, contract, owned.id)
    if (entry === undefined) {
      return reply.notFound()
    }

    let missing
    try {
      // `addLanguageToAllSenses` enforces both of these too, and is still the
      // authority — but it does so *after* the model calls. Asking the same two
      // questions here is what keeps a 400 or a 409 from costing a generation.
      if (!contract.teaches(languageCode)) {
        throw new LanguageNotTaughtError(languageCode)
      }
      missing = entry.sensesMissing(languageCode)
      if (missing.length === 0) {
        throw new LanguageAlreadyPresentError(languageCode)
      }
    } catch (err) {
      return mapDomainError(err, reply)
    }

    const languages = RequestedLanguages.of(collection.native_language_code, [languageCode])
    const drafted = await Promise.all(missing.map(async (sense) => ({
      sense,
      translation: await senseTranslationWithTimeout(fastify, request.log, request.correlationId, {
        text: entry.wordOrPhrase,
        glossText: sense.glossText,
        languages
      })
    })))

    const perSense = new Map(
      drafted
        .filter((result) => result.translation !== null)
        .map((result) => [result.sense.id, {
          meaningText: (result.translation as DraftSenseTranslation).meaningText,
          phoneticTranscription: (result.translation as DraftSenseTranslation).phoneticTranscription,
          sentences: (result.translation as DraftSenseTranslation).sentences.map((sentence) => ({
            targetText: sentence.targetText,
            nativeGlossText: sentence.nativeGlossText
          }))
        }])
    )
    // Some meanings failing leaves the rest as sparse spokes, which are legal.
    // All of them failing is not an answer.
    if (perSense.size === 0) {
      return reply.badGateway('could not generate a translation — try again')
    }

    try {
      entry.addLanguageToAllSenses(contract, languageCode, perSense)
      await appendLanguage(fastify.sql, entry, languageCode, new Set(perSense.keys()))
      return await reply.code(201).send(entry.toResponse())
    } catch (err) {
      return mapDomainError(err, reply)
    }
  })
}

export default collections
