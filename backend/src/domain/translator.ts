import type { TranslationDraft, DraftSenseTranslation, RequestedLanguages } from './translationDraft.ts'
export { TranslatorUnavailableError, MalformedDraftError, DegenerateDraftError } from './translatorErrors.ts'

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
