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
// This shape was previously language-first, and the comment here explained
// that the wire key for a meaning stayed the provider's own because the
// extension is side-loaded and updated by hand (`extension/README.md`), so an
// older popup had to keep parsing it byte for byte. Decision A3 overrides that: no
// version-skew shims. The installed popup stops being able to render this
// response at the end of Phase 2 and works again at Phase 5, and in between
// this route is verified by tests and direct API calls only.
//
// Meanings are now the top level. A language absent from a meaning is a sparse
// spoke and is simply not listed — hence no `minItems` on `translations`.
export const translateResponseSchema = Type.Object({
  normalizedNativeText: Type.String(),
  senses: Type.Array(Type.Object({
    glossText: Type.String(),
    translations: Type.Array(Type.Object({
      languageCode: Type.String(),
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

// FR-018's backfill response. Declared for the same reason as above and with
// the same hazard: Fastify **strips** any property a response schema does not
// declare, so a field missing here vanishes from the body silently rather than
// erroring. Both routes are covered by a full-body deep-equal assertion, which
// is the only shape of test that catches a stripped field.
export const addEntryTranslationResponseSchema = Type.Object({
  entryId: Type.String(),
  translation: Type.Object({
    id: Type.String(),
    languageCode: Type.String(),
    meaningText: Type.String(),
    phoneticTranscription: Type.Union([Type.String(), Type.Null()])
  }),
  sentence: Type.Object({
    id: Type.String(),
    languageCode: Type.String(),
    sentenceText: Type.String(),
    nativeGlossText: Type.String(),
    createdAt: Type.String()
  })
})
export type AddEntryTranslationResponseBody = Static<typeof addEntryTranslationResponseSchema>

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
