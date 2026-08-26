// The collection's language contract, as a value object.
//
// INV-9 — "a translation only exists in a language the collection teaches" —
// spans two aggregates: the rule is about a `Collection` but is broken by an
// `Entry`. Making the contract a **required constructor input** to `Entry` is
// what turns it from three hand-written membership checks
// (`routes/api/collections/index.ts:342-347`, `:423-425`) into something
// structural: there is no code path that builds an `Entry` without one, so
// there is no code path that can skip the check.

export class LanguageContract {
  readonly collectionId: string
  readonly nativeLanguageCode: string
  readonly targetLanguageCodes: readonly string[]

  private constructor (
    collectionId: string,
    nativeLanguageCode: string,
    targetLanguageCodes: readonly string[]
  ) {
    this.collectionId = collectionId
    this.nativeLanguageCode = nativeLanguageCode
    this.targetLanguageCodes = targetLanguageCodes
  }

  // Target codes are only ever compared, so they are normalized once here and
  // membership becomes total rather than case-sensitive — rows created before
  // `POST /api/collections` lowercased on write still hold codes like 'EN'
  // (`context/foundation/lessons.md`, and the dev-DB note on legacy codes).
  //
  // The native code is kept exactly as given, for the same reason
  // `RequestedLanguages.of` keeps it verbatim: it is stamped onto the entry as
  // `sourceLanguageCode` and interpolated into the model's system prompt, so
  // normalizing it here would change what the model is told.
  static of (
    collectionId: string,
    nativeLanguageCode: string,
    targetLanguageCodes: readonly string[]
  ): LanguageContract {
    return new LanguageContract(
      collectionId,
      nativeLanguageCode,
      targetLanguageCodes.map((code) => code.trim().toLowerCase())
    )
  }

  teaches (languageCode: string): boolean {
    return this.targetLanguageCodes.includes(languageCode.trim().toLowerCase())
  }
}
