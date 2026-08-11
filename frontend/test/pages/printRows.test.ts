import { describe, expect, it } from 'vitest'
import { buildBands, collatorFor } from '../../src/pages/printRows'
import { createCollection, createEntry, createSentence, createTranslation } from '../helpers/collections'

// The row model is the only real logic on the print page, and until now it was
// checked by eye against a printout (archive/2026-08-02-printable-export/plan.md,
// manual matrix cases 4-6). These assert the documented requirements, not the
// current output: one row per (entry x target language) the entry actually has,
// in the collection's language order, entries alphabetical by the native
// collator.

describe('buildBands — which rows exist', () => {
  it('emits one row per target language the entry has', () => {
    const collection = createCollection({
      targetLanguageCodes: ['en', 'de'],
      entries: [createEntry('zamek', { languages: ['en', 'de'] })]
    })

    const [band] = buildBands(collection)

    expect(band.rows.map((row) => row.languageCode)).toEqual(['en', 'de'])
  })

  it('follows the collection language order, not the entry data order', () => {
    // The sheet's Language column must read the same way down every band,
    // regardless of the order translations happen to come back in.
    const collection = createCollection({
      targetLanguageCodes: ['de', 'en'],
      entries: [createEntry('zamek', {
        translations: [createTranslation('en'), createTranslation('de')],
        sentences: [createSentence('en'), createSentence('de')]
      })]
    })

    const [band] = buildBands(collection)

    expect(band.rows.map((row) => row.languageCode)).toEqual(['de', 'en'])
  })

  it('skips a language the entry predates rather than printing a blank filler row', () => {
    // FR-018 backfill gap: an entry saved before the collection gained German.
    const collection = createCollection({
      targetLanguageCodes: ['en', 'de'],
      entries: [createEntry('zamek', { languages: ['en'] })]
    })

    const [band] = buildBands(collection)

    expect(band.rows.map((row) => row.languageCode)).toEqual(['en'])
  })

  it('keeps a language that has a translation but no sentence', () => {
    const collection = createCollection({
      targetLanguageCodes: ['en'],
      entries: [createEntry('zamek', {
        translations: [createTranslation('en', { meaningText: 'lock' })],
        sentences: []
      })]
    })

    const [band] = buildBands(collection)

    expect(band.rows).toHaveLength(1)
    expect(band.rows[0].meaningText).toBe('lock')
    expect(band.rows[0].sentenceText).toBe('')
    expect(band.rows[0].nativeGlossText).toBe('')
  })

  it('keeps a language that has a sentence but no translation', () => {
    const collection = createCollection({
      targetLanguageCodes: ['en'],
      entries: [createEntry('zamek', {
        translations: [],
        sentences: [createSentence('en', { sentenceText: 'The lock is old.' })]
      })]
    })

    const [band] = buildBands(collection)

    expect(band.rows).toHaveLength(1)
    expect(band.rows[0].sentenceText).toBe('The lock is old.')
    expect(band.rows[0].meaningText).toBe('')
    expect(band.rows[0].phoneticTranscription).toBeNull()
  })

  it('still emits a band for an entry with no renderable language', () => {
    // The word must not vanish from the sheet just because none of its
    // languages survived — the page prints the word with an empty row.
    const collection = createCollection({
      targetLanguageCodes: ['en'],
      entries: [createEntry('zamek', { translations: [], sentences: [] })]
    })

    const bands = buildBands(collection)

    expect(bands).toHaveLength(1)
    expect(bands[0].entry.wordOrPhrase).toBe('zamek')
    expect(bands[0].rows).toEqual([])
  })

  it('renders a null native gloss as an empty cell rather than "null"', () => {
    const collection = createCollection({
      targetLanguageCodes: ['en'],
      entries: [createEntry('zamek', {
        translations: [createTranslation('en')],
        sentences: [createSentence('en', { nativeGlossText: null })]
      })]
    })

    const [band] = buildBands(collection)

    expect(band.rows[0].nativeGlossText).toBe('')
  })
})

