import { useLayoutEffect, useRef, useState } from 'react'
import type { CollectionDetail } from '../api/collections'
import { printLabels, printLanguageNamer } from './printLabels'
import { measurePrintPages, packPrintPages } from './printPagination'
import { buildBands } from './printRows'
import './print.css'

// The printable document itself, given a collection that is already loaded.
//
// Split from PrintCollectionPage so the route owns fetching, auth and routing
// while this owns the document. That seam exists so the browser-test harness
// (browser-tests/harness/) can mount the very same component with fixture data
// instead of re-creating the markup — a copy would drift from the real page,
// and a drifting harness proves nothing about what users print.

function PrintDocument ({ collection }: { collection: CollectionDetail }) {
  // Band indexes per printed page; null until the document has been measured.
  const [pages, setPages] = useState<number[][] | null>(null)
  const documentRef = useRef<HTMLElement>(null)

  // print.css is scoped to this class, so the global app shell is only
  // neutralised while this document is mounted — navigating away restores the
  // normal app appearance. This class name is the single coupling point
  // between the component and the stylesheet.
  //
  // useLayoutEffect, and declared BEFORE the measuring effect below, so the
  // class is in place before any measurement is taken. As a passive effect it
  // ran *after* the measurement, which meant the bands were measured while the
  // document still inherited the app's 18px body font instead of the sheet's
  // 11pt — every band came out ~25% too tall and the packer put one entry on
  // each page. The route only avoided it by accident: its collection arrives
  // from an async fetch, so the class was always already applied by the time
  // there was a document to measure. Anything rendering this component with a
  // collection already in hand hits it immediately.
  useLayoutEffect(() => {
    document.body.classList.add('print-mode')
    return () => {
      document.body.classList.remove('print-mode')
    }
  }, [])

  // A different collection is a different document, so its page breaks have to
  // be measured again rather than inherited.
  //
  // Adjusted during render, not in an effect. A passive effect runs *after* the
  // useLayoutEffect below, so on mount it would throw away the pagination that
  // had just been measured — leaving `pages` null for good and rendering every
  // band on one endless sheet, which is exactly the unpaginated document this
  // component exists to avoid.
  const [measuredFor, setMeasuredFor] = useState(collection)
  if (measuredFor !== collection) {
    setMeasuredFor(collection)
    setPages(null)
  }

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

export default PrintDocument
