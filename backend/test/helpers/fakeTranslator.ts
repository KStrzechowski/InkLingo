import {
  TranslationDraft,
  RequestedLanguages,
  senseTranslationFromProviderPayload,
  type DraftSenseTranslation
} from '../../src/domain/translationDraft.js'
import { DegenerateDraftError } from '../../src/domain/translator.js'
import type { Translator, TranslationRequest, SenseTranslationRequest } from '../../src/domain/translator.js'
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
  senseCalls: () => Array<{ text: string, glossText: string, languageCode: string }>
}

// D-2's half. Tests write their fixtures as provider payloads here too, so the
// real `senseTranslationFromProviderPayload` decides what is usable — a fixture
// cannot express a translation the parser would never produce, and a payload
// with no word or no sentence raises exactly as it would in production.
export function senseTranslationFrom (payload: unknown, languageCode: string): DraftSenseTranslation {
  return senseTranslationFromProviderPayload(payload, languageCode)
}

// Returns each draft in turn, then repeats the last — the shape a sequence
// test needs. `calls()` survives from stubAnthropicSequence.
//
// `translateSense` answers from a per-gloss map, because D-2's whole point is
// that a backfill asks a *different* question per meaning: a fake returning one
// canned answer for every gloss could not tell "two French words, one per
// meaning" from "the same French word written twice". `senseCalls()` records
// what was actually asked, which is the other half of design test 28.
export function fakeTranslator (
  drafts: TranslationDraft[],
  senseTranslations: ReadonlyMap<string, DraftSenseTranslation> = new Map()
): FakeTranslator {
  let calls = 0
  const senseCalls: Array<{ text: string, glossText: string, languageCode: string }> = []

  return {
    draft: async (_request: TranslationRequest): Promise<TranslationDraft> => {
      const draft = drafts[Math.min(calls, drafts.length - 1)]
      calls++
      return draft
    },
    translateSense: async (request: SenseTranslationRequest): Promise<DraftSenseTranslation> => {
      const [languageCode] = request.languages.targetLanguageCodes
      senseCalls.push({ text: request.text, glossText: request.glossText, languageCode })
      const translation = senseTranslations.get(request.glossText)
      if (translation === undefined) {
        throw new DegenerateDraftError([languageCode])
      }
      return translation
    },
    calls: () => calls,
    senseCalls: () => senseCalls
  }
}

export function failingTranslator (err: Error): Translator {
  return {
    draft: async (_request: TranslationRequest): Promise<TranslationDraft> => { throw err },
    translateSense: async (_request: SenseTranslationRequest): Promise<DraftSenseTranslation> => { throw err }
  }
}

// The backfill's counterpart to `stubTranslator`: one payload per meaning,
// keyed by the gloss the route will ask about.
export function stubSenseTranslator (
  app: App,
  payloadsByGloss: Record<string, unknown>,
  languageCode: string
): FakeTranslator {
  const senseTranslations = new Map(
    Object.entries(payloadsByGloss).map(([glossText, payload]) => [
      glossText,
      senseTranslationFrom(payload, languageCode)
    ])
  )
  const translator = fakeTranslator([], senseTranslations)
  app.translator = translator
  return translator
}

// Convenience for the common case: one payload, always returned.
export function stubTranslator (app: App, payload: unknown, nativeLanguageCode = 'pl', targetLanguageCodes: string[] = ['en']): FakeTranslator {
  const translator = fakeTranslator([draftFrom(payload, nativeLanguageCode, targetLanguageCodes)])
  app.translator = translator
  return translator
}
