import { Anthropic } from '@anthropic-ai/sdk'
import { TranslationDraft, type RequestedLanguages } from '../domain/translationDraft.ts'
import {
  type Translator,
  type TranslationRequest,
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

// One response now covers every target language the collection teaches, so
// the output ceiling scales with how many were asked for. max_tokens is a cap,
// not a charge — sizing it generously costs nothing and a too-small value
// truncates the tool_use JSON mid-object, which fails to parse entirely.
export const MAX_TOKENS_PER_LANGUAGE = 2048

// The model intermittently returns a structurally-valid response whose
// `variants` arrays are all empty — measured at roughly 3 in 34 calls against
// the real API, clustered rather than uniform, and not reproducible on demand.
// Nothing in the request distinguishes a good roll from a bad one, so the
// application retries rather than trying to prevent it. The empty response is
// also the cheap, fast one (~167 output tokens, ~1.3s), so the retry costs
// little and stays well inside the route's timeout.
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

// Moved verbatim from ai/translate.ts:49-107. The bytes sent to the model are
// unchanged by this refactor, which is what keeps translation-pivot's cost
// baseline valid and this change free of a live-API gate. `strict: true` and a
// required `detectedLanguageCode` are deliberate follow-ups, not omissions.
export const translationTool: Anthropic.Tool = {
  name: TRANSLATION_TOOL_NAME,
  description: 'Return structured translation variants with IPA phonetics and bilingual example sentences for a captured word or phrase, for every requested target language.',
  input_schema: {
    type: 'object',
    required: ['normalizedNativeText', 'languages'],
    properties: {
      normalizedNativeText: {
        type: 'string',
        description: 'The input word/phrase normalized to its base form in the native language, regardless of which language it was typed in.'
      },
      languages: {
        type: 'array',
        description: 'One entry per requested target language, in the order they were requested.',
        items: {
          type: 'object',
          required: ['languageCode', 'variants'],
          properties: {
            languageCode: {
              type: 'string',
              description: 'The target language code this entry covers, copied exactly from the requested list.'
            },
            variants: {
              type: 'array',
              // minItems is advisory on a tool schema rather than enforced,
              // but it costs nothing and states the intent the empty-result
              // retry below exists to backstop.
              minItems: 1,
              description: 'The distinct meanings of the word in this target language. Never empty.',
              items: {
                type: 'object',
                required: ['meaningText', 'phoneticTranscription', 'sentences'],
                properties: {
                  meaningText: { type: 'string', description: 'This variant\'s translation in this target language.' },
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
                        targetText: { type: 'string', description: 'An example sentence in this target language using this variant.' },
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

// Moved verbatim from ai/translate.ts:133-135, with the interpolation reading
// from RequestedLanguages instead of loose parameters. Exported so
// translation-pivot's measure-cost.mjs can stop carrying a second copy.
export function systemPrompt (languages: RequestedLanguages): string {
  const targetList = languages.targetLanguageCodes.map((code) => `"${code}"`).join(', ')

  return `You are a translation assistant inside a language-learning app. The active collection's native language is "${languages.nativeLanguageCode}" and its target (learning) languages are: ${targetList}. The user will type a word or phrase in the native language or in any one of the target languages — detect which one, then respond only via the provided tool call. Return one entry in "languages" for every requested target language, using the exact codes listed above. Within each language, give several translation variants covering distinct meanings if the word is ambiguous, each with an IPA phonetic transcription of that language's form, and a few example sentences per variant, each paired with a native-language gloss.

Every language entry must contain at least one variant, and every variant at least one example sentence. An empty "variants" array is never an acceptable answer — if the word is unfamiliar or you are unsure of it, still give your best single translation rather than returning nothing.`
}

export interface AnthropicTranslatorOptions {
  apiKey: string
  log: TranslatorLog
}

export interface TranslatorLog {
  error: (o: object, msg: string) => void
}

// The application always goes through this: it owns which client the adapter
// speaks to, so no caller chooses the transport policy by accident.
export function createAnthropicTranslator (options: AnthropicTranslatorOptions): Translator {
  return anthropicTranslatorOver(
    new Anthropic({
      apiKey: options.apiKey,
      maxRetries: PROVIDER_MAX_RETRIES,
      timeout: PROVIDER_TIMEOUT_MS
    }),
    options.log
  )
}

// Split out so the adapter's own test can drive it with a stubbed SDK client —
// the one place in the suite that builds a provider response envelope. Named
// separately rather than as an optional parameter on the factory above so the
// provider type cannot reach the plugin that wires it.
export function anthropicTranslatorOver (client: Pick<Anthropic, 'messages'>, log: TranslatorLog): Translator {
  async function attempt (request: TranslationRequest): Promise<TranslationDraft> {
    const { text, languages, signal } = request

    const message = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS_PER_LANGUAGE * Math.max(languages.targetLanguageCodes.length, 1),
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
        // The string an operator greps for should not name a vendor the rest
        // of the system cannot see. This line carries the provider-level
        // detail — which SDK error, which status — that the route cannot see
        // from behind the port; the route logs its own line with the
        // correlationId a user can quote.
        log.error({ err }, 'translator provider call failed')
        // Both domain errors are already the right answer. Re-wrapping a
        // MalformedDraftError as "unavailable" would collapse "the provider
        // is down" and "the provider replied with something that is not a
        // translation" into one, which is the distinction the taxonomy exists
        // to keep.
        if (err instanceof TranslatorUnavailableError || err instanceof MalformedDraftError) throw err
        throw new TranslatorUnavailableError('the translator provider call failed', { cause: err })
      }

      if (draft.isDegenerate()) {
        throw new DegenerateDraftError(draft.degenerateLanguageCodes())
      }
      return draft
    }
  }
}
