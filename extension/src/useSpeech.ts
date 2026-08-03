import { useCallback, useEffect, useRef, useState } from 'react'
import { cancel, findVoice, loadVoices, speak } from './speech.ts'

// Plain .ts, no JSX: a file exporting a hook next to a component trips
// oxlint's react/only-export-components (see context/foundation/lessons.md).

export interface SpeechError {
  key: string
  message: string
}

export interface Speech {
  // False until the voice list has resolved. Callers must render a pending
  // state while it is false — "not loaded yet" is not "no voice for this
  // language", and treating it as such disables every control on a cold
  // browser.
  ready: boolean
  hasVoice: (languageCode: string) => boolean
  speakingKey: string | null
  play: (key: string, text: string, languageCode: string) => void
  stop: () => void
  error: SpeechError | null
}

export function useSpeech (): Speech {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[] | null>(null)
  const [speakingKey, setSpeakingKey] = useState<string | null>(null)
  const [error, setError] = useState<SpeechError | null>(null)
  // Every utterance is tagged with the token it started under. cancel() fires
  // the outgoing utterance's onend, and under cancel-and-replace that arrives
  // *after* the replacement is already speaking — so lifecycle events from a
  // superseded utterance have to be dropped rather than clearing the new one.
  const tokenRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    loadVoices()
      .then((resolved) => {
        if (!cancelled) {
          setVoices(resolved)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVoices([])
        }
      })

    // Firefox destroys the popup document when it loses focus, and speech
    // started there should not outlive it. The same cleanup covers route
    // changes in the web app.
    return () => {
      cancelled = true
      tokenRef.current += 1
      cancel()
    }
  }, [])

  const hasVoice = useCallback(
    (languageCode: string): boolean => voices !== null && findVoice(voices, languageCode) !== null,
    [voices]
  )

  const stop = useCallback(() => {
    tokenRef.current += 1
    cancel()
    setSpeakingKey(null)
  }, [])

  const play = useCallback((key: string, text: string, languageCode: string) => {
    if (voices === null) {
      return
    }
    const voice = findVoice(voices, languageCode)
    if (voice === null) {
      return
    }

    tokenRef.current += 1
    const token = tokenRef.current
    cancel()
    setError(null)
    setSpeakingKey(key)
    speak(text, voice, {
      onEnd: () => {
        if (tokenRef.current === token) {
          setSpeakingKey(null)
        }
      },
      onError: (message) => {
        if (tokenRef.current !== token) {
          return
        }
        setSpeakingKey(null)
        setError({ key, message })
      }
    })
  }, [voices])

  return { ready: voices !== null, hasVoice, speakingKey, play, stop, error }
}
