// Mirrors the backend's response shapes. Duplicated rather than shared:
// this repo has no shared-types package between its apps (see CLAUDE.md's
// Architecture section) — the same reason backend/src/languages.ts
// duplicates frontend/src/languages.ts.

export interface Collection {
  id: string
  name: string
  nativeLanguageCode: string
  targetLanguageCodes: string[]
  createdAt: string
}

export interface TranslationSentence {
  targetText: string
  nativeGlossText: string
}

export interface TranslationVariant {
  meaningText: string
  phoneticTranscription: string | null
  sentences: TranslationSentence[]
}

export interface TranslationLanguage {
  languageCode: string
  variants: TranslationVariant[]
}

// One entry per target language the collection teaches, in the order the
// backend requested them. A language the model skipped comes back with an
// empty `variants` array rather than being absent.
//
// Source of truth: `translateResponseSchema` in
// backend/src/routes/api/collections/schemas.ts, which Fastify serializes
// against. These declarations mirror a contract the backend produces — they
// used to mirror the Anthropic tool schema the model filled in, which is why
// a vendor's output shape was this product's wire contract.
//
// A response where *every* language came back empty no longer arrives here at
// all: it is a 502 as of the anti-corruption-layer change, handled by the
// popup's existing error path. An empty `variants` array now means only that
// this one language degraded while others succeeded.
export interface TranslationResult {
  normalizedNativeText: string
  languages: TranslationLanguage[]
}

export interface SavedEntry {
  id: string
  wordOrPhrase: string
  sourceLanguageCode: string
  createdAt: string
}
