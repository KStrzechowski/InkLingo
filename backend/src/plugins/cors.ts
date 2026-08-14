import fp from 'fastify-plugin'
import cors from '@fastify/cors'

export interface CorsPluginOptions {
  // Specify Cors plugin options here
}

export default fp<CorsPluginOptions>(async (fastify) => {
  await fastify.register(cors, {
    origin: fastify.config.allowedOrigin,
    // Without this the browser hides x-request-id from page JS, so a client
    // error report can never carry the id that would join it to the server's
    // log line. API Gateway needs the same entry (exposeHeaders in
    // infra/lib/constructs/api-construct.ts) for the deployed path.
    exposedHeaders: ['x-request-id']
  })
}, { name: 'cors', dependencies: ['config'] })
