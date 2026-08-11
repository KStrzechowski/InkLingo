// PostToolUse hook: the per-edit quality layer.
//
// Fires after every Write/Edit. Runs the fast checks the edited file earns
// (oxlint always, `vitest related` when the file is a test-plan.md risk area)
// and reports failures on stderr with exit code 2, which Claude Code feeds back
// into the agent's context so it can fix the problem on the next turn.
//
// Routing lives in scripts/quality/checks.mjs, shared with the git hooks.

import { checksFor, runCheck, toRepoRelative } from '../../scripts/quality/checks.mjs'

const EXIT_OK = 0
const EXIT_BLOCK = 2 // blocking: stderr is fed back to the agent
const EXIT_SOFT = 1 // non-blocking: logged, does not interrupt the loop

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

const raw = await readStdin()

let payload
try {
  payload = JSON.parse(raw)
} catch {
  // A malformed payload is our problem, not the agent's — say so without
  // blocking work on it.
  console.error('post-edit-check: could not parse the hook payload')
  process.exit(EXIT_SOFT)
}

const repoRelative = toRepoRelative(payload?.tool_input?.file_path)
if (!repoRelative) process.exit(EXIT_OK) // outside the repo, or no path (e.g. NotebookEdit)

const checks = checksFor([repoRelative])
if (checks.length === 0) process.exit(EXIT_OK)

const results = checks.map(runCheck)
const failures = results.filter((result) => !result.ok)

if (failures.length === 0) {
  // Everything passed. Lint warnings don't fail the build (CI runs plain
  // `oxlint`, which exits 0 on them), so surface them as context instead of
  // blocking — the agent can clean them up on the next turn.
  const notes = results.map((result) => result.notes).filter(Boolean).join('\n')
  if (notes) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `Lint warnings in ${repoRelative} (non-blocking):\n${notes.slice(0, 3000)}`,
      },
    }))
  }
  process.exit(EXIT_OK)
}

console.error(`Quality checks failed for ${repoRelative}:`)
for (const failure of failures) {
  console.error(`\n--- ${failure.label} ---`)
  // Cap each report: the agent's additionalContext tops out at 10,000
  // characters, and a truncated failure is still actionable.
  console.error(failure.output.slice(0, 3000) || '(no output)')
}
console.error('\nFix these before continuing.')
process.exit(EXIT_BLOCK)
