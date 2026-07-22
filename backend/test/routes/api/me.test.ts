import { test } from 'node:test'
import * as assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { build } from '../../helper.js'
import { jwks, signToken, tamperSignature } from '../../helpers/jwks.js'

async function userRowCount (app: Awaited<ReturnType<typeof build>>, cognitoSub: string): Promise<number> {
  const rows = await app.sql.query('SELECT id FROM users WHERE cognito_sub = $1', [cognitoSub])
  return (rows as unknown[]).length
}

test('GET /api/me with a valid token returns the identity and provisions exactly one user row', async (t) => {
  const app = await build(t)
  app.jwtVerifier.cacheJwks(jwks)
  const sub = randomUUID()
  t.after(async () => { await app.sql.query('DELETE FROM users WHERE cognito_sub = $1', [sub]) })

  const token = await signToken({ sub, email: 'me-test@example.com' })
  const res = await app.inject({ url: '/api/me', headers: { authorization: `Bearer ${token}` } })

  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.payload) as { id: string, email: string }
  assert.equal(body.email, 'me-test@example.com')
  assert.equal(await userRowCount(app, sub), 1)
})

test('GET /api/me is idempotent: a repeat request reuses the same id and does not duplicate the row', async (t) => {
  const app = await build(t)
  app.jwtVerifier.cacheJwks(jwks)
  const sub = randomUUID()
  t.after(async () => { await app.sql.query('DELETE FROM users WHERE cognito_sub = $1', [sub]) })

  const token = await signToken({ sub })
  const first = await app.inject({ url: '/api/me', headers: { authorization: `Bearer ${token}` } })
  const second = await app.inject({ url: '/api/me', headers: { authorization: `Bearer ${token}` } })

  const firstBody = JSON.parse(first.payload) as { id: string }
  const secondBody = JSON.parse(second.payload) as { id: string }
  assert.equal(firstBody.id, secondBody.id)
  assert.equal(await userRowCount(app, sub), 1)
})

test('GET /api/me without an Authorization header returns 401', async (t) => {
  const app = await build(t)
  const res = await app.inject({ url: '/api/me' })
  assert.equal(res.statusCode, 401)
})

test('GET /api/me with a non-Bearer scheme returns 401', async (t) => {
  const app = await build(t)
  const res = await app.inject({ url: '/api/me', headers: { authorization: 'Basic somevalue' } })
  assert.equal(res.statusCode, 401)
})

test('GET /api/me with an expired token returns 401', async (t) => {
  const app = await build(t)
  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ expiresAtSeconds: Math.floor(Date.now() / 1000) - 60 })
  const res = await app.inject({ url: '/api/me', headers: { authorization: `Bearer ${token}` } })
  assert.equal(res.statusCode, 401)
})

test('GET /api/me with a tampered signature returns 401', async (t) => {
  const app = await build(t)
  app.jwtVerifier.cacheJwks(jwks)
  const token = tamperSignature(await signToken())
  const res = await app.inject({ url: '/api/me', headers: { authorization: `Bearer ${token}` } })
  assert.equal(res.statusCode, 401)
})

test('GET /api/me with the wrong issuer returns 401', async (t) => {
  const app = await build(t)
  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ issuer: 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_wrongPool99' })
  const res = await app.inject({ url: '/api/me', headers: { authorization: `Bearer ${token}` } })
  assert.equal(res.statusCode, 401)
})

test('GET /api/me with the wrong audience returns 401', async (t) => {
  const app = await build(t)
  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ audience: 'not-the-configured-client-id' })
  const res = await app.inject({ url: '/api/me', headers: { authorization: `Bearer ${token}` } })
  assert.equal(res.statusCode, 401)
})

test('GET /api/ping is gone', async (t) => {
  const app = await build(t)
  const res = await app.inject({ url: '/api/ping' })
  assert.equal(res.statusCode, 404)
})
