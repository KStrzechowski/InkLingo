// The row model for the printable sheet: turns a collection's entries, each
// holding nested senses[].translations[].sentences[], into the table's row
// bands.
//
// Kept out of PrintCollectionPage.tsx for the same reason printPagination.ts is
// (`react/only-export-components`, configured as a warning in
// frontend/.oxlintrc.json) — and because this is the one piece of real logic on
// the print page, so it should be testable without rendering React.

import type { CollectionDetail, Entry } from '../api/collections'

// One printed row: one meaning's word in one of the collection's target
// languages. Languages (and now meanings) add rows, not columns, so column
// widths never shrink as a collection gains languages or a word gains
// meanings.
export interface PrintRow {
  glossText: string
  languageCode: string
  meaningText: string
  phoneticTranscription: string | null
  sentenceText: string
  nativeGlossText: string
}

// An entry's rows kept together, because the table emits one <tbody> per
// entry — that is the structure the print stylesheet hangs `break-inside:
// avoid` on to stop a word's rows splitting across a fold.
//
// `rows` has no nesting of its own — it is a flat list, ordered sense by
// sense — so `senseRowCounts` carries the grouping PrintDocument needs
// separately: one entry per sense, in the same order, giving the row count
// its gloss `<th>` should `rowSpan` over. `rows.length === sum(senseRowCounts)`
// always holds.
export interface PrintBand {
  entry: Entry
  rows: PrintRow[]
  senseRowCounts: number[]
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

// One entry per printed row, aligned with `PrintBand.rows`. A row that opens
// its sense's group carries that group's row count — the value PrintDocument
// passes straight to the gloss `<th>`'s `rowSpan` — every other row carries
// `null`, meaning "covered by an earlier row's rowSpan; render nothing here."
export function senseRowSpans (senseRowCounts: readonly number[]): Array<number | null> {
  const spans: Array<number | null> = []
  for (const count of senseRowCounts) {
    // A zero-row group contributes no rows to `PrintBand.rows`, so it must
    // contribute nothing here either — otherwise `spans` outgrows `rows` and
    // every later group's rowSpan lands on the wrong row.
    if (count === 0) continue
    spans.push(count)
    for (let i = 1; i < count; i++) {
      spans.push(null)
    }
  }
  return spans
}

export function buildBands (collection: CollectionDetail): PrintBand[] {
  const collator = collatorFor(collection.nativeLanguageCode)
  // A printed reference sheet is something you look things up in, so
  // alphabetical beats insertion order.
  const entries = [...collection.entries].sort(
    (one, other) => collator.compare(one.wordOrPhrase, other.wordOrPhrase)
  )

  return entries.map((entry) => {
    const senseRowCounts: number[] = []

    const rows = entry.senses.flatMap((sense) => {
      const senseRows = collection.targetLanguageCodes.flatMap((code) => {
        // Case-insensitive throughout, for the same reason CollectionDetailPage
        // and the backend do it: rows saved before write-time normalization hold
        // codes like 'EN' that would otherwise never match a saved 'en'.
        const wanted = code.toLowerCase()
        const translation = sense.translations.find(
          (candidate) => candidate.languageCode.toLowerCase() === wanted
        )

        // A sparse spoke: this meaning has no word in this language. Skip it
        // rather than printing a blank filler row — the same rule that used
        // to cover an entry saved before a language was added.
        if (translation === undefined) {
          return []
        }

        // `Entry.capture` guarantees at least one sentence per translation
        // (`TranslationWithoutSentenceError` otherwise), so there is always a
        // first one to print; a translation with no sentence at all cannot
        // reach this page.
        const [sentence] = translation.sentences

        return [{
          glossText: sense.glossText,
          languageCode: code,
          meaningText: translation.meaningText,
          phoneticTranscription: translation.phoneticTranscription,
          sentenceText: sentence?.sentenceText ?? '',
          nativeGlossText: sentence?.nativeGlossText ?? ''
        }]
      })

      // A sense every one of the collection's target languages happens to
      // lack a word for cannot occur — `SenseWithoutTranslationError` rules
      // out a sense with zero translations — but recording a zero-row group
      // rather than dropping it silently is the defensible failure mode if
      // that ever changes.
      senseRowCounts.push(senseRows.length)
      return senseRows
    })

    return { entry, rows, senseRowCounts }
  })
}
