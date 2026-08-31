import { test } from 'node:test'
import * as assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { build } from '../../helper.js'
import { jwks, signToken } from '../../helpers/jwks.js'
import { createUserRow, createCollectionRow } from '../../helpers/fixtures.js'

type App = Awaited<ReturnType<typeof build>>

interface SavedSentence {
  id: string
  sentenceText: string
  nativeGlossText: string
}

interface SavedTranslation {
  id: string
  languageCode: string
  meaningText: string
  phoneticTranscription: string | null
  sentences: SavedSentence[]
}

interface SavedSense {
  id: string
  glossText: string
  translations: SavedTranslation[]
}

interface SavedEntry {
  id: string
  wordOrPhrase: string
  sourceLanguageCode: string
  createdAt: string
  senses: SavedSense[]
}

function sentence (sentenceText: string, nativeGlossText = 'Pies biegnie.'): Record<string, unknown> {
  return { sentenceText, nativeGlossText }
}

function validBody (): Record<string, unknown> {
  return {
    wordOrPhrase: 'pies',
    senses: [{
      glossText: 'zwierzę domowe',
      translations: [{
        languageCode: 'en',
        meaningText: 'dog',
        phoneticTranscription: '/dɒɡ/',
        sentences: [sentence('The dog runs.')]
      }]
    }]
  }
}

// `zamek`: the word this whole change exists for. Two meanings, each with an
// English and a German word, each word with its own sentence.
function zamekBody (): Record<string, unknown> {
  return {
    wordOrPhrase: 'zamek',
    senses: [
      {
        glossText: 'budowla obronna',
        translations: [
          {
            languageCode: 'en',
            meaningText: 'castle',
            phoneticTranscription: '/ˈkɑːsəl/',
            sentences: [sentence('The castle stands on a hill.', 'Zamek stoi na wzgórzu.')]
          },
          {
            languageCode: 'de',
            meaningText: 'Schloss',
            phoneticTranscription: '/ʃlɔs/',
            sentences: [sentence('Das Schloss steht auf einem Hügel.', 'Zamek stoi na wzgórzu.')]
          }
        ]
      },
      {
        glossText: 'zamknięcie drzwi',
        translations: [
          {
            languageCode: 'en',
            meaningText: 'lock',
            phoneticTranscription: '/lɒk/',
            sentences: [sentence('The lock is broken.', 'Zamek jest zepsuty.')]
          },
          {
            languageCode: 'de',
            meaningText: 'Schloss',
            phoneticTranscription: '/ʃlɔs/',
            sentences: [sentence('Das Schloss ist kaputt.', 'Zamek jest zepsuty.')]
          }
        ]
      }
    ]
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

async function post (app: App, collectionId: string, token: string, payload: unknown) {
  return await app.inject({
    url: `/api/collections/${collectionId}/entries`,
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    payload: payload as Record<string, unknown>
  })
}

function senseByGloss (entry: SavedEntry, glossText: string): SavedSense {
  const sense = entry.senses.find((candidate) => candidate.glossText === glossText)
  assert.ok(sense !== undefined, `no sense glossed "${glossText}"`)
  return sense
}

function translationIn (sense: SavedSense, languageCode: string): SavedTranslation {
  const translation = sense.translations.find((candidate) => candidate.languageCode === languageCode)
  assert.ok(translation !== undefined, `no ${languageCode} translation under "${sense.glossText}"`)
  return translation
}

// --- legal payloads (design tests 1-5) --------------------------------------

test('POST /api/collections/:id/entries persists the entry, sense, translation and sentence rows', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Save endpoint test')

  const res = await post(app, collectionId, token, validBody())

  assert.equal(res.statusCode, 201)
  const created = JSON.parse(res.payload) as SavedEntry
  assert.equal(created.wordOrPhrase, 'pies')
  // Never taken from the request body — always the collection's native language.
  assert.equal(created.sourceLanguageCode, 'pl')
  assert.equal(created.senses.length, 1)
  const translation = translationIn(created.senses[0], 'en')
  assert.equal(created.senses[0].glossText, 'zwierzę domowe')
  assert.equal(translation.meaningText, 'dog')
  assert.equal(translation.phoneticTranscription, '/dɒɡ/')
  assert.deepStrictEqual(
    translation.sentences.map((s) => [s.sentenceText, s.nativeGlossText]),
    [['The dog runs.', 'Pies biegnie.']]
  )

  // The rows, and specifically the two pairings: the word hangs off the
  // meaning, and the sentence hangs off the word.
  const rows = await app.sql.query(
    `SELECT s.gloss_text, s.sense_key, t.language_code, t.meaning_text, x.sentence_text, x.native_gloss_text
       FROM entry_senses s
       JOIN entry_translations t ON t.sense_id = s.id
       JOIN entry_sentences x ON x.translation_id = t.id
      WHERE s.entry_id = $1`,
    [created.id]
  )
  assert.deepStrictEqual(rows, [{
    gloss_text: 'zwierzę domowe',
    sense_key: 'zwierzę domowe',
    language_code: 'en',
    meaning_text: 'dog',
    sentence_text: 'The dog runs.',
    native_gloss_text: 'Pies biegnie.'
  }])
})

// Design test 1. The measured failure this change exists to remove: `zamek`
// used to survive only as `lock`.
test('POST /api/collections/:id/entries keeps every meaning of a word with several', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Zamek save test', ['en', 'de'])

  const res = await post(app, collectionId, token, zamekBody())

  assert.equal(res.statusCode, 201)
  const created = JSON.parse(res.payload) as SavedEntry
  assert.deepStrictEqual(
    created.senses.map((sense) => sense.glossText).sort(),
    ['budowla obronna', 'zamknięcie drzwi']
  )
  // The same German word under both meanings — legal, and exactly the case
  // UNIQUE(entry_id, language_code) used to forbid.
  assert.equal(translationIn(senseByGloss(created, 'budowla obronna'), 'de').meaningText, 'Schloss')
  assert.equal(translationIn(senseByGloss(created, 'zamknięcie drzwi'), 'de').meaningText, 'Schloss')
  assert.equal(translationIn(senseByGloss(created, 'budowla obronna'), 'en').meaningText, 'castle')
  assert.equal(translationIn(senseByGloss(created, 'zamknięcie drzwi'), 'en').meaningText, 'lock')

  // Four sentences, each under the right (meaning, language).
  assert.deepStrictEqual(
    translationIn(senseByGloss(created, 'zamknięcie drzwi'), 'en').sentences.map((s) => s.sentenceText),
    ['The lock is broken.']
  )
  assert.deepStrictEqual(
    translationIn(senseByGloss(created, 'budowla obronna'), 'de').sentences.map((s) => s.sentenceText),
    ['Das Schloss steht auf einem Hügel.']
  )
})

