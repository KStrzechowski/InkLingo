// Shared routing for the local quality layers: which check runs for which file,
// and how to run it. Three entry points import this — the per-edit agent hook
// (.claude/hooks/post-edit-check.mjs), pre-commit and pre-push
// (scripts/quality/staged-check.mjs). Keeping the routing in one place is the
// point: a risk area added here is picked up by every layer at once.
//
// The layering rule (CLAUDE.md, Module 3 Lesson 3): each gate belongs to the
// cheapest layer that still gives signal. Timings below were measured on this
// machine on 2026-08-11 and are why each check sits where it does.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

const IS_WINDOWS = process.platform === 'win32'
const LINTABLE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

// Apps that can answer a check fast enough for the per-edit loop.
//
// backend/ and infra/ are deliberately absent. backend has no linter at all,
// and its `npm test` rebuilds TypeScript (~20s for `tsc` alone) and talks to a
// real Neon database — an edit-loop hook that slow would cost more than it
// catches. Both stay at pre-push and CI, where test-plan.md §5 already
// enforces them.
const APPS = [
  {
    name: 'frontend',
    dir: 'frontend',
    lint: true,
    // test-plan.md Risk #2 (print output), #4 (auth/token handling),
    // #6 (collections pages). Everything else in src/ has no test to run.
    riskAreas: [/^src\/(api|auth|pages)\//, /^test\//],
  },
  {
    name: 'extension',
    dir: 'extension',
    lint: true,
    // test-plan.md Risk #6. The whole popup/background surface counts — it was
    // the repo's highest-churn zero-coverage area until Phase 5.
    riskAreas: [/^src\//, /^test\//],
  },
  { name: 'backend', dir: 'backend', lint: false, riskAreas: [] },
  { name: 'infra', dir: 'infra', lint: false, riskAreas: [] },
]

// `vitest related` walks the module graph, so it cannot see a file the test
// opens with node:fs. printCssGeometry.test.ts reads print.css off disk on
// purpose (Vite's `?raw` does not survive Vitest — see the comment in that
// file), which makes print.css invisible to `related`. Route it by hand, or
// the check that guards the A4 geometry passes vacuously on every CSS edit.
const EXPLICIT_TESTS = new Map([
  ['frontend/src/pages/print.css', ['test/pages/printCssGeometry.test.ts']],
])

/** Repo-relative POSIX path, or null if the path is outside the repo. */
export function toRepoRelative(filePath) {
  if (!filePath) return null
  const relative = path.relative(REPO_ROOT, path.resolve(REPO_ROOT, filePath))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return relative.split(path.sep).join('/')
}

/** The app owning a repo-relative path, plus the path relative to that app. */
export function classify(repoRelative) {
  const app = APPS.find((candidate) => repoRelative.startsWith(`${candidate.dir}/`))
  if (!app) return null
  return { app, appRelative: repoRelative.slice(app.dir.length + 1) }
}

function binary(appDir, name) {
  const shim = path.join(REPO_ROOT, appDir, 'node_modules', '.bin', IS_WINDOWS ? `${name}.cmd` : name)
  return existsSync(shim) ? shim : null
}

/**
 * The checks a set of repo-relative paths earns, deduplicated and batched so
 * each tool runs once per app rather than once per file.
 */
export function checksFor(repoRelativePaths) {
  const lintTargets = new Map()
  const testTargets = new Map()

  for (const repoRelative of repoRelativePaths) {
    const classified = classify(repoRelative)
    if (!classified) continue
    const { app, appRelative } = classified

    if (app.lint && LINTABLE.has(path.extname(appRelative))) {
      if (!lintTargets.has(app.name)) lintTargets.set(app.name, { app, files: [] })
      lintTargets.get(app.name).files.push(appRelative)
    }

    const explicit = EXPLICIT_TESTS.get(repoRelative)
    // `related` can only trace files that are in the module graph, so a stylesheet
    // or an asset earns a test run only through EXPLICIT_TESTS above — otherwise
    // it costs a few seconds to match nothing.
    const traceable = LINTABLE.has(path.extname(appRelative))
    const isRiskArea = traceable && app.riskAreas.some((pattern) => pattern.test(appRelative))
    if (!explicit && !isRiskArea) continue

    if (!testTargets.has(app.name)) {
      testTargets.set(app.name, { app, related: new Set(), explicit: new Set() })
    }
    const target = testTargets.get(app.name)
    if (explicit) explicit.forEach((spec) => target.explicit.add(spec))
    else target.related.add(appRelative)
  }

  const checks = []

  for (const { app, files } of lintTargets.values()) {
    const bin = binary(app.dir, 'oxlint')
    if (!bin) continue // dependencies not installed — nothing to say
    // surfaceOutput: oxlint exits 0 on warnings, so plain `npm run lint` — and
    // therefore CI — passes with them. The hook keeps that threshold rather
    // than inventing a stricter local one, but still reports the warnings so
    // they get fixed instead of accumulating unseen.
    checks.push({ label: `oxlint (${app.name})`, cwd: app.dir, bin, args: files, surfaceOutput: true })
  }

  for (const { app, related, explicit } of testTargets.values()) {
    const bin = binary(app.dir, 'vitest')
    if (!bin) continue
    if (explicit.size > 0) {
      checks.push({
        label: `vitest (${app.name})`,
        cwd: app.dir,
        bin,
        args: ['run', ...explicit],
      })
    }
    if (related.size > 0) {
      checks.push({
        label: `vitest related (${app.name})`,
        cwd: app.dir,
        bin,
        args: ['related', ...related, '--run'],
      })
    }
  }

  return checks
}

/** Typecheck + full test run for an app — the pre-push layer. */
export function heavyChecksFor(appNames) {
  const checks = []
  for (const name of appNames) {
    const app = APPS.find((candidate) => candidate.name === name)
    if (!app) continue

    const tsc = binary(app.dir, 'tsc')
    if (tsc) {
      // backend and infra emit; frontend and extension use project references.
      const args = app.name === 'backend' || app.name === 'infra' ? ['--noEmit'] : ['-b']
      checks.push({ label: `typecheck (${app.name})`, cwd: app.dir, bin: tsc, args })
    }

    // Only frontend and extension: backend's suite needs a live Neon branch and
    // infra's Jest run is not tied to any top-7 risk (test-plan.md §4).
    if (app.name === 'frontend' || app.name === 'extension') {
      const vitest = binary(app.dir, 'vitest')
      if (vitest) checks.push({ label: `tests (${app.name})`, cwd: app.dir, bin: vitest, args: ['run'] })
    }
  }
  return checks
}

/** Run one check. Returns { ok, label, output }. */
export function runCheck(check) {
  // shell:true is required on Windows: Node refuses to spawn a .cmd shim
  // directly, and the npm bin shims are .cmd files there.
  const quote = (value) => (IS_WINDOWS ? `"${value}"` : `'${value}'`)
  const result = spawnSync(quote(check.bin), check.args.map(quote), {
    cwd: path.join(REPO_ROOT, check.cwd),
    encoding: 'utf8',
    shell: true,
  })

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  return {
    ok: result.status === 0,
    label: check.label,
    output,
    // Worth reporting even when the check passed (see surfaceOutput above).
    notes: check.surfaceOutput && result.status === 0 && output ? output : '',
  }
}
