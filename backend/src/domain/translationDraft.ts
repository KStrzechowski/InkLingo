import { MalformedDraftError } from './translator.ts'
import type { TranslateResponseBody } from '../routes/api/collections/schemas.ts'

// A type-only import, erased at runtime. The domain gains a compile-time
// dependency on the wire contract — which is the point, since drift then fails
// the build — without a runtime one, which would invert the direction this
// layer exists to establish.

// Domain vocabulary is `senses`, and as of this change so is the provider's
// and the wire's. The provider's old language-first word for a meaning is gone
// from every layer: a language-first response cannot be regrouped into
// entry-level meanings after the fact, because pairing across languages by
// position is exactly the failure the nesting exists to prevent.
//
// NOTE the level change. Before this change `DraftSense` was *language-scoped*
// — one meaning inside one language, which meant the same meaning appeared
// under N languages with nothing tying the copies together. It is now
// `DraftSenseTranslation`, and `DraftSense` names the entry-level thing: one
// meaning, glossed in the collection's **native** language, holding one
// translation per target language that has a word for it.

export interface DraftSentence {
  targetText: string
  nativeGlossText: string
}

export interface DraftSenseTranslation {
  languageCode: string
  meaningText: string
  phoneticTranscription: string | null
  sentences: readonly DraftSentence[]
}

export interface DraftSense {
  glossText: string
  translations: readonly DraftSenseTranslation[]
}

// The projection the backfill route persists: one language's first usable
// word and its first example, already trimmed and blank-to-nulled.
//
// SUPERSEDED IN PHASE 4 by decision D-2, which gives the backfill its own
// gloss-plus-language tool schema and translates *every* meaning the entry
// already holds instead of guessing at one. Kept here only so
// `POST /:id/entries/:entryId/translations` keeps compiling until then;
// delete it with that route's rewrite.
export interface PersistableRendering {
  languageCode: string
  meaningText: string
  phoneticTranscription: string | null
  sentenceText: string
  nativeGlossText: string
}

// What was asked for, which is what a draft is aligned against. The native code
// is kept exactly as given because it is interpolated verbatim into the system
// prompt; the target codes are only ever compared, so they are normalized here
// to make alignment total rather than case-sensitive.
export class RequestedLanguages {
  readonly nativeLanguageCode: string
  readonly targetLanguageCodes: readonly string[]

  private constructor (nativeLanguageCode: string, targetLanguageCodes: readonly string[]) {
    this.nativeLanguageCode = nativeLanguageCode
    this.targetLanguageCodes = targetLanguageCodes
  }

  static of (nativeLanguageCode: string, targetLanguageCodes: readonly string[]): RequestedLanguages {
    return new RequestedLanguages(
      nativeLanguageCode,
      targetLanguageCodes.map((code) => code.trim().toLowerCase())
    )
  }
}

