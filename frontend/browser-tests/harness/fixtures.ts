// Deterministic collections for the browser tests to render.
//
// Committed rather than read from the dev database: the dev DB is shared
// mutable state and needs a running backend, so a test built on it could not
// run in CI and would not fail for the same reason twice. The hand-made
// "Print test 5 languages" collection stays a manual convenience.

import type { CollectionDetail, Entry } from '../../src/api/collections'

let sequence = 0

function entry (
  wordOrPhrase: string,
  sourceLanguageCode: string,
  perLanguage: Record<string, { meaning: string, ipa?: string, sentence: string, gloss: string }>
): Entry {
  sequence += 1
  const codes = Object.keys(perLanguage)
  return {
    id: `entry-${sequence}`,
    wordOrPhrase,
    sourceLanguageCode,
    createdAt: '2026-08-01T00:00:00.000Z',
    translations: codes.map((code, index) => ({
      id: `translation-${sequence}-${index}`,
      languageCode: code,
      meaningText: perLanguage[code].meaning,
      phoneticTranscription: perLanguage[code].ipa ?? null
    })),
    sentences: codes.map((code, index) => ({
      id: `sentence-${sequence}-${index}`,
      languageCode: code,
      sentenceText: perLanguage[code].sentence,
      nativeGlossText: perLanguage[code].gloss,
      createdAt: '2026-08-01T00:00:00.000Z'
    }))
  }
}

// Enough entries x languages to span several sheets, which is what the
// pagination assertions need. Words are ordinary length; the overflow cases
// live in their own fixtures below.
const FIVE_LANGUAGE_WORDS = [
  'dom', 'kot', 'woda', 'chleb', 'okno', 'droga', 'ryba', 'ptak',
  'las', 'rzeka', 'stół', 'krzesło', 'książka', 'ulica', 'miasto',
  'serce', 'ręka', 'noga', 'głowa', 'oko'
]

const FIVE_LANGUAGES = ['en', 'de', 'fr', 'es', 'it']

// Deliberately modest. An earlier version used ~140-character sentences, which
// made each 5-language band ~853px against ~956px of page capacity — one entry
// per sheet, and on a runner whose `system-ui` resolves to a different font
// (CI is Linux; this sheet was designed against Segoe UI) the bands grew past a
// whole page, so every sheet spilled onto a second PDF page. Bands need to sit
// comfortably under a page in any font for the pagination assertions to be
// about the packer rather than about font metrics.
function exampleSentence (code: string, word: string): string {
  return `A short ${code} sentence about ${word}.`
}

