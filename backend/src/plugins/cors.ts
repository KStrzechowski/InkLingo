import fp from 'fastify-plugin'
import cors from '@fastify/cors'

export interface CorsPluginOptions {
  // Specify Cors plugin options here
}

export default fp<CorsPluginOptions>(async (fastify) => {
  await fastify.register(cors, {
    origin: fastify.config.allowedOrigin
  })
}, { name: 'cors', dependencies: ['config'] })
