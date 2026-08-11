// Builders for the shapes the popup consumes. Same role as
// frontend/test/helpers/collections.ts and test/helpers/webext.ts — extend
// these rather than hand-rolling literals per test, so a change to
// src/types.ts surfaces in one place.
//
// The degenerate shapes are first-class on purpose: a language the model
// returned nothing for (empty `variants`) and a variant with no sentences are
// both legal backend responses (src/types.ts:30-33) and are exactly what the
// popup's "Nothing came back" and save-gating logic exist to handle.

import type {
  Collection,
  TranslationLanguage,
  TranslationResult,
  TranslationSentence,
  TranslationVariant
} from '../../src/types.ts'

let sequence = 0

function nextId (prefix: string): string {
  sequence += 1
  return `${prefix}-${sequence}`
}

export function createSentence (overrides: Partial<TranslationSentence> = {}): TranslationSentence {
  const id = nextId('sentence')
  return {
    targetText: `target text ${id}`,
    nativeGlossText: `gloss ${id}`,
    ...overrides
  }
}

// `sentences` defaults to two, because picking a sentence is a required step
// before saving — a variant with one is a special case, not the norm.
export function createVariant (
  meaningText: string,
  options: { sentences?: TranslationSentence[], sentenceCount?: number, phoneticTranscription?: string | null } = {}
): TranslationVariant {
  const count = options.sentenceCount ?? 2
  return {
    meaningText,
    phoneticTranscription: options.phoneticTranscription ?? null,
    sentences: options.sentences ?? Array.from({ length: count }, () => createSentence())
  }
}

// `meanings: []` builds the "model returned nothing for this language" case.
export function createLanguage (
  languageCode: string,
  options: { meanings?: string[], variants?: TranslationVariant[] } = {}
): TranslationLanguage {
  const meanings = options.meanings ?? [`meaning one (${languageCode})`, `meaning two (${languageCode})`]
  return {
    languageCode,
    variants: options.variants ?? meanings.map((meaning) => createVariant(meaning))
  }
}

export function createTranslationResult (
  options: { normalizedNativeText?: string, languages?: TranslationLanguage[], languageCodes?: string[] } = {}
): TranslationResult {
  const codes = options.languageCodes ?? ['en']
  return {
    normalizedNativeText: options.normalizedNativeText ?? 'znormalizowane słowo',
    languages: options.languages ?? codes.map((code) => createLanguage(code))
  }
}

export function createCollection (overrides: Partial<Collection> = {}): Collection {
  const id = nextId('collection')
  return {
    id,
    name: `Collection ${id}`,
    nativeLanguageCode: 'pl',
    targetLanguageCodes: ['en'],
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides
  }
}
