import { TranslationDraft, RequestedLanguages } from '../../src/domain/translationDraft.js'
import type { Translator, TranslationRequest } from '../../src/domain/translator.js'
import type { build } from '../helper.js'

export type App = Awaited<ReturnType<typeof build>>

// One fake implementing the port, with no SDK import and no cast. A change to
// `Translator` is now a compile error in every test that uses this, rather
// than a cast that keeps compiling against a shape that no longer exists.
// Replaces test/helpers/anthropic.ts, which built the provider's response
// envelope in three places.

// Tests write their fixtures as provider payloads and let the real
// `fromProviderPayload` turn them into drafts, so a fixture cannot express a
// draft the parser would never produce. The alignment rules apply here exactly
// as they do in production.
export function draftFrom (payload: unknown, nativeLanguageCode: string, targetLanguageCodes: string[]): TranslationDraft {
  return TranslationDraft.fromProviderPayload(
    payload,
    RequestedLanguages.of(nativeLanguageCode, targetLanguageCodes)
  )
}

export interface FakeTranslator extends Translator {
  calls: () => number
}

// Returns each draft in turn, then repeats the last — the shape a sequence
// test needs. `calls()` survives from stubAnthropicSequence.
export function fakeTranslator (drafts: TranslationDraft[]): FakeTranslator {
  let calls = 0
  return {
    draft: async (_request: TranslationRequest): Promise<TranslationDraft> => {
      const draft = drafts[Math.min(calls, drafts.length - 1)]
      calls++
      return draft
    },
    calls: () => calls
  }
}

export function failingTranslator (err: Error): Translator {
  return {
    draft: async (_request: TranslationRequest): Promise<TranslationDraft> => { throw err }
  }
}

// Convenience for the common case: one payload, always returned.
export function stubTranslator (app: App, payload: unknown, nativeLanguageCode = 'pl', targetLanguageCodes: string[] = ['en']): FakeTranslator {
  const translator = fakeTranslator([draftFrom(payload, nativeLanguageCode, targetLanguageCodes)])
  app.translator = translator
  return translator
}
