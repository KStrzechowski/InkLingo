import { describe, expect, it } from 'vitest'
import { buildBands, collatorFor, senseRowSpans } from '../../src/pages/printRows'
import { createCollection, createEntry, createSense, createSentence, createTranslation } from '../helpers/collections'

// The row model is the only real logic on the print page, and until now it was
// checked by eye against a printout (archive/2026-08-02-printable-export/plan.md,
// manual matrix cases 4-6). These assert the documented requirements, not the
// current output: one row per (sense x target language) the entry actually
// has, in the collection's language order, meanings in entry order, entries
// alphabetical by the native collator.

describe('buildBands — which rows exist', () => {
  it('emits one row per target language a meaning has', () => {
    const collection = createCollection({
      targetLanguageCodes: ['en', 'de'],
      entries: [createEntry('zamek', { languages: ['en', 'de'] })]
    })

    const [band] = buildBands(collection)

    expect(band.rows.map((row) => row.languageCode)).toEqual(['en', 'de'])
    expect(band.senseRowCounts).toEqual([2])
  })

  it('follows the collection language order, not the entry data order', () => {
    // The sheet's meaning column must read the same way down every band,
    // regardless of the order translations happen to come back in.
    const collection = createCollection({
      targetLanguageCodes: ['de', 'en'],
      entries: [createEntry('zamek', {
        translations: [createTranslation('en'), createTranslation('de')]
      })]
    })

    const [band] = buildBands(collection)

    expect(band.rows.map((row) => row.languageCode)).toEqual(['de', 'en'])
  })

  it('skips a language the meaning has no word for rather than printing a blank filler row', () => {
    // FR-018 backfill gap and a sparse spoke read the same way here: a
    // meaning with no translation in a language the collection targets.
    const collection = createCollection({
      targetLanguageCodes: ['en', 'de'],
      entries: [createEntry('zamek', { languages: ['en'] })]
    })

    const [band] = buildBands(collection)

    expect(band.rows.map((row) => row.languageCode)).toEqual(['en'])
  })

  it('renders a null phonetic transcription as null, not a string', () => {
    const collection = createCollection({
      targetLanguageCodes: ['en'],
      entries: [createEntry('zamek', { translations: [createTranslation('en', { meaningText: 'lock' })] })]
    })

    const [band] = buildBands(collection)

    expect(band.rows[0].meaningText).toBe('lock')
    expect(band.rows[0].phoneticTranscription).toBeNull()
  })
})

describe('buildBands — meanings', () => {
  it('emits one row-group per meaning, in entry order', () => {
    const collection = createCollection({
      targetLanguageCodes: ['en', 'de'],
      entries: [createEntry('zamek', {
        senses: [
          createSense('budowla obronna', { languageCodes: ['en', 'de'] }),
          createSense('zamknięcie drzwi', { languageCodes: ['en'] })
        ]
      })]
    })

    const [band] = buildBands(collection)

    expect(band.rows.map((row) => row.glossText)).toEqual([
      'budowla obronna', 'budowla obronna', 'zamknięcie drzwi'
    ])
    expect(band.senseRowCounts).toEqual([2, 1])
  })

  it('pairs each row with the word and sentence of its own meaning, not another one\'s', () => {
    const collection = createCollection({
      targetLanguageCodes: ['en'],
      entries: [createEntry('zamek', {
        senses: [
          createSense('budowla obronna', {
            translations: [createTranslation('en', { meaningText: 'castle', sentences: [createSentence({ sentenceText: 'The castle stands.' })] })]
          }),
          createSense('zamknięcie drzwi', {
            translations: [createTranslation('en', { meaningText: 'lock', sentences: [createSentence({ sentenceText: 'The lock is broken.' })] })]
          })
        ]
      })]
    })

    const [band] = buildBands(collection)

    expect(band.rows.map((row) => [row.glossText, row.meaningText, row.sentenceText])).toEqual([
      ['budowla obronna', 'castle', 'The castle stands.'],
      ['zamknięcie drzwi', 'lock', 'The lock is broken.']
    ])
  })

  it('still emits a band for an entry with no renderable meaning', () => {
    // The word must not vanish from the sheet just because none of its
    // languages survived — the page prints the word with an empty row.
    const collection = createCollection({
      targetLanguageCodes: ['en'],
      entries: [createEntry('zamek', { translations: [] })]
    })

    const bands = buildBands(collection)

    expect(bands).toHaveLength(1)
    expect(bands[0].entry.wordOrPhrase).toBe('zamek')
    expect(bands[0].rows).toEqual([])
  })
})

describe('buildBands — legacy uppercase language codes', () => {
  // Rows saved before write-time normalization hold codes like 'EN'. Matching
  // is case-insensitive in both directions so those rows still print.
  // See MEMORY / context/foundation: two dev collections carry 'PL' and 'EN'.
  it('matches an uppercase stored code against a lowercase collection code', () => {
    const collection = createCollection({
      targetLanguageCodes: ['en'],
      entries: [createEntry('zamek', { translations: [createTranslation('EN', { meaningText: 'lock' })] })]
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
    // The row carries the collection's code, which is what the Translation
    // column's language-code prefix resolves for display.
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

describe('senseRowSpans', () => {
  it('gives the opening row of each group its row count, and every other row null', () => {
    expect(senseRowSpans([2, 1, 3])).toEqual([2, null, 1, 3, null, null])
  })

  it('handles a single-row group as rowSpan 1, not omitted', () => {
    expect(senseRowSpans([1])).toEqual([1])
  })

  it('produces nothing for no groups', () => {
    expect(senseRowSpans([])).toEqual([])
  })

  it('drops a zero-row group instead of emitting a spurious entry', () => {
    expect(senseRowSpans([2, 0, 3])).toEqual([2, null, 3, null, null])
  })
})
