import { test } from 'node:test'
import * as assert from 'node:assert'
import type { Anthropic } from '@anthropic-ai/sdk'
import {
  anthropicTranslatorOver,
  TRANSLATION_TOOL_NAME,
  ANTHROPIC_MODEL,
  MAX_TOKENS_PER_SENSE_LANGUAGE,
  MAX_BUDGETED_SENSES,
  systemPrompt
} from '../../src/adapters/anthropicTranslator.js'
import { RequestedLanguages } from '../../src/domain/translationDraft.js'
import {
  DegenerateDraftError,
  MalformedDraftError,
  TranslatorUnavailableError
} from '../../src/domain/translator.js'

// This is the only test file in the suite that builds a provider response
// envelope, tested directly against the only file that consumes one. Every
// other test in the repo now works against the `Translator` port instead, so
// changing providers cannot ripple into them.

const requested = RequestedLanguages.of('pl', ['en', 'de'])

function translation (languageCode: string, meaningText: string): unknown {
  return {
    languageCode,
    meaningText,
    phoneticTranscription: `/${meaningText}/`,
    sentences: [{ targetText: `A sentence with ${meaningText}.`, nativeGlossText: 'Zdanie po polsku.' }]
  }
}

// Meaning-first, as of this change. `zamek` replaces `pies` as the fixture
// word for a reason: the envelope now has to be able to carry two meanings, and
// a word with only one cannot exercise the shape the inversion exists for.
const POPULATED = {
  normalizedNativeText: 'zamek',
  senses: [
    { glossText: 'budowla obronna', translations: [translation('en', 'castle'), translation('de', 'Burg')] },
    { glossText: 'urzadzenie do zamykania', translations: [translation('en', 'lock'), translation('de', 'Schloss')] }
  ]
}

// What the retry exists for: structurally valid, and carrying nothing.
const ALL_EMPTY = {
  normalizedNativeText: 'zamek',
  senses: []
}

// A sparse spoke is NOT this — a language missing from one meaning is legal and
// invisible here. This is `de` absent from every meaning, which is what
// `degenerateLanguageCodes()` reports and what the route warns on.
const PARTIALLY_EMPTY = {
  normalizedNativeText: 'zamek',
  senses: [
    { glossText: 'budowla obronna', translations: [translation('en', 'castle')] }
  ]
}

interface Recorder {
  calls: () => number
  params: () => Anthropic.MessageCreateParamsNonStreaming[]
}

// Returns each payload in turn, then repeats the last — the shape a retry test
// needs to drive an empty-then-populated sequence.
function stubClient (inputs: unknown[]): { client: Pick<Anthropic, 'messages'>, recorder: Recorder } {
  let calls = 0
  const params: Anthropic.MessageCreateParamsNonStreaming[] = []
  const client = {
    messages: {
      create: async (body: Anthropic.MessageCreateParamsNonStreaming) => {
        params.push(body)
        const input = inputs[Math.min(calls, inputs.length - 1)]
        calls++
        return { content: [{ type: 'tool_use', name: TRANSLATION_TOOL_NAME, input }] }
      }
    }
  } as unknown as Pick<Anthropic, 'messages'>
  return { client, recorder: { calls: () => calls, params: () => params } }
}

function failingClient (err: Error): Pick<Anthropic, 'messages'> {
  return {
    messages: { create: async () => { throw err } }
  } as unknown as Pick<Anthropic, 'messages'>
}

function request (): { text: string, languages: RequestedLanguages, signal: AbortSignal } {
  return { text: 'zamek', languages: requested, signal: new AbortController().signal }
}

test('a populated response becomes a domain draft with no provider shape left on it', async () => {
  const { client, recorder } = stubClient([POPULATED])
  const translator = anthropicTranslatorOver(client)

  const draft = await translator.draft(request())

  assert.equal(recorder.calls(), 1)
  assert.equal(draft.isDegenerate(), false)
  assert.deepStrictEqual(draft.degenerateLanguageCodes(), [])
  assert.equal(draft.renderingFor('de')?.meaningText, 'Burg')
})

