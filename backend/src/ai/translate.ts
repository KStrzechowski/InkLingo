import type { Anthropic } from '@anthropic-ai/sdk'

const MODEL = 'claude-haiku-4-5-20251001'
export const TRANSLATION_TOOL_NAME = 'return_translation'

// One response now covers every target language the collection teaches, so
// the output ceiling scales with how many were asked for. max_tokens is a cap,
// not a charge — sizing it generously costs nothing and a too-small value
// truncates the tool_use JSON mid-object, which fails to parse entirely.
const MAX_TOKENS_PER_LANGUAGE = 2048

// The model intermittently returns a structurally-valid response whose
// `variants` arrays are all empty — measured at roughly 3 in 34 calls against
// the real API, clustered rather than uniform, and not reproducible on demand.
// Nothing in the request distinguishes a good roll from a bad one, so the
// application retries rather than trying to prevent it. The empty response is
// also the cheap, fast one (~167 output tokens, ~1.3s), so the retry costs
// little and stays well inside the route's timeout.
const EMPTY_RESULT_RETRIES = 1

export interface TranslationSentence {
  targetText: string
  nativeGlossText: string
}

export interface TranslationVariant {
  meaningText: string
  phoneticTranscription: string | null
  sentences: TranslationSentence[]
}

export interface TranslationLanguage {
  languageCode: string
  variants: TranslationVariant[]
}

export interface TranslationResult {
  normalizedNativeText: string
  languages: TranslationLanguage[]
}

export interface GenerateTranslationParams {
  text: string
  nativeLanguageCode: string
  targetLanguageCodes: string[]
  signal: AbortSignal
}

const translationTool: Anthropic.Tool = {
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

// The model can reorder the language blocks, or drop one. Rebuild the list
// against what was actually requested so the response shape is predictable
// for the client regardless — a language it skipped comes back with no
// variants rather than silently vanishing from the array.
function alignToRequested (returned: TranslationLanguage[], requested: string[]): TranslationLanguage[] {
  return requested.map((languageCode) => {
    const match = returned.find(
      (language) => language.languageCode?.trim().toLowerCase() === languageCode
    )
    return { languageCode, variants: match?.variants ?? [] }
  })
}

function isEmpty (result: TranslationResult): boolean {
  return result.languages.every((language) => language.variants.length === 0)
}

async function requestTranslation (client: Anthropic, params: GenerateTranslationParams): Promise<TranslationResult> {
  const { text, nativeLanguageCode, targetLanguageCodes, signal } = params
  const targetList = targetLanguageCodes.map((code) => `"${code}"`).join(', ')

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS_PER_LANGUAGE * Math.max(targetLanguageCodes.length, 1),
    system: `You are a translation assistant inside a language-learning app. The active collection's native language is "${nativeLanguageCode}" and its target (learning) languages are: ${targetList}. The user will type a word or phrase in the native language or in any one of the target languages — detect which one, then respond only via the provided tool call. Return one entry in "languages" for every requested target language, using the exact codes listed above. Within each language, give several translation variants covering distinct meanings if the word is ambiguous, each with an IPA phonetic transcription of that language's form, and a few example sentences per variant, each paired with a native-language gloss.

Every language entry must contain at least one variant, and every variant at least one example sentence. An empty "variants" array is never an acceptable answer — if the word is unfamiliar or you are unsure of it, still give your best single translation rather than returning nothing.`,
    messages: [{ role: 'user', content: text }],
    tools: [translationTool],
    tool_choice: { type: 'tool', name: TRANSLATION_TOOL_NAME }
  }, { signal })

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === TRANSLATION_TOOL_NAME
  )
  if (toolUse === undefined) {
    throw new Error('anthropic response did not include the expected tool_use block')
  }

  const result = toolUse.input as TranslationResult
  return {
    normalizedNativeText: result.normalizedNativeText,
    languages: alignToRequested(result.languages ?? [], targetLanguageCodes)
  }
}

export async function generateTranslation (client: Anthropic, params: GenerateTranslationParams): Promise<TranslationResult> {
  let result = await requestTranslation(client, params)
  // See EMPTY_RESULT_RETRIES: a wholly empty response is a bad roll, not a
  // statement that the word has no translation, so ask once more before
  // handing the caller five empty sections.
  for (let attempt = 0; attempt < EMPTY_RESULT_RETRIES && isEmpty(result); attempt++) {
    result = await requestTranslation(client, params)
  }
  return result
}
