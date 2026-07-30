import type { Collection, SavedEntry, TranslationResult } from './types.ts'

// The popup never talks to the backend directly — every call goes through
// the background script (see background.ts for why). This module is the
// contract between the two.

export interface CreateEntryBody {
  wordOrPhrase: string
  translations: Array<{ languageCode: string, meaningText: string, phoneticTranscription: string | null }>
  sentences: Array<{ languageCode: string, sentenceText: string, nativeGlossText: string }>
}

export type Message =
  | { type: 'auth-status' }
  | { type: 'login' }
  | { type: 'logout' }
  | { type: 'list-collections' }
  | { type: 'translate', collectionId: string, text: string }
  | { type: 'save-entry', collectionId: string, entry: CreateEntryBody }

// What each message resolves to, keyed by its `type` so sendMessage()
// infers the right payload at every call site.
export interface MessageResults {
  'auth-status': { authenticated: boolean }
  login: { authenticated: boolean }
  logout: null
  'list-collections': Collection[]
  translate: TranslationResult
  'save-entry': SavedEntry
}

export type MessageResponse<T> =
  | { ok: true, data: T }
  | { ok: false, error: string }

// Unwraps the background script's ok/error envelope so popup callers can
// use plain try/catch instead of branching on every response.
export async function sendMessage<M extends Message> (message: M): Promise<MessageResults[M['type']]> {
  const response = await browser.runtime.sendMessage(message) as MessageResponse<MessageResults[M['type']]>
  if (!response.ok) {
    throw new Error(response.error)
  }
  return response.data
}
