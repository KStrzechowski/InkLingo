import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { createCollection, listCollections, type Collection } from '../api/collections'
import { extractErrorMessage } from '../api/errors'
import { SUPPORTED_LANGUAGES } from '../languages'

// Mirrors MAX_TARGET_LANGUAGES in backend/src/routes/api/collections/schemas.ts.
// Enforced here too so the form can't build a request the API will reject.
const MAX_TARGET_LANGUAGES = 5

function CollectionsListPage () {
  const [collections, setCollections] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [nativeLanguageCode, setNativeLanguageCode] = useState(SUPPORTED_LANGUAGES[0].code)
  const [targetLanguageCodes, setTargetLanguageCodes] = useState<string[]>([SUPPORTED_LANGUAGES[1].code])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Kept apart from `error`: that one belongs to the create form, and offering
  // "Try again" for a rejected name would reload the list instead of doing
  // anything about the rejection.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)

  // Callable, not inlined in the effect, because a failed load has to be
  // recoverable: without a retry `collections` stays [] and the create below
  // appends to that empty array, rendering one collection as the user's
  // complete list (context/foundation/lessons.md, "Clearing a failure signal
  // doesn't restore the view it was raised over").
  //
  // Deliberately the page's own control rather than a subscription to the
  // global connectionIssue signal — a signal raised by an unrelated request
  // would refetch everything and couple every page to that context.
  // Never rejects, so the caller decides what a settled load means: the mount
  // effect ends the initial loading state, the retry control only ends its own
  // pending state. A retry deliberately does not re-enter `loading` — that
  // would unmount the create form and discard anything typed into it.
  const load = useCallback(async () => {
    setLoadError(null)
    try {
      setCollections(await listCollections())
    } catch (err) {
      setLoadError(extractErrorMessage(err))
    }
  }, [])

  useEffect(() => {
    void load().finally(() => setLoading(false))
  }, [load])

  async function handleRetry () {
    setRetrying(true)
    await load()
    setRetrying(false)
  }

  // The backend rejects a collection whose native language is also a target,
  // so switching native drops it from the picked targets rather than leaving
  // a selection that can only fail on submit.
  function handleNativeChange (code: string) {
    setNativeLanguageCode(code)
    setTargetLanguageCodes((prev) => prev.filter((target) => target !== code))
  }

  function toggleTarget (code: string) {
    setTargetLanguageCodes((prev) => (
      prev.includes(code)
        ? prev.filter((target) => target !== code)
        : prev.length < MAX_TARGET_LANGUAGES ? [...prev, code] : prev
    ))
  }

  async function handleSubmit (event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const created = await createCollection(name, nativeLanguageCode, targetLanguageCodes)
      setName('')
      if (loadError !== null) {
        // The list never loaded, so there is nothing to append to — but this
        // POST just proved the server is reachable, so fetch the real list
        // rather than rendering the one new row as if it were all of them.
        await load()
      } else {
        setCollections((prev) => [...prev, created])
      }
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <p>Loading collections…</p>
  }

  const availableTargets = SUPPORTED_LANGUAGES.filter((language) => language.code !== nativeLanguageCode)

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
        <label>
          I speak{' '}
          <select value={nativeLanguageCode} onChange={(event) => handleNativeChange(event.target.value)}>
            {SUPPORTED_LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>{language.label}</option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>
            I'm learning ({targetLanguageCodes.length} of {MAX_TARGET_LANGUAGES})
          </legend>
          {availableTargets.map((language) => {
            const checked = targetLanguageCodes.includes(language.code)
            return (
              <label key={language.code}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && targetLanguageCodes.length >= MAX_TARGET_LANGUAGES}
                  onChange={() => toggleTarget(language.code)}
                />
                {language.label}
              </label>
            )
          })}
        </fieldset>
        <button type="submit" disabled={submitting || targetLanguageCodes.length === 0}>Create</button>
      </form>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loadError !== null && (
        <p style={{ color: 'red' }}>
          {loadError}{' '}
          <button type="button" onClick={() => void handleRetry()} disabled={retrying}>
            {retrying ? 'Retrying…' : 'Try again'}
          </button>
        </p>
      )}
      {loadError !== null ? null : collections.length === 0 ? (
        <p>No collections yet.</p>
      ) : (
        <ul>
          {collections.map((collection) => (
            <li key={collection.id}>
              <Link to={`/collections/${collection.id}`}>{collection.name}</Link>
              {' '}
              <small>{collection.nativeLanguageCode} → {collection.targetLanguageCodes.join(', ')}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default CollectionsListPage
