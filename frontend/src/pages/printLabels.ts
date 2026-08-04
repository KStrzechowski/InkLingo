// Everything the printed sheet says in its own voice — column headings and
// language names — in the collection's native language. The sheet is a study
// aid for someone learning *into* the target languages, so its furniture
// should be in the language they already read.
//
// Kept print-only and local to this page rather than added to
// frontend/src/languages.ts, which is shared ground with the
// pronunciation-playback change.

import { languageLabel } from '../languages'

export interface PrintLabels {
  word: string
  language: string
  translation: string
  sentenceNative: string
  sentenceTarget: string
}

const LABELS: Record<string, PrintLabels> = {
  en: {
    word: 'Word',
    language: 'Language',
    translation: 'Translation',
    sentenceNative: 'Sentence',
    sentenceTarget: 'Sentence (translated)'
  },
  pl: {
    word: 'Słowo',
    language: 'Język',
    translation: 'Tłumaczenie',
    sentenceNative: 'Zdanie',
    sentenceTarget: 'Zdanie (tłumaczenie)'
  },
  ru: {
    word: 'Слово',
    language: 'Язык',
    translation: 'Перевод',
    sentenceNative: 'Предложение',
    sentenceTarget: 'Предложение (перевод)'
  },
  de: {
    word: 'Wort',
    language: 'Sprache',
    translation: 'Übersetzung',
    sentenceNative: 'Satz',
    sentenceTarget: 'Satz (Übersetzung)'
  },
  fr: {
    word: 'Mot',
    language: 'Langue',
    translation: 'Traduction',
    sentenceNative: 'Phrase',
    sentenceTarget: 'Phrase (traduction)'
  },
  es: {
    word: 'Palabra',
    language: 'Idioma',
    translation: 'Traducción',
    sentenceNative: 'Frase',
    sentenceTarget: 'Frase (traducción)'
  },
  it: {
    word: 'Parola',
    language: 'Lingua',
    translation: 'Traduzione',
    sentenceNative: 'Frase',
    sentenceTarget: 'Frase (traduzione)'
  },
  uk: {
    word: 'Слово',
    language: 'Мова',
    translation: 'Переклад',
    sentenceNative: 'Речення',
    sentenceTarget: 'Речення (переклад)'
  }
}

// Falls back to English for any code with no entry, including the legacy
// uppercase codes ('PL', 'EN') that predate write-time normalization.
export function printLabels (nativeLanguageCode: string): PrintLabels {
  return LABELS[nativeLanguageCode.toLowerCase()] ?? LABELS.en
}

// The Language column and the header pair are furniture too, so they follow
// the headings into the native language — a sheet headed 'Słowo · Język'
// listing 'English, German' is half-translated. `Intl.DisplayNames` carries
// all 8 × 8 combinations without a hand-written 64-entry table, and prints
// each name in its own language's orthography (Polish 'angielski' is lower
// case by rule, German 'Englisch' upper).
//
// Returns a resolver rather than a plain function so the one `DisplayNames`
// instance is shared by every row of the sheet.
//
// Falls back to the shared English `languageLabel` where `Intl` cannot help:
// `.of()` throws `RangeError` on a malformed primary subtag, and the
// constructor throws on a malformed *native* code — which is also the case
// `printLabels` falls back to English for, so the two stay consistent.
export function printLanguageNamer (nativeLanguageCode: string): (languageCode: string) => string {
  try {
    const display = new Intl.DisplayNames([nativeLanguageCode], { type: 'language' })
    return (languageCode: string) => {
      try {
        return display.of(languageCode) ?? languageLabel(languageCode)
      } catch {
        return languageLabel(languageCode)
      }
    }
  } catch {
    return languageLabel
  }
}
