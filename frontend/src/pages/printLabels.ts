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
  meaning: string
  translation: string
  sentenceNative: string
  sentenceTarget: string
}

const LABELS: Record<string, PrintLabels> = {
  en: {
    word: 'Word',
    meaning: 'Meaning',
    translation: 'Translation',
    sentenceNative: 'Sentence',
    sentenceTarget: 'Sentence (translated)'
  },
  pl: {
    word: 'Słowo',
    meaning: 'Znaczenie',
    translation: 'Tłumaczenie',
    sentenceNative: 'Zdanie',
    sentenceTarget: 'Zdanie (tłumaczenie)'
  },
  ru: {
    word: 'Слово',
    meaning: 'Значение',
    translation: 'Перевод',
    sentenceNative: 'Предложение',
    sentenceTarget: 'Предложение (перевод)'
  },
  de: {
    word: 'Wort',
    meaning: 'Bedeutung',
    translation: 'Übersetzung',
    sentenceNative: 'Satz',
    sentenceTarget: 'Satz (Übersetzung)'
  },
  fr: {
    word: 'Mot',
    meaning: 'Sens',
    translation: 'Traduction',
    sentenceNative: 'Phrase',
    sentenceTarget: 'Phrase (traduction)'
  },
  es: {
    word: 'Palabra',
    meaning: 'Significado',
    translation: 'Traducción',
    sentenceNative: 'Frase',
    sentenceTarget: 'Frase (traducción)'
  },
  it: {
    word: 'Parola',
    meaning: 'Significato',
    translation: 'Traduzione',
    sentenceNative: 'Frase',
    sentenceTarget: 'Frase (traduzione)'
  },
  uk: {
    word: 'Слово',
    meaning: 'Значення',
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

// Still used for the document header's native → target summary line
// (`PrintDocument.tsx`'s `<header>`). The per-row meaning column no longer
// uses this: since D-1 replaced it with the row's own uppercase language code
// (design mockup: 'EN castle'), a bounded set of names does not need to fit a
// column any more — that pressure moved to the gloss column instead (see
// print.css).
//
// `Intl.DisplayNames` carries all 8 × 8 combinations without a hand-written
// 64-entry table, and prints each name in its own language's orthography
// (Polish 'angielski' is lower case by rule, German 'Englisch' upper).
//
// Returns a resolver rather than a plain function so the one `DisplayNames`
// instance is shared by every caller.
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
