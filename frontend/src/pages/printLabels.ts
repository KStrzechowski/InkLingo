// Column headings for the printed sheet, in the collection's native language
// — the sheet is a study aid for someone learning *into* the target
// languages, so its furniture should be in the language they already read.
//
// Kept print-only and local to this page rather than added to
// frontend/src/languages.ts, which is shared ground with the
// pronunciation-playback change.

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

// Falls back to English for a code with no entry — including the dev
// database's legacy 'ENss', which matches nothing.
export function printLabels (nativeLanguageCode: string): PrintLabels {
  return LABELS[nativeLanguageCode.toLowerCase()] ?? LABELS.en
}
