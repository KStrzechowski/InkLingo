// Drives the real background.ts against a faked `browser` global — the
// opposite role from webext.ts's FakeBrowser, which stands in FOR
// background.ts on the popup's side. This harness captures the listener
// background.ts registers at import time and lets a test invoke it directly,
// bypassing sendMessage()'s envelope entirely.

import { vi } from 'vitest'
import type { Message, MessageResponse } from '../../src/messages.ts'

type Listener = (message: Message) => Promise<MessageResponse<unknown>>

export interface BackgroundHarness {
  // Backing store for browser.storage.local. Seed store['auth'] with
  // fakeIdToken() before invoke() to give apiFetch a usable token without
  // ever exercising auth.ts's own network calls.
  store: Record<string, unknown>
  invoke: (message: Message) => Promise<MessageResponse<unknown>>
}

function buildApi (store: Record<string, unknown>, captured: { listener: Listener | null }): unknown {
  return {
    runtime: {
      onMessage: {
        addListener: (fn: Listener) => { captured.listener = fn }
      }
    },
    storage: {
      local: {
        get: async (key: string): Promise<Record<string, unknown>> => {
          if (typeof key !== 'string') {
            throw new Error('fake storage.local.get only supports a single string key')
          }
          return key in store ? { [key]: store[key] } : {}
        },
        set: async (items: Record<string, unknown>): Promise<void> => {
          Object.assign(store, items)
        },
        remove: async (key: string): Promise<void> => {
          delete store[key]
        }
      }
    }
  }
}

// Installs the fake `browser` global, then imports background.ts fresh so its
// module-level `browser.runtime.onMessage.addListener(handle)` call captures
// against THIS test's fake. vi.resetModules() first ensures a stale import
// from an earlier test can't leave its listener still registered against a
// torn-down global.
export async function loadBackground (): Promise<BackgroundHarness> {
  const store: Record<string, unknown> = {}
  const captured: { listener: Listener | null } = { listener: null }

  Object.defineProperty(globalThis, 'browser', {
    value: buildApi(store, captured),
    configurable: true,
    writable: true
  })

  vi.resetModules()
  await import('../../src/background.ts')

  if (captured.listener === null) {
    throw new Error('background.ts never registered its onMessage listener')
  }
  const listener = captured.listener

  return {
    store,
    invoke: async (message) => await listener(message)
  }
}

export function unloadBackground (): void {
  Reflect.deleteProperty(globalThis, 'browser')
}

// A minimal, unsigned-JWT-shaped string. auth.ts's expiresAtSeconds() only
// ever reads the middle segment's `exp` claim — header and signature are
// never parsed, so both are dummy placeholders here.
export function fakeIdToken (expiresInSeconds: number): string {
  const base64url = (value: unknown): string =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const payload = { exp: Math.floor(Date.now() / 1000) + expiresInSeconds }
  return `${base64url({ alg: 'none' })}.${base64url(payload)}.`
}
