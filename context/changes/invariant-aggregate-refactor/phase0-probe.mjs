import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const REPO = 'C:/D/source/repos/10xDevs/InkLingo'
const require = createRequire(`${REPO}/backend/package.json`)
const { Client } = require('pg')

// same .env parsing idiom as context/changes/translation-pivot/measure-cost.mjs
const env = readFileSync(`${REPO}/backend/.env`, 'utf8')
const url = env.match(/^NEON_DATABASE_URL=(.*)$/m)?.[1].trim().replace(/^["']|["']$/g, '')
if (!url) throw new Error('NEON_DATABASE_URL not found')

const QUERIES = [
  ['P1  non-lowercase language codes', `
    SELECT 'entry_translations.language_code' AS col, count(*)::int AS offending FROM entry_translations WHERE language_code <> lower(language_code)
    UNION ALL SELECT 'entry_sentences.language_code', count(*)::int FROM entry_sentences WHERE language_code <> lower(language_code)
    UNION ALL SELECT 'collection_target_languages.language_code', count(*)::int FROM collection_target_languages WHERE language_code <> lower(language_code)
    UNION ALL SELECT 'collections.native_language_code', count(*)::int FROM collections WHERE native_language_code <> lower(native_language_code)
    UNION ALL SELECT 'entries.source_language_code', count(*)::int FROM entries WHERE source_language_code <> lower(source_language_code)
    ORDER BY 1`],
  ['P1b distinct raw code values', `
    SELECT 'entry_translations' AS src, language_code, count(*)::int FROM entry_translations GROUP BY 1,2
    UNION ALL SELECT 'entry_sentences', language_code, count(*)::int FROM entry_sentences GROUP BY 1,2
    UNION ALL SELECT 'collection_target_languages', language_code, count(*)::int FROM collection_target_languages GROUP BY 1,2
    UNION ALL SELECT 'collections.native', native_language_code, count(*)::int FROM collections GROUP BY 1,2
    ORDER BY 1,2`],
  ['P2  orphan sentences', `
    SELECT count(*)::int AS orphan_sentences FROM entry_sentences s
     WHERE NOT EXISTS (SELECT 1 FROM entry_translations t WHERE t.entry_id=s.entry_id AND lower(t.language_code)=lower(s.language_code))`],
  ['P2b which orphans', `
    SELECT c.name AS collection, e.word_or_phrase, s.language_code, left(s.sentence_text,50) AS sentence
      FROM entry_sentences s JOIN entries e ON e.id=s.entry_id JOIN collections c ON c.id=e.collection_id
     WHERE NOT EXISTS (SELECT 1 FROM entry_translations t WHERE t.entry_id=s.entry_id AND lower(t.language_code)=lower(s.language_code))
     ORDER BY 1,2`],
  ['P2c AMBIGUOUS sentences (lower() join matches >1 translation)', `
    SELECT s.id AS sentence_id, s.entry_id, s.language_code, count(t.id)::int AS candidates
      FROM entry_sentences s JOIN entry_translations t ON t.entry_id=s.entry_id AND lower(t.language_code)=lower(s.language_code)
     GROUP BY 1,2,3 HAVING count(t.id) > 1`],
  ['P3  volume', `
    SELECT (SELECT count(*)::int FROM users) AS users,
           (SELECT count(*)::int FROM collections) AS collections,
           (SELECT count(*)::int FROM collection_target_languages) AS target_langs,
           (SELECT count(*)::int FROM entries) AS entries,
           (SELECT count(*)::int FROM entry_translations) AS translations,
           (SELECT count(*)::int FROM entry_sentences) AS sentences`],
  ['P4  would-be UNIQUE(sense_id, language_code) violations after lowercasing', `
    SELECT entry_id, lower(language_code) AS norm, count(*)::int AS collisions, array_agg(language_code) AS raw, array_agg(meaning_text) AS meanings
      FROM entry_translations GROUP BY 1,2 HAVING count(*) > 1`],
  ['P4b same, on collection_target_languages', `
    SELECT collection_id, lower(language_code) AS norm, count(*)::int, array_agg(language_code) AS raw
      FROM collection_target_languages GROUP BY 1,2 HAVING count(*) > 1`],
  ['P5  duplicate words within one collection', `
    SELECT c.name AS collection, lower(btrim(e.word_or_phrase)) AS would_be_sense_key, count(*)::int AS dup_entries
      FROM entries e JOIN collections c ON c.id=e.collection_id GROUP BY 1,2 HAVING count(*) > 1 ORDER BY 3 DESC`],
  ['P6  shape sanity', `
    SELECT (SELECT count(*)::int FROM entries e WHERE NOT EXISTS (SELECT 1 FROM entry_translations t WHERE t.entry_id=e.id)) AS entries_no_translations,
           (SELECT count(*)::int FROM entries e WHERE NOT EXISTS (SELECT 1 FROM entry_sentences s WHERE s.entry_id=e.id)) AS entries_no_sentences,
           (SELECT count(*)::int FROM entry_translations WHERE btrim(meaning_text)='') AS blank_meanings,
           (SELECT count(*)::int FROM entry_sentences WHERE native_gloss_text IS NULL) AS sentences_missing_gloss`],
  ['P7  multiple sentences per (entry, language)', `
    SELECT entry_id, lower(language_code) AS lc, count(*)::int FROM entry_sentences GROUP BY 1,2 HAVING count(*) > 1`],
]

const client = new Client({ connectionString: url })
await client.connect()
await client.query('SET default_transaction_read_only = on')
for (const [label, sql] of QUERIES) {
  console.log(`\n=== ${label} ===`)
  try {
    const { rows } = await client.query(sql)
    if (rows.length === 0) console.log('(no rows)')
    else console.table(rows)
  } catch (err) {
    console.log(`ERROR: ${err.message}`)
  }
}
await client.end()
