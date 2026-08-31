import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { reportFromPopup, sendMessage } from '../messages.ts'
import { languageLabel } from '../languages.ts'
import { useSpeech, type Speech } from '../useSpeech.ts'
import type { Collection, TranslationSense } from '../types.ts'

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
  senses: TranslationSense[]
}

// This replaces `sameMeaning` (`one.trim().toLowerCase() === other...`) as
// the identity rule for a meaning: a frozen local copy of
// `backend/src/domain/senseKey.ts`, per this repo's no-shared-package
// convention. Deliberately the same weak comparison — chosen for continuity,
// not because it is right (see that file's own note on the limit).
function senseKey (glossText: string): string {
  return glossText.trim().toLowerCase()
}

// One picked sentence index per (senseKey, languageCode). A nested map
// rather than a flat string-joined key, so there is nothing to parse and
// nothing for a meaning's gloss text to accidentally collide with.
type SentencePicks = Record<string, Record<string, number>>

function pickFor (picks: SentencePicks, key: string, languageCode: string): number | undefined {
  return picks[key]?.[languageCode]
}

function withPick (picks: SentencePicks, key: string, languageCode: string, index: number): SentencePicks {
  return { ...picks, [key]: { ...picks[key], [languageCode]: index } }
}

// Unchecking a meaning drops its sentence picks — the same rule
// `selectVariant` used to apply when a variant changed, and for the same
// reason: a stale pick must not silently reappear if the meaning is
// re-checked later.
function withoutSense (picks: SentencePicks, key: string): SentencePicks {
  const next = { ...picks }
  delete next[key]
  return next
}

function regenKeyOf (key: string, languageCode: string): string {
  return `${key}::${languageCode}`
}

