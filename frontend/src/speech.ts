// Framework-free wrapper over the Web Speech API. Everything awkward about
// speechSynthesis is hidden here: the voice list that isn't there yet on the
// first call, the BCP-47 vs. ISO-639-1 mismatch, and cancellation arriving as
// an error. No React — useSpeech.ts owns the state.
//
// speak(text, voice, handlers) is deliberately the seam a cloud fallback
// would slot in behind: no call site learns where the audio came from.
//
// Mirrors extension/src/speech.ts rather than sharing it: this repo has no
// shared package between its apps, the same reason languages.ts exists three
// times (see CLAUDE.md's Architecture section).

// Firefox returns an empty voice list from the first getVoices() call and
// only fills it in by the time 'voiceschanged' fires (measured 2026-08-03:
// first call [], second call en + pl). Without the event a cold browser
// disables every control; without the timeout a browser that never fires it
// leaves the UI pending forever.
const VOICE_LOAD_TIMEOUT_MS = 3000

// 'canceled' and 'interrupted' arrive on every deliberate stop or switch.
// Surfacing them would flash an error on entirely normal use.
const SILENT_ERRORS = new Set<string>(['canceled', 'interrupted'])

export interface SpeakHandlers {
  onEnd: () => void
  onError: (message: string) => void
}

function synthesis (): SpeechSynthesis | null {
  return typeof speechSynthesis === 'undefined' ? null : speechSynthesis
}

// Voice langs are BCP-47 ('en-US', 'pl-PL'); collection codes are bare
// ISO-639-1 ('en'). Only the primary subtag is comparable.
function primarySubtag (code: string): string {
  return code.trim().toLowerCase().split(/[-_]/)[0] ?? ''
}

export function loadVoices (): Promise<SpeechSynthesisVoice[]> {
  const speech = synthesis()
  return speech === null ? Promise.resolve([]) : resolveVoices(speech)
}

function resolveVoices (speech: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  const immediate = speech.getVoices()
  if (immediate.length > 0) {
    return Promise.resolve(immediate)
  }

  return new Promise((resolve) => {
    let settled = false
    function finish () {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      speech.removeEventListener('voiceschanged', finish)
      resolve(speech.getVoices())
    }
    const timer = setTimeout(finish, VOICE_LOAD_TIMEOUT_MS)
    speech.addEventListener('voiceschanged', finish)
  })
}

// Several voices commonly match one language (en-US, en-GB, multiple
// vendors) and PRD Non-Goals rule out letting the user choose, so the pick
// has to be deterministic — otherwise the same word comes back in a
// different accent on every click.
//
// Returns null rather than throwing for unknown or malformed codes: the
// pre-normalization codes still in the dev database ('EN', 'ENss') reduce to
// 'en' and 'enss', and 'enss' simply matches nothing.
export function findVoice (
  voices: SpeechSynthesisVoice[],
  languageCode: string
): SpeechSynthesisVoice | null {
  const wanted = primarySubtag(languageCode)
  if (wanted.length === 0) {
    return null
  }
  const matches = voices.filter((voice) => primarySubtag(voice.lang) === wanted)
  return matches.find((voice) => voice.default)
    ?? matches.find((voice) => voice.localService)
    ?? matches[0]
    ?? null
}

export function speak (text: string, voice: SpeechSynthesisVoice, handlers: SpeakHandlers): void {
  const speech = synthesis()
  if (speech === null) {
    handlers.onError('Audio playback is not available in this browser.')
    return
  }

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.voice = voice
  utterance.lang = voice.lang
  utterance.onend = () => {
    handlers.onEnd()
  }
  utterance.onerror = (event) => {
    if (SILENT_ERRORS.has(event.error)) {
      handlers.onEnd()
      return
    }
    handlers.onError(`Could not play this audio (${event.error}).`)
  }
  speech.speak(utterance)
}

export function cancel (): void {
  synthesis()?.cancel()
}
