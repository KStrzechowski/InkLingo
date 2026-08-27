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

// The saved entry, as both entry-shaped routes return it. Declared for the same
// reason as above and with the same hazard, which is sharper here: `POST
// /:id/entries` and `GET /:id` hand-built their payloads with **no** schema
// until this change, so nothing was stripped and nothing could be. Declaring
// one means a field missing from it now vanishes from the body silently rather
// than erroring — hence the full-body deep-equal assertion on both routes,
// which is the only shape of test that catches a stripped field.
//
// This replaces `addEntryTranslationResponseSchema`, which returned exactly one
// translation and one sentence. Under decision D-2 a backfill adds a word to
// *every* meaning the entry holds, so there is no longer a single one to name;
// decision A9 has it return the whole updated entry instead of a partial shape
// the client merges by hand.
//
// `sentences` carries no `languageCode`: it is the parent translation's, so a
// cross-wired sentence is unrepresentable on the wire exactly as it is in the
// domain. The old flat shape had to repeat it, which is what let the two drift.
export const entryResponseSchema = Type.Object({
  id: Type.String(),
  wordOrPhrase: Type.String(),
  sourceLanguageCode: Type.String(),
  createdAt: Type.String(),
  senses: Type.Array(Type.Object({
    id: Type.String(),
    glossText: Type.String(),
    translations: Type.Array(Type.Object({
      id: Type.String(),
      languageCode: Type.String(),
      meaningText: Type.String(),
      phoneticTranscription: Type.Union([Type.String(), Type.Null()]),
      sentences: Type.Array(Type.Object({
        id: Type.String(),
        sentenceText: Type.String(),
        nativeGlossText: Type.String()
      }))
    }))
  }))
})
export type EntryResponseBody = Static<typeof entryResponseSchema>

// `GET /api/collections/:id`. `targetLanguageCodes` is returned exactly as
// stored, not as `LanguageContract` normalizes it — collections created before
// `POST /api/collections` lowercased on write still hold codes like 'EN', and
// changing what a read reports is not this change's business.
export const collectionDetailResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  nativeLanguageCode: Type.String(),
  targetLanguageCodes: Type.Array(Type.String()),
  createdAt: Type.String(),
  entries: Type.Array(entryResponseSchema)
})
export type CollectionDetailResponseBody = Static<typeof collectionDetailResponseSchema>

// FR-018: backfill one already-saved entry with a language added to the
// collection after that entry was created. One language per call — this is
// the deliberate opposite of a bulk re-translate.
export const addEntryTranslationBodySchema = Type.Object({
  languageCode: Type.String({ minLength: 2, maxLength: 10 })
})
export type AddEntryTranslationBody = Static<typeof addEntryTranslationBodySchema>

// Meanings first, matching the shape the model now returns and the shape the
// database now records. `MAX_TARGET_LANGUAGES` bounds **a sense's**
// translations rather than the entry's arrays: an entry with three meanings in
// a five-language collection legitimately carries up to fifteen words.
//
// Note what is deliberately absent: `minItems`. The empty cases — an entry with
// no meanings, a meaning with no words, a word with no sentence — are exactly
// the rules `EmptyEntryError`, `SenseWithoutTranslationError` and
// `TranslationWithoutSentenceError` exist to name, and a schema rejecting them
// first would return the same 400 while making the aggregate's guards
// unreachable and untestable. The aggregate is the authority; the schema only
// bounds size and type.
//
// Blank-but-present text is the same story one level down: `minLength: 1`
// admits "   ", which `Entry.capture` rejects as a `BlankTextError` naming the
// field the client sent.
export const MAX_SENSES_PER_ENTRY = 10
export const MAX_SENTENCES_PER_TRANSLATION = 10

export const createEntryBodySchema = Type.Object({
  wordOrPhrase: Type.String({ minLength: 1, maxLength: 200 }),
  senses: Type.Array(
    Type.Object({
      glossText: Type.String({ minLength: 1, maxLength: 200 }),
      translations: Type.Array(
        Type.Object({
          languageCode: Type.String({ minLength: 2, maxLength: 10 }),
          meaningText: Type.String({ minLength: 1, maxLength: 500 }),
          phoneticTranscription: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
          sentences: Type.Array(
            Type.Object({
              sentenceText: Type.String({ minLength: 1, maxLength: 1000 }),
              nativeGlossText: Type.String({ minLength: 1, maxLength: 1000 })
            }),
            { maxItems: MAX_SENTENCES_PER_TRANSLATION }
          )
        }),
        { maxItems: MAX_TARGET_LANGUAGES }
      )
    }),
    { maxItems: MAX_SENSES_PER_ENTRY }
  )
})
export type CreateEntryBody = Static<typeof createEntryBodySchema>
