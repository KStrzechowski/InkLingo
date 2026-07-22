import type { AppConfig } from './plugins/config.ts'
import type { NeonQueryFunction } from '@neondatabase/serverless'
import type { CognitoJwtVerifier } from 'aws-jwt-verify'

type CognitoVerifierProperties = {
  userPoolId: string
  tokenUse: 'id'
  clientId: string
}

export interface AuthUser {
  id: string
  cognitoSub: string
  email: string | undefined
}

// Single home for every FastifyInstance/FastifyRequest augmentation. A .d.ts
// file is picked up by tsconfig's `include` and is part of every compilation
// from the start, regardless of import order — unlike per-plugin `declare
// module` blocks, which depend on @fastify/autoload's alphabetical dynamic
// import order under ts-node/esm (see git history on plugins/auth.ts for the
// bug this caused when "auth" sorted before "config").
declare module 'fastify' {
  export interface FastifyInstance {
    config: AppConfig;
    sql: NeonQueryFunction<false, false>;
    jwtVerifier: ReturnType<typeof CognitoJwtVerifier.create<CognitoVerifierProperties>>;
  }

  export interface FastifyRequest {
    authUser: AuthUser;
  }
}
