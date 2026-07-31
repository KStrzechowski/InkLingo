import { Type, type Static } from '@sinclair/typebox'

// A collection teaches up to MAX_TARGET_LANGUAGES languages at once. The
// junction table has always supported this; Phase 5 relaxes the validation
// that pinned it to exactly one.
export const MAX_TARGET_LANGUAGES = 5

export const createCollectionBodySchema = Type.Object({
  name: Type.String({ minLength: 3, maxLength: 100 }),
  nativeLanguageCode: Type.String({ minLength: 2, maxLength: 10 }),
  targetLanguageCodes: Type.Array(
    Type.String({ minLength: 2, maxLength: 10 }),
    { minItems: 1, maxItems: MAX_TARGET_LANGUAGES }
  )
})
export type CreateCollectionBody = Static<typeof createCollectionBodySchema>

export const collectionParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' })
})
export type CollectionParams = Static<typeof collectionParamsSchema>

export const entryParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  entryId: Type.String({ format: 'uuid' })
})
export type EntryParams = Static<typeof entryParamsSchema>

export const translateBodySchema = Type.Object({
  text: Type.String({ minLength: 1 })
})
export type TranslateBody = Static<typeof translateBodySchema>

// FR-018: backfill one already-saved entry with a language added to the
// collection after that entry was created. One language per call — this is
// the deliberate opposite of a bulk re-translate.
export const addEntryTranslationBodySchema = Type.Object({
  languageCode: Type.String({ minLength: 2, maxLength: 10 })
})
export type AddEntryTranslationBody = Static<typeof addEntryTranslationBodySchema>

// One translation + one sentence per target language, so both arrays share
// the collection's ceiling.
export const createEntryBodySchema = Type.Object({
  wordOrPhrase: Type.String({ minLength: 1, maxLength: 200 }),
  translations: Type.Array(
    Type.Object({
      languageCode: Type.String({ minLength: 2, maxLength: 10 }),
      meaningText: Type.String({ minLength: 1, maxLength: 500 }),
      phoneticTranscription: Type.Union([Type.String({ maxLength: 200 }), Type.Null()])
    }),
    { minItems: 1, maxItems: MAX_TARGET_LANGUAGES }
  ),
  sentences: Type.Array(
    Type.Object({
      languageCode: Type.String({ minLength: 2, maxLength: 10 }),
      sentenceText: Type.String({ minLength: 1, maxLength: 1000 }),
      nativeGlossText: Type.String({ minLength: 1, maxLength: 1000 })
    }),
    { minItems: 1, maxItems: MAX_TARGET_LANGUAGES }
  )
})
export type CreateEntryBody = Static<typeof createEntryBodySchema>
