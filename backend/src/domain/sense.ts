// The parts beneath the aggregate root.
//
// NAME COLLISION, resolved in Phase 2: `translationDraft.ts` currently exports
// a `DraftSense` that is *language-scoped* — it holds a target-language
// `meaningText` and is the model's word for one meaning inside one language.
// The `Sense` here is the opposite thing: entry-level, one per meaning, its
// gloss written in the collection's **native** language. The two coexist under
// distinct names for exactly one phase; Phase 2 renames the draft's version to
// `DraftSenseTranslation` and reintroduces `DraftSense` at this level.
//
// Two structural moves carry the invariant, and neither is a runtime check:
//
//  1. `Sentence` has **no `languageCode`**. Its language is its translation's,
//     so a cross-wired sentence — the bug class INV-12 exists to catch — is
//     unrepresentable rather than merely rejected.
//  2. `SenseTranslation` carries no meaning of its own beyond a word. The
//     meaning lives one level up, once, so exactly one place can answer "how
//     many meanings does this entry have?".

export class Sentence {
  readonly id: string
  readonly targetText: string
  readonly nativeGlossText: string

  constructor (id: string, targetText: string, nativeGlossText: string) {
    this.id = id
    this.targetText = targetText
    this.nativeGlossText = nativeGlossText
  }
}

export class SenseTranslation {
  readonly id: string
  readonly languageCode: string
  readonly meaningText: string
  readonly phoneticTranscription: string | null
  readonly sentences: readonly Sentence[]

  constructor (
    id: string,
    languageCode: string,
    meaningText: string,
    phoneticTranscription: string | null,
    sentences: readonly Sentence[]
  ) {
    this.id = id
    this.languageCode = languageCode
    this.meaningText = meaningText
    this.phoneticTranscription = phoneticTranscription
    this.sentences = sentences
  }
}

export class Sense {
  readonly id: string
  readonly glossText: string
  readonly senseKey: string
  private readonly ownTranslations: SenseTranslation[]

  constructor (id: string, glossText: string, senseKey: string, translations: readonly SenseTranslation[]) {
    this.id = id
    this.glossText = glossText
    this.senseKey = senseKey
    this.ownTranslations = [...translations]
  }

  get translations (): readonly SenseTranslation[] {
    return this.ownTranslations
  }

  translationFor (languageCode: string): SenseTranslation | undefined {
    const code = languageCode.trim().toLowerCase()
    return this.ownTranslations.find((translation) => translation.languageCode === code)
  }

  // Only `Entry` calls this. A sense cannot gain a word on its own, because
  // whether it may depends on the collection's language contract — which the
  // root holds and the part does not.
  attach (translation: SenseTranslation): void {
    this.ownTranslations.push(translation)
  }
}
