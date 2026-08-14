import { test } from 'node:test'
import * as assert from 'node:assert'
import { Writable } from 'node:stream'
import Fastify from 'fastify'
import Sensible from '../../src/plugins/sensible.js'
import ErrorHandler from '../../src/plugins/error-handler.js'

interface LogLine {
  level: number
  msg: string
  requestId?: string
  method?: string
  routePath?: string
  statusCode?: number
  userId?: string
  err?: { stack?: string }
  errName?: string
  errMessage?: string
}

// pino levels, by number — what actually lands in the log line.
// INFO is the level src/server.ts runs at in production, so it is the floor:
// anything logged below it is discarded there, however green the test is here.
const INFO = 30
const WARN = 40
const ERROR = 50

// Builds an instance whose log lines are collected instead of printed, so the
// level routing is asserted on the real output rather than on a spy.
async function buildWithCollectedLogs () {
  const lines: LogLine[] = []
  const stream = new Writable({
    write (chunk, _encoding, callback) {
      for (const raw of String(chunk).split('\n')) {
        if (raw.trim() !== '') {
          lines.push(JSON.parse(raw) as LogLine)
        }
      }
      callback()
    }
  })

  const fastify = Fastify({ logger: { level: 'debug', stream } })
  await fastify.register(Sensible)
  await fastify.register(ErrorHandler)

  fastify.get('/boom', async () => {
    throw new Error('exploded while doing the thing')
  })
  fastify.get('/nope', async (_request, reply) => {
    return reply.unauthorized()
  })
  fastify.get('/bad', async (_request, reply) => {
    return reply.badRequest('name is required')
  })
  fastify.get('/fine', async () => ({ ok: true }))

  await fastify.ready()
  return { fastify, lines }
}

function failureLine (lines: LogLine[]): LogLine {
  const line = lines.find((entry) => entry.msg === 'request failed' || entry.msg === 'request rejected')
  assert.ok(line !== undefined, 'expected a structured failure line')
  return line
}

test('a thrown error answers 500 and correlates the response to its log line', async (t) => {
  const { fastify, lines } = await buildWithCollectedLogs()
  t.after(() => void fastify.close())

  const res = await fastify.inject({ method: 'GET', url: '/boom' })

  assert.equal(res.statusCode, 500)

  const body = JSON.parse(res.payload) as { requestId: string, message: string, error: string }
  const header = res.headers['x-request-id']

  // The join: same id on the wire and in the log, or a user quoting the id
  // from a failure finds nothing when they search.
  assert.equal(typeof header, 'string')
  assert.equal(body.requestId, header)
  assert.equal(failureLine(lines).requestId, header)

  // Shape preserved — nothing parsing an error body has to change.
  assert.equal(body.error, 'Internal Server Error')
  assert.equal(body.message, 'exploded while doing the thing')
})

test('a 5xx logs at error with a stack; the route template, not the concrete url', async (t) => {
  const { fastify, lines } = await buildWithCollectedLogs()
  t.after(() => void fastify.close())

  await fastify.inject({ method: 'GET', url: '/boom' })

  const line = failureLine(lines)
  assert.equal(line.level, ERROR)
  assert.equal(line.statusCode, 500)
  assert.equal(line.method, 'GET')
  assert.equal(line.routePath, '/boom')
  assert.ok(line.err?.stack !== undefined, 'a server fault should carry its stack')
})

test('a 401 logs at info — at or above the level production actually runs', async (t) => {
  // The level here is not a style choice. src/server.ts runs `logger: true`
  // (pino default `info`) and the Lambda executes that file via run.sh, so
  // anything below `info` is discarded in production. A 401 at `debug` would
  // mean 401s are never logged at all, reversing account-auth impl-review F1.
  const { fastify, lines } = await buildWithCollectedLogs()
  t.after(() => void fastify.close())

  const res = await fastify.inject({ method: 'GET', url: '/nope' })

  assert.equal(res.statusCode, 401)

  const line = failureLine(lines)
  assert.equal(line.level, INFO)
  assert.ok(line.level >= INFO, 'a 401 must log at or above the production level')
  assert.equal(line.statusCode, 401)
  // A rejection is not a fault; its stack points at our own throw site.
  assert.equal(line.err, undefined)
})

