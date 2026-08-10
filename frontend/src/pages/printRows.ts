// The row model for the printable sheet: turns a collection's entries, each
// holding parallel translations[] and sentences[], into the table's row bands.
//
// Kept out of PrintCollectionPage.tsx for the same reason printPagination.ts is
// (`react/only-export-components`, configured as a warning in
// frontend/.oxlintrc.json) — and because this is the one piece of real logic on
// the print page, so it should be testable without rendering React.

import type { CollectionDetail, Entry } from '../api/collections'

// One printed row: an entry paired with one of the collection's target
// languages. Languages add rows, not columns, so column widths never shrink
// as a collection gains languages.
export interface PrintRow {
  languageCode: string
  meaningText: string
  phoneticTranscription: string | null
  sentenceText: string
  nativeGlossText: string
}

// An entry's rows kept together, because the table emits one <tbody> per
// entry — that is the structure the print stylesheet hangs `break-inside:
// avoid` on to stop a word's languages splitting across a fold.
export interface PrintBand {
  entry: Entry
  rows: PrintRow[]
}

// Defensive: nativeLanguageCode is user-influenced data, and a malformed
// BCP-47 primary subtag makes `new Intl.Collator(code)` throw RangeError.
// No such code exists in the data today (only uppercase 'PL' and 'EN', both
// valid), but a try/catch is cheaper than a whole-page crash over sort order.
export function collatorFor (languageCode: string): Intl.Collator {
  try {
    return new Intl.Collator(languageCode)
  } catch {
    return new Intl.Collator()
  }
}

export function buildBands (collection: CollectionDetail): PrintBand[] {
  const collator = collatorFor(collection.nativeLanguageCode)
  // A printed reference sheet is something you look things up in, so
  // alphabetical beats insertion order.
  const entries = [...collection.entries].sort(
    (one, other) => collator.compare(one.wordOrPhrase, other.wordOrPhrase)
  )

  return entries.map((entry) => {
    const rows = collection.targetLanguageCodes.flatMap((code) => {
      // Case-insensitive throughout, for the same reason CollectionDetailPage
      // and the backend do it: rows saved before write-time normalization hold
      // codes like 'EN' that would otherwise never match a saved 'en'.
      const wanted = code.toLowerCase()
      const translation = entry.translations.find(
        (candidate) => candidate.languageCode.toLowerCase() === wanted
      )
      const sentence = entry.sentences.find(
        (candidate) => candidate.languageCode.toLowerCase() === wanted
      )

      // An entry saved before this language was added to the collection has
      // neither — skip it rather than printing a blank filler row.
      if (translation === undefined && sentence === undefined) {
        return []
      }

      // Having only one of the two is legitimate; the missing cell prints
      // empty rather than the language being dropped.
      return [{
        languageCode: code,
        meaningText: translation?.meaningText ?? '',
        phoneticTranscription: translation?.phoneticTranscription ?? null,
        sentenceText: sentence?.sentenceText ?? '',
        nativeGlossText: sentence?.nativeGlossText ?? ''
      }]
    })

    return { entry, rows }
  })
}
