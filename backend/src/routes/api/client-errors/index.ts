import { type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { clientErrorsBodySchema } from './schemas.ts'
import { redactRequestContext } from './redact.ts'
// Forcing import for the fastify.d.ts ambient augmentations this file reads
// (`request.authUser`, `request.correlationId`). See lessons.md.
import type { AuthUser as _AuthUser } from '../../../fastify.d.ts'

// A report costs one log write, so an unthrottled route is a log-flooding and
// CloudWatch-cost vector — the same denial-of-wallet shape infrastructure.md's
// risk register raises about the AI routes. Keyed per user, like /:id/translate.
const REPORT_RATE_LIMIT_MAX = 60

const clientErrors: FastifyPluginAsyncTypebox = async (fastify): Promise<void> => {
  const reportRateLimit = {
    rateLimit: {
      max: REPORT_RATE_LIMIT_MAX,
      timeWindow: '1 minute',
      keyGenerator: (request: { authUser: { id: string } }) => request.authUser.id
    }
  }

  // Authenticated, like everything else under /api (routes/api/autohooks.ts).
  // The failure this most wants to see — a dead session — cannot reach here at
  // the moment it happens, which is why each client buffers and flushes on
  // recovery rather than why this route is public.
  fastify.post(
    '/',
    { schema: { body: clientErrorsBodySchema }, config: reportRateLimit },
    async (request) => {
      const accepted: string[] = []

      for (const report of request.body.reports) {
        const requestContext = redactRequestContext(report.request)

        fastify.log.warn({
          clientError: {
            eventId: report.eventId,
            app: report.app,
            appVersion: report.appVersion,
            occurredAt: report.occurredAt,
            name: report.name,
            message: report.message,
            stack: report.stack,
            routePath: report.routePath,
            // The join to the server's own line for this failure, when the
            // response carried one.
            correlatedRequestId: report.requestId,
            request: requestContext
          },
          userId: request.authUser.id,
          // The correlation id of *this* delivery, distinct from the failure's
          // own — so a problem with reporting is itself traceable.
          requestId: request.correlationId
        }, 'client error reported')

        accepted.push(report.eventId)
      }

      // Echoes exactly what was logged. The client drains these ids and keeps
      // the rest, so a partial failure never silently discards a report.
      return { accepted }
    }
  )
}

export default clientErrors
