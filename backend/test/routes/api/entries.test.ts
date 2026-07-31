import { test } from 'node:test'
import * as assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { build } from '../../helper.js'
import { jwks, signToken } from '../../helpers/jwks.js'
import { createUserRow, createCollectionRow } from '../../helpers/fixtures.js'

type App = Awaited<ReturnType<typeof build>>

interface SavedEntry {
  id: string
  wordOrPhrase: string
  sourceLanguageCode: string
  createdAt: string
  translations: Array<{ id: string, languageCode: string, meaningText: string, phoneticTranscription: string | null }>
  sentences: Array<{ id: string, languageCode: string, sentenceText: string, nativeGlossText: string, createdAt: string }>
}

function validBody (): Record<string, unknown> {
  return {
    wordOrPhrase: 'pies',
    translations: [{ languageCode: 'en', meaningText: 'dog', phoneticTranscription: '/dɒɡ/' }],
    sentences: [{ languageCode: 'en', sentenceText: 'The dog runs.', nativeGlossText: 'Pies biegnie.' }]
  }
}

async function collectionFor (
  app: App,
  t: Parameters<typeof build>[0],
  name: string,
  targetLanguageCodes = ['en']
): Promise<{ collectionId: string, token: string }> {
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, name, 'pl', targetLanguageCodes)
  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub })
  return { collectionId, token }
}

test('POST /api/collections/:id/entries persists the entry, translation, and sentence rows', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Save endpoint test')

  const res = await app.inject({
    url: `/api/collections/${collectionId}/entries`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: validBody()
  })

  assert.equal(res.statusCode, 201)
  const created = JSON.parse(res.payload) as SavedEntry
  assert.equal(created.wordOrPhrase, 'pies')
  // Never taken from the request body — always the collection's native language.
  assert.equal(created.sourceLanguageCode, 'pl')
  assert.equal(created.translations.length, 1)
  assert.equal(created.translations[0].meaningText, 'dog')
  assert.equal(created.translations[0].phoneticTranscription, '/dɒɡ/')
  assert.equal(created.sentences.length, 1)
  assert.equal(created.sentences[0].sentenceText, 'The dog runs.')
  assert.equal(created.sentences[0].nativeGlossText, 'Pies biegnie.')

  const translationRows = await app.sql.query(
    'SELECT meaning_text, phonetic_transcription FROM entry_translations WHERE entry_id = $1',
    [created.id]
  ) as Array<{ meaning_text: string, phonetic_transcription: string | null }>
  const sentenceRows = await app.sql.query(
    'SELECT sentence_text, native_gloss_text FROM entry_sentences WHERE entry_id = $1',
    [created.id]
  ) as Array<{ sentence_text: string, native_gloss_text: string | null }>
  assert.deepStrictEqual(translationRows, [{ meaning_text: 'dog', phonetic_transcription: '/dɒɡ/' }])
  assert.deepStrictEqual(sentenceRows, [{ sentence_text: 'The dog runs.', native_gloss_text: 'Pies biegnie.' }])
})

test('a saved entry appears in GET /api/collections/:id with phonetics and native gloss', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Save then read-back test')

  const createRes = await app.inject({
    url: `/api/collections/${collectionId}/entries`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: validBody()
  })
  assert.equal(createRes.statusCode, 201)
  const created = JSON.parse(createRes.payload) as SavedEntry

  const res = await app.inject({ url: `/api/collections/${collectionId}`, headers: { authorization: `Bearer ${token}` } })
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.payload) as { entries: SavedEntry[] }

  assert.deepStrictEqual(body.entries.map((entry) => entry.id), [created.id])
  const [entry] = body.entries
  assert.equal(entry.translations[0].phoneticTranscription, '/dɒɡ/')
  assert.equal(entry.sentences[0].nativeGlossText, 'Pies biegnie.')
})

test('POST /api/collections/:id/entries accepts a null phoneticTranscription', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Null phonetics test')

  const res = await app.inject({
    url: `/api/collections/${collectionId}/entries`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { ...validBody(), translations: [{ languageCode: 'en', meaningText: 'dog', phoneticTranscription: null }] }
  })

  assert.equal(res.statusCode, 201)
  const created = JSON.parse(res.payload) as SavedEntry
  assert.equal(created.translations[0].phoneticTranscription, null)
})

