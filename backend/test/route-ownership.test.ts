import { test } from 'node:test'
import * as assert from 'node:assert'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { ROUTES_DIR, walkRouteFiles } from './helpers/routes.ts'

// Mirrors route-reachability.test.ts's static-source-comparison approach,
// applied to Risk #5 (IDOR) instead of Risk #1 (gateway reachability): a
// route accepting a collection/entry id in its path must call the shared
// ownership helper (backend/src/routes/api/collections/ownership.ts)
// rather than writing its own ad hoc (and possibly wrong) ownership query.
const methodCallPattern = /fastify\.(get|post|put|delete|patch)\s*\(\s*(['"`])(.*?)\2/g

interface IdRoute {
  method: string
  path: string
  handlerSource: string
}

function joinPrefix (prefix: string, subPath: string): string {
  if (subPath === '/') return prefix === '' ? '/' : prefix
  return `${prefix}${subPath}`
}

function routeLabel (route: IdRoute): string {
  return `${route.method} ${route.path}`
}

// Slices each match's handler source as "from this route registration's
// start to the next route registration's start" (or end of file). Safe only
// because no route handler in this codebase is nested inside another — see
// plan.md's Critical Implementation Details for the caveat; a future change
// that nests route registrations would need a real brace-matcher instead.
function extractIdRoutes (): IdRoute[] {
  const routes: IdRoute[] = []

  for (const filePath of walkRouteFiles(ROUTES_DIR)) {
    const source = fs.readFileSync(filePath, 'utf8')
    const relDir = path.relative(ROUTES_DIR, path.dirname(filePath)).split(path.sep).join('/')
    const prefix = relDir === '' ? '' : `/${relDir}`

    const matches = [...source.matchAll(methodCallPattern)]
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]
      const routePath = match[3]
      if (!routePath.includes(':id')) continue

      const start = match.index ?? 0
      const end = i + 1 < matches.length ? (matches[i + 1].index ?? source.length) : source.length
      routes.push({
        method: match[1].toUpperCase(),
        path: joinPrefix(prefix, routePath),
        handlerSource: source.slice(start, end)
      })
    }
  }
  return routes
}

// Tripwire floor, not a hardcoded expectation — bump it up when a new
// :id-accepting route is legitimately added. Catches the parser silently
// extracting fewer routes than it used to, which a plain > 0 check would miss.
const MIN_EXPECTED_ID_ROUTES = 4

test('every :id/:entryId route calls the shared ownership helper', () => {
  const idRoutes = extractIdRoutes()

  assert.ok(
    idRoutes.length >= MIN_EXPECTED_ID_ROUTES,
    `route extraction found only ${idRoutes.length} :id-accepting route(s) (expected at least ${MIN_EXPECTED_ID_ROUTES}) — the parser likely missed some, not that the app lost routes`
  )

  const missingCollectionCheck = idRoutes
    .filter((route) => !route.handlerSource.includes('fetchOwnedCollection('))
    .map(routeLabel)
  const missingEntryCheck = idRoutes
    .filter((route) => route.path.includes(':entryId') && !route.handlerSource.includes('fetchOwnedEntry('))
    .map(routeLabel)

  assert.deepStrictEqual(
    missingCollectionCheck,
    [],
    `route(s) accept a collection :id but never call fetchOwnedCollection(): ${missingCollectionCheck.join(', ')}`
  )
  assert.deepStrictEqual(
    missingEntryCheck,
    [],
    `route(s) accept an :entryId but never call fetchOwnedEntry(): ${missingEntryCheck.join(', ')}`
  )
})
