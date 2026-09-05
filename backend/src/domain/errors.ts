// The named error taxonomy for the Entry aggregate.
//
// One error per rule, so nothing logs-and-continues and the HTTP mapping has a
// closed set to switch over. Every one of these is thrown from
// `Entry.capture` / `Entry.addLanguageToAllSenses` and nowhere else — the
// aggregate is the only guardian, which is the whole point of the refactor
// (`context/domain/02-invariant-aggregate-refactor.md` § 4.3).
//
// Deliberately separate from `translatorErrors.ts`'s taxonomy: those describe what a
// *provider* did to us, these describe what a *request* asked us to do. Only
// the latter are mapped to 4xx by `mapDomainError` (Phase 4).

export class DomainError extends Error {
  readonly code: string

  constructor (code: string, message: string) {
    super(message)
    this.name = 'DomainError'
    this.code = code
  }
}

// INV-16. `field` is the name the client sent, because it travels verbatim
// into the 400 message.
export class BlankTextError extends DomainError {
  readonly field: string

  constructor (field: string) {
    super('BLANK_TEXT', `${field} must not be blank`)
    this.name = 'BlankTextError'
    this.field = field
  }
}

// An entry with no meanings is not an entry. There is nothing to teach.
export class EmptyEntryError extends DomainError {
  constructor () {
    super('EMPTY_ENTRY', 'an entry must carry at least one meaning')
    this.name = 'EmptyEntryError'
  }
}

// INV-9. Structural rather than hand-written: an `Entry` cannot be built
// without a `LanguageContract`, so this is the only place the check can fail.
export class LanguageNotTaughtError extends DomainError {
  readonly languageCode: string

  constructor (languageCode: string) {
    super('LANGUAGE_NOT_TAUGHT', 'language code is not one of the collection\'s target languages')
    this.name = 'LanguageNotTaughtError'
    this.languageCode = languageCode
  }
}

// INV-13/14. Two meanings that normalize to the same `senseKey` are one
// meaning submitted twice.
export class DuplicateSenseError extends DomainError {
  readonly senseKey: string

  constructor (senseKey: string) {
    super('DUPLICATE_SENSE', 'this entry already has that meaning')
    this.name = 'DuplicateSenseError'
    this.senseKey = senseKey
  }
}

// INV-10, relocated one level down. Before this change the uniqueness rule sat
// at `(entry_id, language_code)` and forbade a second meaning outright; it now
// sits at `(sense_id, language_code)` and forbids only a second *word* for one
// meaning in one language.
export class DuplicateSenseLanguageError extends DomainError {
  readonly senseKey: string
  readonly languageCode: string

  constructor (senseKey: string, languageCode: string) {
    super('DUPLICATE_SENSE_LANGUAGE', 'only one translation per meaning per language')
    this.name = 'DuplicateSenseLanguageError'
    this.senseKey = senseKey
    this.languageCode = languageCode
  }
}

// A meaning with no word in any language teaches nothing. Note this is not the
// same as a sparse spoke, which is a meaning missing *some* language and is
// legal (`02-invariant-aggregate-refactor.md` § 4.1).
export class SenseWithoutTranslationError extends DomainError {
  readonly senseKey: string

  constructor (senseKey: string) {
    super('SENSE_WITHOUT_TRANSLATION', 'each meaning must carry at least one translation')
    this.name = 'SenseWithoutTranslationError'
    this.senseKey = senseKey
  }
}

// INV-12. The rule this entire change exists to make enforceable: a word the
// learner cannot see used is not worth saving.
export class TranslationWithoutSentenceError extends DomainError {
  readonly senseKey: string
  readonly languageCode: string

  constructor (senseKey: string, languageCode: string) {
    super('TRANSLATION_WITHOUT_SENTENCE', 'each translation must carry at least one example sentence')
    this.name = 'TranslationWithoutSentenceError'
    this.senseKey = senseKey
    this.languageCode = languageCode
  }
}

// FR-018 backfill: every meaning the entry holds already has a word in this
// language, so there is nothing to add.
export class LanguageAlreadyPresentError extends DomainError {
  readonly languageCode: string

  constructor (languageCode: string) {
    super('LANGUAGE_ALREADY_PRESENT', 'this entry already has a translation in that language')
    this.name = 'LanguageAlreadyPresentError'
    this.languageCode = languageCode
  }
}
