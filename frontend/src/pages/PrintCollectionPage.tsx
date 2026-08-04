import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import axios from 'axios'
import { getCollection, type CollectionDetail, type Entry } from '../api/collections'
import { extractErrorMessage } from '../api/errors'
import { printLabels, printLanguageNamer } from './printLabels'
import { measurePrintPages, packPrintPages } from './printPagination'
import './print.css'

// One printed row: an entry paired with one of the collection's target
// languages. Languages add rows, not columns, so column widths never shrink
// as a collection gains languages.
interface PrintRow {
  languageCode: string
  meaningText: string
  phoneticTranscription: string | null
  sentenceText: string
  nativeGlossText: string
}

// An entry's rows kept together, because the table emits one <tbody> per
// entry — that is the structure Phase 2 hangs `break-inside: avoid` on to
// stop a word's languages splitting across a fold.
interface PrintBand {
  entry: Entry
  rows: PrintRow[]
}

// Defensive: nativeLanguageCode is user-influenced data, and a malformed
// BCP-47 primary subtag makes `new Intl.Collator(code)` throw RangeError.
// No such code exists in the data today (only uppercase 'PL' and 'EN', both
// valid), but a try/catch is cheaper than a whole-page crash over sort order.
function collatorFor (languageCode: string): Intl.Collator {
  try {
    return new Intl.Collator(languageCode)
  } catch {
    return new Intl.Collator()
  }
}

