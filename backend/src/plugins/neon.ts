import fp from 'fastify-plugin'
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'

export interface NeonPluginOptions {
  // Specify Neon plugin options here
}

// Deliberately the HTTP-based serverless driver, not a persistent
// pg.Pool: Lambda's execution environment is ephemeral and reused
// unpredictably across invocations, which a TCP connection pool doesn't
// tolerate well.
export default fp<NeonPluginOptions>(async (fastify) => {
  const sql = neon(fastify.config.neonDatabaseUrl)

  fastify.decorate('sql', sql)
}, { name: 'neon', dependencies: ['config'] })

declare module 'fastify' {
  export interface FastifyInstance {
    sql: NeonQueryFunction<false, false>;
  }
}
