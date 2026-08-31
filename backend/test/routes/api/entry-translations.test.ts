import { test } from 'node:test'
import * as assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { build } from '../../helper.js'
import { jwks, signToken } from '../../helpers/jwks.js'
import {
  createUserRow,
  createCollectionRow,
  createEntryRow,
  createSenseRow,
  createTranslationRow,
  createSentenceRow
} from '../../helpers/fixtures.js'
import { stubSenseTranslator, type FakeTranslator } from '../../helpers/fakeTranslator.js'

type App = Awaited<ReturnType<typeof build>>

interface BackfilledSentence {
  id: string
  sentenceText: string
  nativeGlossText: string
}

interface BackfilledTranslation {
  id: string
  languageCode: string
  meaningText: string
  phoneticTranscription: string | null
  sentences: BackfilledSentence[]
}

interface BackfilledSense {
  id: string
  glossText: string
  translations: BackfilledTranslation[]
}

interface BackfilledEntry {
  id: string
  wordOrPhrase: string
  sourceLanguageCode: string
  createdAt: string
  senses: BackfilledSense[]
}

// A collection that already teaches German, holding a one-meaning entry that
// only has an English translation — the state FR-018 exists to repair.
async function backfillFixture (
  app: App,
  t: Parameters<typeof build>[0],
  name: string
): Promise<{ collectionId: string, entryId: string, token: string }> {
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, name, 'pl', ['en', 'de'])
  const entryId = await createEntryRow(app, collectionId, 'pies')
  const senseId = await createSenseRow(app, entryId, 'zwierzę domowe')
  const translationId = await createTranslationRow(app, entryId, senseId, 'en', 'dog')
  await createSentenceRow(app, entryId, translationId, 'The dog runs.', 'Pies biegnie.')
  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub })
  return { collectionId, entryId, token }
}

// D-2's real subject: an entry that already carries two meanings, each with an
// English word, in a collection that also teaches French.
async function twoMeaningFixture (
  app: App,
  t: Parameters<typeof build>[0],
  name: string
): Promise<{ collectionId: string, entryId: string, token: string }> {
  const sub = randomUUID()
  const userId = await createUserRow(app, t, sub)
  const collectionId = await createCollectionRow(app, userId, name, 'pl', ['en', 'fr'])
  const entryId = await createEntryRow(app, collectionId, 'zamek')

  const castleId = await createSenseRow(app, entryId, 'budowla obronna')
  const castleEn = await createTranslationRow(app, entryId, castleId, 'en', 'castle')
  await createSentenceRow(app, entryId, castleEn, 'The castle stands on a hill.', 'Zamek stoi na wzgórzu.')

  const lockId = await createSenseRow(app, entryId, 'zamknięcie drzwi')
  const lockEn = await createTranslationRow(app, entryId, lockId, 'en', 'lock')
  await createSentenceRow(app, entryId, lockEn, 'The lock is broken.', 'Zamek jest zepsuty.')

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub })
  return { collectionId, entryId, token }
}

function germanDog (app: App): FakeTranslator {
  return stubSenseTranslator(app, {
    'zwierzę domowe': {
      meaningText: 'Hund',
      phoneticTranscription: '/hʊnt/',
      sentences: [{ targetText: 'Der Hund rennt.', nativeGlossText: 'Pies biegnie.' }]
    }
  }, 'de')
}

async function post (app: App, collectionId: string, entryId: string, token: string, languageCode: string) {
  return await app.inject({
    url: `/api/collections/${collectionId}/entries/${entryId}/translations`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: { languageCode }
  })
}

function senseByGloss (entry: BackfilledEntry, glossText: string): BackfilledSense {
  const sense = entry.senses.find((candidate) => candidate.glossText === glossText)
  assert.ok(sense !== undefined, `no sense glossed "${glossText}"`)
  return sense
}