describe('buildBands — legacy uppercase language codes', () => {
  // Rows saved before write-time normalization hold codes like 'EN'. Matching
  // is case-insensitive in both directions so those rows still print.
  // See MEMORY / context/foundation: two dev collections carry 'PL' and 'EN'.
  it('matches an uppercase stored code against a lowercase collection code', () => {
    const collection = createCollection({
      targetLanguageCodes: ['en'],
      entries: [createEntry('zamek', {
        translations: [createTranslation('EN', { meaningText: 'lock' })],
        sentences: [createSentence('EN')]
      })]
    })

    const [band] = buildBands(collection)

    expect(band.rows).toHaveLength(1)
    expect(band.rows[0].meaningText).toBe('lock')
  })

  it('matches a lowercase stored code against an uppercase collection code', () => {
    const collection = createCollection({
      targetLanguageCodes: ['EN'],
      entries: [createEntry('zamek', { languages: ['en'] })]
    })

    const [band] = buildBands(collection)

    expect(band.rows).toHaveLength(1)
    // The row carries the collection's code, which is what the Language column
    // resolves for display.
    expect(band.rows[0].languageCode).toBe('EN')
  })
})

describe('buildBands — entry ordering', () => {
  it('sorts entries alphabetically rather than by insertion order', () => {
    const collection = createCollection({
      targetLanguageCodes: ['en'],
      entries: [
        createEntry('zebra', { languages: ['en'] }),
        createEntry('antylopa', { languages: ['en'] }),
        createEntry('mysz', { languages: ['en'] })
      ]
    })

    const words = buildBands(collection).map((band) => band.entry.wordOrPhrase)

    expect(words).toEqual(['antylopa', 'mysz', 'zebra'])
  })

  it('places a diacritic in its alphabetical position, not after z', () => {
    // A naive codepoint sort puts 'ą' (U+0105) after every ASCII letter. The
    // collator is what keeps it between 'a' and 'b' on a Polish sheet.
    const collection = createCollection({
      nativeLanguageCode: 'pl',
      targetLanguageCodes: ['en'],
      entries: [
        createEntry('bok', { languages: ['en'] }),
        createEntry('ąkra', { languages: ['en'] }),
        createEntry('agrafka', { languages: ['en'] })
      ]
    })

    const words = buildBands(collection).map((band) => band.entry.wordOrPhrase)

    expect(words).toEqual(['agrafka', 'ąkra', 'bok'])
  })

  it('sorts Cyrillic words for a Russian-native collection', () => {
    const collection = createCollection({
      nativeLanguageCode: 'ru',
      targetLanguageCodes: ['en'],
      entries: [
        createEntry('яблоко', { languages: ['en'] }),
        createEntry('банан', { languages: ['en'] }),
        createEntry('арбуз', { languages: ['en'] })
      ]
    })

    const words = buildBands(collection).map((band) => band.entry.wordOrPhrase)

    expect(words).toEqual(['арбуз', 'банан', 'яблоко'])
  })

  it('does not crash the page when the native code is malformed', () => {
    // nativeLanguageCode is user-influenced; a malformed BCP-47 primary subtag
    // makes `new Intl.Collator(code)` throw. Sort order is not worth a
    // whole-page crash, so it falls back to the default collator.
    const collection = createCollection({
      nativeLanguageCode: 'not a tag!!',
      targetLanguageCodes: ['en'],
      entries: [
        createEntry('zebra', { languages: ['en'] }),
        createEntry('antylopa', { languages: ['en'] })
      ]
    })

    const words = buildBands(collection).map((band) => band.entry.wordOrPhrase)

    expect(words).toEqual(['antylopa', 'zebra'])
  })
})

describe('collatorFor', () => {
  it('returns a usable collator for a malformed tag instead of throwing', () => {
    // Guards the assumption the fallback rests on: that the malformed input
    // really does throw, so the try/catch is load-bearing rather than dead code.
    expect(() => new Intl.Collator('not a tag!!')).toThrow(RangeError)
    expect(collatorFor('not a tag!!').compare('a', 'b')).toBeLessThan(0)
  })
})
