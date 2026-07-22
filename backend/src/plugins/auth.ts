import fp from 'fastify-plugin'
import { CognitoJwtVerifier } from 'aws-jwt-verify'
// Type-only import (erased at runtime — a plain value import of a .d.ts
// crashes ts-node/esm's loader, which tries to actually require() it).
// Forces ts-node to load fastify.d.ts's ambient FastifyInstance
// augmentation before checking this file. Unlike a full `tsc` build (which
// scans tsconfig's `include` glob upfront regardless of imports), ts-node's
// per-file dynamic-import checking only pulls in files actually reachable
// from an import — a .d.ts nothing imports is otherwise never seen.
import type { AuthUser as _AuthUser } from '../fastify.d.ts'

export interface AuthPluginOptions {
  // Specify Auth plugin options here
}

export default fp<AuthPluginOptions>(async (fastify) => {
  const jwtVerifier = CognitoJwtVerifier.create({
    userPoolId: fastify.config.cognitoUserPoolId,
    tokenUse: 'id',
    clientId: fastify.config.cognitoClientId
  })

  fastify.decorate('jwtVerifier', jwtVerifier)
}, { name: 'auth', dependencies: ['config'] })
