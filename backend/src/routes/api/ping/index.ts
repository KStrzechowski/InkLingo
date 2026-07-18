import { type FastifyPluginAsync } from 'fastify'

interface LambdaWebAdapterRequestContext {
  authorizer?: {
    jwt?: {
      claims?: Record<string, unknown>
    }
  }
}

function extractCognitoClaims (rawHeader: unknown): Record<string, unknown> | undefined {
  if (typeof rawHeader !== 'string') {
    return undefined
  }

  try {
    const requestContext = JSON.parse(rawHeader) as LambdaWebAdapterRequestContext
    return requestContext.authorizer?.jwt?.claims
  } catch {
    return undefined
  }
}

// Protected by the API Gateway HttpUserPoolAuthorizer, not app-level auth
// - unauthenticated requests never reach this handler.
const ping: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.get('/', async (request) => {
    // TEMPORARY: confirms exactly how Lambda Web Adapter forwards API
    // Gateway's JWT authorizer claims before wiring real claim extraction.
    // Remove once confirmed against a real deployed request (Phase 2).
    fastify.log.debug({ headers: request.headers }, 'api/ping raw headers')

    const claims = extractCognitoClaims(request.headers['x-amzn-request-context'])
    const [row] = await fastify.sql`SELECT now() AS db_time`

    return { ok: true, dbTime: row.db_time, claimsPresent: Boolean(claims) }
  })
}

export default ping
