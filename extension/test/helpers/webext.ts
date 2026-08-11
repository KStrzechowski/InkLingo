// A fake for the two WebExtension APIs the popup actually touches:
// browser.runtime.sendMessage (via src/messages.ts) and browser.storage.local
// (called directly by src/popup/App.tsx). jsdom provides neither —
// @types/firefox-webext-browser declares `browser` globally, so TypeScript is
// satisfied while the runtime value is simply missing.
//
// Faked wholesale rather than mocking src/messages.ts, so the real ok/error
// envelope unwrapping in sendMessage() stays in the path — the popup's entire
// error UI depends on it. Same role as frontend/test/helpers/oidc.ts: extend
// this rather than re-mocking ad hoc.

import type { Message, MessageResponse } from '../../src/messages.ts'

type MessageType = Message['type']

// Returns the `data` half of the envelope. Throwing (or rejecting) here models
// a background handler that failed, which the popup sees as { ok: false }.
export type MessageHandler = (message: Message) => unknown

export interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: Error) => void
}

// A response the test resolves by hand. This is what the race tests are made
// of: without control over *when* a call lands, an in-flight state cannot be
// observed at all.
export function deferred<T = unknown> (): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: Error) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export interface FakeBrowser {
  // Per-message-type handlers. Assign in a test to script a response; a
  // handler may return a value or a promise (see deferred() above).
  handlers: Partial<Record<MessageType, MessageHandler>>
  // Backing store for browser.storage.local, readable and seedable by tests.
  store: Record<string, unknown>
  // Every message the popup sent, in order — for asserting what was requested
  // and with which collection id.
  sent: Message[]
}

function buildApi (fake: FakeBrowser): unknown {
  return {
    runtime: {
      // Mirrors background.ts's handle(): a thrown error comes back as
      // { ok: false, error }, never as a rejected sendMessage. Getting this
      // wrong would let every error-path test pass against a contract the real
      // background script does not honor.
      sendMessage: async (message: Message): Promise<MessageResponse<unknown>> => {
        fake.sent.push(message)
        const handler = fake.handlers[message.type]
        if (handler === undefined) {
          return { ok: false, error: `no fake handler registered for "${message.type}"` }
        }
        try {
          return { ok: true, data: await handler(message) }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
        }
      }
    },
    storage: {
      local: {
        // The popup only ever reads one key at a time (App.tsx's
        // LAST_COLLECTION_KEY). Anything else throws rather than quietly
        // returning {}, so a future caller can't get a silent wrong answer.
        get: async (key: string): Promise<Record<string, unknown>> => {
          if (typeof key !== 'string') {
            throw new Error('fake storage.local.get only supports a single string key')
          }
          return key in fake.store ? { [key]: fake.store[key] } : {}
        },
        set: async (items: Record<string, unknown>): Promise<void> => {
          Object.assign(fake.store, items)
        }
      }
    }
  }
}

// Installs onto globalThis and returns the handle. Call in beforeEach: each
// test gets its own handlers, store and sent-log, so nothing leaks between
// tests the way a module-level mock would.
export function installFakeBrowser (): FakeBrowser {
  const fake: FakeBrowser = { handlers: {}, store: {}, sent: [] }
  Object.defineProperty(globalThis, 'browser', {
    value: buildApi(fake),
    configurable: true,
    writable: true
  })
  return fake
}

export function uninstallFakeBrowser (): void {
  Reflect.deleteProperty(globalThis, 'browser')
}
