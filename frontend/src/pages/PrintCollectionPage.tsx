import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import axios from 'axios'
import { getCollection, type CollectionDetail } from '../api/collections'
import { extractErrorMessage } from '../api/errors'
import PrintDocument from './PrintDocument'

// The route: auth gate, params, fetch lifecycle. Everything below the fetch —
// the row model, pagination and the sheets themselves — lives in PrintDocument,
// which the browser-test harness mounts directly with fixture data.

function PrintCollectionPage () {
  const { id } = useParams<{ id: string }>()
  const [collection, setCollection] = useState<CollectionDetail | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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

  return <PrintDocument collection={collection} />
}

export default PrintCollectionPage
