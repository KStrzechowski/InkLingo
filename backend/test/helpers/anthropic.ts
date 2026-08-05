import type { Anthropic } from '@anthropic-ai/sdk'
import type { build } from '../helper.js'
import { TRANSLATION_TOOL_NAME } from '../../src/ai/translate.js'

export type App = Awaited<ReturnType<typeof build>>

export function stubAnthropicSuccess (app: App, input: unknown): void {
  app.anthropicClient = {
    messages: {
      create: async () => ({
        content: [{ type: 'tool_use', name: TRANSLATION_TOOL_NAME, input }]
      })
    }
  } as unknown as Anthropic
}

// Returns each supplied payload in turn, then repeats the last one. Lets a
// test drive the empty-then-populated sequence the retry exists for.
export function stubAnthropicSequence (app: App, inputs: unknown[]): { calls: () => number } {
  let calls = 0
  app.anthropicClient = {
    messages: {
      create: async () => {
        const input = inputs[Math.min(calls, inputs.length - 1)]
        calls++
        return { content: [{ type: 'tool_use', name: TRANSLATION_TOOL_NAME, input }] }
      }
    }
  } as unknown as Anthropic
  return { calls: () => calls }
}

export function stubAnthropicFailure (app: App): void {
  app.anthropicClient = {
    messages: {
      create: async () => { throw new Error('anthropic unavailable') }
    }
  } as unknown as Anthropic
}
