import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import axios from 'axios'
import { getCollection, type CollectionDetail } from '../api/collections'
import { extractErrorMessage } from '../api/errors'

function CollectionDetailPage () {
  const { id } = useParams<{ id: string }>()
  const [collection, setCollection] = useState<CollectionDetail | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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

  if (error || !collection) {
    return <p style={{ color: 'red' }}>{error ?? 'Something went wrong.'}</p>
  }

  return (
    <section>
      <h2>{collection.name}</h2>
      {collection.entries.length === 0 ? (
        <p>No entries yet.</p>
      ) : (
        <ul>
          {collection.entries.map((entry) => (
            <li key={entry.id}>
              <strong>{entry.wordOrPhrase}</strong> ({entry.sourceLanguageCode})
              <ul>
                {entry.translations.map((translation) => (
                  <li key={translation.id}>{translation.languageCode}: {translation.meaningText}</li>
                ))}
              </ul>
              <ul>
                {entry.sentences.map((sentence) => (
                  <li key={sentence.id}>{sentence.languageCode}: {sentence.sentenceText}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default CollectionDetailPage
