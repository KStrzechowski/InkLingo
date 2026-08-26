// Seeds one demo collection that exercises every feature the invariant
// aggregate refactor adds. The old print fixtures ("Print test 5 languages")
// are single-meaning by construction and cannot exercise the new shape.
//
// Change-local on purpose: this is not shipped in `backend/`, it is a fixture
// generator for manual verification. Same `.env` parsing idiom as
// `phase0-probe.mjs`.
//
// Idempotent: re-running deletes the collection by name and rebuilds it.
//
//   node context/changes/invariant-aggregate-refactor/seed-demo.mjs [cognito-sub]
//
// With no argument it attaches the collection to the most recently created
// user, which on a dev branch is whoever last logged in.

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const REPO = 'C:/D/source/repos/10xDevs/InkLingo'
const require = createRequire(`${REPO}/backend/package.json`)
const { Client } = require('pg')

const env = readFileSync(`${REPO}/backend/.env`, 'utf8')
const url = env.match(/^NEON_DATABASE_URL=(.*)$/m)?.[1].trim().replace(/^["']|["']$/g, '')
if (!url) throw new Error('NEON_DATABASE_URL not found')

const COLLECTION_NAME = 'Demo — senses, overflow, sparse spokes'
const NATIVE = 'pl'
const TARGETS = ['en', 'de', 'fr', 'es', 'ru']

// senses[].translations[].sentences[] — the shape this whole change exists to
// make representable.
const ENTRIES = [
  {
    // THE headline case: one word, three unrelated meanings. Under
    // UNIQUE(entry_id, language_code) only one of these survived a save.
    word: 'zamek',
    senses: [
      {
        gloss: 'budowla obronna',
        translations: [
          { lang: 'en', meaning: 'castle', ipa: '/ˈkɑːsl/', sentences: [['The castle stands on a hill.', 'Zamek stoi na wzgórzu.']] },
          { lang: 'de', meaning: 'Schloss', ipa: '/ʃlɔs/', sentences: [['Das Schloss ist sehr alt.', 'Zamek jest bardzo stary.']] },
          { lang: 'fr', meaning: 'château', ipa: '/ʃɑ.to/', sentences: [['Le château domine la vallée.', 'Zamek góruje nad doliną.']] },
          { lang: 'es', meaning: 'castillo', ipa: '/kasˈtiʎo/', sentences: [['El castillo tiene una torre.', 'Zamek ma wieżę.']] },
          { lang: 'ru', meaning: 'замок', ipa: '/ˈzamək/', sentences: [['Замок стоит на холме.', 'Zamek stoi na wzgórzu.']] }
        ]
      },
      {
        gloss: 'zamknięcie w drzwiach',
        translations: [
          { lang: 'en', meaning: 'lock', ipa: '/lɒk/', sentences: [['The lock is broken.', 'Zamek jest zepsuty.']] },
          { lang: 'de', meaning: 'Schloss', ipa: '/ʃlɔs/', sentences: [['Das Schloss klemmt.', 'Zamek się zacina.']] },
          { lang: 'fr', meaning: 'serrure', ipa: '/sɛ.ʁyʁ/', sentences: [['La serrure est cassée.', 'Zamek jest zepsuty.']] },
          { lang: 'es', meaning: 'cerradura', ipa: '/θeraˈðuɾa/', sentences: [['La cerradura no funciona.', 'Zamek nie działa.']] },
          { lang: 'ru', meaning: 'замок', ipa: '/zɐˈmok/', sentences: [['Замок сломался.', 'Zamek się zepsuł.']] }
        ]
      },
      {
        // SPARSE SPOKE: a meaning present in one language only. Every read path
        // and the print sheet have to survive a sense that most columns cannot
        // fill.
        gloss: 'zapięcie w ubraniu',
        translations: [
          { lang: 'en', meaning: 'zipper', ipa: '/ˈzɪpər/', sentences: [['The zipper on my jacket broke.', 'Zamek w mojej kurtce się zepsuł.']] }
        ]
      }
    ]
  },
  {
    // LONG WORD: `independence /ˌɪndɪˈpendəns/` measured 203.9px against a
    // 118.9px column (PrintDocument.tsx:168-173). The overflow case the print
    // geometry test exists for.
    word: 'niepodległość',
    senses: [
      {
        gloss: 'niezależność państwa',
        translations: [
          { lang: 'en', meaning: 'independence', ipa: '/ˌɪndɪˈpendəns/', sentences: [['Independence was declared in 1918.', 'Niepodległość ogłoszono w 1918 roku.']] },
          { lang: 'de', meaning: 'Unabhängigkeit', ipa: '/ˈʊnapˌhɛŋɪçkaɪt/', sentences: [['Die Unabhängigkeit wurde 1918 erklärt.', 'Niepodległość ogłoszono w 1918 roku.']] },
          { lang: 'fr', meaning: 'indépendance', ipa: '/ɛ̃.de.pɑ̃.dɑ̃s/', sentences: [["L'indépendance fut proclamée en 1918.", 'Niepodległość ogłoszono w 1918 roku.']] },
          { lang: 'es', meaning: 'independencia', ipa: '/independˈenθja/', sentences: [['La independencia se declaró en 1918.', 'Niepodległość ogłoszono w 1918 roku.']] },
          { lang: 'ru', meaning: 'независимость', ipa: '/nʲɪzɐˈvʲisʲɪməsʲtʲ/', sentences: [['Независимость была провозглашена в 1918 году.', 'Niepodległość ogłoszono w 1918 roku.']] }
        ]
      }
    ]
  },
  {
    // LONG SENTENCE + LONG NATIVE GLOSS, in every column at once.
    word: 'przedsiębiorczość',
    senses: [
      {
        gloss: 'zdolność do prowadzenia działalności gospodarczej',
        translations: [
          { lang: 'en', meaning: 'entrepreneurship', ipa: '/ˌɒntrəprəˈnɜːʃɪp/', sentences: [['Entrepreneurship requires a tolerance for uncertainty that most salaried work never asks of anyone.', 'Przedsiębiorczość wymaga tolerancji na niepewność, jakiej praca na etacie nigdy od nikogo nie wymaga.']] },
          { lang: 'de', meaning: 'Unternehmertum', ipa: '/ʊntɐˈneːmɐtuːm/', sentences: [['Unternehmertum verlangt eine Bereitschaft zum Risiko, die eine feste Anstellung selten einfordert.', 'Przedsiębiorczość wymaga gotowości do ryzyka, jakiej stała posada rzadko wymaga.']] },
          { lang: 'fr', meaning: 'entrepreneuriat', ipa: '/ɑ̃.tʁə.pʁə.nœ.ʁja/', sentences: [["L'entrepreneuriat exige une tolérance à l'incertitude que le salariat ne demande presque jamais.", 'Przedsiębiorczość wymaga tolerancji na niepewność, jakiej praca najemna prawie nigdy nie wymaga.']] },
          { lang: 'es', meaning: 'emprendimiento', ipa: '/empɾendiˈmjento/', sentences: [['El emprendimiento exige una tolerancia a la incertidumbre que el trabajo asalariado casi nunca pide.', 'Przedsiębiorczość wymaga tolerancji na niepewność, jakiej praca najemna prawie nigdy nie wymaga.']] },
          { lang: 'ru', meaning: 'предпринимательство', ipa: '/prʲɪtprʲɪnʲɪˈmatʲɪlʲstvə/', sentences: [['Предпринимательство требует терпимости к неопределённости, которой почти никогда не требует наёмная работа.', 'Przedsiębiorczość wymaga tolerancji na niepewność, jakiej praca najemna prawie nigdy nie wymaga.']] }
        ]
      }
    ]
  }
]

const senseKeyAtMigrationTime = (gloss) => gloss.trim().toLowerCase()

const client = new Client({ connectionString: url })
await client.connect()

try {
  await client.query('BEGIN')

  const sub = process.argv[2]
  const { rows: userRows } = sub
    ? await client.query('SELECT id FROM users WHERE cognito_sub = $1', [sub])
    : await client.query('SELECT id FROM users ORDER BY created_at DESC LIMIT 1')
  if (userRows.length === 0) {
    throw new Error(sub ? `no user with cognito_sub=${sub}` : 'no users in the database')
  }
  const userId = userRows[0].id

  // Idempotence: rebuild from scratch rather than reconciling. The cascade
  // takes senses, translations and sentences with it.
  const { rowCount: dropped } = await client.query(
    'DELETE FROM collections WHERE user_id = $1 AND name = $2',
    [userId, COLLECTION_NAME]
  )
  if (dropped > 0) console.log(`replaced ${dropped} existing "${COLLECTION_NAME}"`)

  const { rows: collectionRows } = await client.query(
    'INSERT INTO collections (user_id, name, native_language_code) VALUES ($1, $2, $3) RETURNING id',
    [userId, COLLECTION_NAME, NATIVE]
  )
  const collectionId = collectionRows[0].id
  for (const code of TARGETS) {
    await client.query(
      'INSERT INTO collection_target_languages (collection_id, language_code) VALUES ($1, $2)',
      [collectionId, code]
    )
  }

  let senses = 0
  let translations = 0
  let sentences = 0

  for (const entry of ENTRIES) {
    const { rows: entryRows } = await client.query(
      'INSERT INTO entries (collection_id, word_or_phrase, source_language_code) VALUES ($1, $2, $3) RETURNING id',
      [collectionId, entry.word, NATIVE]
    )
    const entryId = entryRows[0].id

    for (const sense of entry.senses) {
      const { rows: senseRows } = await client.query(
        'INSERT INTO entry_senses (entry_id, gloss_text, sense_key) VALUES ($1, $2, $3) RETURNING id',
        [entryId, sense.gloss, senseKeyAtMigrationTime(sense.gloss)]
      )
      const senseId = senseRows[0].id
      senses += 1

      for (const translation of sense.translations) {
        const { rows: translationRows } = await client.query(
          `INSERT INTO entry_translations (entry_id, sense_id, language_code, meaning_text, phonetic_transcription)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [entryId, senseId, translation.lang, translation.meaning, translation.ipa]
        )
        const translationId = translationRows[0].id
        translations += 1

        for (const [targetText, nativeGloss] of translation.sentences) {
          await client.query(
            `INSERT INTO entry_sentences (entry_id, translation_id, language_code, sentence_text, native_gloss_text)
             VALUES ($1, $2, $3, $4, $5)`,
            [entryId, translationId, translation.lang, targetText, nativeGloss]
          )
          sentences += 1
        }
      }
    }
  }

  await client.query('COMMIT')
  console.log(`seeded "${COLLECTION_NAME}" (${collectionId})`)
  console.log(`  ${ENTRIES.length} entries · ${senses} senses · ${translations} translations · ${sentences} sentences`)
  console.log('  zamek carries 3 meanings, one of them a sparse spoke (en only)')
} catch (err) {
  await client.query('ROLLBACK')
  throw err
} finally {
  await client.end()
}
