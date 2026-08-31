// Builders for the collection shapes the print page and CollectionDetailPage
// consume. Same role as backend/test/helpers/fixtures.ts and
// test/helpers/oidc.ts — extend these rather than hand-rolling literals per
// test, so a change to the API types surfaces in one place.

import type {
  CollectionDetail,
  Entry,
  EntrySense,
  EntrySentence,
  EntryTranslation
} from '../../src/api/collections'

let sequence = 0

function nextId (prefix: string): string {
  sequence += 1
  return `${prefix}-${sequence}`
}

export function createSentence (overrides: Partial<EntrySentence> = {}): EntrySentence {
  return {
    id: nextId('sentence'),
    sentenceText: 'sentence text',
    nativeGlossText: 'gloss text',
    ...overrides
  }
}

// `sentences` defaults to one, since `Entry.capture` guarantees every
// translation carries at least one — there is no "translation with no
// sentence" shape left to build.
export function createTranslation (
  languageCode: string,
  overrides: Partial<Omit<EntryTranslation, 'sentences'>> & { sentences?: EntrySentence[] } = {}
): EntryTranslation {
  const { sentences, ...rest } = overrides
  return {
    id: nextId('translation'),
    languageCode,
    meaningText: `meaning-${languageCode}`,
    phoneticTranscription: null,
    sentences: sentences ?? [createSentence({ sentenceText: `sentence-${languageCode}`, nativeGlossText: `gloss-${languageCode}` })],
    ...rest
  }
}

// `languageCodes` is the shorthand for the common case: a meaning with a
// translation for each listed code. Tests exercising a sparse spoke pass
// `translations` explicitly with fewer languages than the collection targets.
export function createSense (
  glossText: string,
  options: { languageCodes?: string[], translations?: EntryTranslation[] } = {}
): EntrySense {
  const codes = options.languageCodes ?? []
  return {
    id: nextId('sense'),
    glossText,
    translations: options.translations ?? codes.map((code) => createTranslation(code))
  }
}

// `languages` is the shorthand for the common case: a single-meaning entry —
// the shape every entry had before this change, and still the common one —
// glossed as its own word_or_phrase, with a translation for each listed code.
// Tests exercising more than one meaning pass `senses` explicitly.
export function createEntry (
  wordOrPhrase: string,
  options: {
    languages?: string[]
    translations?: EntryTranslation[]
    senses?: EntrySense[]
    sourceLanguageCode?: string
  } = {}
): Entry {
  const languages = options.languages ?? []
  return {
    id: nextId('entry'),
    wordOrPhrase,
    sourceLanguageCode: options.sourceLanguageCode ?? 'pl',
    createdAt: '2026-08-01T00:00:00.000Z',
    senses: options.senses ?? [
      createSense(wordOrPhrase, { translations: options.translations ?? languages.map((code) => createTranslation(code)) })
    ]
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
