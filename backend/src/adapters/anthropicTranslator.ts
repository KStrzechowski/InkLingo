import { Anthropic } from '@anthropic-ai/sdk'
import {
  TranslationDraft,
  senseTranslationFromProviderPayload,
  type DraftSenseTranslation,
  type RequestedLanguages
} from '../domain/translationDraft.ts'
import {
  type Translator,
  type TranslationRequest,
  type SenseTranslationRequest,
  DegenerateDraftError,
  MalformedDraftError,
  TranslatorUnavailableError
} from '../domain/translator.ts'

// The only file under backend/src permitted to import @anthropic-ai/sdk.
// `test/architecture/providerBoundary.test.ts` enforces that as a gate rather
// than a convention. Everything provider-shaped lives above
// `TranslationDraft.fromProviderPayload`; nothing provider-shaped leaves this
// file.

export const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001'
export const TRANSLATION_TOOL_NAME = 'return_translation'

// The output ceiling. One response covers every target language the collection
// teaches, and — since the meaning-first inversion — every distinct meaning of
// the word, so the volume scales with **senses × languages**, not languages
// alone. max_tokens is a cap, not a charge: sizing it generously costs nothing
// and a too-small value truncates the tool_use JSON mid-object, which fails to
// parse entirely.
//
// The ceiling is 512 × 4 × 5 = 10 240 tokens for the largest collection this
// app allows (MAX_TARGET_LANGUAGES = 5) — the same ceiling the language-first
// budget (2048 × 5) produced, re-derived on the axis that now drives the
// output. `MAX_BUDGETED_SENSES` is a budgeting assumption, not a guarantee:
// `maxItems` is advisory on a tool schema, so a word with more meanings than
// this can still overrun. Phase 7 measures the real distribution against the
// live API and this number moves to fit it.
export const MAX_TOKENS_PER_SENSE_LANGUAGE = 512
export const MAX_BUDGETED_SENSES = 4

// The model intermittently returns a structurally-valid response carrying
// nothing usable — measured at roughly 3 in 34 calls against the real API,
// clustered rather than uniform, and not reproducible on demand.
// Nothing in the request distinguishes a good roll from a bad one, so the
// application retries rather than trying to prevent it. The empty response is
// also the cheap, fast one (~167 output tokens, ~1.3s), so the retry costs
// little and stays well inside the route's timeout.
//
// **Those numbers were measured against the language-first schema**, whose
// per-language meaning arrays all came back empty, and they are not evidence
// about this one — a different tool schema is a different prompt and therefore
// a different failure distribution.
// Phase 7 re-measures the rate and decides on that number whether this retry
// still pays for itself.
//
// This lives in the adapter, not the route and not the value object, because
// only the adapter knows a re-ask is cheap *for this provider*. A different
// provider's adapter is free to choose differently.
const EMPTY_DRAFT_RETRIES = 1

// Transport policy, chosen here rather than inherited. The SDK defaults to 2
// retries and a 10-minute timeout, which combined with EMPTY_DRAFT_RETRIES
// permitted up to six upstream calls per request. Two application attempts
// times two SDK tries is four, and the 15s per-request timeout sits below the
// route's 20s AbortController, so a hung provider call fails inside the
// adapter rather than being killed from above.
const PROVIDER_MAX_RETRIES = 1
const PROVIDER_TIMEOUT_MS = 15_000

