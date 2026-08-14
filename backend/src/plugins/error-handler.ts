import fp from 'fastify-plugin'
import { type FastifyError } from 'fastify'
import { randomUUID } from 'node:crypto'
import { STATUS_CODES } from 'node:http'
// Forcing import for the fastify.d.ts ambient augmentations this file reads
// (`request.authUser`, `request.correlationId`). Erased at runtime; without it
// ts-node/esm may check this file before the augmentation is loaded. See
// context/foundation/lessons.md.
import type { AuthUser as _AuthUser } from '../fastify.d.ts'

export interface ErrorHandlerPluginOptions {
  // Specify Error-handler plugin options here
}

export const CORRELATION_HEADER = 'x-request-id'

// Fastify's own `request.id` is a per-process counter (`req-1`, `req-2`), so
// two Lambda containers hand out the same ids and a correlation id stops
// correlating. Generated server-side rather than read off an inbound header:
// a client-supplied id would be unvalidated text going straight into a log
// line.
function correlationIdFor (): string {
  return randomUUID()
}

// Every failure gets one structured line and a correlation id the client can
// quote back.
//
// Levels are chosen against the *deployed* level, which is pino's default
// `info` (src/server.ts — the Lambda runs that file, never `npm start`, so
// package.json's `-l info` never applies). Anything below `info` here is
// discarded in production, which is why 401 is not at `debug`: that would mean
// "never logged", reversing account-auth's impl-review finding F1
// ("a real incident would just look like a spike of 401s with no breadcrumb").
// The noise that motivated demoting them is handled at the source instead, by
// disableRequestLogging in server.ts.
//
// Response shape is deliberately unchanged apart from the added `requestId` —
// `statusCode`, `error`, and `message` keep the values Fastify's default
// handler produced, so no client parsing an error body has to change.
export default fp<ErrorHandlerPluginOptions>(async (fastify) => {
  fastify.decorateRequest('correlationId', '')

  fastify.addHook('onRequest', async (request) => {
    request.correlationId = correlationIdFor()
  })

  // On every response, not just failures — a client report about a request
  // that returned 200 but did the wrong thing still needs something to join on.
  fastify.addHook('onSend', async (request, reply) => {
    reply.header(CORRELATION_HEADER, request.correlationId)
  })

  fastify.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500

    // Never the Authorization header, never a request body — the payloads on
    // these routes are user vocabulary data.
    const context = {
      requestId: request.correlationId,
      method: request.method,
      // The route template (`/api/collections/:id`), not the concrete URL, so
      // failures group instead of fragmenting per id.
      routePath: request.routeOptions?.url ?? request.url,
      statusCode,
      userId: request.authUser?.id
    }

    if (statusCode >= 500) {
      // `err` serializes with the stack. Only here: a 4xx is the client being
      // told no, and its stack points at our own throw site, not at a fault.
      request.log.error({ err: error, ...context }, 'request failed')
    } else if (statusCode === 401) {
      // `info`, not `debug` — see the note above. Distinct from the 4xx branch
      // so the level can be tuned without touching the rest.
      request.log.info(
        { errName: error.name, errMessage: error.message, ...context },
        'request rejected'
      )
    } else {
      request.log.warn(
        { errName: error.name, errMessage: error.message, ...context },
        'request rejected'
      )
    }

    void reply.status(statusCode).send({
      statusCode,
      error: STATUS_CODES[statusCode] ?? 'Internal Server Error',
      message: error.message,
      requestId: request.correlationId
    })
  })

  // Fastify's default 404 sends a plain object, not an Error, so it never
  // reaches setErrorHandler above. The onSend hook still stamps x-request-id,
  // which made it worse than useless: the client got a correlation id that
  // matched no log line anywhere, so searching for it came back empty and read
  // as "no such failure". A 404 is also the shape a missing API Gateway route
  // takes (lessons.md), which is exactly when you want to find it.
  fastify.setNotFoundHandler((request, reply) => {
    const context = {
      requestId: request.correlationId,
      method: request.method,
      routePath: request.url,
      statusCode: 404,
      userId: request.authUser?.id
    }
    request.log.warn(context, 'route not found')

    void reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: `Route ${request.method}:${request.url} not found`,
      requestId: request.correlationId
    })
  })
}, { name: 'error-handler' })

// A boot failure in server.ts's top-level await, or any floating promise that
// rejects after a response is sent, kills the container. Node's default prints
// a raw stack to stderr — not pino JSON, no correlation id, nothing that
// CloudWatch Insights can query. These make the last thing the process ever
// says match the shape of everything else it said.
export function installProcessHandlers (log: {
  error: (obj: object, msg: string) => void
}): void {
  process.on('unhandledRejection', (reason: unknown) => {
    log.error(
      { err: reason instanceof Error ? reason : new Error(String(reason)) },
      'unhandled rejection'
    )
  })
  process.on('uncaughtException', (err: Error) => {
    log.error({ err }, 'uncaught exception')
    // Deliberately not swallowed: after an uncaught exception the process is
    // in an undefined state and Lambda should replace the container. Logging
    // first is the only thing worth adding.
    process.exit(1)
  })
}
