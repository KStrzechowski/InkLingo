import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import axios from 'axios'
import { createCollection, listCollections, type Collection } from '../api/collections'

function extractErrorMessage (err: unknown): string {
  if (axios.isAxiosError(err) && err.response) {
    const data = err.response.data as { message?: string } | undefined
    return data?.message ?? `${err.response.status} ${err.response.statusText}`
  }
  return 'Request failed'
}

function CollectionsListPage () {
  const [collections, setCollections] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listCollections()
      .then((data) => setCollections(data))
      .catch((err: unknown) => setError(extractErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [])

  async function handleSubmit (event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const created = await createCollection(name)
      setCollections((prev) => [...prev, created])
      setName('')
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <p>Loading collections…</p>
  }

  return (
    <section>
      <h2>Your collections</h2>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Collection name"
        />
        <button type="submit" disabled={submitting}>Create</button>
      </form>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {collections.length === 0 ? (
        <p>No collections yet.</p>
      ) : (
        <ul>
          {collections.map((collection) => (
            <li key={collection.id}>
              <Link to={`/collections/${collection.id}`}>{collection.name}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default CollectionsListPage
