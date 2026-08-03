import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import axios from 'axios'
import { getCollection, type CollectionDetail, type Entry } from '../api/collections'
import { extractErrorMessage } from '../api/errors'
import { languageLabel } from '../languages'
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

// The dev database holds pre-normalization codes including 'ENss', which is
// not a well-formed BCP-47 primary subtag — `new Intl.Collator('ENss')`
// throws RangeError. Degrade to the default locale rather than crashing the
// whole page over a sort order.
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
  const nativeLabel = languageLabel(collection.nativeLanguageCode)

  return (
    <article className="print-document">
      <header className="print-header">
        <h1>{collection.name}</h1>
        <p>
          {nativeLabel} → {collection.targetLanguageCodes.map(languageLabel).join(', ')}
          {' · '}
          {new Date().toLocaleDateString()}
        </p>
      </header>

      {bands.length === 0 ? (
        <p>Nothing to print — this collection has no entries yet.</p>
      ) : (
        <>
          <p className="no-print">
            <button type="button" onClick={() => window.print()}>Print</button>
          </p>

          <table className="print-table">
            <thead>
              <tr>
                <th scope="col">Word</th>
                <th scope="col">Sentence ({nativeLabel})</th>
                <th scope="col">Lang</th>
                <th scope="col">Translation</th>
                <th scope="col">Sentence</th>
              </tr>
            </thead>
            {bands.map(({ entry, rows }) => (
              <tbody key={entry.id}>
                {rows.length === 0 ? (
                  // No renderable language at all — still print the word, so
                  // nothing silently vanishes from the sheet.
                  <tr>
                    <th scope="row">{entry.wordOrPhrase}</th>
                    <td colSpan={4} />
                  </tr>
                ) : (
                  rows.map((row, index) => (
                    <tr key={`${entry.id}:${row.languageCode}`}>
                      {index === 0 && (
                        <th scope="row" rowSpan={rows.length}>{entry.wordOrPhrase}</th>
                      )}
                      <td>{row.nativeGlossText}</td>
                      <td>{languageLabel(row.languageCode)}</td>
                      <td>
                        {row.meaningText}
                        {row.phoneticTranscription !== null && (
                          <span className="print-phonetic"> /{row.phoneticTranscription}/</span>
                        )}
                      </td>
                      <td>{row.sentenceText}</td>
                    </tr>
                  ))
                )}
              </tbody>
            ))}
          </table>
        </>
      )}
    </article>
  )
}

export default PrintCollectionPage
