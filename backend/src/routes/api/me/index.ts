import { type FastifyPluginAsync } from 'fastify'

const me: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.get('/', async (request) => {
    return { id: request.authUser.id, email: request.authUser.email }
  })
}

export default me
