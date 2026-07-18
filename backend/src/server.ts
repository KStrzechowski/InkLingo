import Fastify from 'fastify'
import app from './app.ts'

const fastify = Fastify({
  logger: true
})

await fastify.register(app)
await fastify.ready()

const port = Number(process.env.PORT) || 8080
await fastify.listen({ port, host: '0.0.0.0' })