test('POST /api/collections/:id/entries returns 404 for a collection owned by a different user', async (t) => {
  const app = await build(t)
  const ownerId = await createUserRow(app, t)
  const collectionId = await createCollectionRow(app, ownerId, 'Someone elses save target')

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub: randomUUID() })

  const res = await app.inject({
    url: `/api/collections/${collectionId}/entries`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: validBody()
  })

  assert.equal(res.statusCode, 404)
})

test('POST /api/collections/:id/entries rejects a blank wordOrPhrase with 400', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Blank word test')

  const res = await app.inject({
    url: `/api/collections/${collectionId}/entries`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { ...validBody(), wordOrPhrase: '   ' }
  })

  assert.equal(res.statusCode, 400)
})

test('POST /api/collections/:id/entries rejects a language code the collection does not target with 400', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Wrong target language test')

  const res = await app.inject({
    url: `/api/collections/${collectionId}/entries`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { ...validBody(), translations: [{ languageCode: 'de', meaningText: 'Hund', phoneticTranscription: null }] }
  })

  assert.equal(res.statusCode, 400)
})

test('POST /api/collections/:id/entries persists one translation+sentence pair per target language', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Multi language save test', ['en', 'de', 'fr'])

  const res = await app.inject({
    url: `/api/collections/${collectionId}/entries`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      wordOrPhrase: 'pies',
      translations: [
        { languageCode: 'en', meaningText: 'dog', phoneticTranscription: '/dɒɡ/' },
        { languageCode: 'de', meaningText: 'Hund', phoneticTranscription: '/hʊnt/' },
        { languageCode: 'fr', meaningText: 'chien', phoneticTranscription: '/ʃjɛ̃/' }
      ],
      sentences: [
        { languageCode: 'en', sentenceText: 'The dog runs.', nativeGlossText: 'Pies biegnie.' },
        { languageCode: 'de', sentenceText: 'Der Hund rennt.', nativeGlossText: 'Pies biegnie.' },
        { languageCode: 'fr', sentenceText: 'Le chien court.', nativeGlossText: 'Pies biegnie.' }
      ]
    }
  })

  assert.equal(res.statusCode, 201)
  const created = JSON.parse(res.payload) as SavedEntry
  assert.deepStrictEqual(
    created.translations.map((translation) => translation.languageCode).sort(),
    ['de', 'en', 'fr']
  )
  assert.deepStrictEqual(
    created.sentences.map((sentence) => sentence.languageCode).sort(),
    ['de', 'en', 'fr']
  )
  // Still the collection's native language, not any of the three targets.
  assert.equal(created.sourceLanguageCode, 'pl')
})

test('POST /api/collections/:id/entries rejects more than five translations with 400', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Over the language ceiling test')

  const res = await app.inject({
    url: `/api/collections/${collectionId}/entries`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      ...validBody(),
      translations: ['en', 'de', 'fr', 'es', 'it', 'ru'].map((languageCode) => ({
        languageCode, meaningText: 'dog', phoneticTranscription: null
      }))
    }
  })

  assert.equal(res.statusCode, 400)
})

// UNIQUE(entry_id, language_code) would otherwise blow up mid-transaction
// and surface as a 500.
test('POST /api/collections/:id/entries rejects two translations in the same language with 400', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Duplicate language save test', ['en', 'de'])

  const res = await app.inject({
    url: `/api/collections/${collectionId}/entries`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      ...validBody(),
      translations: [
        { languageCode: 'en', meaningText: 'dog', phoneticTranscription: null },
        { languageCode: 'en', meaningText: 'hound', phoneticTranscription: null }
      ]
    }
  })

  assert.equal(res.statusCode, 400)
})

// The save route relies on the Neon HTTP driver's non-interactive
// transaction to avoid leaving an orphan `entries` row behind when a
// follow-up insert fails. This exercises that guarantee against the real
// database, since no request-level input can force a mid-transaction error.
test('a failing follow-up insert rolls the entries row back', async (t) => {
  const app = await build(t)
  const userId = await createUserRow(app, t)
  const collectionId = await createCollectionRow(app, userId, 'Atomic save test')
  const entryId = randomUUID()

  await assert.rejects(
    app.sql.transaction([
      app.sql`
        INSERT INTO entries (id, collection_id, word_or_phrase, source_language_code)
        VALUES (${entryId}, ${collectionId}, 'pies', 'pl')
      `,
      app.sql`
        INSERT INTO entry_translations (entry_id, language_code, meaning_text)
        VALUES (${entryId}, 'en', ${null})
      `
    ])
  )

  const rows = await app.sql.query('SELECT id FROM entries WHERE id = $1', [entryId])
  assert.deepStrictEqual(rows, [])
})
