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
