import type { TranslationDraft, DraftSenseTranslation, RequestedLanguages } from './translationDraft.ts'

// The narrowest interface that still lets a route do its job.
//
// Note what is absent: a client parameter. The function this replaces,
// `generateTranslation(client: Anthropic, …)`, had the provider in its public
// signature, so every caller could reach the SDK and the seam was decorative.
// `draft(request)` cannot hand anyone a provider client — that is the
// structural difference between a seam and a passthrough.
//
// `AbortSignal` is a platform type rather than a provider type, so it is
// allowed here for the same reason `RequestedLanguages` is and `Anthropic` is
// not: swapping the provider does not change it.

export interface TranslationRequest {
  text: string
  languages: RequestedLanguages
  signal: AbortSignal
}

// D-2's backfill request. The meaning is an input, not something the provider
// decides: `glossText` comes off a sense the entry already holds, and
// `languages` names exactly one target. That is the whole difference between
// this and `draft` — one asks "what does this word mean?", the other asks "what
// is *this* meaning called in *this* language?", and only the second can add a
// language to a multi-meaning entry without guessing which meaning it belongs
// to.
export interface SenseTranslationRequest {
  text: string
  glossText: string
  languages: RequestedLanguages
  signal: AbortSignal
}

export interface Translator {
  draft: (request: TranslationRequest) => Promise<TranslationDraft>
  translateSense: (request: SenseTranslationRequest) => Promise<DraftSenseTranslation>
}

// The error taxonomy. Each of these carries a reason a caller can act on and
// no provider type at all, so a route maps them to HTTP without knowing which
// translator raised them.

// The provider could not be reached, refused, timed out, or answered in a
// shape that was not a translation attempt at all. The underlying failure
// travels on `cause` for the log line; nothing above reads it.
export class TranslatorUnavailableError extends Error {
  constructor (message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'TranslatorUnavailableError'
  }
}

// The provider answered, but the payload could not become a draft — it was not
// an object, or carried no usable `normalizedNativeText`. This is the failure
// that used to be an unchecked cast: everything below `languageCode` reached
// the client exactly as the model emitted it.
export class MalformedDraftError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'MalformedDraftError'
  }
}

// The provider answered with a well-formed draft that is useless: it carried
// no meaning at all, so no requested language got a word. Raising rather than
// returning it is deliberate — a 200 that is useless to the user is invisible
// to every other layer.
//
// `lessons.md:33-39` measured this at roughly 3 in 34 live calls against the
// language-first tool schema this change replaced — a different schema is a
// different prompt and therefore a different failure distribution, so that
// rate was never evidence about this one. Phase 7 re-measured against the
// meaning-first schema: 0 of 13 varied live calls were degenerate. See
// `anthropicTranslator.ts`'s `EMPTY_DRAFT_RETRIES` comment for why the retry
// this error backstops stays in place despite the improved sample, and for a
// different, non-empty failure mode the same measurement surfaced.
export class DegenerateDraftError extends Error {
  readonly languageCodes: readonly string[]

  constructor (languageCodes: readonly string[]) {
    super('the translator returned no usable senses for any requested language')
    this.name = 'DegenerateDraftError'
    this.languageCodes = languageCodes
  }
}
