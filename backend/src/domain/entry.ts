import { randomUUID } from 'node:crypto'
import { Sense, SenseTranslation, Sentence } from './sense.ts'
import { senseKey } from './senseKey.ts'
import type { LanguageContract } from './languageContract.ts'
import {
  BlankTextError,
  DuplicateSenseError,
  DuplicateSenseLanguageError,
  EmptyEntryError,
  LanguageAlreadyPresentError,
  LanguageNotTaughtError,
  SenseWithoutTranslationError,
  TranslationWithoutSentenceError
} from './errors.ts'

// The aggregate root, and the only guardian of sense integrity.
//
// Everything here is pure: no Fastify, no SQL, no Anthropic. Every
// precondition the capture route currently spreads across
// `routes/api/collections/index.ts:250-347` becomes one guard in one place,
// raising one named error.

// --- construction input -----------------------------------------------------
//
// The `id` fields are optional and, when absent, generated here rather than by
// a column default. Two things depend on that:
//
//  - **Writing.** The Neon HTTP driver runs only *non-interactive*
//    transactions, so no `RETURNING` value can feed the next statement.
//    App-side ids are what make a three-level insert possible in a single
//    round trip (Phase 4's `entryRepository.insert`).
//  - **Reading.** Decision A1: reconstruction from the database goes through
//    this same strict path — there is no lenient second constructor. Supplying
//    the persisted ids is how a read rebuilds the entry it stored rather than a
//    fresh copy of it. Phase 3 repairs the handful of legacy rows that would
//    otherwise throw here on a plain `GET`.

export interface SentenceDraft {
  id?: string
  targetText: string
  nativeGlossText: string
}

export interface SenseTranslationDraft {
  id?: string
  languageCode: string
  meaningText: string
  phoneticTranscription?: string | null
  sentences: readonly SentenceDraft[]
}

export interface SenseDraft {
  id?: string
  glossText: string
  translations: readonly SenseTranslationDraft[]
}

export interface EntryDraft {
  id?: string
  createdAt?: Date
  wordOrPhrase: string
  senses: readonly SenseDraft[]
}

// What a backfill supplies for one already-known meaning. The language is
// named once, by `addLanguageToAllSenses`'s own parameter, so a draft that
// disagrees with it is unrepresentable rather than merely rejected — the same
// move `Sentence` makes by not carrying a `languageCode`.
export type BackfillTranslationDraft = Omit<SenseTranslationDraft, 'languageCode'>

// --- wire projection --------------------------------------------------------

export interface SentenceResponse {
  id: string
  sentenceText: string
  nativeGlossText: string
}

export interface SenseTranslationResponse {
  id: string
  languageCode: string
  meaningText: string
  phoneticTranscription: string | null
  sentences: SentenceResponse[]
}

export interface SenseResponse {
  id: string
  glossText: string
  translations: SenseTranslationResponse[]
}

export interface EntryResponse {
  id: string
  wordOrPhrase: string
  sourceLanguageCode: string
  createdAt: string
  senses: SenseResponse[]
}

function trimOrNull (value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length === 0 ? null : trimmed
}

export class Entry {
  readonly id: string
  readonly collectionId: string
  readonly wordOrPhrase: string
  readonly sourceLanguageCode: string
  readonly createdAt: Date
  private readonly ownSenses: Sense[]

  private constructor (
    id: string,
    collectionId: string,
    wordOrPhrase: string,
    sourceLanguageCode: string,
    createdAt: Date,
    senses: readonly Sense[]
  ) {
    this.id = id
    this.collectionId = collectionId
    this.wordOrPhrase = wordOrPhrase
    this.sourceLanguageCode = sourceLanguageCode
    this.createdAt = createdAt
    this.ownSenses = [...senses]
  }

  get senses (): readonly Sense[] {
    return this.ownSenses
  }

  // Preconditions first, and their **order is load-bearing**: it decides which
  // error a payload that breaks several rules reports, and the tests pin it.
  // Each guard below maps to exactly one row of
  // `02-invariant-aggregate-refactor.md` § 4.3 and to one named error.
  static capture (contract: LanguageContract, draft: EntryDraft): Entry {
    const wordOrPhrase = draft.wordOrPhrase.trim()
    if (wordOrPhrase.length === 0) {
      throw new BlankTextError('wordOrPhrase')            // INV-16
    }
    if (draft.senses.length === 0) {
      throw new EmptyEntryError()
    }

    const senses: Sense[] = []
    const seenSenseKeys = new Set<string>()

    for (const senseDraft of draft.senses) {
      const glossText = senseDraft.glossText.trim()
      if (glossText.length === 0) {
        throw new BlankTextError('glossText')
      }
      const key = senseKey(senseDraft.glossText)
      if (seenSenseKeys.has(key)) {
        throw new DuplicateSenseError(key)                // INV-13/14
      }
      seenSenseKeys.add(key)
      if (senseDraft.translations.length === 0) {
        throw new SenseWithoutTranslationError(key)
      }

      const translations: SenseTranslation[] = []
      const seenLanguageCodes = new Set<string>()

      for (const translationDraft of senseDraft.translations) {
        const translation = buildTranslation(contract, key, seenLanguageCodes, translationDraft)
        seenLanguageCodes.add(translation.languageCode)
        translations.push(translation)
      }

      senses.push(new Sense(senseDraft.id ?? randomUUID(), glossText, key, translations))
    }

    // INV-7 and INV-8: the source language is always the contract's native
    // language, never taken from the request body, and the word is the
    // normalized native base form the client supplies.
    return new Entry(
      draft.id ?? randomUUID(),
      contract.collectionId,
      wordOrPhrase,
      contract.nativeLanguageCode,
      draft.createdAt ?? new Date(),
      senses
    )
  }

