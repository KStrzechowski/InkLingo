import fp from 'fastify-plugin'
import rateLimit from '@fastify/rate-limit'

export interface RateLimitPluginOptions {
  // Specify Rate-limit plugin options here
}

// global: false — most routes stay unlimited; AI-calling routes opt in via
// a per-route `config.rateLimit` override (see collections/index.ts's
// /:id/translate), closing the denial-of-wallet gap infrastructure.md's
// risk register flags.
export default fp<RateLimitPluginOptions>(async (fastify) => {
  await fastify.register(rateLimit, { global: false })
})