// Design test 2.
test('POST /api/collections/:id/entries persists every sentence under one translation', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Many sentences test')

  const res = await post(app, collectionId, token, {
    wordOrPhrase: 'pies',
    senses: [{
      glossText: 'zwierzę domowe',
      translations: [{
        languageCode: 'en',
        meaningText: 'dog',
        phoneticTranscription: null,
        sentences: [
          sentence('The dog runs.'),
          sentence('The dog sleeps.', 'Pies śpi.'),
          sentence('The dog barks.', 'Pies szczeka.')
        ]
      }]
    }]
  })

  assert.equal(res.statusCode, 201)
  const created = JSON.parse(res.payload) as SavedEntry
  assert.deepStrictEqual(
    translationIn(created.senses[0], 'en').sentences.map((s) => s.sentenceText),
    ['The dog runs.', 'The dog sleeps.', 'The dog barks.']
  )
})

// Design test 3. A meaning present in English only, in a pl -> en,de
// collection. Not a degenerate answer — `suwak` simply has no single German
// word — so it must be accepted rather than rejected or padded.
test('POST /api/collections/:id/entries accepts a sparse spoke', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Sparse spoke test', ['en', 'de'])

  const res = await post(app, collectionId, token, {
    wordOrPhrase: 'zamek',
    senses: [{
      glossText: 'suwak przy kurtce',
      translations: [{
        languageCode: 'en',
        meaningText: 'zipper',
        phoneticTranscription: null,
        sentences: [sentence('The zipper is stuck.', 'Zamek się zaciął.')]
      }]
    }]
  })

  assert.equal(res.statusCode, 201)
  const created = JSON.parse(res.payload) as SavedEntry
  assert.deepStrictEqual(created.senses[0].translations.map((tr) => tr.languageCode), ['en'])
})