test('POST /:id/entries/:entryId/translations adds exactly one language to one entry', async (t) => {
  const app = await build(t)
  const { collectionId, entryId, token } = await backfillFixture(app, t, 'Backfill test')
  germanDog(app)

  const res = await post(app, collectionId, entryId, token, 'de')

  assert.equal(res.statusCode, 201)
  const updated = JSON.parse(res.payload) as BackfilledEntry
  const sense = senseByGloss(updated, 'zwierzę domowe')
  // Decision A9: the whole entry comes back, so the pre-existing English word
  // is in the response alongside the new German one rather than the client
  // having to remember it.
  assert.deepStrictEqual(sense.translations.map((tr) => tr.languageCode).sort(), ['de', 'en'])
  const german = sense.translations.find((tr) => tr.languageCode === 'de')
  assert.equal(german?.meaningText, 'Hund')
  assert.equal(german?.phoneticTranscription, '/hʊnt/')
  assert.deepStrictEqual(
    german?.sentences.map((s) => [s.sentenceText, s.nativeGlossText]),
    [['Der Hund rennt.', 'Pies biegnie.']]
  )

  const rows = await app.sql.query(
    'SELECT language_code FROM entry_translations WHERE entry_id = $1 ORDER BY language_code',
    [entryId]
  ) as Array<{ language_code: string }>
  assert.deepStrictEqual(rows.map((row) => row.language_code), ['de', 'en'])
})

// Design test 6 / 28 — the reason D-2 exists. Under the old "take the model's
// first one" behaviour this wrote exactly one French row and silently left the
// other meaning untranslated.
test('POST /:id/entries/:entryId/translations translates every meaning the entry holds', async (t) => {
  const app = await build(t)
  const { collectionId, entryId, token } = await twoMeaningFixture(app, t, 'Two meaning backfill test')
  const translator = stubSenseTranslator(app, {
    'budowla obronna': {
      meaningText: 'château',
      phoneticTranscription: '/ʃɑ.to/',
      sentences: [{ targetText: 'Le château est sur une colline.', nativeGlossText: 'Zamek stoi na wzgórzu.' }]
    },
    'zamknięcie drzwi': {
      meaningText: 'serrure',
      phoneticTranscription: '/sɛ.ʁyʁ/',
      sentences: [{ targetText: 'La serrure est cassée.', nativeGlossText: 'Zamek jest zepsuty.' }]
    }
  }, 'fr')

  const res = await post(app, collectionId, entryId, token, 'fr')

  assert.equal(res.statusCode, 201)
  const updated = JSON.parse(res.payload) as BackfilledEntry

  // One call per meaning, each naming its own gloss — a fake returning one
  // canned answer could not tell this apart from the same word written twice.
  assert.deepStrictEqual(
    translator.senseCalls().map((call) => call.glossText).sort(),
    ['budowla obronna', 'zamknięcie drzwi']
  )
  assert.deepStrictEqual(translator.senseCalls().map((call) => call.languageCode), ['fr', 'fr'])

  assert.equal(
    senseByGloss(updated, 'budowla obronna').translations.find((tr) => tr.languageCode === 'fr')?.meaningText,
    'château'
  )
  assert.equal(
    senseByGloss(updated, 'zamknięcie drzwi').translations.find((tr) => tr.languageCode === 'fr')?.meaningText,
    'serrure'
  )

  // Two French rows in the database, and the English ones untouched.
  const rows = await app.sql.query(
    'SELECT language_code, meaning_text FROM entry_translations WHERE entry_id = $1 ORDER BY language_code, meaning_text',
    [entryId]
  ) as Array<{ language_code: string, meaning_text: string }>
  assert.deepStrictEqual(rows, [
    { language_code: 'en', meaning_text: 'castle' },
    { language_code: 'en', meaning_text: 'lock' },
    { language_code: 'fr', meaning_text: 'château' },
    { language_code: 'fr', meaning_text: 'serrure' }
  ])
})