function errorText (err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong'
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

// D-3: every meaning starts checked, mirroring the old "the first variant is
// preselected" default — the common case is a single meaning, and checking
// it by hand for every capture would be pure friction. Nothing is checked
// beneath that: sentences are still an active choice.
function initialCheckedSenses (senses: TranslationSense[]): Set<string> {
  return new Set(senses.map((sense) => senseKey(sense.glossText)))
}

// A checked meaning with every one of its languages' sentences picked.
// Sparse spokes do not weaken this: `sense.translations` only ever lists the
// languages this meaning actually has a word for.
function isSenseReady (sense: TranslationSense, checked: ReadonlySet<string>, picks: SentencePicks): boolean {
  const key = senseKey(sense.glossText)
  if (!checked.has(key)) {
    return false
  }
  return sense.translations.every((translation) => pickFor(picks, key, translation.languageCode) !== undefined)
}

function App () {
  const [status, setStatus] = useState<Status>('loading')
  const [collections, setCollections] = useState<Collection[]>([])
  const [activeCollectionId, setActiveCollectionId] = useState('')
  const [text, setText] = useState('')
  const [capture, setCapture] = useState<Capture | null>(null)
  const [checkedSenses, setCheckedSenses] = useState<Set<string>>(new Set())
  const [sentencePicks, setSentencePicks] = useState<SentencePicks>({})
  const [busy, setBusy] = useState<Busy>(null)
  const [regeneratingKey, setRegeneratingKey] = useState<string | null>(null)
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
  const working = busy !== null || regeneratingKey !== null

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
    setCheckedSenses(new Set())
    setSentencePicks({})
  }

  // Abandons whatever is in flight: the continuation will see a newer
  // generation and drop its result. Clearing the pending flags here is what
  // lets those continuations leave them alone — otherwise a discarded call
  // would either strand the UI in "Translating…" or clear a flag a newer call
  // now owns.
  function abandonInFlight () {
    generationRef.current += 1
    setBusy(null)
    setRegeneratingKey(null)
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

  function toggleSense (key: string) {
    const next = new Set(checkedSenses)
    if (next.has(key)) {
      next.delete(key)
      setSentencePicks((prev) => withoutSense(prev, key))
    } else {
      next.add(key)
    }
    setCheckedSenses(next)
  }

  function pickSentence (key: string, languageCode: string, index: number) {
    setSentencePicks((prev) => withPick(prev, key, languageCode, index))
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
      // The degradation counting that used to live here is gone. Its all-empty
      // half is now a 502 the catch below already handles, and its partial half
      // is logged by the backend on every request rather than only by popups
      // that stayed open long enough to report. Counting it here too would
      // count one condition twice in two systems.
      setCapture({ input, wordOrPhrase: result.normalizedNativeText, senses: result.senses })
      setCheckedSenses(initialCheckedSenses(result.senses))
      setSentencePicks({})
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

  // FR-012 regenerates sentences only, for one (meaning, language) pair. The
  // backend has a single all-languages, all-meanings call, so this re-asks
  // for everything and keeps just this pair's fresh sentences — every other
  // meaning and language keeps what it was first shown.
  async function handleRegenerate (glossText: string, languageCode: string) {
    const key = senseKey(glossText)
    const sense = capture?.senses.find((candidate) => senseKey(candidate.glossText) === key)
    const translation = sense?.translations.find((candidate) => candidate.languageCode === languageCode)
    if (capture === null || activeCollection === undefined || translation === undefined) {
      return
    }

    generationRef.current += 1
    const generation = generationRef.current
    const regenKey = regenKeyOf(key, languageCode)
    setRegeneratingKey(regenKey)
    setError(null)
    try {
      const result = await sendMessage({ type: 'translate', collectionId: activeCollection.id, text: capture.input })
      if (generationRef.current !== generation) {
        return
      }
      // Generation is non-deterministic, so a fresh response can order the
      // senses differently or return a different set of them — pair by
      // senseKey, never by position. A sense is now findable across
      // languages, which is what the entry-level model buys.
      const fresh = result.senses
        .find((candidate) => senseKey(candidate.glossText) === key)
        ?.translations.find((candidate) => candidate.languageCode === languageCode)
      if (fresh === undefined) {
        // A 200 that is useless to the user. Nothing else in the system can
        // see this: the request succeeded, so no interceptor fires, and the
        // response parsed fine. lessons.md measured this class at ~9% of live
        // calls ("A stubbed AI client cannot tell you the model's output is
        // usable") — reporting it is the only way that number stays known.
        reportFromPopup({
          name: 'DegradedAiResult',
          message: 'regenerate returned no matching sense/language for the selected meaning',
          routePath: `ai:regenerate:${key}:${languageCode}`
        })
        setError(`No new ${languageLabel(languageCode)} sentences came back for this meaning — try again.`)
        return
      }
      // Functional, not a rebuild from the closure's `capture`: that snapshot
      // is from before the await, and writing it back would revert anything
      // that changed meanwhile.
      setCapture((prev) => (prev === null ? prev : {
        ...prev,
        senses: prev.senses.map((candidate) => (
          senseKey(candidate.glossText) === key
            ? {
                ...candidate,
                translations: candidate.translations.map((candidateTranslation) => (
                  candidateTranslation.languageCode === languageCode
                    ? { ...candidateTranslation, sentences: fresh.sentences }
                    : candidateTranslation
                ))
              }
            : candidate
        ))
      }))
      // The old sentence index is now stale against a brand-new list. Unlike
      // the old per-language "current variant" model there is no race to
      // guard here: checking is independent per meaning, so nothing else —
      // no other sense, language, or checked state — is touched by this
      // write, regardless of what the user did elsewhere while it was
      // in flight.
      setSentencePicks((prev) => {
        const forSense = { ...prev[key] }
        delete forSense[languageCode]
        return { ...prev, [key]: forSense }
      })
    } catch (err) {
      if (generationRef.current !== generation) {
        return
      }
      setError(errorText(err))
    } finally {
      if (generationRef.current === generation) {
        setRegeneratingKey(null)
      }
    }
  }

  // D-3's restated gate: at least one meaning is checked, and every checked
  // meaning has a sentence chosen in each language it carries a word for. A
  // meaning the model returned no word for in some language is a sparse
  // spoke and must not block save — `sense.translations` already excludes
  // that language, so `isSenseReady` never asks about it.
  const checkedSenseList = capture?.senses.filter((sense) => checkedSenses.has(senseKey(sense.glossText))) ?? []
  const readySenses = capture?.senses.filter((sense) => isSenseReady(sense, checkedSenses, sentencePicks)) ?? []
  const readyToSave = checkedSenseList.length > 0 && readySenses.length === checkedSenseList.length

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
          senses: checkedSenseList.map((sense) => {
            const key = senseKey(sense.glossText)
            return {
              glossText: sense.glossText,
              // readyToSave guarantees every translation of a checked sense
              // has a pick, so this mapping is total.
              translations: sense.translations.map((translation) => {
                const index = pickFor(sentencePicks, key, translation.languageCode) as number
                const sentence = translation.sentences[index]
                return {
                  languageCode: translation.languageCode,
                  meaningText: translation.meaningText,
                  phoneticTranscription: translation.phoneticTranscription,
                  sentences: [{ sentenceText: sentence.targetText, nativeGlossText: sentence.nativeGlossText }]
                }
              })
            }
          })
        }
      })
      const meaningCount = checkedSenseList.length === 1 ? '1 meaning' : `${checkedSenseList.length} meanings`
      // Shown even if the user has moved on: it names the collection the entry
      // actually landed in, so it stays true either way.
      setSaved(`Saved “${entry.wordOrPhrase}” to ${activeCollection.name} in ${meaningCount}.`)
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

          {capture.senses.map((sense) => {
            const key = senseKey(sense.glossText)
            const checked = checkedSenses.has(key)

            return (
              <section className="sense" key={key}>
                <label className="sense-toggle">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSense(key)}
                  />
                  <span className="meaning">{sense.glossText}</span>
                </label>

                {checked && sense.translations.map((translation) => {
                  const pickedIndex = pickFor(sentencePicks, key, translation.languageCode)
                  const regenKey = regenKeyOf(key, translation.languageCode)
                  const errorKeyPrefix = `${key}:${translation.languageCode}:`

                  return (
                    <section className="language" key={translation.languageCode}>
                      <h3>
                        {languageLabel(translation.languageCode)}: {translation.meaningText}
                        {translation.phoneticTranscription !== null && (
                          <span className="phonetic">/{translation.phoneticTranscription}/</span>
                        )}
                        <SpeakButton
                          speech={speech}
                          itemKey={`${errorKeyPrefix}word`}
                          text={translation.meaningText}
                          languageCode={translation.languageCode}
                        />
                      </h3>

                      {speech.loadFailed ? (
                        <p className="muted">
                          Audio playback is unavailable — the voice list could not be read.
                        </p>
                      ) : speech.ready && !speech.hasVoice(translation.languageCode) && (
                        <p className="muted">
                          No {languageLabel(translation.languageCode)} voice is installed on this computer, so playback is unavailable here.
                        </p>
                      )}
                      {speech.error !== null && speech.error.key.startsWith(errorKeyPrefix) && (
                        <p className="error">{speech.error.message}</p>
                      )}

                      <div className="sentences-header">
                        <h4>Example sentences</h4>
                        <button
                          type="button"
                          className="link"
                          onClick={() => void handleRegenerate(sense.glossText, translation.languageCode)}
                          disabled={working}
                        >
                          {regeneratingKey === regenKey ? 'Regenerating…' : 'New sentences'}
                        </button>
                      </div>
                      <ul className="sentences">
                        {translation.sentences.map((candidate, index) => (
                          <li key={`${candidate.targetText}-${index}`}>
                            <label>
                              <input
                                type="radio"
                                name={`sentence-${key}-${translation.languageCode}`}
                                checked={pickedIndex === index}
                                onChange={() => pickSentence(key, translation.languageCode, index)}
                              />
                              <span>
                                <span className="target">{candidate.targetText}</span>
                                <span className="gloss">{candidate.nativeGlossText}</span>
                              </span>
                            </label>
                            <SpeakButton
                              speech={speech}
                              itemKey={`${errorKeyPrefix}sentence:${index}`}
                              text={candidate.targetText}
                              languageCode={translation.languageCode}
                            />
                          </li>
                        ))}
                      </ul>
                    </section>
                  )
                })}
              </section>
            )
          })}

          {capture.senses.length > 1 && (
            <p className="muted">{readySenses.length} of {capture.senses.length} meanings chosen</p>
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
