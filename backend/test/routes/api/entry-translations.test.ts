import { test } from 'node:test'
import * as assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { build } from '../../helper.js'
import { jwks, signToken } from '../../helpers/jwks.js'
import { createUserRow, createCollectionRow, createEntryRow } from '../../helpers/fixtures.js'
import { stubTranslator } from '../../helpers/fakeTranslator.js'

type App = Awaited<ReturnType<typeof build>>

interface AddedTranslation {
  entryId: string
  translation: { id: string, languageCode: string, meaningText: string, phoneticTranscription: string | null }
  sentence: { id: string, languageCode: string, sentenceText: string, nativeGlossText: string, createdAt: string }
}

// The private SDK envelope this file used to build is gone: it now assigns a
// fake implementing the port, which cannot drift from the real contract
// without a compile error.
function stubDraft (app: App, payload: unknown): void {
  stubTranslator(app, payload, 'pl', ['de'])
}

function germanResult (): unknown {
  return {
    normalizedNativeText: 'pies',
    languages: [{
      languageCode: 'de',
      variants: [{
        meaningText: 'Hund',
        phoneticTranscription: '/hʊnt/',
        sentences: [{ targetText: 'Der Hund rennt.', nativeGlossText: 'Pies biegnie.' }]
      }]
    }]
  }
}

// A collection that already teaches German, holding an entry that only has an
// English translation — the state FR-018 exists to repair.
async function backfillFixture (
  app: App,
  t: Parameters<typeof build>[0],
  name: string
): Promise<{ collectionId: string, entryId: string, token: string }> {
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, name, 'pl', ['en', 'de'])
  const entryId = await createEntryRow(app, collectionId, 'pies')
  await app.sql.query(
    'INSERT INTO entry_translations (entry_id, language_code, meaning_text) VALUES ($1, $2, $3)',
    [entryId, 'en', 'dog']
  )
  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub })
  return { collectionId, entryId, token }
}

test('POST /:id/entries/:entryId/translations adds exactly one language to one entry', async (t) => {
  const app = await build(t)
  const { collectionId, entryId, token } = await backfillFixture(app, t, 'Backfill test')
  stubDraft(app, germanResult())

  const res = await app.inject({
    url: `/api/collections/${collectionId}/entries/${entryId}/translations`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { languageCode: 'de' }
  })

  assert.equal(res.statusCode, 201)
  const created = JSON.parse(res.payload) as AddedTranslation
  assert.equal(created.translation.languageCode, 'de')
  assert.equal(created.translation.meaningText, 'Hund')
  assert.equal(created.translation.phoneticTranscription, '/hʊnt/')
  assert.equal(created.sentence.sentenceText, 'Der Hund rennt.')
  assert.equal(created.sentence.nativeGlossText, 'Pies biegnie.')

  // The pre-existing English translation is untouched, and German is now there.
  const rows = await app.sql.query(
    'SELECT language_code FROM entry_translations WHERE entry_id = $1',
    [entryId]
  ) as Array<{ language_code: string }>
  assert.deepStrictEqual(rows.map((row) => row.language_code).sort(), ['de', 'en'])
})

test('POST /:id/entries/:entryId/translations does not touch sibling entries', async (t) => {
  const app = await build(t)
  const { collectionId, entryId, token } = await backfillFixture(app, t, 'Sibling isolation test')
  const otherEntryId = await createEntryRow(app, collectionId, 'kot')
  stubDraft(app, germanResult())

  const res = await app.inject({
    url: `/api/collections/${collectionId}/entries/${entryId}/translations`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { languageCode: 'de' }
  })
  assert.equal(res.statusCode, 201)

  const rows = await app.sql.query(
    'SELECT id FROM entry_translations WHERE entry_id = $1',
    [otherEntryId]
  )
  assert.deepStrictEqual(rows, [])
})

test('POST /:id/entries/:entryId/translations returns 409 when the entry already has that language', async (t) => {
  const app = await build(t)
  const { collectionId, entryId, token } = await backfillFixture(app, t, 'Already translated test')
  stubDraft(app, germanResult())

  const res = await app.inject({
    url: `/api/collections/${collectionId}/entries/${entryId}/translations`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { languageCode: 'en' }
  })

  assert.equal(res.statusCode, 409)
})

test('POST /:id/entries/:entryId/translations returns 400 for a language the collection does not target', async (t) => {
  const app = await build(t)
  const { collectionId, entryId, token } = await backfillFixture(app, t, 'Untargeted language test')
  stubDraft(app, germanResult())

  const res = await app.inject({
    url: `/api/collections/${collectionId}/entries/${entryId}/translations`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { languageCode: 'fr' }
  })

  assert.equal(res.statusCode, 400)
})

test('POST /:id/entries/:entryId/translations returns 404 for an entry in a different collection', async (t) => {
  const app = await build(t)
  const { entryId, token } = await backfillFixture(app, t, 'Cross collection test')
  const sub = randomUUID()
  const otherUserId = await createUserRow(app, t, sub)
  const otherCollectionId = await createCollectionRow(app, otherUserId, 'Other collection', 'pl', ['de'])
  stubDraft(app, germanResult())

  const res = await app.inject({
    url: `/api/collections/${otherCollectionId}/entries/${entryId}/translations`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { languageCode: 'de' }
  })

  // The collection belongs to someone else, so it 404s before the entry lookup.
  assert.equal(res.statusCode, 404)
})

test('POST /:id/entries/:entryId/translations returns 502 when the model returns no variants', async (t) => {
  const app = await build(t)
  const { collectionId, entryId, token } = await backfillFixture(app, t, 'Empty generation test')
  stubDraft(app, { normalizedNativeText: 'pies', languages: [{ languageCode: 'de', variants: [] }] })

  const res = await app.inject({
    url: `/api/collections/${collectionId}/entries/${entryId}/translations`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { languageCode: 'de' }
  })

  assert.equal(res.statusCode, 502)
  // Nothing was written on the failure path.
  const rows = await app.sql.query(
    'SELECT language_code FROM entry_translations WHERE entry_id = $1',
    [entryId]
  ) as Array<{ language_code: string }>
  assert.deepStrictEqual(rows.map((row) => row.language_code), ['en'])
})
