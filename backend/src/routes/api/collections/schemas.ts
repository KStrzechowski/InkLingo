import { Type, type Static } from '@sinclair/typebox'

export const createCollectionBodySchema = Type.Object({
  name: Type.String({ minLength: 3, maxLength: 100 }),
  nativeLanguageCode: Type.String({ minLength: 2, maxLength: 10 }),
  targetLanguageCodes: Type.Array(
    Type.String({ minLength: 2, maxLength: 10 }),
    { minItems: 1, maxItems: 1 }
  )
})
export type CreateCollectionBody = Static<typeof createCollectionBodySchema>

export const collectionParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' })
})
export type CollectionParams = Static<typeof collectionParamsSchema>

export const translateBodySchema = Type.Object({
  text: Type.String({ minLength: 1 })
})
export type TranslateBody = Static<typeof translateBodySchema>

// maxItems is 1 while a collection has exactly one target language;
// Phase 5 relaxes both arrays alongside createCollectionBodySchema.
export const createEntryBodySchema = Type.Object({
  wordOrPhrase: Type.String({ minLength: 1, maxLength: 200 }),
  translations: Type.Array(
    Type.Object({
      languageCode: Type.String({ minLength: 2, maxLength: 10 }),
      meaningText: Type.String({ minLength: 1, maxLength: 500 }),
      phoneticTranscription: Type.Union([Type.String({ maxLength: 200 }), Type.Null()])
    }),
    { minItems: 1, maxItems: 1 }
  ),
  sentences: Type.Array(
    Type.Object({
      languageCode: Type.String({ minLength: 2, maxLength: 10 }),
      sentenceText: Type.String({ minLength: 1, maxLength: 1000 }),
      nativeGlossText: Type.String({ minLength: 1, maxLength: 1000 })
    }),
    { minItems: 1, maxItems: 1 }
  )
})
export type CreateEntryBody = Static<typeof createEntryBodySchema>
