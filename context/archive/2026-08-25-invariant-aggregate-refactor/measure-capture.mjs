// Live verification, capture surface. Per lessons.md ("A stubbed AI client
// cannot tell you the model's output is usable"), the question this answers —
// does the model group meanings well ACROSS languages — no stub can answer,
// because every stub in the suite is a fixture we wrote ourselves.
//
//   cd backend && node ../context/changes/invariant-aggregate-refactor/measure-capture.mjs
//
// Reads ANTHROPIC_API_KEY from backend/.env. PREREQUISITE: `npm run build:ts`
// in backend/ first — imports the compiled adapter from backend/dist/, so the
// contract measured is the contract shipped, not a hand-copied second one
// that could quietly drift from it (the mistake translation-pivot's
// measure-cost.mjs was rewritten to avoid).
//
// Calls the SDK directly, one attempt per case, bypassing the port's own
// EMPTY_DRAFT_RETRIES retry: the retry's whole justification is a measured
// empty-result rate, so measuring through it would hide the number the retry
// exists to explain.

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

const distUrl = (relative) =>
  new URL(`file:///${path.join(repoRoot, relative).split(path.sep).join('/')}`).href

const {
  ANTHROPIC_MODEL,
  TRANSLATION_TOOL_NAME,
  MAX_TOKENS_PER_SENSE_LANGUAGE,
  MAX_BUDGETED_SENSES,
  translationTool,
  systemPrompt
} = await import(distUrl('backend/dist/adapters/anthropicTranslator.js'))
const { RequestedLanguages, TranslationDraft } = await import(distUrl('backend/dist/domain/translationDraft.js'))

const MODEL = ANTHROPIC_MODEL
const TOOL = TRANSLATION_TOOL_NAME
// Haiku 4.5 pricing per million tokens, as of 2026-08-27. Verify before trusting.
const IN = 1.0 / 1e6
const OUT = 5.0 / 1e6

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function run (label, text, nativeCode, targets) {
  const requested = RequestedLanguages.of(nativeCode, targets)
  const maxTokens = MAX_TOKENS_PER_SENSE_LANGUAGE * MAX_BUDGETED_SENSES * Math.max(targets.length, 1)
  const start = performance.now()
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt(requested),
    messages: [{ role: 'user', content: text }],
    tools: [translationTool],
    tool_choice: { type: 'tool', name: TOOL }
  })
  const latencyMs = performance.now() - start

  const { input_tokens: i, output_tokens: o } = msg.usage
  const cost = i * IN + o * OUT
  const toolUse = msg.content.find((b) => b.type === 'tool_use')
  const raw = toolUse?.input

  let draft = null
  let malformed = false
  try {
    draft = TranslationDraft.fromProviderPayload(raw, requested)
  } catch {
    malformed = true
  }
  const degenerate = draft === null || draft.isDegenerate()
  const senseCount = draft?.senses.length ?? 0
  const translationCount = draft?.senses.reduce((n, s) => n + s.translations.length, 0) ?? 0
  const sentenceCount = draft?.senses.reduce(
    (n, s) => n + s.translations.reduce((m, t) => m + t.sentences.length, 0), 0
  ) ?? 0

  console.log(`\n--- ${label} ("${text}", ${nativeCode} -> ${targets.join(',')}) ---`)
  console.log(`  latency: ${latencyMs.toFixed(0)}ms`)
  console.log(`  input  : ${i} tokens ($${(i * IN).toFixed(5)})`)
  console.log(`  output : ${o} tokens ($${(o * OUT).toFixed(5)}) — ceiling was ${maxTokens}, headroom ${maxTokens - o} (${(100 * (1 - o / maxTokens)).toFixed(1)}%)`)
  console.log(`  TOTAL  : $${cost.toFixed(5)}`)
  console.log(`  shape  : ${senseCount} sense(s), ${translationCount} translation(s), ${sentenceCount} sentence(s)`)
  console.log(`  malformed: ${malformed}  degenerate: ${degenerate}`)
  if (draft !== null) {
    for (const sense of draft.senses) {
      console.log(`    - "${sense.glossText}": ${sense.translations.map((t) => `${t.languageCode}=${t.meaningText}`).join(', ')}`)
    }
  }

  return { label, i, o, cost, latencyMs, maxTokens, malformed, degenerate, senseCount }
}

const five = ['en', 'de', 'fr', 'es', 'it']
const results = []

// Ambiguous words — the case this whole change exists for: does the model
// keep several distinct meanings, grouped correctly across all 5 languages?
results.push(await run('ambiguous: castle/lock/zipper', 'zamek', 'pl', five))
results.push(await run('ambiguous: bank (river/financial)', 'bank', 'pl', five))
results.push(await run('ambiguous: to fine / okay', 'kara', 'pl', five))

// Unambiguous, single meaning.
results.push(await run('unambiguous: cat', 'kot', 'pl', five))
results.push(await run('unambiguous: water', 'woda', 'pl', five))
results.push(await run('unambiguous: table', 'stół', 'pl', five))

// A phrase rather than a single word.
results.push(await run('phrase: good morning', 'dzień dobry', 'pl', five))
results.push(await run('phrase: how are you', 'jak się masz', 'pl', five))

// Single target language — the narrow end of the senses x languages grid.
results.push(await run('1 language, ambiguous', 'zamek', 'pl', ['en']))
results.push(await run('1 language, unambiguous', 'kot', 'pl', ['en']))

// Captured from a target language rather than the native one.
results.push(await run('captured in target language', 'castle', 'pl', five))
results.push(await run('captured in target language, unambiguous', 'water', 'pl', five))

// A word likely unfamiliar to the model, to see the "give your best single
// meaning rather than nothing" fallback in the system prompt actually fire.
results.push(await run('obscure/rare word', 'zaściankowość', 'pl', ['en', 'de']))

const usable = results.filter((r) => !r.malformed && !r.degenerate)
const totalCost = results.reduce((s, r) => s + r.cost, 0)
const avgLatency = results.reduce((s, r) => s + r.latencyMs, 0) / results.length
const avgHeadroomPct = results.reduce((s, r) => s + (1 - r.o / r.maxTokens), 0) / results.length * 100

console.log('\n=== CAPTURE SURFACE SUMMARY ===')
console.log(`calls          : ${results.length}`)
console.log(`usable         : ${usable.length}/${results.length} (${(100 * usable.length / results.length).toFixed(1)}%)`)
console.log(`degenerate/malformed rate: ${(100 * (results.length - usable.length) / results.length).toFixed(1)}%`)
console.log(`total cost     : $${totalCost.toFixed(5)}`)
console.log(`avg cost/call  : $${(totalCost / results.length).toFixed(5)}`)
console.log(`avg latency    : ${avgLatency.toFixed(0)}ms`)
console.log(`avg headroom   : ${avgHeadroomPct.toFixed(1)}% of max_tokens unused`)
console.log(`1,000 captures ≈ $${(1000 * totalCost / results.length).toFixed(2)}`)