  // FR-018 backfill (decision D-2). Adding a language translates **every**
  // meaning the entry already holds, one word per meaning — which is what makes
  // this path and `capture` answer "how many meanings does an entry keep?" the
  // same way. It retires "take the model's first one and its first sentence"
  // (`index.ts:439-442`).
  //
  // A meaning the caller supplies nothing for is left alone: that is a sparse
  // spoke, and sparse spokes are legal.
  addLanguageToAllSenses (
    contract: LanguageContract,
    languageCode: string,
    perSense: ReadonlyMap<string, BackfillTranslationDraft>
  ): void {
    const code = languageCode.trim().toLowerCase()
    if (!contract.teaches(code)) {
      throw new LanguageNotTaughtError(code)              // INV-9
    }
    if (this.sensesMissing(code).length === 0) {
      throw new LanguageAlreadyPresentError(code)
    }

    // Built in full before anything is attached, so a draft that fails a
    // precondition halfway through leaves the aggregate exactly as it was —
    // the in-memory half of the atomicity guarantee `prd.md:37` asks for.
    const attachments: Array<{ sense: Sense, translation: SenseTranslation }> = []

    for (const [senseId, translationDraft] of perSense) {
      const sense = this.ownSenses.find((candidate) => candidate.id === senseId)
      if (sense === undefined) continue
      const seen = new Set(sense.translations.map((translation) => translation.languageCode))
      attachments.push({
        sense,
        translation: buildTranslation(contract, sense.senseKey, seen, { ...translationDraft, languageCode: code })
      })
    }

    for (const attachment of attachments) {
      attachment.sense.attach(attachment.translation)
    }
  }

  // The senses a backfill has work to do for. Also what lets a caller decide
  // whether to spend a model call at all.
  sensesMissing (languageCode: string): readonly Sense[] {
    const code = languageCode.trim().toLowerCase()
    return this.ownSenses.filter((sense) => sense.translationFor(code) === undefined)
  }

  toResponse (): EntryResponse {
    return {
      id: this.id,
      wordOrPhrase: this.wordOrPhrase,
      sourceLanguageCode: this.sourceLanguageCode,
      createdAt: this.createdAt.toISOString(),
      senses: this.ownSenses.map((sense) => ({
        id: sense.id,
        glossText: sense.glossText,
        translations: sense.translations.map((translation) => ({
          id: translation.id,
          languageCode: translation.languageCode,
          meaningText: translation.meaningText,
          phoneticTranscription: translation.phoneticTranscription,
          // `targetText` is the domain's name for the sentence in the target
          // language; `sentenceText` is the wire's, inherited from the column
          // and from every client copy of this shape. The rename happens here
          // and nowhere else.
          sentences: translation.sentences.map((sentence) => ({
            id: sentence.id,
            sentenceText: sentence.targetText,
            nativeGlossText: sentence.nativeGlossText
          }))
        }))
      }))
    }
  }
}

// Shared by both construction paths, so a word added by a backfill is held to
// exactly the same rules as one saved at capture time. Two paths that validate
// differently is the failure this whole change exists to remove.
function buildTranslation (
  contract: LanguageContract,
  key: string,
  seenLanguageCodes: ReadonlySet<string>,
  draft: SenseTranslationDraft
): SenseTranslation {
  const code = draft.languageCode.trim().toLowerCase()
  if (!contract.teaches(code)) {
    throw new LanguageNotTaughtError(code)                // INV-9
  }
  if (seenLanguageCodes.has(code)) {
    throw new DuplicateSenseLanguageError(key, code)      // INV-10, now per sense
  }
  const meaningText = draft.meaningText.trim()
  if (meaningText.length === 0) {
    throw new BlankTextError('meaningText')
  }
  if (draft.sentences.length === 0) {
    throw new TranslationWithoutSentenceError(key, code)  // INV-12
  }

  const sentences = draft.sentences.map((sentenceDraft) => {
    const targetText = sentenceDraft.targetText.trim()
    const nativeGlossText = sentenceDraft.nativeGlossText.trim()
    // The field names are the ones the client sent, because they travel
    // verbatim into the 400 message.
    if (targetText.length === 0) {
      throw new BlankTextError('sentenceText')
    }
    if (nativeGlossText.length === 0) {
      throw new BlankTextError('nativeGlossText')
    }
    return new Sentence(sentenceDraft.id ?? randomUUID(), targetText, nativeGlossText)
  })

  return new SenseTranslation(
    draft.id ?? randomUUID(),
    code,
    meaningText,
    trimOrNull(draft.phoneticTranscription),
    sentences
  )
}
