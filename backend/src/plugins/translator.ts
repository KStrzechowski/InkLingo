import fp from 'fastify-plugin'
import { createAnthropicTranslator } from '../adapters/anthropicTranslator.ts'
// Type-only import (erased at runtime — a plain value import of a .d.ts
// crashes ts-node/esm's loader, which tries to actually require() it).
// Forces ts-node to load fastify.d.ts's ambient FastifyInstance
// augmentation before checking this file. Unlike a full `tsc` build (which
// scans tsconfig's `include` glob upfront regardless of imports), ts-node's
// per-file dynamic-import checking only pulls in files actually reachable
// from an import — a .d.ts nothing imports is otherwise never seen.
// See context/foundation/lessons.md: this trap has been hit twice, most
// recently in plugins/anthropic.ts, the file this one replaces.
import type { AuthUser as _AuthUser } from '../fastify.d.ts'

export interface TranslatorPluginOptions {
  // Specify Translator plugin options here
}

// The application's only knowledge of which provider is active is the factory
// name on the line below. Swapping providers is this line plus a new file in
// adapters/ — no route, schema, migration, client type or component moves.
export default fp<TranslatorPluginOptions>(async (fastify) => {
  const translator = createAnthropicTranslator({
    apiKey: fastify.config.anthropicApiKey
  })

  fastify.decorate('translator', translator)
}, { name: 'translator', dependencies: ['config'] })
