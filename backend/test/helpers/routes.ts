import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROUTES_DIR = path.join(__dirname, '..', '..', 'src', 'routes')

// Non-route support files, excluded by name rather than relying on them
// having no fastify.get/post calls to match: autohooks.ts registers an
// onRequest hook (@fastify/autoload's autoHooks convention), and schemas.ts
// exports TypeBox schema objects, not a Fastify plugin.
export const NON_ROUTE_FILES = new Set(['autohooks.ts', 'schemas.ts'])

export function walkRouteFiles (dir: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkRouteFiles(fullPath))
    } else if (entry.name.endsWith('.ts') && !NON_ROUTE_FILES.has(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}