// Design test 4. The round trip is the claim the whole change rests on: what
// comes back out is grouped the way it went in — same meanings, same words
// under each, same sentences under each word, same ids throughout.
//
// Compared **order-insensitively**, and that is not a hedge. Neither the
// aggregate nor the schema defines a sequence for an entry's meanings: the
// write keeps the payload's order, while the read sorts (senses by creation
// then id, translations by language code) because every sense of one entry is
// inserted inside a single transaction and therefore shares one `now()`.
// Grouping is the invariant; sequence is not, and a test that pinned it would
// be asserting an accident of the insert.
function normalize (entry: SavedEntry): SavedEntry {
  return {
    ...entry,
    senses: [...entry.senses]
      .sort((a, b) => a.glossText.localeCompare(b.glossText))
      .map((sense) => ({
        ...sense,
        translations: [...sense.translations]
          .sort((a, b) => a.languageCode.localeCompare(b.languageCode))
      }))
  }
}

test('a saved entry reads back from GET /api/collections/:id with the same grouping', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Round trip test', ['en', 'de'])

  const createRes = await post(app, collectionId, token, zamekBody())
  assert.equal(createRes.statusCode, 201)
  const created = JSON.parse(createRes.payload) as SavedEntry

  const res = await app.inject({ url: `/api/collections/${collectionId}`, headers: { authorization: `Bearer ${token}` } })
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.payload) as { entries: SavedEntry[] }

  assert.deepStrictEqual(body.entries.map((entry) => entry.id), [created.id])
  assert.deepStrictEqual(normalize(body.entries[0]), normalize(created))
})

// Design test 5. The key is `(entry, senseKey)`, so two entries may each carry
// a meaning that normalizes to the same string.
test('POST /api/collections/:id/entries accepts the same senseKey in two different entries', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Cross entry sense key test')

  const first = await post(app, collectionId, token, validBody())
  const second = await post(app, collectionId, token, {
    ...validBody(),
    wordOrPhrase: 'piesek',
    senses: [{
      glossText: '  Zwierzę Domowe  ',
      translations: [{
        languageCode: 'en',
        meaningText: 'doggy',
        phoneticTranscription: null,
        sentences: [sentence('The doggy runs.', 'Piesek biegnie.')]
      }]
    }]
  })

  assert.equal(first.statusCode, 201)
  assert.equal(second.statusCode, 201)
})

test('POST /api/collections/:id/entries accepts a null phoneticTranscription', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Null phonetics test')

  const res = await post(app, collectionId, token, {
    ...validBody(),
    senses: [{
      glossText: 'zwierzę domowe',
      translations: [{
        languageCode: 'en',
        meaningText: 'dog',
        phoneticTranscription: null,
        sentences: [sentence('The dog runs.')]
      }]
    }]
  })

  assert.equal(res.statusCode, 201)
  const created = JSON.parse(res.payload) as SavedEntry
  assert.equal(translationIn(created.senses[0], 'en').phoneticTranscription, null)
})

test('POST /api/collections/:id/entries returns 404 for a collection owned by a different user', async (t) => {
  const app = await build(t)
  const ownerId = await createUserRow(app, t)
  const collectionId = await createCollectionRow(app, ownerId, 'Someone elses save target')

  app.jwtVerifier.cacheJwks(jwks)
  const token = await signToken({ sub: randomUUID() })

  const res = await post(app, collectionId, token, validBody())

  assert.equal(res.statusCode, 404)
})

// --- illegal payloads: one test per named error (design tests 7-13) ----------

// Design test 7.
test('POST /api/collections/:id/entries rejects two senses with the same senseKey with 409', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Duplicate sense test')

  const res = await post(app, collectionId, token, {
    wordOrPhrase: 'pies',
    senses: [
      {
        glossText: 'zwierzę domowe',
        translations: [{
          languageCode: 'en', meaningText: 'dog', phoneticTranscription: null, sentences: [sentence('The dog runs.')]
        }]
      },
      {
        // Same meaning submitted twice — `senseKey` is trim().toLowerCase().
        glossText: '  Zwierzę Domowe ',
        translations: [{
          languageCode: 'en', meaningText: 'hound', phoneticTranscription: null, sentences: [sentence('The hound runs.')]
        }]
      }
    ]
  })

  assert.equal(res.statusCode, 409)
  assert.match(JSON.parse(res.payload).message, /already has that meaning/)
})

