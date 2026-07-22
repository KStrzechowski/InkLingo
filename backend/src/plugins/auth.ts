import fp from 'fastify-plugin'
import { CognitoJwtVerifier } from 'aws-jwt-verify'
// Type-only import (erased at runtime, so it can't break `npm run dev`'s
// native execution): registers config.ts's `FastifyInstance.config` type
// augmentation before this file is type-checked. Without it, ts-node's
// per-file ESM loader can type-check auth.ts (alphabetically before
// config.ts in this directory, so dynamically imported first by
// @fastify/autoload) before config.ts's `declare module 'fastify'` block
// has been seen, causing a spurious "Property 'config' does not exist" error.
import type { AppConfig } from './config.ts'

export interface AuthPluginOptions {
  // Specify Auth plugin options here
}

type CognitoVerifierProperties = {
  userPoolId: string
  tokenUse: 'id'
  clientId: string
}

export default fp<AuthPluginOptions>(async (fastify) => {
  const jwtVerifier = CognitoJwtVerifier.create({
    userPoolId: fastify.config.cognitoUserPoolId,
    tokenUse: 'id',
    clientId: fastify.config.cognitoClientId
  })

  fastify.decorate('jwtVerifier', jwtVerifier)
}, { name: 'auth', dependencies: ['config'] })

declare module 'fastify' {
  export interface FastifyInstance {
    jwtVerifier: ReturnType<typeof CognitoJwtVerifier.create<CognitoVerifierProperties>>;
  }
}
