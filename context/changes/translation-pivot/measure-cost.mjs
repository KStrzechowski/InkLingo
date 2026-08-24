// Reproduces the cost baseline recorded in change.md.
//
// Per lessons.md:33-38 ("A stubbed AI client cannot tell you the model's
// output is usable"), the numbers in change.md came from real API calls, not
// estimates. Re-run this before planning — model pricing and behaviour move.
//
//   cd backend && node ../context/changes/translation-pivot/measure-cost.mjs
//
// Reads ANTHROPIC_API_KEY from backend/.env. Costs roughly $0.02 per run.
//
// PREREQUISITE: run `npm run build:ts` in backend/ first — this imports the
// compiled adapter from backend/dist/.
//
// It used to carry a hand-copied second copy of the tool schema, prompt, model
// id and token formula, on the theory that a copy keeps measuring the shipped
// shape. It did the opposite: nothing detected when the two drifted, so the
// instrument could quietly measure a contract the app no longer sent. Now it
// imports the one definition from the adapter — the only place a provider
// contract lives — so the thing measured is the thing shipped, by
// construction. It still builds its own client and calls the API directly;
// that is what a cost instrument is for, and routing it through the port would
// measure the wrong thing.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const { default: Anthropic } = await import(
  new URL(`file:///${path.join(repoRoot, 'backend/node_modules/@anthropic-ai/sdk/index.mjs').replace(/\\/g, '/')}`).href
)

for (const line of fs.readFileSync(path.join(repoRoot, 'backend/.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

// The one definition of the provider contract, imported rather than copied.
// Reads from dist/ because this is a plain .mjs script with no TS loader —
// hence the build:ts prerequisite in the header above.
const distUrl = (relative) =>
  new URL(`file:///${path.join(repoRoot, relative).split(path.sep).join('/')}`).href

const { ANTHROPIC_MODEL, TRANSLATION_TOOL_NAME, MAX_TOKENS_PER_LANGUAGE, translationTool, systemPrompt } =
  await import(distUrl('backend/dist/adapters/anthropicTranslator.js'))
const { RequestedLanguages } = await import(distUrl('backend/dist/domain/translationDraft.js'))

const MODEL = ANTHROPIC_MODEL
const TOOL = TRANSLATION_TOOL_NAME
// Haiku 4.5 pricing per million tokens, as of 2026-08-01. Verify before trusting.
const IN = 1.0 / 1e6
const OUT = 5.0 / 1e6

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function run (label, text, targets) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS_PER_LANGUAGE * Math.max(targets.length, 1),
    system: systemPrompt(RequestedLanguages.of('pl', targets)),
    messages: [{ role: 'user', content: text }],
    tools: [translationTool],
    tool_choice: { type: 'tool', name: TOOL }
  })
  const { input_tokens: i, output_tokens: o } = msg.usage
  const cost = i * IN + o * OUT
  const result = msg.content.find((b) => b.type === 'tool_use')?.input
  const variants = (result?.languages ?? []).reduce((n, l) => n + (l.variants?.length ?? 0), 0)
  const sentences = (result?.languages ?? []).reduce(
    (n, l) => n + (l.variants ?? []).reduce((m, v) => m + (v.sentences?.length ?? 0), 0), 0
  )
  console.log(`\n--- ${label} ("${text}", ${targets.length} langs) ---`)
  console.log(`  input  : ${i} tokens ($${(i * IN).toFixed(5)})`)
  console.log(`  output : ${o} tokens ($${(o * OUT).toFixed(5)})`)
  console.log(`  TOTAL  : $${cost.toFixed(5)}  (output = ${Math.round((100 * o * OUT) / cost)}% of cost)`)
  console.log(`  shape  : ${result?.languages?.length ?? 0} languages, ${variants} variants, ${sentences} sentences`)
  return cost
}

// Baseline recorded 2026-08-01: $0.00986 / $0.00528 / $0.00277, ≈ $7.57 per 1,000 captures.
const five = ['en', 'de', 'fr', 'es', 'it']
const a = await run('ambiguous single word', 'zamek', five)
const b = await run('simple word', 'kot', five)
await run('single target language', 'zamek', ['en'])

console.log(`\n=== average 5-lang capture: $${((a + b) / 2).toFixed(5)} ===`)
console.log(`1,000 captures ≈ $${((1000 * (a + b)) / 2).toFixed(2)}`)
