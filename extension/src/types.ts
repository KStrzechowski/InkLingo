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

// One word for one meaning in one target language. Unlike the old
// language-first `TranslationVariant`, there is at most one of these per
// (sense, language) pair — the model no longer offers several candidate
// words to choose among within a language; it offers several *meanings*
// (senses), each with at most one word per language.
export interface SenseTranslation {
  languageCode: string
  meaningText: string
  phoneticTranscription: string | null
  sentences: TranslationSentence[]
}

// One distinct meaning of the captured word, named in the native language
// via `glossText`, holding one translation per target language that has a
// word for it. A language absent from `translations` is a legal sparse
// spoke — `suwak` simply has no single German word — not a degraded answer.
export interface TranslationSense {
  glossText: string
  translations: SenseTranslation[]
}

// Meanings are the top level now. Source of truth: `translateResponseSchema`
// in backend/src/routes/api/collections/schemas.ts, which Fastify serializes
// against. These declarations mirror a contract the backend produces — they
// used to mirror the Anthropic tool schema the model filled in, which is why
// a vendor's output shape was this product's wire contract.
//
// A response with no usable meaning at all no longer arrives here: it is a
// 502, handled by the popup's existing error path. An empty `senses` array
// is therefore not a shape this type needs to represent as legal — it simply
// never appears — but a sense whose `translations` omits one of the
// collection's target languages does, and is the sparse-spoke case above.
export interface TranslationResult {
  normalizedNativeText: string
  senses: TranslationSense[]
}

// One saved word/sentence pair under a sense. Named separately from
// `TranslationSentence` even though the fields match — that one is a draft's
// shape, this one is a persisted row with an id.
export interface SavedEntrySentence {
  id: string
  sentenceText: string
  nativeGlossText: string
}

export interface SavedEntryTranslation {
  id: string
  languageCode: string
  meaningText: string
  phoneticTranscription: string | null
  sentences: SavedEntrySentence[]
}

export interface SavedEntrySense {
  id: string
  glossText: string
  translations: SavedEntryTranslation[]
}

// Source of truth: `entryResponseSchema` in
// backend/src/routes/api/collections/schemas.ts, which both
// `POST /:id/entries` and `GET /:id` serialize against. `senses` was missing
// here until the response schema was checked against this file directly —
// nothing failed at runtime because nothing in this popup reads it yet, but a
// future caller trusting this type would have silently gotten `undefined`.
export interface SavedEntry {
  id: string
  wordOrPhrase: string
  sourceLanguageCode: string
  createdAt: string
  senses: SavedEntrySense[]
}