// A meaning the model could not answer for is left as a sparse spoke rather
// than failing the whole request: sparse spokes are legal, and losing the one
// good answer to save the bad one helps nobody.
test('POST /:id/entries/:entryId/translations keeps the meanings that answered when one does not', async (t) => {
  const app = await build(t)
  const { collectionId, entryId, token } = await twoMeaningFixture(app, t, 'Partial backfill test')
  stubSenseTranslator(app, {
    'budowla obronna': {
      meaningText: 'château',
      phoneticTranscription: null,
      sentences: [{ targetText: 'Le château est sur une colline.', nativeGlossText: 'Zamek stoi na wzgórzu.' }]
    }
  }, 'fr')

  const res = await post(app, collectionId, entryId, token, 'fr')

  assert.equal(res.statusCode, 201)
  const rows = await app.sql.query(
    'SELECT meaning_text FROM entry_translations WHERE entry_id = $1 AND language_code = $2',
    [entryId, 'fr']
  ) as Array<{ meaning_text: string }>
  assert.deepStrictEqual(rows, [{ meaning_text: 'château' }])
})

test('POST /:id/entries/:entryId/translations does not touch sibling entries', async (t) => {
  const app = await build(t)
  const { collectionId, entryId, token } = await backfillFixture(app, t, 'Sibling isolation test')
  const otherEntryId = await createEntryRow(app, collectionId, 'kot')
  germanDog(app)

  const res = await post(app, collectionId, entryId, token, 'de')
  assert.equal(res.statusCode, 201)

  const rows = await app.sql.query(
    'SELECT id FROM entry_translations WHERE entry_id = $1',
    [otherEntryId]
  )
  assert.deepStrictEqual(rows, [])
})

// Design test 14.
test('POST /:id/entries/:entryId/translations returns 409 when every meaning already has that language', async (t) => {
  const app = await build(t)
  const { collectionId, entryId, token } = await backfillFixture(app, t, 'Already translated test')
  const translator = germanDog(app)

  const res = await post(app, collectionId, entryId, token, 'en')

  assert.equal(res.statusCode, 409)
  assert.match(JSON.parse(res.payload).message, /already has a translation in that language/)
  // The 409 is decided before any model spend.
  assert.deepStrictEqual(translator.senseCalls(), [])
})

// A partially-covered entry is NOT already present: the meaning without a word
// in that language still has work to do.
test('POST /:id/entries/:entryId/translations fills only the meanings missing that language', async (t) => {
  const app = await build(t)
  const { collectionId, entryId, token } = await twoMeaningFixture(app, t, 'Partially covered test')
  // Give one meaning a French word up front.
  const senseRows = await app.sql.query(
    'SELECT id FROM entry_senses WHERE entry_id = $1 AND gloss_text = $2',
    [entryId, 'budowla obronna']
  ) as Array<{ id: string }>
  const existing = await createTranslationRow(app, entryId, senseRows[0].id, 'fr', 'château')
  await createSentenceRow(app, entryId, existing, 'Le château est sur une colline.', 'Zamek stoi na wzgórzu.')

  const translator = stubSenseTranslator(app, {
    'zamknięcie drzwi': {
      meaningText: 'serrure',
      phoneticTranscription: null,
      sentences: [{ targetText: 'La serrure est cassée.', nativeGlossText: 'Zamek jest zepsuty.' }]
    }
  }, 'fr')

  const res = await post(app, collectionId, entryId, token, 'fr')

  assert.equal(res.statusCode, 201)
  assert.deepStrictEqual(translator.senseCalls().map((call) => call.glossText), ['zamknięcie drzwi'])
  const rows = await app.sql.query(
    'SELECT meaning_text FROM entry_translations WHERE entry_id = $1 AND language_code = $2 ORDER BY meaning_text',
    [entryId, 'fr']
  ) as Array<{ meaning_text: string }>
  assert.deepStrictEqual(rows, [{ meaning_text: 'château' }, { meaning_text: 'serrure' }])
})

