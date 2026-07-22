import { type FastifyPluginAsync } from 'fastify'

export interface AuthUser {
  id: string
  cognitoSub: string
  email: string | undefined
}

const BEARER_PREFIX = 'Bearer '

// Cascades (via @fastify/autoload's autoHooks + cascadeHooks, see app.ts) to
// every route nested under routes/api/ — new routes are protected with zero
// opt-in. DB upsert failures below are deliberately not caught: they
// propagate to Fastify's default error handler (500), which is correct — a
// provisioning failure isn't a bad credential and shouldn't be reported as 401.
const authHooks: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.addHook('onRequest', async (request, reply) => {
    const authorization = request.headers.authorization

    if (typeof authorization !== 'string' || !authorization.startsWith(BEARER_PREFIX)) {
      return reply.unauthorized()
    }

    const token = authorization.slice(BEARER_PREFIX.length)

    let payload
    try {
      payload = await fastify.jwtVerifier.verify(token)
    } catch {
      return reply.unauthorized()
    }

    const cognitoSub = payload.sub
    const email = typeof payload.email === 'string' ? payload.email : undefined

    const [row] = await fastify.sql`
      INSERT INTO users (cognito_sub)
      VALUES (${cognitoSub})
      ON CONFLICT (cognito_sub) DO UPDATE SET cognito_sub = EXCLUDED.cognito_sub
      RETURNING id
    `

    request.authUser = { id: row.id, cognitoSub, email }
  })
}

export default authHooks

declare module 'fastify' {
  export interface FastifyRequest {
    authUser: AuthUser;
  }
}
