// Git-hook entry point for the pre-commit and pre-push layers.
//
//   pre-commit — the same fast checks the agent runs per edit, over staged
//                files. Catches what bypassed the agent: manual edits, a
//                teammate's commit, anything written outside the session.
//   pre-push   — the heavier pass: full typecheck and the full Vitest suite
//                for every app touched by the commits being pushed.
//
// Both share the routing in checks.mjs, so a risk area is defined once.

import { spawnSync } from 'node:child_process'
import { checksFor, classify, heavyChecksFor, REPO_ROOT, runCheck } from './checks.mjs'

const mode = process.argv[2]

function git(args) {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' })
  if (result.status !== 0) return []
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
}

function readStdin() {
  return new Promise((resolve) => {
    let raw = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      raw += chunk
    })
    process.stdin.on('end', () => resolve(raw))
    process.stdin.on('error', () => resolve(''))
  })
}

const ZERO_SHA = /^0+$/

/**
 * Files carried by the commits about to be pushed. Git feeds pre-push one
 * `<local ref> <local sha> <remote ref> <remote sha>` line per ref; an
 * all-zero remote sha means the branch is new there, so fall back to what the
 * branch adds on top of main.
 */
function pushedFiles(stdin) {
  const files = new Set()
  const lines = stdin.split('\n').map((line) => line.trim()).filter(Boolean)

  for (const line of lines) {
    const [, localSha, , remoteSha] = line.split(/\s+/)
    if (!localSha || ZERO_SHA.test(localSha)) continue // deleting a remote ref

    const range = remoteSha && !ZERO_SHA.test(remoteSha)
      ? `${remoteSha}..${localSha}`
      : `origin/main..${localSha}`
    git(['diff', '--name-only', '--diff-filter=ACMR', range]).forEach((file) => files.add(file))
  }

  // No refs on stdin (a manual `node staged-check.mjs pre-push`, or a git
  // version that stayed quiet): check everything this branch changed.
  if (lines.length === 0) {
    git(['diff', '--name-only', '--diff-filter=ACMR', 'origin/main...HEAD']).forEach((file) => files.add(file))
  }

  return [...files]
}

function report(checks) {
  if (checks.length === 0) {
    console.log(`${mode}: nothing to check`)
    return 0
  }

  let failed = false
  for (const check of checks) {
    process.stdout.write(`${mode}: ${check.label}... `)
    const result = runCheck(check)
    console.log(result.ok ? 'ok' : 'FAILED')
    if (!result.ok) {
      failed = true
      console.log(result.output || '(no output)')
    } else if (result.notes) {
      console.log(result.notes) // warnings — reported, not blocking
    }
  }
  return failed ? 1 : 0
}

if (mode === 'pre-commit') {
  const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
  process.exit(report(checksFor(staged)))
} else if (mode === 'pre-push') {
  const files = pushedFiles(await readStdin())
  const apps = new Set()
  for (const file of files) {
    const classified = classify(file)
    if (classified) apps.add(classified.app.name)
  }
  process.exit(report(heavyChecksFor(apps)))
} else {
  console.error('usage: node scripts/quality/staged-check.mjs <pre-commit|pre-push>')
  process.exit(1)
}
