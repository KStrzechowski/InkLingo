import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { sendMessage } from '../messages.ts'
import { languageLabel } from '../languages.ts'
import { useSpeech, type Speech } from '../useSpeech.ts'
import type { Collection, TranslationLanguage } from '../types.ts'

// FR-013's "default to the last-used collection" — the collection has to
// be resolved before the input box is usable, since the native/target
// languages the AI call needs live on the collection, not the account.
const LAST_COLLECTION_KEY = 'lastCollectionId'

type Status = 'loading' | 'anonymous' | 'ready'
type Busy = 'login' | 'translate' | 'save' | null

interface Capture {
  // What the user typed, kept verbatim so regeneration re-asks the same
  // question rather than the normalized form.
  input: string
  // The normalized native-language form from the AI response — this is
  // what gets persisted, because the backend stamps every entry's
  // source_language_code with the collection's native language.
  wordOrPhrase: string
  languages: TranslationLanguage[]
}

// One pick per target language. Indices into that language's own arrays.
interface Selection {
  variant: number | null
  sentence: number | null
}

function errorText (err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong'
}

function sameMeaning (one: string, other: string): boolean {
  return one.trim().toLowerCase() === other.trim().toLowerCase()
}

function speakTitle (speech: Speech, languageCode: string, speaking: boolean): string {
  if (speaking) {
    return 'Stop'
  }
  if (!speech.ready) {
    return 'Loading voices…'
  }
  if (!speech.hasVoice(languageCode)) {
    return `No ${languageLabel(languageCode)} voice installed on this computer`
  }
  return `Play in ${languageLabel(languageCode)}`
}

// FR-016. Rendered as a sibling of the row's <label>, never inside it: a
// button nested in a label makes every play click also select that row's
// radio.
function SpeakButton ({ speech, itemKey, text, languageCode }: {
  speech: Speech
  itemKey: string
  text: string
  languageCode: string
}) {
  const speaking = speech.speakingKey === itemKey
  const title = speakTitle(speech, languageCode, speaking)

  return (
    <button
      type="button"
      className={speaking ? 'speak speaking' : 'speak'}
      disabled={!speech.ready || !speech.hasVoice(languageCode)}
      title={title}
      aria-label={title}
      onClick={() => {
        if (speaking) {
          speech.stop()
        } else {
          speech.play(itemKey, text, languageCode)
        }
      }}
    >
      {speaking ? '◼' : '▶'}
    </button>
  )
}

function initialSelections (languages: TranslationLanguage[]): Record<string, Selection> {
  return Object.fromEntries(languages.map((language) => [
    language.languageCode,
    { variant: language.variants.length > 0 ? 0 : null, sentence: null }
  ]))
}