// Design test 8. INV-10, relocated one level down: two words for ONE meaning in
// one language is still a conflict, while two meanings sharing a language is
// now legal (covered by the `zamek` test above).
test('POST /api/collections/:id/entries rejects two translations in one language under one sense with 409', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Duplicate sense language test')

  const res = await post(app, collectionId, token, {
    wordOrPhrase: 'pies',
    senses: [{
      glossText: 'zwierzę domowe',
      translations: [
        { languageCode: 'en', meaningText: 'dog', phoneticTranscription: null, sentences: [sentence('The dog runs.')] },
        { languageCode: 'en', meaningText: 'hound', phoneticTranscription: null, sentences: [sentence('The hound runs.')] }
      ]
    }]
  })

  assert.equal(res.statusCode, 409)
  assert.match(JSON.parse(res.payload).message, /one translation per meaning per language/)
})

// Design test 9.
test('POST /api/collections/:id/entries rejects a language the collection does not teach with 400', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Wrong target language test')

  const res = await post(app, collectionId, token, {
    wordOrPhrase: 'pies',
    senses: [{
      glossText: 'zwierzę domowe',
      translations: [{
        languageCode: 'de', meaningText: 'Hund', phoneticTranscription: null, sentences: [sentence('Der Hund rennt.')]
      }]
    }]
  })

  assert.equal(res.statusCode, 400)
  assert.match(JSON.parse(res.payload).message, /not one of the collection's target languages/)
})

// Design test 10.
test('POST /api/collections/:id/entries rejects a sense with no translations with 400', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Sense without translation test')

  const res = await post(app, collectionId, token, {
    wordOrPhrase: 'pies',
    senses: [{ glossText: 'zwierzę domowe', translations: [] }]
  })

  assert.equal(res.statusCode, 400)
  assert.match(JSON.parse(res.payload).message, /at least one translation/)
})

// Design test 11 — INV-12, the rule this change exists to make enforceable.
test('POST /api/collections/:id/entries rejects a translation with no sentences with 400', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Translation without sentence test')

  const res = await post(app, collectionId, token, {
    wordOrPhrase: 'pies',
    senses: [{
      glossText: 'zwierzę domowe',
      translations: [{ languageCode: 'en', meaningText: 'dog', phoneticTranscription: null, sentences: [] }]
    }]
  })

  assert.equal(res.statusCode, 400)
  assert.match(JSON.parse(res.payload).message, /at least one example sentence/)
})

// Design test 12, once per field. Each is blank-but-present, so the schema's
// minLength admits it and the aggregate is what rejects it — naming the field
// the client sent, which is why `sentenceText` and not `targetText` appears in
// the message.
for (const [field, body] of [
  ['wordOrPhrase', { ...validBody(), wordOrPhrase: '   ' }],
  ['glossText', {
    wordOrPhrase: 'pies',
    senses: [{
      glossText: '  ',
      translations: [{ languageCode: 'en', meaningText: 'dog', phoneticTranscription: null, sentences: [sentence('The dog runs.')] }]
    }]
  }],
  ['meaningText', {
    wordOrPhrase: 'pies',
    senses: [{
      glossText: 'zwierzę domowe',
      translations: [{ languageCode: 'en', meaningText: ' ', phoneticTranscription: null, sentences: [sentence('The dog runs.')] }]
    }]
  }],
  ['sentenceText', {
    wordOrPhrase: 'pies',
    senses: [{
      glossText: 'zwierzę domowe',
      translations: [{ languageCode: 'en', meaningText: 'dog', phoneticTranscription: null, sentences: [sentence('   ')] }]
    }]
  }],
  ['nativeGlossText', {
    wordOrPhrase: 'pies',
    senses: [{
      glossText: 'zwierzę domowe',
      translations: [{ languageCode: 'en', meaningText: 'dog', phoneticTranscription: null, sentences: [sentence('The dog runs.', '  ')] }]
    }]
  }]
] as Array<[string, Record<string, unknown>]>) {
  test(`POST /api/collections/:id/entries rejects a blank ${field} with 400 naming it`, async (t) => {
    const app = await build(t)
    const { collectionId, token } = await collectionFor(app, t, `Blank ${field} test`)

    const res = await post(app, collectionId, token, body)

    assert.equal(res.statusCode, 400)
    assert.equal(JSON.parse(res.payload).message, `${field} must not be blank`)
  })
}

// Design test 13.
test('POST /api/collections/:id/entries rejects an entry with no senses with 400', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Empty entry test')

  const res = await post(app, collectionId, token, { wordOrPhrase: 'pies', senses: [] })

  assert.equal(res.statusCode, 400)
  assert.match(JSON.parse(res.payload).message, /at least one meaning/)
})

