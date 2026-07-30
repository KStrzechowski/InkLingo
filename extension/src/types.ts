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

export interface TranslationResult {
  normalizedNativeText: string
  variants: TranslationVariant[]
}

export interface SavedEntry {
  id: string
  wordOrPhrase: string
  sourceLanguageCode: string
  createdAt: string
}
