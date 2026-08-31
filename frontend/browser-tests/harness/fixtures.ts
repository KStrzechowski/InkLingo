// Deterministic collections for the browser tests to render.
//
// Committed rather than read from the dev database: the dev DB is shared
// mutable state and needs a running backend, so a test built on it could not
// run in CI and would not fail for the same reason twice. The hand-made
// "Print test 5 languages" collection stays a manual convenience.

import type { CollectionDetail, Entry } from '../../src/api/collections'

let sequence = 0

// A single-meaning entry — the shape every fixture here needs except
// `multi-meaning` below, which builds its own senses by hand. The gloss
// defaults to the word itself, matching what the Phase 3 migration backfilled
// for every legacy single-meaning row.
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
    senses: [{
      id: `sense-${sequence}`,
      glossText: wordOrPhrase,
      translations: codes.map((code, index) => ({
        id: `translation-${sequence}-${index}`,
        languageCode: code,
        meaningText: perLanguage[code].meaning,
        phoneticTranscription: perLanguage[code].ipa ?? null,
        sentences: [{
          id: `sentence-${sequence}-${index}`,
          sentenceText: perLanguage[code].sentence,
          nativeGlossText: perLanguage[code].gloss
        }]
      }))
    }]
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
      }),
      // A compound transcription: two pronunciation variants for one meaning
      // with no single Russian equivalent, joined by "; ". Reported live
      // 2026-08-29 — this whole string is wider than the column even alone,
      // so dropping it to its own line (the 'independence' fix above) does
      // not help; it must be allowed to wrap between the two variants.
      entry('śledzić', 'pl', {
        de: {
          meaning: 'verfolgen',
          ipa: '/fɛɐ̯ˈfɔlɡn̩/',
          sentence: 'Die Polizei verfolgt den Verdächtigen.',
          gloss: 'Policja śledzi podejrzanego.'
        },
        // Meaning stays a single short word on purpose — the reported bug was
        // specifically that the transcription overflowed while the
        // translation itself rendered fine.
        ru: {
          meaning: 'следить',
          ipa: "/ɐt'sledʒɪvət'; 'sledʲɪt'/",
          sentence: 'Полиция следила за движениями подозреваемого.',
          gloss: 'Policja śledziła ruchy podejrzanego.'
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
  },

  // D-1's own subject: a word with several meanings, so the nested rowSpan
  // (word spans the whole band, each gloss spans only its own rows) has
  // something real to exercise. None of the other fixtures can — every
  // `entry()` above builds exactly one meaning, gloss defaulting to the word
  // itself, so a band's inner grouping is always trivially one row.
  'multi-meaning': {
    id: 'fixture-multi-meaning',
    name: 'Print test — multiple meanings',
    nativeLanguageCode: 'pl',
    targetLanguageCodes: ['en', 'de'],
    createdAt: '2026-08-01T00:00:00.000Z',
    entries: [
      {
        id: 'entry-zamek',
        wordOrPhrase: 'zamek',
        sourceLanguageCode: 'pl',
        createdAt: '2026-08-01T00:00:00.000Z',
        senses: [
          {
            id: 'sense-zamek-castle',
            glossText: 'budowla obronna',
            translations: [
              {
                id: 'translation-zamek-castle-en',
                languageCode: 'en',
                meaningText: 'castle',
                phoneticTranscription: '/ˈkɑːsəl/',
                sentences: [{ id: 'sentence-zamek-castle-en', sentenceText: 'The castle stood on a hill.', nativeGlossText: 'Zamek stał na wzgórzu.' }]
              },
              {
                id: 'translation-zamek-castle-de',
                languageCode: 'de',
                meaningText: 'Schloss',
                phoneticTranscription: '/ʃlɔs/',
                sentences: [{ id: 'sentence-zamek-castle-de', sentenceText: 'Das Schloss ist alt.', nativeGlossText: 'Zamek jest stary.' }]
              }
            ]
          },
          {
            id: 'sense-zamek-lock',
            glossText: 'zamknięcie drzwi',
            translations: [
              {
                id: 'translation-zamek-lock-en',
                languageCode: 'en',
                meaningText: 'lock',
                phoneticTranscription: '/lɒk/',
                sentences: [{ id: 'sentence-zamek-lock-en', sentenceText: 'The lock is broken.', nativeGlossText: 'Zamek jest zepsuty.' }]
              }
            ]
          }
        ]
      },
      entry('kot', 'pl', {
        en: { meaning: 'cat', sentence: 'The cat sleeps.', gloss: 'Kot śpi.' },
        de: { meaning: 'Katze', sentence: 'Die Katze schläft.', gloss: 'Kot śpi.' }
      })
    ]
  }
}