test('POST /api/collections/:id/entries rejects more than five translations under one sense with 400', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Over the language ceiling test')

  const res = await post(app, collectionId, token, {
    wordOrPhrase: 'pies',
    senses: [{
      glossText: 'zwierzę domowe',
      translations: ['en', 'de', 'fr', 'es', 'it', 'ru'].map((languageCode) => ({
        languageCode, meaningText: 'dog', phoneticTranscription: null, sentences: [sentence('The dog runs.')]
      }))
    }]
  })

  assert.equal(res.statusCode, 400)
})

// --- atomicity (design test 15) ---------------------------------------------

// The guardrail at prd.md:37, exercised from the far end of the payload: the
// blank sentence is the LAST thing in the body, so everything before it looked
// valid on the way past. Nothing may survive.
test('a payload whose last sentence is blank leaves no rows behind', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Partial failure test', ['en', 'de'])

  const body = zamekBody() as { senses: Array<{ translations: Array<{ sentences: Array<{ sentenceText: string }> }> }> }
  const lastSense = body.senses[body.senses.length - 1]
  const lastTranslation = lastSense.translations[lastSense.translations.length - 1]
  lastTranslation.sentences[lastTranslation.sentences.length - 1].sentenceText = '   '

  const res = await post(app, collectionId, token, body)
  assert.equal(res.statusCode, 400)

  const rows = await app.sql.query(
    'SELECT id FROM entries WHERE collection_id = $1',
    [collectionId]
  )
  assert.deepStrictEqual(rows, [])
})

// The Neon HTTP driver's non-interactive transaction is what makes the write
// half of that guarantee hold. No request-level input can force a
// mid-transaction error now that the aggregate rejects bad payloads before a
// statement is built, so this drives the driver directly.
test('a failing follow-up insert rolls the entries row back', async (t) => {
  const app = await build(t)
  const userId = await createUserRow(app, t)
  const collectionId = await createCollectionRow(app, userId, 'Atomic save test')
  const entryId = randomUUID()
  const senseId = randomUUID()

  await assert.rejects(
    app.sql.transaction([
      app.sql`
        INSERT INTO entries (id, collection_id, word_or_phrase, source_language_code)
        VALUES (${entryId}, ${collectionId}, 'pies', 'pl')
      `,
      app.sql`
        INSERT INTO entry_senses (id, entry_id, gloss_text, sense_key)
        VALUES (${senseId}, ${entryId}, 'pies', 'pies')
      `,
      // The deliberate failure is the null meaning_text, not a missing
      // sense_id — the sense above exists so this still fails for the reason
      // the test is about.
      app.sql`
        INSERT INTO entry_translations (entry_id, sense_id, language_code, meaning_text)
        VALUES (${entryId}, ${senseId}, 'en', ${null})
      `
    ])
  )

  const rows = await app.sql.query('SELECT id FROM entries WHERE id = $1', [entryId])
  assert.deepStrictEqual(rows, [])
})

// --- response serialization -------------------------------------------------

// `POST /:id/entries` hand-built its payload with no response schema until this
// change, so nothing was stripped and nothing could be. Now a field missing
// from `entryResponseSchema` vanishes **silently**, and a full-body deep-equal
// is the only shape of test that catches it. Ids and the timestamp are
// generated, so they are asserted by shape and then substituted in.
test('POST /api/collections/:id/entries serializes the full body, stripping nothing', async (t) => {
  const app = await build(t)
  const { collectionId, token } = await collectionFor(app, t, 'Capture serialization')

  const res = await post(app, collectionId, token, validBody())

  assert.equal(res.statusCode, 201)
  const body = JSON.parse(res.payload) as SavedEntry

  assert.equal(typeof body.id, 'string')
  assert.equal(typeof body.createdAt, 'string')
  const [sense] = body.senses
  const [translation] = sense.translations
  const [example] = translation.sentences
  assert.equal(typeof sense.id, 'string')
  assert.equal(typeof translation.id, 'string')
  assert.equal(typeof example.id, 'string')

  assert.deepStrictEqual(body, {
    id: body.id,
    wordOrPhrase: 'pies',
    sourceLanguageCode: 'pl',
    createdAt: body.createdAt,
    senses: [{
      id: sense.id,
      glossText: 'zwierzę domowe',
      translations: [{
        id: translation.id,
        languageCode: 'en',
        meaningText: 'dog',
        phoneticTranscription: '/dɒɡ/',
        sentences: [{
          id: example.id,
          sentenceText: 'The dog runs.',
          nativeGlossText: 'Pies biegnie.'
        }]
      }]
    }]
  })
})
