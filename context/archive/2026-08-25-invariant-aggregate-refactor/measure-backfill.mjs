// Live verification, backfill surface (FR-018 / decision D-2). Same treatment
// as measure-capture.mjs for a different prompt: the model is handed a known
// glossText and asked for a word in one language, rather than handed a word
// and asked to enumerate meanings — a different prompt is a different place
// to fail, per lessons.md.
//
//   cd backend && node ../context/changes/invariant-aggregate-refactor/measure-backfill.mjs
//
// Reads ANTHROPIC_API_KEY from backend/.env. PREREQUISITE: `npm run build:ts`
// in backend/ first. Calls the SDK directly, one attempt per case, bypassing
// the port's own retry — the retry's justification is the raw empty-result
// rate this script measures.

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
  senseTranslationTool,
  senseSystemPrompt
} = await import(distUrl('backend/dist/adapters/anthropicTranslator.js'))
const { RequestedLanguages, senseTranslationFromProviderPayload } = await import(distUrl('backend/dist/domain/translationDraft.js'))

const MODEL = ANTHROPIC_MODEL
const TOOL = TRANSLATION_TOOL_NAME
const IN = 1.0 / 1e6
const OUT = 5.0 / 1e6

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function run (label, text, glossText, nativeCode, targetCode) {
  const requested = RequestedLanguages.of(nativeCode, [targetCode])
  const start = performance.now()
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS_PER_SENSE_LANGUAGE,
    system: senseSystemPrompt(requested, glossText),
    messages: [{ role: 'user', content: text }],
    tools: [senseTranslationTool],
    tool_choice: { type: 'tool', name: TOOL }
  })
  const latencyMs = performance.now() - start

  const { input_tokens: i, output_tokens: o } = msg.usage
  const cost = i * IN + o * OUT
  const toolUse = msg.content.find((b) => b.type === 'tool_use')
  const raw = toolUse?.input

  let translation = null
  let failure = null
  try {
    translation = senseTranslationFromProviderPayload(raw, targetCode)
  } catch (err) {
    failure = err.name
  }

  console.log(`\n--- ${label} ("${text}" / "${glossText}", ${nativeCode} -> ${targetCode}) ---`)
  console.log(`  latency: ${latencyMs.toFixed(0)}ms`)
  console.log(`  input  : ${i} tokens ($${(i * IN).toFixed(5)})`)
  console.log(`  output : ${o} tokens ($${(o * OUT).toFixed(5)}) — ceiling was ${MAX_TOKENS_PER_SENSE_LANGUAGE}, headroom ${MAX_TOKENS_PER_SENSE_LANGUAGE - o} (${(100 * (1 - o / MAX_TOKENS_PER_SENSE_LANGUAGE)).toFixed(1)}%)`)
  console.log(`  TOTAL  : $${cost.toFixed(5)}`)
  console.log(`  failure: ${failure ?? 'none'}`)
  if (translation !== null) {
    console.log(`  word   : ${translation.meaningText}${translation.phoneticTranscription !== null ? ` /${translation.phoneticTranscription}/` : ''}`)
    console.log(`  sentence: ${translation.sentences[0]?.targetText ?? '(none)'}`)
  }

  return { label, i, o, cost, latencyMs, failure }
}

const results = []

// Exactly D-2's real subject: one meaning of a multi-meaning word, one
// language at a time — does the model answer for THAT meaning and not drift
// to the word's other senses?
results.push(await run('zamek: castle sense -> de', 'zamek', 'fortyfikowana budowla obronna', 'pl', 'de'))
results.push(await run('zamek: lock sense -> de', 'zamek', 'zamknięcie lub sprzączka', 'pl', 'de'))
results.push(await run('zamek: castle sense -> fr', 'zamek', 'fortyfikowana budowla obronna', 'pl', 'fr'))
results.push(await run('zamek: lock sense -> fr', 'zamek', 'zamknięcie lub sprzączka', 'pl', 'fr'))
results.push(await run('bank: financial sense -> de', 'bank', 'instytucja finansowa', 'pl', 'de'))
results.push(await run('bank: riverbank sense -> de', 'bank', 'brzeg rzeki lub zbiornika wodnego', 'pl', 'de'))
results.push(await run('bank: financial sense -> es', 'bank', 'instytucja finansowa', 'pl', 'es'))
results.push(await run('bank: riverbank sense -> es', 'bank', 'brzeg rzeki lub zbiornika wodnego', 'pl', 'es'))

// Unambiguous words — the common case, one sense to fill.
results.push(await run('cat -> de', 'kot', 'domowe zwierzę mięsożerne', 'pl', 'de'))
results.push(await run('water -> fr', 'woda', 'przezroczysta ciecz bez smaku i zapachu', 'pl', 'fr'))
results.push(await run('table -> it', 'stół', 'meble do siedzenia i spożywania posiłków', 'pl', 'it'))
results.push(await run('good morning -> de', 'dzień dobry', 'pozdrowienie używane rano i w ciągu dnia', 'pl', 'de'))

const usable = results.filter((r) => r.failure === null)
const totalCost = results.reduce((s, r) => s + r.cost, 0)
const avgLatency = results.reduce((s, r) => s + r.latencyMs, 0) / results.length

console.log('\n=== BACKFILL SURFACE SUMMARY ===')
console.log(`calls          : ${results.length}`)
console.log(`usable         : ${usable.length}/${results.length} (${(100 * usable.length / results.length).toFixed(1)}%)`)
console.log(`failed         : ${results.filter((r) => r.failure !== null).map((r) => `${r.label}=${r.failure}`).join(', ') || 'none'}`)
console.log(`total cost     : $${totalCost.toFixed(5)}`)
console.log(`avg cost/call  : $${(totalCost / results.length).toFixed(5)}`)
console.log(`avg latency    : ${avgLatency.toFixed(0)}ms`)
console.log(`1,000 backfills ≈ $${(1000 * totalCost / results.length).toFixed(2)}`)
