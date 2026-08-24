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

// The translate response contract, declared once and owned by us. Before this
// existed the body *was* the model's tool-call object, redeclared by hand in
// `extension/src/types.ts:14-36` and checked by nothing at either end.
//
// Two consumers read from here and must not drift: Fastify serializes
// `POST /:id/translate` against it, and `TranslationDraft.toWire()` is typed by
// it, so a field the domain stops emitting becomes a compile error rather than
// a property Fastify silently strips.
//
// The wire key is `variants`, not the domain's `senses`. The extension is
// side-loaded and updated by hand (`extension/README.md`), so an older popup
// must keep parsing this shape byte for byte; the rename belongs to `toWire()`
// on the day the clients are ready for it.
export const translateResponseSchema = Type.Object({
  normalizedNativeText: Type.String(),
  languages: Type.Array(Type.Object({
    languageCode: Type.String(),
    variants: Type.Array(Type.Object({
      meaningText: Type.String(),
      phoneticTranscription: Type.Union([Type.String(), Type.Null()]),
      sentences: Type.Array(Type.Object({
        targetText: Type.String(),
        nativeGlossText: Type.String()
      }))
    }))
  }))
})
export type TranslateResponseBody = Static<typeof translateResponseSchema>

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
