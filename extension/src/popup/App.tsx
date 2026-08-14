import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { reportFromPopup, sendMessage } from '../messages.ts'
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
  // Every AI call is tagged with the generation it started under, and anything
  // that makes an in-flight result unwanted — a new call, a collection switch,
  // a logout — bumps it. A continuation whose generation is stale drops its
  // result instead of writing it. Same idiom, same reason as useSpeech.ts's
  // tokenRef: without it, a translate started under one collection can land,
  // render, and be saved under another.
  const generationRef = useRef(0)

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

  // Abandons whatever is in flight: the continuation will see a newer
  // generation and drop its result. Clearing the pending flags here is what
  // lets those continuations leave them alone — otherwise a discarded call
  // would either strand the UI in "Translating…" or clear a flag a newer call
  // now owns.
  function abandonInFlight () {
    generationRef.current += 1
    setBusy(null)
    setRegeneratingCode(null)
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
    abandonInFlight()
    await sendMessage({ type: 'logout' })
    setCollections([])
    setActiveCollectionId('')
    setText('')
    resetCapture()
    setSaved(null)
    setStatus('anonymous')
  }

  // Switching collection mid-call is a legitimate thing to do, so the select
  // stays enabled — but the languages the AI was asked for belong to the old
  // collection, so its answer must not survive the switch.
  function handleCollectionChange (id: string) {
    abandonInFlight()
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
    generationRef.current += 1
    const generation = generationRef.current
    setBusy('translate')
    setError(null)
    setSaved(null)
    try {
      const result = await sendMessage({ type: 'translate', collectionId: activeCollection.id, text: input })
      if (generationRef.current !== generation) {
        return
      }
      // Counted here, not in render: a language with no variants renders the
      // "Nothing came back" line on every re-render, and this is a
      // once-per-result fact. A 200 that is useless to the user is invisible
      // to every other layer — the request succeeded and the body parsed.
      // lessons.md measured this class at ~9% of live calls.
      const empty = result.languages.filter((language) => language.variants.length === 0)
      if (empty.length > 0) {
        reportFromPopup({
          name: 'DegradedAiResult',
          message: `translate returned no variants for ${String(empty.length)} of ${String(result.languages.length)} language(s)`,
          routePath: `ai:translate:${empty.map((language) => language.languageCode).join(',')}`
        })
      }
      setCapture({ input, wordOrPhrase: result.normalizedNativeText, languages: result.languages })
      setSelections(initialSelections(result.languages))
    } catch (err) {
      if (generationRef.current !== generation) {
        return
      }
      setError(errorText(err))
    } finally {
      // Only the call that still owns this generation clears the flag; a
      // superseded one would otherwise unlock the form under a live request.
      if (generationRef.current === generation) {
        setBusy(null)
      }
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

    generationRef.current += 1
    const generation = generationRef.current
    setRegeneratingCode(languageCode)
    setError(null)
    try {
      const result = await sendMessage({ type: 'translate', collectionId: activeCollection.id, text: capture.input })
      if (generationRef.current !== generation) {
        return
      }
      // Generation is non-deterministic, so a fresh response can order the
      // senses differently or return a different set of them — pair by
      // meaning, never by position. Attaching one sense's sentences to
      // another is exactly the mismatch that nesting sentences under variants
      // exists to prevent.
      const fresh = result.languages
        .find((candidate) => candidate.languageCode === languageCode)
        ?.variants.find((candidate) => sameMeaning(candidate.meaningText, selected.meaningText))
      if (fresh === undefined) {
        // A 200 that is useless to the user. Nothing else in the system can
        // see this: the request succeeded, so no interceptor fires, and the
        // response parsed fine. lessons.md measured this class at ~9% of live
        // calls ("A stubbed AI client cannot tell you the model's output is
        // usable") — reporting it is the only way that number stays known.
        reportFromPopup({
          name: 'DegradedAiResult',
          message: 'regenerate returned no matching sense for the selected meaning',
          routePath: `ai:regenerate:${languageCode}`
        })
        setError(`No new ${languageLabel(languageCode)} sentences came back for this meaning — try again.`)
        return
      }
      // Functional, not a rebuild from the closure's `capture`: that snapshot
      // is from before the await, and writing it back would revert anything
      // that changed meanwhile.
      setCapture((prev) => (prev === null ? prev : {
        ...prev,
        languages: prev.languages.map((candidate) => (
          candidate.languageCode === languageCode
            ? {
                ...candidate,
                variants: candidate.variants.map((variant, index) => (
                  index === selectedIndex ? { ...variant, sentences: fresh.sentences } : variant
                ))
              }
            : candidate
        ))
      }))
      // The sentence pick is dropped because its list was just replaced — but
      // only if the user is still on the meaning that was regenerated. Forcing
      // selectedIndex back would silently undo a variant they picked while
      // waiting.
      setSelections((prev) => (
        prev[languageCode]?.variant === selectedIndex
          ? { ...prev, [languageCode]: { variant: selectedIndex, sentence: null } }
          : prev
      ))
    } catch (err) {
      if (generationRef.current !== generation) {
        return
      }
      setError(errorText(err))
    } finally {
      if (generationRef.current === generation) {
        setRegeneratingCode(null)
      }
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
    generationRef.current += 1
    const generation = generationRef.current
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
      const languageCount = picks.length === 1 ? '1 language' : `${picks.length} languages`
      // Shown even if the user has moved on: it names the collection the entry
      // actually landed in, so it stays true either way.
      setSaved(`Saved “${entry.wordOrPhrase}” to ${activeCollection.name} in ${languageCount}.`)
      if (generationRef.current !== generation) {
        // Switched collections while the save ran. The entry is safely stored,
        // but the last-used pointer and the input box belong to the new choice
        // now — writing the pre-await id back would silently undo the switch.
        return
      }
      await rememberCollection(activeCollection.id)
      setText('')
      resetCapture()
    } catch (err) {
      if (generationRef.current !== generation) {
        return
      }
      setError(errorText(err))
    } finally {
      if (generationRef.current === generation) {
        setBusy(null)
      }
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
              // The submit button below is already disabled while a call runs,
              // but Enter in this field is not — that path starts a second
              // concurrent AI call, doubling the spend on the rate-limited
              // route and racing two writes against the same capture.
              disabled={working}
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
                {speech.loadFailed ? (
                  <p className="muted">
                    Audio playback is unavailable — the voice list could not be read.
                  </p>
                ) : speech.ready && !speech.hasVoice(language.languageCode) && (
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
