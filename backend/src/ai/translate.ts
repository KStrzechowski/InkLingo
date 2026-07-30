import type { Anthropic } from '@anthropic-ai/sdk'

const MODEL = 'claude-haiku-4-5-20251001'
export const TRANSLATION_TOOL_NAME = 'return_translation'

export interface TranslationSentence {
  targetText: string
  nativeGlossText: string
}

export interface TranslationVariant {
  meaningText: string
  phoneticTranscription: string | null
  sentences: TranslationSentence[]
}

export interface TranslationResult {
  normalizedNativeText: string
  variants: TranslationVariant[]
}

export interface GenerateTranslationParams {
  text: string
  nativeLanguageCode: string
  targetLanguageCode: string
  signal: AbortSignal
}

const translationTool: Anthropic.Tool = {
  name: TRANSLATION_TOOL_NAME,
  description: 'Return structured translation variants with IPA phonetics and bilingual example sentences for a captured word or phrase.',
  input_schema: {
    type: 'object',
    required: ['normalizedNativeText', 'variants'],
    properties: {
      normalizedNativeText: {
        type: 'string',
        description: 'The input word/phrase normalized to its base form in the native language, regardless of which language it was typed in.'
      },
      variants: {
        type: 'array',
        items: {
          type: 'object',
          required: ['meaningText', 'phoneticTranscription', 'sentences'],
          properties: {
            meaningText: { type: 'string', description: 'This variant\'s translation in the target language.' },
            phoneticTranscription: {
              type: ['string', 'null'],
              description: 'IPA phonetic transcription of the target-language translation, or null if one cannot be produced.'
            },
            sentences: {
              type: 'array',
              items: {
                type: 'object',
                required: ['targetText', 'nativeGlossText'],
                properties: {
                  targetText: { type: 'string', description: 'An example sentence in the target language using this variant.' },
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

export async function generateTranslation (client: Anthropic, params: GenerateTranslationParams): Promise<TranslationResult> {
  const { text, nativeLanguageCode, targetLanguageCode, signal } = params

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1536,
    system: `You are a translation assistant inside a language-learning app. The active collection's native language is "${nativeLanguageCode}" and its target (learning) language is "${targetLanguageCode}". The user will type a word or phrase in either language — detect which one, then respond only via the provided tool call with: several translation variants covering distinct meanings if the word is ambiguous, each with an IPA phonetic transcription of the target-language form, and a few example sentences per variant, each paired with a native-language gloss.`,
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

  return toolUse.input as TranslationResult
}
