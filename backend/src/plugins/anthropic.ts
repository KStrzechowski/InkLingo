import fp from 'fastify-plugin'
import { Anthropic } from '@anthropic-ai/sdk'
// Type-only import (erased at runtime — a plain value import of a .d.ts
// crashes ts-node/esm's loader, which tries to actually require() it).
// Forces ts-node to load fastify.d.ts's ambient FastifyInstance
// augmentation before checking this file. Unlike a full `tsc` build (which
// scans tsconfig's `include` glob upfront regardless of imports), ts-node's
// per-file dynamic-import checking only pulls in files actually reachable
// from an import — a .d.ts nothing imports is otherwise never seen.
import type { AuthUser as _AuthUser } from '../fastify.d.ts'

export interface AnthropicPluginOptions {
  // Specify Anthropic plugin options here
}

export default fp<AnthropicPluginOptions>(async (fastify) => {
  const client = new Anthropic({ apiKey: fastify.config.anthropicApiKey })

  fastify.decorate('anthropicClient', client)
}, { name: 'anthropic', dependencies: ['config'] })
