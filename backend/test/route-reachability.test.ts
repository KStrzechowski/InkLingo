import { test } from 'node:test'
import * as assert from 'node:assert'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

// A route added under backend/src/routes/ passes the full backend suite
// (test/helper.ts builds the app in-process) whether or not it has a
// matching infra/lib/constructs/api-construct.ts entry — nothing under test
// ever goes through the real API Gateway. This has shipped unreachable
// twice (see context/foundation/lessons.md). This is a static source
// comparison, not an HTTP test: it reads both sides as plain text, so it
// catches drift without needing AWS credentials or a deployed stack.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROUTES_DIR = path.join(__dirname, '..', 'src', 'routes')
const API_CONSTRUCT_PATH = path.join(__dirname, '..', '..', 'infra', 'lib', 'constructs', 'api-construct.ts')

interface RouteEntry {
  method: string
  path: string
}

// Normalizes Fastify's :param segments to API Gateway's {param} segments so
// both sides compare on one syntax.
function normalizePath (routePath: string): string {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
}

function joinPrefix (prefix: string, subPath: string): string {
  if (subPath === '/') return prefix === '' ? '/' : prefix
  return `${prefix}${subPath}`
}

// Non-route support files, excluded by name rather than relying on them
// having no fastify.get/post calls to match: autohooks.ts registers an
// onRequest hook (@fastify/autoload's autoHooks convention), and schemas.ts
// exports TypeBox schema objects, not a Fastify plugin.
const NON_ROUTE_FILES = new Set(['autohooks.ts', 'schemas.ts'])

function walkRouteFiles (dir: string): string[] {
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

// Only recognizes the literal fastify.get/post/put/delete/patch('/path', ...)
// call shape used everywhere in this codebase today. A route registered via
// fastify.route({ method, url }) or a computed/template-literal path would
// be invisible here — and equally invisible to extractGatewayRoutes' literal
// addRoutes({ path, methods }) match below, so such a route would silently
// report as "matching" (absent from both sides) instead of failing loudly.
// The MIN_EXPECTED_ROUTES tripwire below guards against a *drop* in what
// this pattern catches; it doesn't guard against a genuinely new call shape.
function extractBackendRoutes (): RouteEntry[] {
  const routes: RouteEntry[] = []
  const methodCallPattern = /fastify\.(get|post|put|delete|patch)\s*\(\s*(['"`])(.*?)\2/g

  for (const filePath of walkRouteFiles(ROUTES_DIR)) {
    const source = fs.readFileSync(filePath, 'utf8')
    const relDir = path.relative(ROUTES_DIR, path.dirname(filePath)).split(path.sep).join('/')
    const prefix = relDir === '' ? '' : `/${relDir}`

    for (const match of source.matchAll(methodCallPattern)) {
      routes.push({
        method: match[1].toUpperCase(),
        path: normalizePath(joinPrefix(prefix, match[3]))
      })
    }
  }
  return routes
}

function extractGatewayRoutes (): RouteEntry[] {
  const routes: RouteEntry[] = []
  const source = fs.readFileSync(API_CONSTRUCT_PATH, 'utf8')
  const addRoutesBlockPattern = /addRoutes\(\{([\s\S]*?)\}\);/g

  for (const blockMatch of source.matchAll(addRoutesBlockPattern)) {
    const block = blockMatch[1]
    const pathMatch = /path:\s*(['"`])(.*?)\1/.exec(block)
    const methodsMatch = /methods:\s*\[([\s\S]*?)\]/.exec(block)
    if (pathMatch === null || methodsMatch === null) continue

    const routePath = normalizePath(pathMatch[2])
    for (const methodMatch of methodsMatch[1].matchAll(/HttpMethod\.(\w+)/g)) {
      routes.push({ method: methodMatch[1].toUpperCase(), path: routePath })
    }
  }
  return routes
}

function routeKey (route: RouteEntry): string {
  return `${route.method} ${route.path}`
}

// Tripwire floor, not a hardcoded expectation — bump it up when a route is
// legitimately added. Catches the parser silently extracting fewer routes
// than it used to (e.g. a call-shape change it no longer recognizes),
// which a plain > 0 check would miss.
const MIN_EXPECTED_ROUTES = 8

test('every backend route has a matching API Gateway entry, and vice versa', () => {
  const backendRoutes = new Set(extractBackendRoutes().map(routeKey))
  const gatewayRoutes = new Set(extractGatewayRoutes().map(routeKey))

  assert.ok(
    backendRoutes.size >= MIN_EXPECTED_ROUTES,
    `route extraction found only ${backendRoutes.size} backend route(s) (expected at least ${MIN_EXPECTED_ROUTES}) — the parser likely missed some, not that the app lost routes`
  )
  assert.ok(
    gatewayRoutes.size >= MIN_EXPECTED_ROUTES,
    `route extraction found only ${gatewayRoutes.size} gateway route(s) (expected at least ${MIN_EXPECTED_ROUTES}) — the parser likely missed some, not that the app lost routes`
  )

  const missingFromGateway = [...backendRoutes].filter((route) => !gatewayRoutes.has(route)).sort()
  const missingFromBackend = [...gatewayRoutes].filter((route) => !backendRoutes.has(route)).sort()

  assert.deepStrictEqual(
    missingFromGateway,
    [],
    `route(s) exist under backend/src/routes/ with no infra/lib/constructs/api-construct.ts entry: ${missingFromGateway.join(', ')}`
  )
  assert.deepStrictEqual(
    missingFromBackend,
    [],
    `route(s) are registered in infra/lib/constructs/api-construct.ts with no matching file under backend/src/routes/: ${missingFromBackend.join(', ')}`
  )
})