// Meaning-first. The schema used to ask for one block per target language,
// each holding its own list of that language's meanings, which made the model
// enumerate meanings independently inside each language: with five target
// languages there were five unrelated lists and no way to tell
// which German word went with which English one. An entry-level sense cannot
// be assembled from that after the fact — grouping it would mean pairing across
// languages by position, the exact failure the nesting exists to prevent — so
// the model does the grouping once, here.
//
// The tool NAME stays `return_translation`: `providerBoundary.test.ts:77-80`
// asserts that string appears in this file and nowhere else, and a second name
// would turn it red. `strict: true` and a required `detectedLanguageCode` are
// deliberate follow-ups, not omissions.
export const translationTool: Anthropic.Tool = {
  name: TRANSLATION_TOOL_NAME,
  description: 'Return the distinct meanings of a captured word or phrase, each with its translation into every requested target language, with IPA phonetics and bilingual example sentences.',
  input_schema: {
    type: 'object',
    required: ['normalizedNativeText', 'senses'],
    properties: {
      normalizedNativeText: {
        type: 'string',
        description: 'The input word/phrase normalized to its base form in the native language, regardless of which language it was typed in.'
      },
      senses: {
        type: 'array',
        // Both bounds are advisory on a tool schema rather than enforced.
        // minItems costs nothing and states the intent the empty-result retry
        // below exists to backstop; maxItems states the assumption
        // MAX_BUDGETED_SENSES prices max_tokens against.
        minItems: 1,
        maxItems: MAX_BUDGETED_SENSES,
        description: 'One entry per distinct meaning of the word. Never empty.',
        items: {
          type: 'object',
          required: ['glossText', 'translations'],
          properties: {
            glossText: {
              type: 'string',
              description: 'This meaning named in the NATIVE language — a short phrase distinguishing it from the word\'s other meanings, not a translation of the word. The same meaning must carry the same wording here no matter which target languages it appears under.'
            },
            translations: {
              type: 'array',
              minItems: 1,
              description: 'One entry per requested target language that has a word for THIS meaning. Omit a language that has no word for it rather than inventing one.',
              items: {
                type: 'object',
                required: ['languageCode', 'meaningText', 'phoneticTranscription', 'sentences'],
                properties: {
                  languageCode: {
                    type: 'string',
                    description: 'The target language code this translation is in, copied exactly from the requested list.'
                  },
                  meaningText: { type: 'string', description: 'This meaning\'s translation in this target language.' },
                  phoneticTranscription: {
                    type: ['string', 'null'],
                    description: 'IPA phonetic transcription of the target-language translation, or null if one cannot be produced.'
                  },
                  sentences: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      type: 'object',
                      required: ['targetText', 'nativeGlossText'],
                      properties: {
                        targetText: { type: 'string', description: 'An example sentence in this target language using this meaning.' },
                        nativeGlossText: { type: 'string', description: 'That same sentence translated into the native language.' }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

// D-2's second tool: one already-known meaning, one language, one word.
//
// It lives here rather than beside the route that uses it because
// `providerBoundary.test.ts` is not a style rule — `@anthropic-ai/sdk` is
// importable from exactly two files (`:64-72`), and the string
// `return_translation` may appear in this one and nowhere else (`:77-80`).
// Reusing `TRANSLATION_TOOL_NAME` rather than typing a second name is what
// keeps that assertion true; two tools never travel in the same request, so
// sharing a name costs nothing.
//
// Note the shape: no `senses`, no `translations`, no `languageCode`. The
// meaning is named in the prompt and the language is the one the caller asked
// for, so neither is something the model gets to decide — the parser
// (`senseTranslationFromProviderPayload`) stamps the requested code rather than
// reading one back.
export const senseTranslationTool: Anthropic.Tool = {
  name: TRANSLATION_TOOL_NAME,
  description: 'Return one target-language word for a single, already-identified meaning of a word, with IPA phonetics and bilingual example sentences.',
  input_schema: {
    type: 'object',
    required: ['meaningText', 'phoneticTranscription', 'sentences'],
    properties: {
      meaningText: {
        type: 'string',
        description: 'The target-language word or phrase for THIS meaning, and only this meaning.'
      },
      phoneticTranscription: {
        type: ['string', 'null'],
        description: 'IPA phonetic transcription of the target-language translation, or null if one cannot be produced.'
      },
      sentences: {
        type: 'array',
        minItems: 1,
        description: 'Example sentences using this meaning in the target language. Never empty.',
        items: {
          type: 'object',
          required: ['targetText', 'nativeGlossText'],
          properties: {
            targetText: { type: 'string', description: 'An example sentence in the target language using this meaning.' },
            nativeGlossText: { type: 'string', description: 'That same sentence translated into the native language.' }
          }
        }
      }
    }
  }
}

// Rewritten with the tool schema it accompanies: a prompt still asking for one
// block per language would contradict the shape the model is being handed.
// Exported so translation-pivot's measure-cost.mjs can stop carrying a second
// copy.
export function systemPrompt (languages: RequestedLanguages): string {
  const targetList = languages.targetLanguageCodes.map((code) => `"${code}"`).join(', ')

  return `You are a translation assistant inside a language-learning app. The active collection's native language is "${languages.nativeLanguageCode}" and its target (learning) languages are: ${targetList}. The user will type a word or phrase in the native language or in any one of the target languages — detect which one, then respond only via the provided tool call.

Group by MEANING first, never by language. Decide how many distinct meanings the word has, and return one entry in "senses" for each. Name every meaning in "glossText" using the native language "${languages.nativeLanguageCode}" — a short phrase that distinguishes it from the word's other meanings, not a translation of the word. The same meaning must carry the same "glossText" wording no matter which target languages it appears under; that wording is what pairs a meaning's translations together.

Within each meaning, give one entry in "translations" for each of the target languages listed above that has a word for THAT meaning, using the exact codes listed, each with an IPA phonetic transcription of that language's form and a few example sentences, each paired with a native-language gloss. If a target language has no word for one of the meanings, omit that language from that meaning rather than inventing one.

Every translation must carry at least one example sentence, and "senses" is never empty — if the word is unfamiliar or you are unsure of it, still give your best single meaning rather than returning nothing.`
}

// D-2's prompt. The meaning is stated, not asked for — the whole point is that
// the caller already knows which of the entry's meanings this call is about, so
// the model's only job is to name it in one language. Telling it *not* to
// answer for the word's other meanings is the instruction that makes a
// per-meaning backfill differ from N copies of the same generic translation.
export function senseSystemPrompt (languages: RequestedLanguages, glossText: string): string {
  const [targetLanguageCode] = languages.targetLanguageCodes

  return `You are a translation assistant inside a language-learning app. The active collection's native language is "${languages.nativeLanguageCode}". The user will give you a word or phrase in that native language.

That word has several distinct meanings. You are translating exactly ONE of them, described in the native language "${languages.nativeLanguageCode}" as: "${glossText}".

Translate ONLY that meaning into "${targetLanguageCode}", and respond only via the provided tool call. Do not return a word for any of the word's other meanings — if the target language's usual translation of the word does not carry this meaning, give the word that does. Include an IPA phonetic transcription of the target-language form and at least one example sentence using this meaning, each paired with a native-language gloss.`
}

export interface AnthropicTranslatorOptions {
  apiKey: string
}

// The application always goes through this: it owns which client the adapter
// speaks to, so no caller chooses the transport policy by accident.
export function createAnthropicTranslator (options: AnthropicTranslatorOptions): Translator {
  return anthropicTranslatorOver(new Anthropic({
    apiKey: options.apiKey,
    maxRetries: PROVIDER_MAX_RETRIES,
    timeout: PROVIDER_TIMEOUT_MS
  }))
}

// Split out so the adapter's own test can drive it with a stubbed SDK client —
// the one place in the suite that builds a provider response envelope. Named
// separately rather than as an optional parameter on the factory above so the
// provider type cannot reach the plugin that wires it.
//
// Deliberately takes no logger. Every failure leaves here as a domain error
// carrying its `cause`, and the route logs exactly one line for it with the
// correlationId a user can quote — pino serializes the whole cause chain, so
// nothing is lost. An adapter-side line would be a second record of the same
// event, and the one *without* the correlation id: precisely the split that
// made the informative half unfindable before this change.
export function anthropicTranslatorOver (client: Pick<Anthropic, 'messages'>): Translator {
  async function attempt (request: TranslationRequest): Promise<TranslationDraft> {
    const { text, languages, signal } = request

    const message = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS_PER_SENSE_LANGUAGE * MAX_BUDGETED_SENSES * Math.max(languages.targetLanguageCodes.length, 1),
      system: systemPrompt(languages),
      messages: [{ role: 'user', content: text }],
      tools: [translationTool],
      tool_choice: { type: 'tool', name: TRANSLATION_TOOL_NAME }
    }, { signal })

    const toolUse = message.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === TRANSLATION_TOOL_NAME
    )
    if (toolUse === undefined) {
      throw new TranslatorUnavailableError('provider response did not include the expected tool_use block')
    }

    // The one crossing point. `toolUse.input` is `unknown` and stays that way:
    // fromProviderPayload either returns a valid draft or raises, so no cast
    // happens here or anywhere downstream.
    return TranslationDraft.fromProviderPayload(toolUse.input, languages)
  }

  async function attemptSense (request: SenseTranslationRequest): Promise<DraftSenseTranslation> {
    const { text, glossText, languages, signal } = request
    const [targetLanguageCode] = languages.targetLanguageCodes

    const message = await client.messages.create({
      model: ANTHROPIC_MODEL,
      // One meaning, one language — the single cell of the senses × languages
      // grid `MAX_TOKENS_PER_SENSE_LANGUAGE` is named for.
      max_tokens: MAX_TOKENS_PER_SENSE_LANGUAGE,
      system: senseSystemPrompt(languages, glossText),
      messages: [{ role: 'user', content: text }],
      tools: [senseTranslationTool],
      tool_choice: { type: 'tool', name: TRANSLATION_TOOL_NAME }
    }, { signal })

    const block = message.content.find(
      (candidate): candidate is Anthropic.ToolUseBlock => candidate.type === 'tool_use' && candidate.name === TRANSLATION_TOOL_NAME
    )
    if (block === undefined) {
      throw new TranslatorUnavailableError('provider response did not include the expected tool_use block')
    }

    return senseTranslationFromProviderPayload(block.input, targetLanguageCode)
  }

  return {
    async draft (request: TranslationRequest): Promise<TranslationDraft> {
      let draft: TranslationDraft
      try {
        draft = await attempt(request)
        // See EMPTY_DRAFT_RETRIES: a wholly empty draft is a bad roll, not a
        // statement that the word has no translation, so ask once more before
        // giving up on it.
        for (let retry = 0; retry < EMPTY_DRAFT_RETRIES && draft.isDegenerate(); retry++) {
          draft = await attempt(request)
        }
      } catch (err) {
        // Both domain errors are already the right answer. Re-wrapping a
        // MalformedDraftError as "unavailable" would collapse "the provider
        // is down" and "the provider replied with something that is not a
        // translation" into one, which is the distinction the taxonomy exists
        // to keep.
        if (err instanceof TranslatorUnavailableError || err instanceof MalformedDraftError) throw err
        // The cause carries the SDK's own error — status, retry state, body —
        // to whoever logs this. The message names no vendor, because the
        // string an operator greps for should not name one the rest of the
        // system cannot see.
        throw new TranslatorUnavailableError('the translator provider call failed', { cause: err })
      }

      if (draft.isDegenerate()) {
        throw new DegenerateDraftError(draft.degenerateLanguageCodes())
      }
      return draft
    },

    // Same retry reasoning as `draft`, one level down: an answer carrying no
    // word or no example is a bad roll rather than a statement that this
    // meaning has no translation, and the empty answer is the cheap fast one.
    // `senseTranslationFromProviderPayload` raises `DegenerateDraftError` for
    // that case rather than returning something empty, so the retry hangs off
    // the catch instead of a predicate.
    async translateSense (request: SenseTranslationRequest): Promise<DraftSenseTranslation> {
      for (let attempt = 0; ; attempt++) {
        try {
          return await attemptSense(request)
        } catch (err) {
          if (err instanceof DegenerateDraftError && attempt < EMPTY_DRAFT_RETRIES) continue
          if (
            err instanceof TranslatorUnavailableError ||
            err instanceof MalformedDraftError ||
            err instanceof DegenerateDraftError
          ) throw err
          throw new TranslatorUnavailableError('the translator provider call failed', { cause: err })
        }
      }
    }
  }
}
