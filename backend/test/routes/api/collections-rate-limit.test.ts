import { test } from 'node:test'
import * as assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { build } from '../../helper.js'
import { jwks, signToken } from '../../helpers/jwks.js'
import { createUserRow, createCollectionRow } from '../../helpers/fixtures.js'
import { stubTranslator } from '../../helpers/fakeTranslator.js'

const STUB_PAYLOAD = {
  normalizedNativeText: 'pies',
  languages: [{
    languageCode: 'en',
    variants: [{
      meaningText: 'dog',
      phoneticTranscription: '/dog/',
      sentences: [{ targetText: 'A sentence with dog.', nativeGlossText: 'Zdanie po polsku.' }]
    }]
  }]
}

// Proves the guard configured in collections/index.ts (translateRateLimit,
// max: 20/minute, keyed by request.authUser.id) actually rejects excess
// traffic, not just that it's declared. The Anthropic client stays stubbed
// throughout, so all 21 requests — including the 20 that succeed — cost
// nothing against the real API.
test('POST /api/collections/:id/translate rejects the 21st request within the rate limit window', async (t) => {
  const app = await build(t)
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, 'Rate limit test', 'pl', ['en'])

  stubTranslator(app, STUB_PAYLOAD)

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub })

  for (let i = 0; i < 20; i++) {
    const res = await app.inject({
      url: `/api/collections/${collectionId}/translate`,
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      payload: { text: 'pies' }
    })
    assert.equal(res.statusCode, 200, `request ${i + 1} of 20 should be allowed`)
  }

  const res = await app.inject({
    url: `/api/collections/${collectionId}/translate`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { text: 'pies' }
  })
  assert.equal(res.statusCode, 429)
})
