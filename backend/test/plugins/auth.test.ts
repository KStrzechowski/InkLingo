import { test } from 'node:test'
import * as assert from 'node:assert'
import Fastify from 'fastify'
import Config from '../../src/plugins/config.js'
import Auth from '../../src/plugins/auth.js'

test('auth registers a jwtVerifier decorator', async (t) => {
  process.env.NEON_DATABASE_URL = 'postgres://test-user:test-pass@localhost/test-db'
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
  process.env.COGNITO_USER_POOL_ID = 'eu-central-1_TestPool123'
  process.env.COGNITO_CLIENT_ID = 'test-client-id'

  const fastify = Fastify()
  // eslint-disable-next-line no-void
  void fastify.register(Config)
  // eslint-disable-next-line no-void
  void fastify.register(Auth)
  await fastify.ready()

  assert.equal(typeof fastify.jwtVerifier.verify, 'function')
})