export const fixtures: Record<string, CollectionDetail> = {
  // The workhorse: Polish-native, five targets, 20 entries — 100 rows, which
  // paginates to several sheets.
  'five-languages': {
    id: 'fixture-five-languages',
    name: 'Print test — five languages',
    nativeLanguageCode: 'pl',
    targetLanguageCodes: FIVE_LANGUAGES,
    createdAt: '2026-08-01T00:00:00.000Z',
    entries: FIVE_LANGUAGE_WORDS.map((word) => entry(
      word,
      'pl',
      Object.fromEntries(FIVE_LANGUAGES.map((code) => [code, {
        meaning: `${word}-${code}`,
        sentence: exampleSentence(code, word),
        gloss: `Polskie zdanie o ${word}.`
      }]))
    ))
  },

  // The other end of the range from five-languages: one target, so every band
  // is a single row and the word cell's rowSpan is 1. Baseline readability
  // case 1 of the archived manual matrix.
  'one-language': {
    id: 'fixture-one-language',
    name: 'Print test — one language',
    nativeLanguageCode: 'pl',
    targetLanguageCodes: ['en'],
    createdAt: '2026-08-01T00:00:00.000Z',
    entries: FIVE_LANGUAGE_WORDS.slice(0, 6).map((word) => entry(word, 'pl', {
      en: {
        meaning: `${word}-en`,
        sentence: exampleSentence('en', word),
        gloss: `Polskie zdanie z wyrazem ${word}.`
      }
    }))
  },

  // A single band tall enough to exercise the "band taller than a page" path,
  // plus the long-word hyphenation case the dev data cannot reach (longest
  // real word_or_phrase is 8 characters, measured 2026-08-03).
  'long-words': {
    id: 'fixture-long-words',
    name: 'Print test — long words',
    nativeLanguageCode: 'pl',
    targetLanguageCodes: ['de', 'ru'],
    createdAt: '2026-08-01T00:00:00.000Z',
    entries: [
      entry('niepodległość', 'pl', {
        de: {
          meaning: 'Geschwindigkeitsbegrenzung',
          ipa: '/ɡəˈʃvɪndɪçkaɪtsbəˌɡʁɛntsʊŋ/',
          sentence: 'Die Geschwindigkeitsbegrenzung gilt auch für Fahrzeuge mit Anhänger.',
          gloss: 'Ograniczenie prędkości dotyczy także pojazdów z przyczepą.'
        },
        ru: {
          meaning: 'достопримечательность',
          ipa: '[dəstəprʲimʲɪˈtɕatʲɪlʲnəsʲtʲ]',
          sentence: 'Эта достопримечательность привлекает туристов круглый год.',
          gloss: 'Ta atrakcja przyciąga turystów przez cały rok.'
        }
      }),
      // The measured regression case: meaning and IPA together overflow the
      // column while neither does alone.
      entry('niezależność', 'pl', {
        de: {
          meaning: 'independence',
          ipa: '/ˌɪndɪˈpendəns/',
          sentence: 'Die Unabhängigkeit wurde nach langen Verhandlungen erklärt.',
          gloss: 'Niepodległość ogłoszono po długich negocjacjach.'
        },
        ru: {
          meaning: 'независимость',
          ipa: '[nʲɪzɐˈvʲisʲɪməsʲtʲ]',
          sentence: 'Независимость была объявлена после долгих переговоров.',
          gloss: 'Niepodległość ogłoszono po długich negocjacjach.'
        }
      })
    ]
  },

  // An entry saved before the collection gained a language, plus the legacy
  // uppercase codes two dev collections still carry.
  'backfill-gap': {
    id: 'fixture-backfill-gap',
    name: 'Print test — backfill gap',
    nativeLanguageCode: 'PL',
    targetLanguageCodes: ['en', 'de'],
    createdAt: '2026-08-01T00:00:00.000Z',
    entries: [
      entry('zamek', 'pl', {
        EN: { meaning: 'lock', ipa: '/lɒk/', sentence: 'The lock is old.', gloss: 'Zamek jest stary.' }
      }),
      entry('woda', 'pl', {
        en: { meaning: 'water', sentence: 'The water is cold.', gloss: 'Woda jest zimna.' },
        de: { meaning: 'Wasser', sentence: 'Das Wasser ist kalt.', gloss: 'Woda jest zimna.' }
      })
    ]
  },

  empty: {
    id: 'fixture-empty',
    name: 'Print test — empty',
    nativeLanguageCode: 'pl',
    targetLanguageCodes: ['en'],
    createdAt: '2026-08-01T00:00:00.000Z',
    entries: []
  }
}

export const FIXTURE_NAMES = Object.keys(fixtures)

// Built rather than hand-written: the Language column must fit every one of the
// 8 x 8 native x target language names, and hand-maintaining 64 rows across 8
// fixtures is exactly the table printLabels avoids by using Intl.DisplayNames.
// One entry carrying every supported target puts all 8 names in the column at
// once for a given native language.
export function allLanguagesFixture (nativeLanguageCode: string, targetCodes: string[]): CollectionDetail {
  return {
    id: `fixture-all-languages-${nativeLanguageCode}`,
    name: `Language column — ${nativeLanguageCode}`,
    nativeLanguageCode,
    targetLanguageCodes: targetCodes,
    createdAt: '2026-08-01T00:00:00.000Z',
    entries: [
      entry('test', nativeLanguageCode, Object.fromEntries(targetCodes.map((code) => [code, {
        meaning: `meaning-${code}`,
        sentence: `Sentence in ${code}.`,
        gloss: 'Gloss.'
      }])))
    ]
  }
}