test('POST /:id/entries/:entryId/translations returns 400 for a language the collection does not target', async (t) => {
  const app = await build(t)
  const { collectionId, entryId, token } = await backfillFixture(app, t, 'Untargeted language test')
  const translator = germanDog(app)

  const res = await post(app, collectionId, entryId, token, 'fr')

  assert.equal(res.statusCode, 400)
  assert.match(JSON.parse(res.payload).message, /not one of the collection's target languages/)
  assert.deepStrictEqual(translator.senseCalls(), [])
})

test('POST /:id/entries/:entryId/translations returns 404 for an entry in a different collection', async (t) => {
  const app = await build(t)
  const { entryId, token } = await backfillFixture(app, t, 'Cross collection test')
  const sub = randomUUID()
  const otherUserId = await createUserRow(app, t, sub)
  const otherCollectionId = await createCollectionRow(app, otherUserId, 'Other collection', 'pl', ['de'])
  germanDog(app)

  const res = await post(app, otherCollectionId, entryId, token, 'de')

  // The collection belongs to someone else, so it 404s before the entry lookup.
  assert.equal(res.statusCode, 404)
})

test('POST /:id/entries/:entryId/translations returns 502 when no meaning gets an answer', async (t) => {
  const app = await build(t)
  const { collectionId, entryId, token } = await backfillFixture(app, t, 'Empty generation test')
  stubSenseTranslator(app, {}, 'de')

  const res = await post(app, collectionId, entryId, token, 'de')

  assert.equal(res.statusCode, 502)
  // Nothing was written on the failure path.
  const rows = await app.sql.query(
    'SELECT language_code FROM entry_translations WHERE entry_id = $1',
    [entryId]
  ) as Array<{ language_code: string }>
  assert.deepStrictEqual(rows.map((row) => row.language_code), ['en'])
})

// Fastify strips any property the response schema does not declare, so a
// missing declaration drops a field silently rather than erroring. The ids and
// timestamp are generated, so they are asserted by shape and then substituted
// in — everything else is compared exactly.
test('POST /:id/entries/:entryId/translations serializes the full body, stripping nothing', async (t) => {
  const app = await build(t)
  const { collectionId, entryId, token } = await backfillFixture(app, t, 'Backfill serialization')
  germanDog(app)

  const res = await post(app, collectionId, entryId, token, 'de')

  assert.equal(res.statusCode, 201)
  const body = JSON.parse(res.payload) as BackfilledEntry
  const [sense] = body.senses
  const german = sense.translations.find((tr) => tr.languageCode === 'de')
  const english = sense.translations.find((tr) => tr.languageCode === 'en')
  assert.ok(german !== undefined && english !== undefined)

  assert.equal(typeof body.createdAt, 'string')
  assert.deepStrictEqual(body, {
    id: entryId,
    wordOrPhrase: 'pies',
    sourceLanguageCode: 'pl',
    createdAt: body.createdAt,
    senses: [{
      id: sense.id,
      glossText: 'zwierzę domowe',
      // The pre-existing word first, the appended one after it: the aggregate
      // was reconstructed from rows ordered by language code and the new
      // translation is attached to the end.
      translations: [
        {
          id: english.id,
          languageCode: 'en',
          meaningText: 'dog',
          phoneticTranscription: null,
          sentences: [{
            id: english.sentences[0].id,
            sentenceText: 'The dog runs.',
            nativeGlossText: 'Pies biegnie.'
          }]
        },
        {
          id: german.id,
          languageCode: 'de',
          meaningText: 'Hund',
          phoneticTranscription: '/hʊnt/',
          sentences: [{
            id: german.sentences[0].id,
            sentenceText: 'Der Hund rennt.',
            nativeGlossText: 'Pies biegnie.'
          }]
        }
      ]
    }]
  })
})
