// Builders for the collection shapes the print page consumes. Same role as
// backend/test/helpers/fixtures.ts and test/helpers/oidc.ts — extend these
// rather than hand-rolling literals per test, so a change to the API types
// surfaces in one place.

import type {
  CollectionDetail,
  Entry,
  EntrySentence,
  EntryTranslation
} from '../../src/api/collections'

let sequence = 0

function nextId (prefix: string): string {
  sequence += 1
  return `${prefix}-${sequence}`
}

export function createTranslation (
  languageCode: string,
  overrides: Partial<EntryTranslation> = {}
): EntryTranslation {
  return {
    id: nextId('translation'),
    languageCode,
    meaningText: `meaning-${languageCode}`,
    phoneticTranscription: null,
    ...overrides
  }
}

export function createSentence (
  languageCode: string,
  overrides: Partial<EntrySentence> = {}
): EntrySentence {
  return {
    id: nextId('sentence'),
    languageCode,
    sentenceText: `sentence-${languageCode}`,
    nativeGlossText: `gloss-${languageCode}`,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides
  }
}

// `languages` is the shorthand for the common case: an entry that has both a
// translation and a sentence for each listed code. Tests that need a partial
// entry (translation but no sentence, or a backfill gap) pass `translations`
// and `sentences` explicitly instead.
export function createEntry (
  wordOrPhrase: string,
  options: {
    languages?: string[]
    translations?: EntryTranslation[]
    sentences?: EntrySentence[]
    sourceLanguageCode?: string
  } = {}
): Entry {
  const languages = options.languages ?? []
  return {
    id: nextId('entry'),
    wordOrPhrase,
    sourceLanguageCode: options.sourceLanguageCode ?? 'pl',
    createdAt: '2026-08-01T00:00:00.000Z',
    translations: options.translations ?? languages.map((code) => createTranslation(code)),
    sentences: options.sentences ?? languages.map((code) => createSentence(code))
  }
}

export function createCollection (
  overrides: Partial<CollectionDetail> = {}
): CollectionDetail {
  return {
    id: nextId('collection'),
    name: 'Test collection',
    nativeLanguageCode: 'pl',
    targetLanguageCodes: ['en'],
    createdAt: '2026-08-01T00:00:00.000Z',
    entries: [],
    ...overrides
  }
}