function buildBands (collection: CollectionDetail): PrintBand[] {
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

function PrintCollectionPage () {
  const { id } = useParams<{ id: string }>()
  const [collection, setCollection] = useState<CollectionDetail | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Band indexes per printed page; null until the document has been measured.
  const [pages, setPages] = useState<number[][] | null>(null)
  const documentRef = useRef<HTMLElement>(null)

  // print.css is scoped to this class, so the global app shell is only
  // neutralised while this page is mounted — navigating away restores the
  // normal app appearance. This class name is the single coupling point
  // between the component and the stylesheet.
  useEffect(() => {
    document.body.classList.add('print-mode')
    return () => {
      document.body.classList.remove('print-mode')
    }
  }, [])

  // Same fetch lifecycle as CollectionDetailPage, so loading / 404 / error /
  // loaded behave consistently across the two pages.
  useEffect(() => {
    if (!id) {
      return
    }
    let cancelled = false
    setLoading(true)
    setNotFound(false)
    setError(null)
    // A different collection is a different document, so its page breaks have
    // to be measured again rather than inherited.
    setPages(null)
    getCollection(id)
      .then((data) => {
        if (!cancelled) {
          setCollection(data)
        }
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return
        }
        if (axios.isAxiosError(err) && err.response?.status === 404) {
          setNotFound(true)
        } else {
          setError(extractErrorMessage(err))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [id])

  // Pagination is a two-pass render: the first pass lays every band out in one
  // continuous table, which is the only way to learn how tall each band is;
  // this effect deals them into pages and the second pass replaces that column
  // with real sheets. `useLayoutEffect`, so the browser never paints the
  // unpaginated pass and the user sees no reflow.
  //
  // `collection` is a dependency because the DOM being measured only exists
  // once it has loaded. Re-entry is bounded: the effect only ever runs its
  // body while `pages` is null, and its own `setPages` ends that.
  useLayoutEffect(() => {
    if (pages !== null || documentRef.current === null) {
      return
    }
    const metrics = measurePrintPages(documentRef.current)
    if (metrics !== null) {
      setPages(packPrintPages(metrics))
    }
  }, [collection, pages])

  if (loading) {
    return <p>Loading…</p>
  }

  if (notFound) {
    return <p>Collection not found.</p>
  }

  if (!collection) {
    return <p>{error ?? 'Something went wrong.'}</p>
  }

  const bands = buildBands(collection)
  const labels = printLabels(collection.nativeLanguageCode)
  const languageName = printLanguageNamer(collection.nativeLanguageCode)

  // Before measurement, every band goes on one oversized sheet — that is the
  // pass the heights are read from. It is also the fallback if measurement
  // ever fails: an unbroken column, which is what this page used to be, not a
  // blank one.
  const sheets = pages ?? [bands.map((_, index) => index)]

  return (
    // `lang` is what lets the browser pick a hyphenation dictionary, so it is
    // declared wherever the language changes: the document is in the native
    // language, and the target-language cells override it below. It also
    // steers font selection and screen-reader pronunciation.
    <article className="print-document" lang={collection.nativeLanguageCode} ref={documentRef}>
      {bands.length > 0 && (
        // Outside the sheets, not inside the first one. A screen-only control
        // sitting in a page box would take up room on screen that it does not
        // take up on paper, so page one would look fuller than it prints —
        // and it would corrupt the measurement it sits above.
        <p className="print-toolbar no-print">
          <button type="button" onClick={() => window.print()}>Print</button>
        </p>
      )}

      {bands.length > 0 && pages === null && (
        <div className="print-page-probe" aria-hidden="true" />
      )}

      {sheets.map((bandIndexes, pageIndex) => (
        <section
          className="print-page"
          key={pageIndex}
          data-page-label={`${pageIndex + 1} / ${sheets.length}`}
        >
          {pageIndex === 0 && (
            <header className="print-header">
              <h1>{collection.name}</h1>
              <p>
                {languageName(collection.nativeLanguageCode)}
                {' → '}
                {collection.targetLanguageCodes.map((code) => languageName(code)).join(', ')}
                {' · '}
                {new Date().toLocaleDateString()}
              </p>
            </header>
          )}

          {bands.length === 0 ? (
            <p>Nothing to print — this collection has no entries yet.</p>
          ) : (
            <table className="print-table">
              {/* Repeated per page structurally now, rather than left to
                  `table-header-group` to repeat across a fragmented table —
                  each page holds its own table. */}
              <thead>
                <tr>
                  <th scope="col">{labels.word}</th>
                  <th scope="col">{labels.language}</th>
                  <th scope="col">{labels.translation}</th>
                  <th scope="col">{labels.sentenceNative}</th>
                  <th scope="col">{labels.sentenceTarget}</th>
                </tr>
              </thead>
              {bandIndexes.map((bandIndex) => {
                const { entry, rows } = bands[bandIndex]
                return (
                  <tbody key={entry.id}>
                    {rows.length === 0 ? (
                      // No renderable language at all — still print the word, so
                      // nothing silently vanishes from the sheet.
                      <tr>
                        <th scope="row" lang={entry.sourceLanguageCode}>{entry.wordOrPhrase}</th>
                        <td colSpan={4} />
                      </tr>
                    ) : (
                      rows.map((row, index) => (
                        <tr key={`${entry.id}:${row.languageCode}`}>
                          {index === 0 && (
                            // The captured word is not necessarily in the native
                            // language — an entry can be captured in one of the
                            // collection's target languages too.
                            <th scope="row" rowSpan={rows.length} lang={entry.sourceLanguageCode}>
                              {entry.wordOrPhrase}
                            </th>
                          )}
                          <td className="print-language">{languageName(row.languageCode)}</td>
                          <td lang={row.languageCode}>
                            {row.meaningText}
                            {row.phoneticTranscription !== null && (
                              <>
                                {/* The space belongs OUTSIDE the nowrap span. Inside
                                    it, it stops being a break opportunity, which
                                    welds the meaning and the transcription into one
                                    unbreakable run — 'independence /ˌɪndɪˈpendəns/'
                                    is 203.9px against a 118.9px column, so Firefox
                                    broke the word itself to make the tail fit and
                                    printed 'indepen-/denc/e /ˌɪndɪˈpendəns/'. */}
                                {' '}
                                {/* Rendered verbatim: stored transcriptions already
                                    carry their own delimiters, and inconsistently —
                                    '/ˈfuːd/' for English, '[ɪˈda]' for Russian.
                                    Wrapping them again printed 'food //ˈfuːd//'. */}
                                <span className="print-phonetic">{row.phoneticTranscription}</span>
                              </>
                            )}
                          </td>
                          {/* The gloss is in the native language, so it inherits
                              the document's `lang`; the target sentence overrides it. */}
                          <td>{row.nativeGlossText}</td>
                          <td lang={row.languageCode}>{row.sentenceText}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                )
              })}
            </table>
          )}
        </section>
      ))}
    </article>
  )
}

export default PrintCollectionPage
