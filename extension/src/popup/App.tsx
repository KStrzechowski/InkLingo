import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { sendMessage } from '../messages.ts'
import type { Collection, TranslationVariant } from '../types.ts'

// FR-013's "default to the last-used collection" — the collection has to
// be resolved before the input box is usable, since the native/target
// languages the AI call needs live on the collection, not the account.
const LAST_COLLECTION_KEY = 'lastCollectionId'

type Status = 'loading' | 'anonymous' | 'ready'
type Busy = 'login' | 'translate' | 'regenerate' | 'save' | null

interface Capture {
  // What the user typed, kept verbatim so regeneration re-asks the same
  // question rather than the normalized form.
  input: string
  // The normalized native-language form from the AI response — this is
  // what gets persisted, because the backend stamps every entry's
  // source_language_code with the collection's native language.
  wordOrPhrase: string
  variants: TranslationVariant[]
}

function errorText (err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong'
}

function sameMeaning (one: string, other: string): boolean {
  return one.trim().toLowerCase() === other.trim().toLowerCase()
}

function App () {
  const [status, setStatus] = useState<Status>('loading')
  const [collections, setCollections] = useState<Collection[]>([])
  const [activeCollectionId, setActiveCollectionId] = useState('')
  const [text, setText] = useState('')
  const [capture, setCapture] = useState<Capture | null>(null)
  const [selectedVariant, setSelectedVariant] = useState<number | null>(null)
  const [selectedSentence, setSelectedSentence] = useState<number | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const activeCollection = collections.find((collection) => collection.id === activeCollectionId)

  const loadCollections = useCallback(async () => {
    const list = await sendMessage({ type: 'list-collections' })
    setCollections(list)
    const stored = await browser.storage.local.get(LAST_COLLECTION_KEY)
    const lastUsedId = stored[LAST_COLLECTION_KEY] as string | undefined
    const resolved = list.find((collection) => collection.id === lastUsedId) ?? list[0]
    setActiveCollectionId(resolved?.id ?? '')
  }, [])

  useEffect(() => {
    async function bootstrap () {
      const { authenticated } = await sendMessage({ type: 'auth-status' })
      if (!authenticated) {
        setStatus('anonymous')
        return
      }
      await loadCollections()
      setStatus('ready')
    }
    bootstrap().catch((err: unknown) => {
      setError(errorText(err))
      setStatus('anonymous')
    })
  }, [loadCollections])

  function resetCapture () {
    setCapture(null)
    setSelectedVariant(null)
    setSelectedSentence(null)
  }

  async function rememberCollection (id: string) {
    await browser.storage.local.set({ [LAST_COLLECTION_KEY]: id })
  }

  // Firefox closes the popup as soon as the identity auth window takes
  // focus, so this promise usually dies with the popup — the background
  // script finishes the flow and stores the tokens regardless, and the
  // next popup open bootstraps straight into the authenticated state.
  async function handleLogin () {
    setBusy('login')
    setError(null)
    try {
      await sendMessage({ type: 'login' })
      await loadCollections()
      setStatus('ready')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  async function handleLogout () {
    await sendMessage({ type: 'logout' })
    setCollections([])
    setActiveCollectionId('')
    setText('')
    resetCapture()
    setSaved(null)
    setStatus('anonymous')
  }

  function handleCollectionChange (id: string) {
    setActiveCollectionId(id)
    void rememberCollection(id)
    resetCapture()
    setSaved(null)
  }

  async function handleTranslate (event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = text.trim()
    if (input.length === 0 || activeCollection === undefined) {
      return
    }
    setBusy('translate')
    setError(null)
    setSaved(null)
    try {
      const result = await sendMessage({ type: 'translate', collectionId: activeCollection.id, text: input })
      setCapture({ input, wordOrPhrase: result.normalizedNativeText, variants: result.variants })
      setSelectedVariant(result.variants.length > 0 ? 0 : null)
      setSelectedSentence(null)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  async function handleRegenerate () {
    const selected = selectedVariant === null ? undefined : capture?.variants[selectedVariant]
    if (capture === null || activeCollection === undefined || selected === undefined) {
      return
    }
    setBusy('regenerate')
    setError(null)
    try {
      const result = await sendMessage({ type: 'translate', collectionId: activeCollection.id, text: capture.input })
      // Generation is non-deterministic, so a fresh response can order
      // the senses differently or return a different set of them — pair
      // by meaning, never by position. Attaching one sense's sentences to
      // another is exactly the mismatch that nesting sentences under
      // variants exists to prevent.
      const fresh = result.variants.find((candidate) => sameMeaning(candidate.meaningText, selected.meaningText))
      if (fresh === undefined) {
        setError('No new sentences came back for this meaning — try again.')
        return
      }
      // FR-012 regenerates sentences only, and only under the variant the
      // user is looking at: every other variant keeps the sentences it
      // was first shown with, and no phonetic transcription moves.
      setCapture({
        ...capture,
        variants: capture.variants.map((variant, index) => (
          index === selectedVariant ? { ...variant, sentences: fresh.sentences } : variant
        ))
      })
      setSelectedSentence(null)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  async function handleSave () {
    const languageCode = activeCollection?.targetLanguageCodes[0]
    if (capture === null || activeCollection === undefined || languageCode === undefined) {
      return
    }
    const variant = selectedVariant === null ? undefined : capture.variants[selectedVariant]
    const sentence = selectedSentence === null ? undefined : variant?.sentences[selectedSentence]
    if (variant === undefined || sentence === undefined) {
      return
    }

    setBusy('save')
    setError(null)
    try {
      const entry = await sendMessage({
        type: 'save-entry',
        collectionId: activeCollection.id,
        entry: {
          wordOrPhrase: capture.wordOrPhrase,
          translations: [{
            languageCode,
            meaningText: variant.meaningText,
            phoneticTranscription: variant.phoneticTranscription
          }],
          sentences: [{
            languageCode,
            sentenceText: sentence.targetText,
            nativeGlossText: sentence.nativeGlossText
          }]
        }
      })
      await rememberCollection(activeCollection.id)
      setSaved(`Saved “${entry.wordOrPhrase}” to ${activeCollection.name}.`)
      setText('')
      resetCapture()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  if (status === 'loading') {
    return <main className="popup"><p className="muted">Loading…</p></main>
  }

  if (status === 'anonymous') {
    return (
      <main className="popup">
        <h1>InkLingo</h1>
        <p className="muted">Log in to capture words into your collections.</p>
        <button type="button" onClick={() => void handleLogin()} disabled={busy === 'login'}>
          {busy === 'login' ? 'Opening login…' : 'Log in'}
        </button>
        {error !== null && <p className="error">{error}</p>}
      </main>
    )
  }

  const variant = selectedVariant === null ? undefined : capture?.variants[selectedVariant]

  return (
    <main className="popup">
      <header>
        <h1>InkLingo</h1>
        <button type="button" className="link" onClick={() => void handleLogout()}>Log out</button>
      </header>

      {collections.length === 0 ? (
        <p className="muted">No collections yet — create one in the web app first.</p>
      ) : (
        <>
          <label className="field">
            <span>Collection</span>
            <select
              value={activeCollectionId}
              onChange={(event) => handleCollectionChange(event.target.value)}
            >
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name} ({collection.nativeLanguageCode} → {collection.targetLanguageCodes.join(', ')})
                </option>
              ))}
            </select>
          </label>

          <form onSubmit={(event) => void handleTranslate(event)}>
            <input
              type="text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Word or phrase, in either language"
              autoFocus
            />
            <button type="submit" disabled={busy !== null || text.trim().length === 0}>
              {busy === 'translate' ? 'Translating…' : 'Translate'}
            </button>
          </form>
        </>
      )}

      {error !== null && <p className="error">{error}</p>}
      {saved !== null && <p className="saved">{saved}</p>}

      {capture !== null && (
        <section className="results">
          <p className="normalized">{capture.wordOrPhrase}</p>

          {capture.variants.length === 0 ? (
            <p className="muted">No translations came back — try rephrasing.</p>
          ) : (
            <ul className="variants">
              {capture.variants.map((candidate, index) => (
                <li key={`${candidate.meaningText}-${index}`}>
                  <label>
                    <input
                      type="radio"
                      name="variant"
                      checked={selectedVariant === index}
                      onChange={() => {
                        setSelectedVariant(index)
                        setSelectedSentence(null)
                      }}
                    />
                    <span className="meaning">{candidate.meaningText}</span>
                    {candidate.phoneticTranscription !== null && (
                      <span className="phonetic">/{candidate.phoneticTranscription}/</span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          )}

          {variant !== undefined && (
            <>
              <div className="sentences-header">
                <h2>Example sentences</h2>
                <button
                  type="button"
                  className="link"
                  onClick={() => void handleRegenerate()}
                  disabled={busy !== null}
                >
                  {busy === 'regenerate' ? 'Regenerating…' : 'New sentences'}
                </button>
              </div>
              <ul className="sentences">
                {variant.sentences.map((candidate, index) => (
                  <li key={`${candidate.targetText}-${index}`}>
                    <label>
                      <input
                        type="radio"
                        name="sentence"
                        checked={selectedSentence === index}
                        onChange={() => setSelectedSentence(index)}
                      />
                      <span>
                        <span className="target">{candidate.targetText}</span>
                        <span className="gloss">{candidate.nativeGlossText}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy !== null || selectedVariant === null || selectedSentence === null}
          >
            {busy === 'save' ? 'Saving…' : 'Save to collection'}
          </button>
        </section>
      )}
    </main>
  )
}

export default App
