// Builders for the shapes the popup consumes. Same role as
// frontend/test/helpers/collections.ts and test/helpers/webext.ts — extend
// these rather than hand-rolling literals per test, so a change to
// src/types.ts surfaces in one place.
//
// The sparse-spoke shape is first-class on purpose: a meaning present in some
// but not all target languages is a legal backend response (src/types.ts) and
// is exactly what the popup's per-meaning gating exists to handle.

import type {
  Collection,
  SenseTranslation,
  TranslationResult,
  TranslationSense,
  TranslationSentence
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
// before saving — a translation with one is a special case, not the norm.
export function createSenseTranslation (
  languageCode: string,
  options: { meaningText?: string, sentences?: TranslationSentence[], sentenceCount?: number, phoneticTranscription?: string | null } = {}
): SenseTranslation {
  const count = options.sentenceCount ?? 2
  return {
    languageCode,
    meaningText: options.meaningText ?? `meaning-${languageCode}`,
    phoneticTranscription: options.phoneticTranscription ?? null,
    sentences: options.sentences ?? Array.from({ length: count }, () => createSentence())
  }
}

// `languageCodes` is the shorthand for the common case: a meaning with a word
// in every one of those languages. Tests exercising a sparse spoke pass
// `translations` explicitly with fewer languages than the collection targets.
export function createSense (
  glossText: string,
  options: { languageCodes?: string[], translations?: SenseTranslation[] } = {}
): TranslationSense {
  const codes = options.languageCodes ?? ['en']
  return {
    glossText,
    translations: options.translations ?? codes.map((code) => createSenseTranslation(code))
  }
}

export function createTranslationResult (
  options: { normalizedNativeText?: string, senses?: TranslationSense[], glossTexts?: string[], languageCodes?: string[] } = {}
): TranslationResult {
  const glosses = options.glossTexts ?? ['meaning one']
  const codes = options.languageCodes ?? ['en']
  return {
    normalizedNativeText: options.normalizedNativeText ?? 'znormalizowane słowo',
    senses: options.senses ?? glosses.map((glossText) => createSense(glossText, { languageCodes: codes }))
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