function asRecord (value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asNonBlankString (value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

// Skip rules, not repairs. A sentence missing either half of the pair teaches
// nothing, and inventing the missing half would be worse than dropping it.
// Text is left untrimmed here so the wire bytes stay what the model produced;
// `renderingFor` trims on the way to the database, which is where it matters.
function parseSentences (raw: unknown): DraftSentence[] {
  if (!Array.isArray(raw)) return []
  const sentences: DraftSentence[] = []
  for (const entry of raw) {
    const record = asRecord(entry)
    if (record === null) continue
    if (asNonBlankString(record.targetText) === null) continue
    if (asNonBlankString(record.nativeGlossText) === null) continue
    sentences.push({
      targetText: record.targetText as string,
      nativeGlossText: record.nativeGlossText as string
    })
  }
  return sentences
}

// `alignToRequested`, moved down a level and renamed for what it now aligns.
//
// The old version rebuilt the *language* list against what was asked for, so a
// language the model skipped came back as an empty block. This one rebuilds
// **one sense's** translations, and the difference in semantics is the point: a
// language absent from one meaning is a legitimate **sparse spoke** — `suwak`
// simply has no single German word — not a degenerate answer. So it is left
// absent rather than materialized empty, and nothing downstream has to tell a
// missing word from a failed one.
//
// Alignment still does the two things it always did: re-key a reordered
// response against the requested codes rather than trusting its order, and drop
// anything that was not asked for.
function alignSenseTranslations (raw: unknown, requested: RequestedLanguages): DraftSenseTranslation[] {
  const returned = Array.isArray(raw) ? raw : []

  const translations: DraftSenseTranslation[] = []
  for (const languageCode of requested.targetLanguageCodes) {
    const match = asRecord(returned.find((candidate) => {
      const block = asRecord(candidate)
      return block !== null && asNonBlankString(block.languageCode)?.toLowerCase() === languageCode
    }))
    if (match === null) continue

    const meaningText = asNonBlankString(match.meaningText)
    if (meaningText === null) continue
    const sentences = parseSentences(match.sentences)
    // A word with no example teaches nothing, so it is not a translation.
    if (sentences.length === 0) continue

    translations.push({
      languageCode,
      meaningText,
      phoneticTranscription: asNonBlankString(match.phoneticTranscription),
      sentences
    })
  }
  return translations
}

function parseSenses (raw: unknown, requested: RequestedLanguages): DraftSense[] {
  if (!Array.isArray(raw)) return []
  const senses: DraftSense[] = []
  for (const entry of raw) {
    const record = asRecord(entry)
    if (record === null) continue
    // The gloss is the meaning's identity — `senseKey` is computed from it and
    // both clients group on it — so a sense without one cannot be a sense.
    const glossText = asNonBlankString(record.glossText)
    if (glossText === null) continue
    const translations = alignSenseTranslations(record.translations, requested)
    // A meaning with no word in any requested language teaches nothing. This
    // is the sense-level twin of the sparse-spoke rule above, and the two are
    // deliberately different: *some* languages missing is legal, *all* is not.
    if (translations.length === 0) continue
    senses.push({ glossText, translations })
  }
  return senses
}

export class TranslationDraft {
  readonly normalizedNativeText: string
  readonly senses: readonly DraftSense[]
  // Kept so `degenerateLanguageCodes()` can still name a language that came
  // back under no meaning at all. Before the inversion this was recoverable
  // from the aligned language list; now that a missing language is simply
  // absent, the draft has to remember what was asked for.
  readonly requestedLanguageCodes: readonly string[]

  private constructor (
    normalizedNativeText: string,
    senses: readonly DraftSense[],
    requestedLanguageCodes: readonly string[]
  ) {
    this.normalizedNativeText = normalizedNativeText
    this.senses = senses
    this.requestedLanguageCodes = requestedLanguageCodes
  }

  // The single crossing point from provider data into the domain, and the
  // reason this class exists. It is **total**: every payload either becomes a
  // valid draft or raises `MalformedDraftError`. There is no cast and no third
  // outcome, so no caller has to guess which of the three it got.
  static fromProviderPayload (payload: unknown, requested: RequestedLanguages): TranslationDraft {
    const record = asRecord(payload)
    if (record === null) {
      throw new MalformedDraftError('provider payload was not an object')
    }
    if (asNonBlankString(record.normalizedNativeText) === null) {
      throw new MalformedDraftError('provider payload carried no usable normalizedNativeText')
    }

    return new TranslationDraft(
      record.normalizedNativeText as string,
      parseSenses(record.senses, requested),
      requested.targetLanguageCodes
    )
  }

  // The model returned no usable meaning at all. Distinct from a partial
  // draft, which is still worth showing.
  //
  // Before the inversion this read "every requested language came back with
  // nothing", which was the same question asked language-first. Now that
  // meanings are the top level, a draft with no senses is exactly a draft with
  // nothing under any language.
  isDegenerate (): boolean {
    return this.senses.length === 0
  }

  // The requested languages that appear under **no** meaning. A language
  // missing from one sense is a sparse spoke and is not reported here; a
  // language missing from all of them is a gap the user will see.
  degenerateLanguageCodes (): readonly string[] {
    const covered = new Set(
      this.senses.flatMap((sense) => sense.translations.map((translation) => translation.languageCode))
    )
    return this.requestedLanguageCodes.filter((code) => !covered.has(code))
  }

  // The backfill flow has no user picking a meaning, so it takes the first
  // sense that has a word in this language and that word's first example.
  //
  // SUPERSEDED IN PHASE 4 (decision D-2): "the model's first one" is precisely
  // the behaviour this change exists to remove, and the rewritten backfill
  // route asks for one word per meaning the entry already holds. Kept only so
  // that route compiles until then.
  renderingFor (languageCode: string): PersistableRendering | null {
    for (const sense of this.senses) {
      const translation = sense.translations.find((candidate) => candidate.languageCode === languageCode)
      const sentence = translation?.sentences.at(0)
      if (translation === undefined || sentence === undefined) continue

      return {
        languageCode: translation.languageCode,
        meaningText: translation.meaningText,
        phoneticTranscription: translation.phoneticTranscription,
        sentenceText: sentence.targetText.trim(),
        nativeGlossText: sentence.nativeGlossText.trim()
      }
    }
    return null
  }

  // The wire projection, typed by the schema Fastify serializes against, so a
  // field this stops emitting is a compile error rather than one Fastify
  // quietly strips. Domain and wire now use the same word at every level, so
  // this is a pure copy — the domain-to-wire rename died with the
  // language-first shape.
  toWire (): TranslateResponseBody {
    return {
      normalizedNativeText: this.normalizedNativeText,
      senses: this.senses.map((sense) => ({
        glossText: sense.glossText,
        translations: sense.translations.map((translation) => ({
          languageCode: translation.languageCode,
          meaningText: translation.meaningText,
          phoneticTranscription: translation.phoneticTranscription,
          sentences: translation.sentences.map((sentence) => ({
            targetText: sentence.targetText,
            nativeGlossText: sentence.nativeGlossText
          }))
        }))
      }))
    }
  }

  // Counts the text this draft carries: every gloss, word, phonetic, sentence
  // and native gloss, so a meaning that came back with no words costs nothing.
  //
  // Named for what it measures, not for what it costs. It was
  // `billableCharacters()` — the name `03-anti-corruption-layer.md:1173` gives
  // it as `research.md:1010-1014`'s spend meter — but that name matches no
  // provider's invoice: Anthropic bills tokens, and DeepL and Azure bill
  // characters *submitted*, per target language. This is characters
  // *produced*, which is the only quantity a draft can honestly measure, since
  // it does not hold the request.
  //
  // So this is half of the counter the pivot needs. The other half — metering
  // submitted characters — belongs in the adapter, which knows the request,
  // alongside the per-call log line `03-anti-corruption-layer.md:1014`
  // specifies and this change did not build. Recorded as a follow-up in
  // change.md; until it exists, nothing reads this number.
  producedCharacters (): number {
    return this.senses.reduce((senseTotal, sense) => (
      senseTotal + sense.glossText.length + sense.translations.reduce((translationTotal, translation) => (
        translationTotal +
        translation.meaningText.length +
        (translation.phoneticTranscription?.length ?? 0) +
        translation.sentences.reduce(
          (sentenceTotal, sentence) => sentenceTotal + sentence.targetText.length + sentence.nativeGlossText.length,
          0
        )
      ), 0)
    ), 0)
  }
}
