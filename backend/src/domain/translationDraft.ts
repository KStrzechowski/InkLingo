import { MalformedDraftError } from './translator.ts'
import type { TranslateResponseBody } from '../routes/api/collections/schemas.ts'

// A type-only import, erased at runtime. The domain gains a compile-time
// dependency on the wire contract — which is the point, since drift then fails
// the build — without a runtime one, which would invert the direction this
// layer exists to establish.

// Domain vocabulary is `senses`. The provider's word, `variants`, survives in
// exactly two places: as an input key inside `fromProviderPayload`, and as an
// output key inside `toWire()`. Between them there is no provider-shaped data.

export interface DraftSentence {
  targetText: string
  nativeGlossText: string
}

export interface DraftSense {
  meaningText: string
  phoneticTranscription: string | null
  sentences: readonly DraftSentence[]
}

export interface DraftLanguage {
  languageCode: string
  senses: readonly DraftSense[]
}

// The projection the backfill route persists: one language's first usable
// sense and its first example, already trimmed and blank-to-nulled. Replaces
// the eleven lines of inline string hygiene the route used to do against the
// model's object.
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

function parseSenses (raw: unknown): DraftSense[] {
  if (!Array.isArray(raw)) return []
  const senses: DraftSense[] = []
  for (const entry of raw) {
    const record = asRecord(entry)
    if (record === null) continue
    const meaningText = asNonBlankString(record.meaningText)
    if (meaningText === null) continue
    const sentences = parseSentences(record.sentences)
    // A sense with no example teaches nothing, so it is not a sense.
    if (sentences.length === 0) continue
    senses.push({
      meaningText,
      phoneticTranscription: asNonBlankString(record.phoneticTranscription),
      sentences
    })
  }
  return senses
}

export class TranslationDraft {
  readonly normalizedNativeText: string
  readonly languages: readonly DraftLanguage[]

  private constructor (normalizedNativeText: string, languages: readonly DraftLanguage[]) {
    this.normalizedNativeText = normalizedNativeText
    this.languages = languages
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

    const returned = Array.isArray(record.languages) ? record.languages : []

    // The model can reorder the language blocks or drop one. Rebuild the list
    // against what was actually requested, so a language it skipped comes back
    // empty rather than silently vanishing and a reordered response is re-keyed
    // rather than trusted. (`ai/translate.ts:113-120`, moved here unchanged.)
    const languages = requested.targetLanguageCodes.map((languageCode) => {
      const match = returned.find((language) => {
        const block = asRecord(language)
        return block !== null && asNonBlankString(block.languageCode)?.toLowerCase() === languageCode
      })
      return { languageCode, senses: parseSenses(asRecord(match)?.variants) }
    })

    return new TranslationDraft(record.normalizedNativeText as string, languages)
  }

  // Every requested language came back with nothing. Distinct from a partial
  // draft, which is still worth showing.
  isDegenerate (): boolean {
    return this.languages.every((language) => language.senses.length === 0)
  }

  degenerateLanguageCodes (): readonly string[] {
    return this.languages
      .filter((language) => language.senses.length === 0)
      .map((language) => language.languageCode)
  }

  // The backfill flow has no user picking a sense, so it takes the first one
  // and its first example — the same choice the route used to make inline, with
  // the string hygiene it used to do inline now owned by the domain.
  //
  // Only the sentence halves are trimmed here: `meaningText` and
  // `phoneticTranscription` arrive already trimmed and blank-to-nulled from
  // parsing, because those two decide whether a sense counts at all. Trimming
  // them a second time would be dead code that reads as a live guard.
  renderingFor (languageCode: string): PersistableRendering | null {
    const language = this.languages.find((candidate) => candidate.languageCode === languageCode)
    const sense = language?.senses.at(0)
    const sentence = sense?.sentences.at(0)
    if (language === undefined || sense === undefined || sentence === undefined) return null

    return {
      languageCode: language.languageCode,
      meaningText: sense.meaningText,
      phoneticTranscription: sense.phoneticTranscription,
      sentenceText: sentence.targetText.trim(),
      nativeGlossText: sentence.nativeGlossText.trim()
    }
  }

  // The wire projection, typed by the schema Fastify serializes against, so a
  // field this stops emitting is a compile error rather than one Fastify
  // quietly strips. `senses` becomes `variants` here and nowhere else.
  toWire (): TranslateResponseBody {
    return {
      normalizedNativeText: this.normalizedNativeText,
      languages: this.languages.map((language) => ({
        languageCode: language.languageCode,
        variants: language.senses.map((sense) => ({
          meaningText: sense.meaningText,
          phoneticTranscription: sense.phoneticTranscription,
          sentences: sense.sentences.map((sentence) => ({
            targetText: sentence.targetText,
            nativeGlossText: sentence.nativeGlossText
          }))
        }))
      }))
    }
  }

  // Counts the translated text this draft carries: every meaning, phonetic,
  // sentence and gloss, so a language that came back empty costs nothing.
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
    return this.languages.reduce((languageTotal, language) => (
      languageTotal + language.senses.reduce((senseTotal, sense) => (
        senseTotal +
        sense.meaningText.length +
        (sense.phoneticTranscription?.length ?? 0) +
        sense.sentences.reduce(
          (sentenceTotal, sentence) => sentenceTotal + sentence.targetText.length + sentence.nativeGlossText.length,
          0
        )
      ), 0)
    ), 0)
  }
}
