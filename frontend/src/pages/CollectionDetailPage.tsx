import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import axios from 'axios'
import { addEntryTranslation, getCollection, type CollectionDetail, type Entry } from '../api/collections'
import { extractErrorMessage } from '../api/errors'
import { languageLabel } from '../languages'
import { useSpeech, type Speech } from '../useSpeech'

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

// FR-016, the saved-entry half. Keyed by database id rather than by index,
// since these rows have real ids.
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

function CollectionDetailPage () {
  const { id } = useParams<{ id: string }>()
  const [collection, setCollection] = useState<CollectionDetail | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Which entry+language backfill is in flight, so only that button spins.
  const [addingKey, setAddingKey] = useState<string | null>(null)
  // Playback state lives entirely in the hook, so a failed utterance never
  // touches the load/backfill error above it.
  const speech = useSpeech()

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

  // FR-018: one entry, one language, on request. Splices the new rows into
  // the entry in place rather than refetching the whole collection, so the
  // other entries visibly stay as they were.
  async function handleAddLanguage (entry: Entry, languageCode: string) {
    if (!id) {
      return
    }
    const key = `${entry.id}:${languageCode}`
    setAddingKey(key)
    setError(null)
    try {
      const added = await addEntryTranslation(id, entry.id, languageCode)
      setCollection((prev) => (prev === null ? prev : {
        ...prev,
        entries: prev.entries.map((candidate) => (
          candidate.id === entry.id
            ? {
                ...candidate,
                translations: [...candidate.translations, added.translation],
                sentences: [...candidate.sentences, added.sentence]
              }
            : candidate
        ))
      }))
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setAddingKey(null)
    }
  }

  if (loading) {
    return <p>Loading…</p>
  }

  if (notFound) {
    return <p>Collection not found.</p>
  }

  if (error && !collection) {
    return <p style={{ color: 'red' }}>{error}</p>
  }

  if (!collection) {
    return <p style={{ color: 'red' }}>Something went wrong.</p>
  }

  // One reason line for the page, not one per row: a collection holds many
  // entries in the same handful of languages, and legacy codes ('EN',
  // 'ENss') land here too — they resolve to no voice and read as their
  // uppercased selves.
  const spokenCodes = [...new Set(collection.entries.flatMap((entry) => [
    ...entry.translations.map((translation) => translation.languageCode),
    ...entry.sentences.map((sentence) => sentence.languageCode)
  ]))]
  const silentCodes = speech.ready ? spokenCodes.filter((code) => !speech.hasVoice(code)) : []

  return (
    <section>
      <h2>{collection.name}</h2>
      <p>
        <small>{collection.nativeLanguageCode} → {collection.targetLanguageCodes.join(', ')}</small>
      </p>
      {silentCodes.length > 0 && (
        <p>
          <small>
            No voice is installed on this computer for {silentCodes.map(languageLabel).join(', ')},
            so playback is unavailable for those.
          </small>
        </p>
      )}
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {collection.entries.length === 0 ? (
        <p>No entries yet.</p>
      ) : (
        <ul>
          {collection.entries.map((entry) => {
            // Languages the collection teaches that this entry predates.
            // Compared case-insensitively: POST /api/collections lowercases on
            // write, but collections created before that normalization landed
            // still hold codes like 'EN', which would otherwise never match a
            // saved 'en' translation and show a spurious "Add EN" button.
            const have = new Set(entry.translations.map((translation) => translation.languageCode.toLowerCase()))
            const missing = collection.targetLanguageCodes.filter((code) => !have.has(code.toLowerCase()))

            return (
              <li key={entry.id}>
                <strong>{entry.wordOrPhrase}</strong> ({entry.sourceLanguageCode})
                <ul>
                  {entry.translations.map((translation) => (
                    <li key={translation.id}>
                      {translation.languageCode}: {translation.meaningText}
                      {translation.phoneticTranscription && <em> {translation.phoneticTranscription}</em>}
                      {' '}
                      <SpeakButton
                        speech={speech}
                        itemKey={`${entry.id}:t:${translation.id}`}
                        text={translation.meaningText}
                        languageCode={translation.languageCode}
                      />
                    </li>
                  ))}
                </ul>
                <ul>
                  {entry.sentences.map((sentence) => (
                    <li key={sentence.id}>
                      {sentence.languageCode}: {sentence.sentenceText}
                      {sentence.nativeGlossText && <em> — {sentence.nativeGlossText}</em>}
                      {' '}
                      <SpeakButton
                        speech={speech}
                        itemKey={`${entry.id}:s:${sentence.id}`}
                        text={sentence.sentenceText}
                        languageCode={sentence.languageCode}
                      />
                    </li>
                  ))}
                </ul>
                {speech.error !== null && speech.error.key.startsWith(`${entry.id}:`) && (
                  <p style={{ color: 'red' }}>{speech.error.message}</p>
                )}
                {missing.length > 0 && (
                  <p>
                    <small>Missing: </small>
                    {missing.map((languageCode) => (
                      <button
                        key={languageCode}
                        type="button"
                        disabled={addingKey !== null}
                        onClick={() => void handleAddLanguage(entry, languageCode)}
                      >
                        {addingKey === `${entry.id}:${languageCode}` ? 'Adding…' : `Add ${languageCode}`}
                      </button>
                    ))}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default CollectionDetailPage
