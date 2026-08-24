import { test } from 'node:test'
import * as assert from 'node:assert'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

// The anti-corruption layer's success criterion, as a gate rather than a
// command documented in a plan nobody re-runs. Reads project source as plain
// text — the technique route-reachability.test.ts already uses to catch drift
// without AWS credentials or a deployed stack.
//
// This has been verified by making it fail: adding an @anthropic-ai/sdk import
// to a route file turns it red, and removing it turns it green again. A gate
// verified only in the happy case has been shown to run exactly once
// (context/foundation/lessons.md).

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_DIR = path.join(__dirname, '..', '..')

// The two files permitted to know a provider exists: the adapter, and the one
// test that drives it with a provider response envelope.
const ADAPTER = 'src/adapters/anthropicTranslator.ts'
const ADAPTER_TEST = 'test/adapters/anthropicTranslator.test.ts'

// This file names every needle it searches for, so it matches itself. Excluded
// from its own walk — a gate cannot meaningfully police itself, and leaving it
// in would mean hard-coding it into each expected set, which would let a real
// leak hide behind the exception.
const SELF = 'test/architecture/providerBoundary.test.ts'

// A drop in what the walk finds would make every assertion below vacuously
// true, so the count is asserted too.
const MIN_EXPECTED_FILES = 30

function walk (dir: string, sink: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      walk(full, sink)
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.mjs')) {
      sink.push(full)
    }
  }
  return sink
}

function sourceFiles (): Array<{ relative: string, text: string }> {
  return [...walk(path.join(BACKEND_DIR, 'src')), ...walk(path.join(BACKEND_DIR, 'test'))]
    .map((full) => ({
      relative: path.relative(BACKEND_DIR, full).split(path.sep).join('/'),
      text: fs.readFileSync(full, 'utf8')
    }))
    .filter((file) => file.relative !== SELF)
}

function filesContaining (needle: string): string[] {
  return sourceFiles()
    .filter((file) => file.text.includes(needle))
    .map((file) => file.relative)
    .sort()
}

test('the provider SDK is importable from exactly two files', () => {
  const files = sourceFiles()
  assert.ok(
    files.length >= MIN_EXPECTED_FILES,
    `only walked ${files.length} source files — the walk is broken, so every assertion here is vacuous`
  )

  assert.deepStrictEqual(filesContaining('@anthropic-ai/sdk'), [ADAPTER, ADAPTER_TEST])
})

// Both are literals in the adapter and nowhere else — even its own test reaches
// the tool name through the exported constant rather than retyping it, so a
// rename cannot leave a stale copy behind anywhere in the repo.
test('the model id and tool name appear nowhere outside the adapter', () => {
  assert.deepStrictEqual(filesContaining('claude-haiku'), [ADAPTER])
  assert.deepStrictEqual(filesContaining('return_translation'), [ADAPTER])
})

// The decorator this change removed is what made the SDK reachable from every
// route in the app with full type support and no import. Its absence is the
// structural half of the claim; the import check above is the mechanical half.
test('no route or plugin can reach a provider client', () => {
  for (const needle of ['anthropicClient', 'toolUse', 'tool_use', 'TranslationResult']) {
    const offenders = filesContaining(needle)
      .filter((file) => file.startsWith('src/routes/') || file.startsWith('src/plugins/'))
    assert.deepStrictEqual(offenders, [], `"${needle}" leaked back into a route or plugin`)
  }
})

test('the deleted provider module has not come back', () => {
  assert.equal(fs.existsSync(path.join(BACKEND_DIR, 'src', 'ai')), false)
})