test('every failure level survives the production logger level', async (t) => {
  // Guards the whole plugin against the trap the 401 branch fell into: a level
  // chosen in isolation, verified only against a debug-level test logger.
  const { fastify, lines } = await buildWithCollectedLogs()
  t.after(() => void fastify.close())

  for (const url of ['/boom', '/nope', '/bad']) {
    await fastify.inject({ method: 'GET', url })
  }

  const failures = lines.filter(
    (line) => line.msg === 'request failed' || line.msg === 'request rejected'
  )
  assert.equal(failures.length, 3)
  for (const line of failures) {
    assert.ok(
      line.level >= INFO,
      `a failure logged at level ${String(line.level)} is invisible in production`
    )
  }
})

test('a non-401 4xx logs at warn, without a stack', async (t) => {
  const { fastify, lines } = await buildWithCollectedLogs()
  t.after(() => void fastify.close())

  const res = await fastify.inject({ method: 'GET', url: '/bad' })

  assert.equal(res.statusCode, 400)

  const line = failureLine(lines)
  assert.equal(line.level, WARN)
  assert.equal(line.statusCode, 400)
  assert.equal(line.errMessage, 'name is required')
  assert.equal(line.err, undefined)
})

test('the Authorization header never reaches a log line', async (t) => {
  const { fastify, lines } = await buildWithCollectedLogs()
  t.after(() => void fastify.close())

  const token = 'super-secret-token-value'
  await fastify.inject({
    method: 'GET',
    url: '/boom',
    headers: { authorization: `Bearer ${token}` }
  })

  // Asserted over every line the request produced, not just the failure one —
  // a request-logging default elsewhere could reintroduce this at any time.
  const serialized = JSON.stringify(lines)
  assert.ok(!serialized.includes(token), 'a token must never be written to a log')
})

test('a 404 is structured and correlated, not a bare info string', async (t) => {
  const { fastify, lines } = await buildWithCollectedLogs()
  t.after(() => void fastify.close())

  const res = await fastify.inject({ method: 'GET', url: '/no-such-route' })

  assert.equal(res.statusCode, 404)

  const body = JSON.parse(res.payload) as { requestId: string, error: string }
  const header = res.headers['x-request-id']

  // Fastify's default 404 sends a plain object rather than an Error, so it
  // never reached setErrorHandler — while the onSend hook still stamped an
  // x-request-id. The client got an id that matched no log line anywhere, so
  // searching for it came back empty and read as "no such failure".
  assert.equal(body.requestId, header)
  assert.equal(body.error, 'Not Found')

  const line = lines.find((entry) => entry.msg === 'route not found')
  assert.ok(line !== undefined, 'a 404 must leave a structured line')
  assert.equal(line.requestId, header)
  assert.equal(line.statusCode, 404)
  assert.equal(line.level, WARN)
})

test('a successful response also carries a correlation id', async (t) => {
  const { fastify } = await buildWithCollectedLogs()
  t.after(() => void fastify.close())

  const res = await fastify.inject({ method: 'GET', url: '/fine' })

  assert.equal(res.statusCode, 200)
  // A request that returns 200 and still does the wrong thing needs something
  // to join a client report against.
  assert.equal(typeof res.headers['x-request-id'], 'string')
})

test('correlation ids are unique per request', async (t) => {
  const { fastify } = await buildWithCollectedLogs()
  t.after(() => void fastify.close())

  const first = await fastify.inject({ method: 'GET', url: '/fine' })
  const second = await fastify.inject({ method: 'GET', url: '/fine' })

  // Fastify's own request.id is a per-process counter, so two Lambda
  // containers would hand out the same ids. This is the regression guard for
  // dropping back to it.
  assert.notEqual(first.headers['x-request-id'], second.headers['x-request-id'])
})
