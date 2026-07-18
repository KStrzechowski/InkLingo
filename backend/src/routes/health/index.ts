import { type FastifyPluginAsync } from 'fastify'

// Pure liveness probe for the Lambda/API Gateway wiring itself: no auth,
// no DB call, so it stays fast and cheap to poll.
const health: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.get('/', async () => {
    return { status: 'ok', time: new Date().toISOString() }
  })
}

export default health