test('the request carries the moved model id, token formula and system prompt', async () => {
  const { client, recorder } = stubClient([POPULATED])

  await anthropicTranslatorOver(client).draft(request())

  const [body] = recorder.params()
  assert.equal(body.model, ANTHROPIC_MODEL)
  // Budgeted on senses x languages now, not languages alone.
  assert.equal(body.max_tokens, MAX_TOKENS_PER_SENSE_LANGUAGE * MAX_BUDGETED_SENSES * 2)
  assert.equal(body.system, systemPrompt(requested))
  assert.deepStrictEqual(body.tool_choice, { type: 'tool', name: TRANSLATION_TOOL_NAME })
})

// translate.test.ts:115 moving down to the layer that owns the retry.
test('an all-empty draft is re-asked exactly once, and the second answer is kept', async () => {
  const { client, recorder } = stubClient([ALL_EMPTY, POPULATED])

  const draft = await anthropicTranslatorOver(client).draft(request())

  assert.equal(recorder.calls(), 2)
  assert.equal(draft.isDegenerate(), false)
  assert.equal(draft.renderingFor('en')?.meaningText, 'castle')
})

// translate.test.ts:151 moving down — and where its 200-vs-502 question is
// answered. An all-empty draft is a failure, not an answer.
test('an always-empty sequence stops after two attempts and raises DegenerateDraftError', async () => {
  const { client, recorder } = stubClient([ALL_EMPTY])

  await assert.rejects(
    async () => await anthropicTranslatorOver(client).draft(request()),
    (err: unknown) => {
      assert.ok(err instanceof DegenerateDraftError)
      assert.deepStrictEqual(err.languageCodes, ['en', 'de'])
      return true
    }
  )
  assert.equal(recorder.calls(), 2)
})

// translate.test.ts:180 moving down. A partial answer is still worth showing,
// so it must neither retry nor raise.
test('a partially-empty draft is returned as-is, without a retry', async () => {
  const { client, recorder } = stubClient([PARTIALLY_EMPTY])

  const draft = await anthropicTranslatorOver(client).draft(request())

  assert.equal(recorder.calls(), 1)
  assert.equal(draft.isDegenerate(), false)
  assert.deepStrictEqual(draft.degenerateLanguageCodes(), ['de'])
})

// The adapter logs nothing: the cause travels on the error, and the route
// emits the single correlated line for it. pino serializes the whole cause
// chain, so the provider detail survives without a second, uncorrelated record.
test('a thrown SDK error becomes TranslatorUnavailableError, keeping the cause', async () => {
  const cause = new Error('529 overloaded_error')

  await assert.rejects(
    async () => await anthropicTranslatorOver(failingClient(cause)).draft(request()),
    (err: unknown) => {
      assert.ok(err instanceof TranslatorUnavailableError)
      assert.equal(err.cause, cause)
      return true
    }
  )
})

test('a response with no tool_use block becomes TranslatorUnavailableError', async () => {
  const client = {
    messages: {
      create: async () => ({ content: [{ type: 'text', text: 'I cannot translate that.' }] })
    }
  } as unknown as Pick<Anthropic, 'messages'>

  await assert.rejects(
    async () => await anthropicTranslatorOver(client).draft(request()),
    TranslatorUnavailableError
  )
})

test('a tool_use block under a different tool name is not mistaken for a translation', async () => {
  const client = {
    messages: {
      create: async () => ({ content: [{ type: 'tool_use', name: 'some_other_tool', input: POPULATED }] })
    }
  } as unknown as Pick<Anthropic, 'messages'>

  await assert.rejects(
    async () => await anthropicTranslatorOver(client).draft(request()),
    TranslatorUnavailableError
  )
})

// The distinction the taxonomy exists to keep: "the provider is down" and
// "the provider replied with something that is not a translation" are not the
// same failure, so the adapter must not collapse the second into the first.
test('an unparseable payload surfaces as MalformedDraftError, not as unavailable', async () => {
  const { client } = stubClient(['not an object at all'])

  await assert.rejects(
    async () => await anthropicTranslatorOver(client).draft(request()),
    MalformedDraftError
  )
})
