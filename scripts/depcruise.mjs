// Canonical dependency-cruiser invocation for this repo.
//
// Two things make the raw command awkward enough to be worth a wrapper:
//
//  1. There is no root package.json, so dependency-cruiser is never installed —
//     it runs through npx. But npx resolves transpilers relative to its own temp
//     install, not the cwd, so `npx dependency-cruiser` alone cannot see any
//     TypeScript at all: it silently cruises 0 modules out of a .ts folder.
//     `npx -p dependency-cruiser -p typescript` puts both in the same temp dir,
//     which is what enables .ts/.tsx. (dependency-cruiser 16 accepts typescript
//     >=2 <6, so the parser is pinned to 5.x even though three of the four apps
//     are on 6/7 — it only parses imports, it does not typecheck.)
//
//  2. The cross-app rules in .dependency-cruiser.cjs only mean anything if all
//     four apps are cruised in one pass. Cruising them one at a time cannot see
//     frontend/ reaching into backend/.
//
// Usage:
//   node scripts/depcruise.mjs                        # validate, err reporter
//   node scripts/depcruise.mjs --output-type err-long  # + the rule comments
//   node scripts/depcruise.mjs --output-type mermaid -f deps.mmd
//   node scripts/depcruise.mjs --output-type dot | dot -T svg > deps.svg
//   node scripts/depcruise.mjs --focus '^backend/src/routes' --output-type text
//
// Everything after the script name is forwarded to dependency-cruiser verbatim.

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Every tree that holds first-party source. Explicit directories rather than a
// glob: a `**/*.{ts,tsx}` glob quietly drops backend/test/register-loader.mjs,
// and a dropped file is a dropped check.
const SOURCES = [
  'frontend/src',
  'frontend/test',
  'frontend/e2e',
  'frontend/browser-tests',
  'backend/src',
  'backend/test',
  'extension/src',
  'extension/test',
  'infra/bin',
  'infra/lib',
  'infra/test',
  // Build/deploy glue rather than app code, but first-party either way — and
  // infra/scripts/ is where two of the four filesystem-level cross-app
  // couplings live (it packages backend/dist and writes frontend/.env.production).
  'infra/scripts',
  'scripts',
]

const forwarded = process.argv.slice(2)
const hasReporter = forwarded.some((argument) => argument === '-T' || argument === '--output-type')

const result = spawnSync(
  'npx',
  [
    '--yes',
    '-p',
    'dependency-cruiser@^16',
    '-p',
    'typescript@^5',
    'depcruise',
    '--config',
    '.dependency-cruiser.cjs',
    ...(hasReporter ? [] : ['--output-type', 'err-long']),
    ...forwarded,
    ...SOURCES,
  ],
  {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    // Windows cannot spawn the npx .cmd shim directly (same reason
    // scripts/quality/checks.mjs uses a shell).
    shell: true,
  },
)

process.exit(result.status ?? 1)