function App () {
  const [status, setStatus] = useState<Status>('loading')
  const [collections, setCollections] = useState<Collection[]>([])
  const [activeCollectionId, setActiveCollectionId] = useState('')
  const [text, setText] = useState('')
  const [capture, setCapture] = useState<Capture | null>(null)
  const [selections, setSelections] = useState<Record<string, Selection>>({})
  const [busy, setBusy] = useState<Busy>(null)
  const [regeneratingCode, setRegeneratingCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  // Playback state lives entirely in the hook, so a failed utterance never
  // touches the capture/save error above it.
  const speech = useSpeech()

  const activeCollection = collections.find((collection) => collection.id === activeCollectionId)
  const working = busy !== null || regeneratingCode !== null

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
    setSelections({})
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

  function selectVariant (languageCode: string, index: number) {
    // Sentences belong to a specific variant, so switching variant drops the
    // sentence pick rather than carrying an index into a different list.
    setSelections((prev) => ({ ...prev, [languageCode]: { variant: index, sentence: null } }))
  }

  function selectSentence (languageCode: string, index: number) {
    setSelections((prev) => ({
      ...prev,
      [languageCode]: { variant: prev[languageCode]?.variant ?? null, sentence: index }
    }))
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
      setCapture({ input, wordOrPhrase: result.normalizedNativeText, languages: result.languages })
      setSelections(initialSelections(result.languages))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  // FR-012 regenerates sentences only, and only under the variant the user is
  // looking at in one language. The backend has a single all-languages call,
  // so this re-asks for everything and then keeps just this language's fresh
  // sentences — every other language keeps what it was first shown.
  async function handleRegenerate (languageCode: string) {
    const language = capture?.languages.find((candidate) => candidate.languageCode === languageCode)
    const selectedIndex = selections[languageCode]?.variant
    const selected = selectedIndex === null || selectedIndex === undefined
      ? undefined
      : language?.variants[selectedIndex]
    if (capture === null || activeCollection === undefined || selected === undefined) {
      return
    }

    setRegeneratingCode(languageCode)
    setError(null)
    try {
      const result = await sendMessage({ type: 'translate', collectionId: activeCollection.id, text: capture.input })
      // Generation is non-deterministic, so a fresh response can order the
      // senses differently or return a different set of them — pair by
      // meaning, never by position. Attaching one sense's sentences to
      // another is exactly the mismatch that nesting sentences under variants
      // exists to prevent.
      const fresh = result.languages
        .find((candidate) => candidate.languageCode === languageCode)
        ?.variants.find((candidate) => sameMeaning(candidate.meaningText, selected.meaningText))
      if (fresh === undefined) {
        setError(`No new ${languageLabel(languageCode)} sentences came back for this meaning — try again.`)
        return
      }
      setCapture({
        ...capture,
        languages: capture.languages.map((candidate) => (
          candidate.languageCode === languageCode
            ? {
                ...candidate,
                variants: candidate.variants.map((variant, index) => (
                  index === selectedIndex ? { ...variant, sentences: fresh.sentences } : variant
                ))
              }
            : candidate
        ))
      })
      setSelections((prev) => ({ ...prev, [languageCode]: { variant: selectedIndex, sentence: null } }))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setRegeneratingCode(null)
    }
  }

  // A language the model returned nothing for can't be picked, so it doesn't
  // count towards "everything chosen" — but every language that does have
  // variants must have a complete pick before the entry is saved.
  const pickable = capture?.languages.filter((language) => language.variants.length > 0) ?? []
  const picks = pickable.flatMap((language) => {
    const selection = selections[language.languageCode]
    const variant = selection?.variant === null || selection?.variant === undefined
      ? undefined
      : language.variants[selection.variant]
    const sentence = selection?.sentence === null || selection?.sentence === undefined
      ? undefined
      : variant?.sentences[selection.sentence]
    return variant !== undefined && sentence !== undefined
      ? [{ languageCode: language.languageCode, variant, sentence }]
      : []
  })
  const readyToSave = pickable.length > 0 && picks.length === pickable.length

  async function handleSave () {
    if (capture === null || activeCollection === undefined || !readyToSave) {
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
          translations: picks.map(({ languageCode, variant }) => ({
            languageCode,
            meaningText: variant.meaningText,
            phoneticTranscription: variant.phoneticTranscription
          })),
          sentences: picks.map(({ languageCode, sentence }) => ({
            languageCode,
            sentenceText: sentence.targetText,
            nativeGlossText: sentence.nativeGlossText
          }))
        }
      })
      await rememberCollection(activeCollection.id)
      const languageCount = picks.length === 1 ? '1 language' : `${picks.length} languages`
      setSaved(`Saved “${entry.wordOrPhrase}” to ${activeCollection.name} in ${languageCount}.`)
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
            <button type="submit" disabled={working || text.trim().length === 0}>
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

          {capture.languages.map((language) => {
            const selection = selections[language.languageCode]
            const selectedVariant = selection?.variant === null || selection?.variant === undefined
              ? undefined
              : language.variants[selection.variant]

            return (
              <section className="language" key={language.languageCode}>
                <h2>{languageLabel(language.languageCode)}</h2>

                {/* One reason line per language, not per row — the popup is
                    380px wide and a block can hold several variants and
                    several sentences. */}
                {speech.ready && !speech.hasVoice(language.languageCode) && (
                  <p className="muted">
                    No {languageLabel(language.languageCode)} voice is installed on this computer, so playback is unavailable here.
                  </p>
                )}
                {speech.error !== null && speech.error.key.startsWith(`${language.languageCode}:`) && (
                  <p className="error">{speech.error.message}</p>
                )}

                {language.variants.length === 0 ? (
                  <p className="muted">Nothing came back for this language — try translating again.</p>
                ) : (
                  <ul className="variants">
                    {language.variants.map((candidate, index) => (
                      <li key={`${candidate.meaningText}-${index}`}>
                        <label>
                          <input
                            type="radio"
                            name={`variant-${language.languageCode}`}
                            checked={selection?.variant === index}
                            onChange={() => selectVariant(language.languageCode, index)}
                          />
                          <span className="meaning">{candidate.meaningText}</span>
                          {candidate.phoneticTranscription !== null && (
                            <span className="phonetic">/{candidate.phoneticTranscription}/</span>
                          )}
                        </label>
                        <SpeakButton
                          speech={speech}
                          itemKey={`${language.languageCode}:variant:${index}`}
                          text={candidate.meaningText}
                          languageCode={language.languageCode}
                        />
                      </li>
                    ))}
                  </ul>
                )}

                {selectedVariant !== undefined && (
                  <>
                    <div className="sentences-header">
                      <h2>Example sentences</h2>
                      <button
                        type="button"
                        className="link"
                        onClick={() => void handleRegenerate(language.languageCode)}
                        disabled={working}
                      >
                        {regeneratingCode === language.languageCode ? 'Regenerating…' : 'New sentences'}
                      </button>
                    </div>
                    <ul className="sentences">
                      {selectedVariant.sentences.map((candidate, index) => (
                        <li key={`${candidate.targetText}-${index}`}>
                          <label>
                            <input
                              type="radio"
                              name={`sentence-${language.languageCode}`}
                              checked={selection?.sentence === index}
                              onChange={() => selectSentence(language.languageCode, index)}
                            />
                            <span>
                              <span className="target">{candidate.targetText}</span>
                              <span className="gloss">{candidate.nativeGlossText}</span>
                            </span>
                          </label>
                          <SpeakButton
                            speech={speech}
                            itemKey={`${language.languageCode}:sentence:${index}`}
                            text={candidate.targetText}
                            languageCode={language.languageCode}
                          />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )
          })}

          {pickable.length > 1 && (
            <p className="muted">{picks.length} of {pickable.length} languages chosen</p>
          )}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={working || !readyToSave}
          >
            {busy === 'save' ? 'Saving…' : 'Save to collection'}
          </button>
        </section>
      )}
    </main>
  )
}

export default App
