import type { Collection, SavedEntry, TranslationResult } from './types.ts'

// The popup never talks to the backend directly — every call goes through
// the background script (see background.ts for why). This module is the
// contract between the two.

export interface CreateEntryBody {
  wordOrPhrase: string
  translations: Array<{ languageCode: string, meaningText: string, phoneticTranscription: string | null }>
  sentences: Array<{ languageCode: string, sentenceText: string, nativeGlossText: string }>
}

// What the popup can say about a failure it saw itself. Deliberately a subset
// of the reporter's ReportInput: the popup never sets app/version/timestamps,
// and never sees a backend correlation id, because by definition these are the
// failures that never reached the network.
export interface PopupErrorReport {
  name: string
  message: string
  stack?: string
  routePath?: string
}

export type Message =
  | { type: 'auth-status' }
  | { type: 'login' }
  | { type: 'logout' }
  | { type: 'list-collections' }
  | { type: 'translate', collectionId: string, text: string }
  | { type: 'save-entry', collectionId: string, entry: CreateEntryBody }
  // Reporting has to run in the background script: that is where the buffer
  // and host_permissions live, and where a report can outlive the popup
  // document Firefox destroys on focus loss.
  | { type: 'report-error', report: PopupErrorReport }

// What each message resolves to, keyed by its `type` so sendMessage()
// infers the right payload at every call site.
export interface MessageResults {
  'auth-status': { authenticated: boolean }
  login: { authenticated: boolean }
  logout: null
  'list-collections': Collection[]
  translate: TranslationResult
  'save-entry': SavedEntry
  'report-error': null
}

// Fire-and-forget reporting from the popup. Never throws and never rejects:
// every call site is already handling a failure, and a reporting problem must
// not displace the error the user is being shown. A background script that is
// asleep or restarting is itself one of the conditions worth reporting, which
// is exactly when this would fail — so it stays silent rather than cascading.
export function reportFromPopup (report: PopupErrorReport): void {
  void (async () => {
    try {
      await browser.runtime.sendMessage({ type: 'report-error', report })
    } catch {
      // Nothing further to do from inside a dying document.
    }
  })()
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
