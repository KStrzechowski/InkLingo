import { test } from 'node:test'
import * as assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import type { Anthropic } from '@anthropic-ai/sdk'
import { build } from '../../helper.js'
import { jwks, signToken } from '../../helpers/jwks.js'
import { createUserRow, createCollectionRow } from '../../helpers/fixtures.js'
import { TRANSLATION_TOOL_NAME, type TranslationResult } from '../../../src/ai/translate.js'

type App = Awaited<ReturnType<typeof build>>

function stubAnthropicSuccess (app: App, result: TranslationResult): void {
  app.anthropicClient = {
    messages: {
      create: async () => ({
        content: [{ type: 'tool_use', name: TRANSLATION_TOOL_NAME, input: result }]
      })
    }
  } as unknown as Anthropic
}

function stubAnthropicFailure (app: App): void {
  app.anthropicClient = {
    messages: {
      create: async () => { throw new Error('anthropic unavailable') }
    }
  } as unknown as Anthropic
}

test('POST /api/collections/:id/translate returns variants from a stubbed Anthropic client', async (t) => {
  const app = await build(t)
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Translate test', 'pl', ['en'])

  const fakeResult: TranslationResult = {
    normalizedNativeText: 'pies',
    variants: [{
      meaningText: 'dog',
      phoneticTranscription: '/dɒɡ/',
      sentences: [{ targetText: 'The dog runs.', nativeGlossText: 'Pies biegnie.' }]
    }]
  }
  stubAnthropicSuccess(app, fakeResult)

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub })

  const res = await app.inject({
    url: `/api/collections/${collectionId}/translate`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { text: 'pies' }
  })

  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.payload) as TranslationResult
  assert.deepStrictEqual(body, fakeResult)
})

test('POST /api/collections/:id/translate rejects a blank text with 400', async (t) => {
  const app = await build(t)
  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub: randomUUID() })

  const res = await app.inject({
    url: `/api/collections/${randomUUID()}/translate`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { text: '   ' }
  })

  assert.equal(res.statusCode, 400)
})

test('POST /api/collections/:id/translate returns 404 for a collection owned by a different user', async (t) => {
  const app = await build(t)
  const ownerId = await createUserRow(app, t)
  const collectionId = await createCollectionRow(app, ownerId, 'Someone elses translate target')

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub: randomUUID() })

  const res = await app.inject({
    url: `/api/collections/${collectionId}/translate`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { text: 'pies' }
  })

  assert.equal(res.statusCode, 404)
})

test('POST /api/collections/:id/translate returns a clean 502 (not a raw exception) when the Anthropic call fails', async (t) => {
  const app = await build(t)
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Failing translate test', 'pl', ['en'])
  stubAnthropicFailure(app)

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub })

  const res = await app.inject({
    url: `/api/collections/${collectionId}/translate`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { text: 'pies' }
  })

  assert.equal(res.statusCode, 502)
  const body = JSON.parse(res.payload) as { message: string }
  assert.equal(body.message, 'could not generate a translation — try again')
})
