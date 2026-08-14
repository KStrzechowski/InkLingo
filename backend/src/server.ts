import Fastify from 'fastify'
import app from './app.ts'

const fastify = Fastify({
  // Default pino level, `info` — the deployed level, since the Lambda runs
  // this file via run.sh (`exec node dist/server.js`) and never `npm start`.
  // plugins/error-handler.ts picks its levels against this: anything logged
  // below `info` there is discarded in production.
  logger: true,
  // The LWA readiness probe polls /health on every cold start
  // (AWS_LWA_READINESS_CHECK_PATH, infra/lib/constructs/api-construct.ts), and
  // Fastify's default request logging writes two `info` lines per request. In a
  // one-week log group that noise is what buries real failures — the structured
  // line from the error handler carries everything these two did, and only for
  // requests worth reading about.
  disableRequestLogging: true
})

await fastify.register(app)
await fastify.ready()

const port = Number(process.env.PORT) || 8080
await fastify.listen({ port, host: '0.0.0.0' })
