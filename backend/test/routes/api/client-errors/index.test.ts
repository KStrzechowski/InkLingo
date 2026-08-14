import { test } from 'node:test'
import * as assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { build } from '../../../helper.js'
import { jwks, signToken } from '../../../helpers/jwks.js'
import { MAX_REPORTS_PER_BATCH } from '../../../../src/routes/api/client-errors/schemas.js'

function aReport (overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: randomUUID(),
    app: 'frontend',
    appVersion: '1.0.0',
    occurredAt: new Date().toISOString(),
    name: 'AxiosError',
    message: 'Network Error',
    ...overrides
  }
}

async function authorizedApp (t: Parameters<typeof build>[0]) {
  const app = await build(t)
  app.jwtVerifier.cacheJwks(jwks)
  const sub = randomUUID()
  t.after(async () => { await app.sql.query('DELETE FROM users WHERE cognito_sub = $1', [sub]) })
  const token = await signToken({ sub })
  return { app, token }
}

test('POST /api/client-errors accepts a batch and echoes the ids it logged', async (t) => {
  const { app, token } = await authorizedApp(t)

  const reports = [aReport(), aReport()]
  const res = await app.inject({
    method: 'POST',
    url: '/api/client-errors',
    headers: { authorization: `Bearer ${token}` },
    payload: { reports }
  })

  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.payload) as { accepted: string[] }
  // The client drains exactly these ids, so anything not echoed stays buffered.
  assert.deepStrictEqual(body.accepted, reports.map((report) => report.eventId))
})

test('POST /api/client-errors requires authentication', async (t) => {
  const app = await build(t)

  const res = await app.inject({
    method: 'POST',
    url: '/api/client-errors',
    payload: { reports: [aReport()] }
  })

  // The dead-session case is answered by the client buffering, not by opening
  // this route up.
  assert.equal(res.statusCode, 401)
})

test('POST /api/client-errors rejects an empty batch', async (t) => {
  const { app, token } = await authorizedApp(t)

  const res = await app.inject({
    method: 'POST',
    url: '/api/client-errors',
    headers: { authorization: `Bearer ${token}` },
    payload: { reports: [] }
  })

  assert.equal(res.statusCode, 400)
})

test('POST /api/client-errors caps how many reports one request can carry', async (t) => {
  const { app, token } = await authorizedApp(t)

  const res = await app.inject({
    method: 'POST',
    url: '/api/client-errors',
    headers: { authorization: `Bearer ${token}` },
    payload: { reports: Array.from({ length: MAX_REPORTS_PER_BATCH + 1 }, () => aReport()) }
  })

  assert.equal(res.statusCode, 400)
})

test('POST /api/client-errors rejects an unknown app rather than logging it', async (t) => {
  const { app, token } = await authorizedApp(t)

  const res = await app.inject({
    method: 'POST',
    url: '/api/client-errors',
    headers: { authorization: `Bearer ${token}` },
    payload: { reports: [aReport({ app: 'something-else' })] }
  })

  assert.equal(res.statusCode, 400)
})

test('POST /api/client-errors accepts a report carrying a backend correlation id', async (t) => {
  const { app, token } = await authorizedApp(t)

  const res = await app.inject({
    method: 'POST',
    url: '/api/client-errors',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      reports: [aReport({
        requestId: randomUUID(),
        routePath: '/api/collections/:id/translate',
        request: { method: 'POST', status: 502, bodyKeys: ['text'] }
      })]
    }
  })

  assert.equal(res.statusCode, 200)
})

test('POST /api/client-errors strips unknown fields instead of logging them', async (t) => {
  const { app, token } = await authorizedApp(t)

  // Fastify's ajv runs with removeAdditional, so `additionalProperties: false`
  // strips rather than rejects. Either outcome satisfies the promise that
  // matters — the field never reaches a log line — but the distinction is
  // worth pinning down, because a future schema change to a shape ajv cannot
  // strip would silently start accepting it.
  const res = await app.inject({
    method: 'POST',
    url: '/api/client-errors',
    headers: { authorization: `Bearer ${token}` },
    payload: { reports: [aReport({ wordOrPhrase: 'VALUE-niedzwiedz' })] }
  })

  assert.equal(res.statusCode, 200)
  assert.ok(!res.payload.includes('VALUE-niedzwiedz'), 'the unknown field must not survive')
})
