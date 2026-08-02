// Reproduces the cost baseline recorded in change.md.
//
// Per lessons.md:33-38 ("A stubbed AI client cannot tell you the model's
// output is usable"), the numbers in change.md came from real API calls, not
// estimates. Re-run this before planning — model pricing and behaviour move.
//
//   cd backend && node ../context/changes/translation-pivot/measure-cost.mjs
//
// Reads ANTHROPIC_API_KEY from backend/.env. Costs roughly $0.02 per run.
// Deliberately duplicates the tool schema and system prompt from
// backend/src/ai/translate.ts rather than importing them, so it keeps
// measuring the CURRENT shipped shape even after that file changes — if the
// two drift, that drift is itself the thing worth noticing.

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

const MODEL = 'claude-haiku-4-5-20251001'
const TOOL = 'return_translation'
// Haiku 4.5 pricing per million tokens, as of 2026-08-01. Verify before trusting.
const IN = 1.0 / 1e6
const OUT = 5.0 / 1e6

const translationTool = {
  name: TOOL,
  description: 'Return structured translation variants with IPA phonetics and bilingual example sentences for a captured word or phrase, for every requested target language.',
  input_schema: {
    type: 'object',
    required: ['normalizedNativeText', 'languages'],
    properties: {
      normalizedNativeText: { type: 'string', description: 'The input word/phrase normalized to its base form in the native language, regardless of which language it was typed in.' },
      languages: {
        type: 'array',
        description: 'One entry per requested target language, in the order they were requested.',
        items: {
          type: 'object',
          required: ['languageCode', 'variants'],
          properties: {
            languageCode: { type: 'string', description: 'The target language code this entry covers, copied exactly from the requested list.' },
            variants: {
              type: 'array',
              minItems: 1,
              description: 'The distinct meanings of the word in this target language. Never empty.',
              items: {
                type: 'object',
                required: ['meaningText', 'phoneticTranscription', 'sentences'],
                properties: {
                  meaningText: { type: 'string', description: 'This variant\'s translation in this target language.' },
                  phoneticTranscription: { type: ['string', 'null'], description: 'IPA phonetic transcription of the target-language translation, or null if one cannot be produced.' },
                  sentences: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      type: 'object',
                      required: ['targetText', 'nativeGlossText'],
                      properties: {
                        targetText: { type: 'string', description: 'An example sentence in this target language using this variant.' },
                        nativeGlossText: { type: 'string', description: 'That same sentence translated into the native language.' }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

const systemPrompt = (native, targets) => `You are a translation assistant inside a language-learning app. The active collection's native language is "${native}" and its target (learning) languages are: ${targets.map((c) => `"${c}"`).join(', ')}. The user will type a word or phrase in the native language or in any one of the target languages — detect which one, then respond only via the provided tool call. Return one entry in "languages" for every requested target language, using the exact codes listed above. Within each language, give several translation variants covering distinct meanings if the word is ambiguous, each with an IPA phonetic transcription of that language's form, and a few example sentences per variant, each paired with a native-language gloss.

Every language entry must contain at least one variant, and every variant at least one example sentence. An empty "variants" array is never an acceptable answer — if the word is unfamiliar or you are unsure of it, still give your best single translation rather than returning nothing.`

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function run (label, text, targets) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 2048 * Math.max(targets.length, 1),
    system: systemPrompt('pl', targets),
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
