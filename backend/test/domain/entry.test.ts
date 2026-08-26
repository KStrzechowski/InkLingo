import { test } from 'node:test'
import * as assert from 'node:assert'
import { Entry } from '../../src/domain/entry.js'
import type { BackfillTranslationDraft, EntryDraft, SenseDraft, SenseTranslationDraft } from '../../src/domain/entry.js'
import { LanguageContract } from '../../src/domain/languageContract.js'
import {
  BlankTextError,
  DuplicateSenseError,
  DuplicateSenseLanguageError,
  EmptyEntryError,
  LanguageAlreadyPresentError,
  LanguageNotTaughtError,
  SenseWithoutTranslationError,
  TranslationWithoutSentenceError
} from '../../src/domain/errors.js'

// This file is the specification of the invariant, written before the
// implementation. It is the answer to "what is a valid entry?" — and, because
// decision A1 makes reads go through the same construction path as writes, it
// is equally the specification of what may legally come *back* out of the
// database.
//
// No database, no Fastify, no Anthropic: every case below is reachable with a
// plain object, which is what makes Phase 1 genuinely test-first.
//
// Covers the design's test cases 1-3, 5 and 7-13
// (`context/domain/02-invariant-aggregate-refactor.md` § 5.6).

const contract = LanguageContract.of('col-1', 'pl', ['en', 'de'])

function sentence (targetText: string, nativeGlossText = 'Zdanie po polsku.'): { targetText: string, nativeGlossText: string } {
  return { targetText, nativeGlossText }
}

function translation (languageCode: string, meaningText: string, overrides: Partial<SenseTranslationDraft> = {}): SenseTranslationDraft {
  return {
    languageCode,
    meaningText,
    phoneticTranscription: `/${meaningText}/`,
    sentences: [sentence(`A sentence with ${meaningText}.`)],
    ...overrides
  }
}

function sense (glossText: string, translations: SenseTranslationDraft[]): SenseDraft {
  return { glossText, translations }
}

function draft (senses: SenseDraft[], overrides: Partial<EntryDraft> = {}): EntryDraft {
  return { wordOrPhrase: 'zamek', senses, ...overrides }
}

// The canonical case this whole change exists for: `zamek` is a castle, a lock
// and a zipper, and today's schema keeps exactly one of them.
const twoMeanings = draft([
  sense('budowla obronna', [translation('en', 'castle'), translation('de', 'Burg')]),
  sense('urządzenie do zamykania', [translation('en', 'lock'), translation('de', 'Schloss')])
])

// --- legal shapes (design tests 1-3, 5) --------------------------------------

test('two meanings, each with two languages, each with its own sentence, all survive', () => {
  const entry = Entry.capture(contract, twoMeanings)

  assert.equal(entry.senses.length, 2)
  assert.deepStrictEqual(entry.senses.map((s) => s.glossText), ['budowla obronna', 'urządzenie do zamykania'])
  assert.deepStrictEqual(
    entry.senses.map((s) => s.translations.map((t) => t.meaningText)),
    [['castle', 'Burg'], ['lock', 'Schloss']]
  )
  // The pairing is the point: every sentence sits under exactly one
  // (meaning, language), and there are four of them.
  assert.deepStrictEqual(
    entry.senses.flatMap((s) => s.translations.flatMap((t) => t.sentences.map((x) => x.targetText))),
    ['A sentence with castle.', 'A sentence with Burg.', 'A sentence with lock.', 'A sentence with Schloss.']
  )
})

test('the entry is stamped from the contract, never from the draft', () => {
  const entry = Entry.capture(contract, twoMeanings)

  assert.equal(entry.collectionId, 'col-1')
  assert.equal(entry.sourceLanguageCode, 'pl')   // INV-7
})

test('a translation carrying three sentences keeps all three', () => {
  const entry = Entry.capture(contract, draft([
    sense('budowla obronna', [translation('en', 'castle', {
      sentences: [sentence('One.'), sentence('Two.'), sentence('Three.')]
    })])
  ]))

  assert.deepStrictEqual(
    entry.senses[0].translations[0].sentences.map((x) => x.targetText),
    ['One.', 'Two.', 'Three.']
  )
})

test('a sparse spoke — a meaning present in one language only — is accepted', () => {
  const entry = Entry.capture(contract, draft([
    sense('budowla obronna', [translation('en', 'castle'), translation('de', 'Burg')]),
    sense('suwak', [translation('en', 'zipper')])
  ]))

  assert.deepStrictEqual(
    entry.senses.map((s) => s.translations.map((t) => t.languageCode)),
    [['en', 'de'], ['en']]
  )
})

test('glosses differing only in case or whitespace collide within an entry but not across entries', () => {
  const first = Entry.capture(contract, draft([sense('  Budowla Obronna ', [translation('en', 'castle')])]))
  const second = Entry.capture(contract, draft([sense('budowla obronna', [translation('en', 'castle')])]))

  // The key is (entry, senseKey), so two entries may each hold the meaning...
  assert.equal(first.senses[0].senseKey, 'budowla obronna')
  assert.equal(second.senses[0].senseKey, 'budowla obronna')
  assert.notEqual(first.id, second.id)
  // ...while the gloss itself keeps the user's own capitalization, trimmed.
  assert.equal(first.senses[0].glossText, 'Budowla Obronna')

  // ...but one entry may not. (Design test 7, stated here alongside its
  // legal twin because the pair is the rule.)
  assert.throws(
    () => Entry.capture(contract, draft([
      sense('Budowla Obronna', [translation('en', 'castle')]),
      sense('budowla obronna ', [translation('de', 'Burg')])
    ])),
    DuplicateSenseError
  )
})

test('language codes and text are normalized, and a blank phonetic becomes null', () => {
  const entry = Entry.capture(contract, draft([
    sense('budowla obronna', [translation('  EN  ', '  castle  ', { phoneticTranscription: '   ' })])
  ], { wordOrPhrase: '  zamek  ' }))

  assert.equal(entry.wordOrPhrase, 'zamek')
  assert.equal(entry.senses[0].translations[0].languageCode, 'en')
  assert.equal(entry.senses[0].translations[0].meaningText, 'castle')
  assert.equal(entry.senses[0].translations[0].phoneticTranscription, null)
})

test('ids are generated when absent and honoured when supplied', () => {
  const generated = Entry.capture(contract, twoMeanings)
  assert.match(generated.id, /^[0-9a-f-]{36}$/)
  assert.equal(new Set(generated.senses.map((s) => s.id)).size, 2)

  // Decision A1: reads go through this same path, so persisted ids must
  // survive reconstruction rather than being replaced by fresh ones.
  const rehydrated = Entry.capture(contract, draft([{
    id: 'sense-1',
    glossText: 'budowla obronna',
    translations: [{
      id: 'translation-1',
      languageCode: 'en',
      meaningText: 'castle',
      phoneticTranscription: null,
      sentences: [{ id: 'sentence-1', targetText: 'A castle.', nativeGlossText: 'Zamek.' }]
    }]
  }], { id: 'entry-1', createdAt: new Date('2026-01-01T00:00:00.000Z') }))

  assert.equal(rehydrated.id, 'entry-1')
  assert.equal(rehydrated.senses[0].id, 'sense-1')
  assert.equal(rehydrated.senses[0].translations[0].id, 'translation-1')
  assert.equal(rehydrated.senses[0].translations[0].sentences[0].id, 'sentence-1')
  assert.equal(rehydrated.createdAt.toISOString(), '2026-01-01T00:00:00.000Z')
})

// --- the wire projection -----------------------------------------------------

test('toResponse emits the nesting, and renames targetText to the wire sentenceText', () => {
  const entry = Entry.capture(contract, draft([{
    id: 'sense-1',
    glossText: 'budowla obronna',
    translations: [{
      id: 'translation-1',
      languageCode: 'en',
      meaningText: 'castle',
      phoneticTranscription: '/ˈkɑːsl/',
      sentences: [{ id: 'sentence-1', targetText: 'A castle.', nativeGlossText: 'Zamek.' }]
    }]
  }], { id: 'entry-1', createdAt: new Date('2026-01-01T00:00:00.000Z') }))

  assert.deepStrictEqual(entry.toResponse(), {
    id: 'entry-1',
    wordOrPhrase: 'zamek',
    sourceLanguageCode: 'pl',
    createdAt: '2026-01-01T00:00:00.000Z',
    senses: [{
      id: 'sense-1',
      glossText: 'budowla obronna',
      translations: [{
        id: 'translation-1',
        languageCode: 'en',
        meaningText: 'castle',
        phoneticTranscription: '/ˈkɑːsl/',
        sentences: [{ id: 'sentence-1', sentenceText: 'A castle.', nativeGlossText: 'Zamek.' }]
      }]
    }]
  })
})

// --- illegal shapes: one test per named error (design tests 7-13) ------------

test('a blank wordOrPhrase raises BlankTextError', () => {
  for (const bad of ['', '   ', '\n\t']) {
    assert.throws(
      () => Entry.capture(contract, draft([sense('budowla obronna', [translation('en', 'castle')])], { wordOrPhrase: bad })),
      (error: unknown) => error instanceof BlankTextError && error.field === 'wordOrPhrase',
      `expected ${JSON.stringify(bad)} to be rejected`
    )
  }
})

test('an entry with zero senses raises EmptyEntryError', () => {
  assert.throws(() => Entry.capture(contract, draft([])), EmptyEntryError)
})

test('a blank glossText raises BlankTextError', () => {
  assert.throws(
    () => Entry.capture(contract, draft([sense('   ', [translation('en', 'castle')])])),
    (error: unknown) => error instanceof BlankTextError && error.field === 'glossText'
  )
})

test('a sense with no translations raises SenseWithoutTranslationError', () => {
  assert.throws(
    () => Entry.capture(contract, draft([sense('budowla obronna', [])])),
    (error: unknown) => error instanceof SenseWithoutTranslationError && error.senseKey === 'budowla obronna'
  )
})

test('a language the collection does not teach raises LanguageNotTaughtError', () => {
  assert.throws(
    () => Entry.capture(contract, draft([sense('budowla obronna', [translation('fr', 'château')])])),
    (error: unknown) => error instanceof LanguageNotTaughtError && error.languageCode === 'fr'
  )
})

test('two translations in the same language under one sense raise DuplicateSenseLanguageError', () => {
  assert.throws(
    () => Entry.capture(contract, draft([
      sense('budowla obronna', [translation('en', 'castle'), translation('EN', 'fortress')])
    ])),
    (error: unknown) => error instanceof DuplicateSenseLanguageError &&
      error.senseKey === 'budowla obronna' && error.languageCode === 'en'
  )
})

test('the same language under two different senses is legal — that is the whole point', () => {
  const entry = Entry.capture(contract, draft([
    sense('budowla obronna', [translation('en', 'castle')]),
    sense('urządzenie do zamykania', [translation('en', 'lock')])
  ]))

  assert.deepStrictEqual(entry.senses.map((s) => s.translations[0].meaningText), ['castle', 'lock'])
})

test('a blank meaningText raises BlankTextError', () => {
  assert.throws(
    () => Entry.capture(contract, draft([sense('budowla obronna', [translation('en', '   ')])])),
    (error: unknown) => error instanceof BlankTextError && error.field === 'meaningText'
  )
})

test('a translation with no sentences raises TranslationWithoutSentenceError', () => {
  assert.throws(
    () => Entry.capture(contract, draft([
      sense('budowla obronna', [translation('en', 'castle', { sentences: [] })])
    ])),
    (error: unknown) => error instanceof TranslationWithoutSentenceError &&
      error.senseKey === 'budowla obronna' && error.languageCode === 'en'
  )
})

test('either blank half of a sentence raises BlankTextError, naming its own field', () => {
  assert.throws(
    () => Entry.capture(contract, draft([
      sense('budowla obronna', [translation('en', 'castle', { sentences: [sentence('  ')] })])
    ])),
    (error: unknown) => error instanceof BlankTextError && error.field === 'sentenceText'
  )
  assert.throws(
    () => Entry.capture(contract, draft([
      sense('budowla obronna', [translation('en', 'castle', { sentences: [sentence('A castle.', ' ')] })])
    ])),
    (error: unknown) => error instanceof BlankTextError && error.field === 'nativeGlossText'
  )
})

// The order matters because it decides what a payload breaking several rules
// reports, and a route's 400 message is only as useful as that choice.
test('a payload breaking several rules reports the outermost one first', () => {
  assert.throws(
    () => Entry.capture(contract, draft([sense('   ', [])], { wordOrPhrase: ' ' })),
    (error: unknown) => error instanceof BlankTextError && error.field === 'wordOrPhrase'
  )
  assert.throws(
    () => Entry.capture(contract, draft([sense('   ', [])])),
    (error: unknown) => error instanceof BlankTextError && error.field === 'glossText'
  )
  // Membership before duplication before blankness before emptiness, per the
  // design's § 4.3 pseudocode.
  assert.throws(
    () => Entry.capture(contract, draft([
      sense('budowla obronna', [translation('fr', '  ', { sentences: [] })])
    ])),
    LanguageNotTaughtError
  )
})

// --- nothing partial survives a rejection ------------------------------------

test('a blank last sentence leaves no half-built aggregate behind', () => {
  // The in-memory half of design test 15: the throw happens before any Entry
  // exists, so there is nothing for a caller to persist by mistake.
  let captured: Entry | undefined
  assert.throws(() => {
    captured = Entry.capture(contract, draft([
      sense('budowla obronna', [translation('en', 'castle')]),
      sense('urządzenie do zamykania', [
        translation('en', 'lock'),
        translation('de', 'Schloss', { sentences: [sentence('Das Schloss.'), sentence('  ')] })
      ])
    ]))
  }, BlankTextError)
  assert.equal(captured, undefined)
})

// --- backfill (design tests 6 and 14) ----------------------------------------

const backfillContract = LanguageContract.of('col-1', 'pl', ['en', 'de', 'fr'])

function backfill (meaningText: string): BackfillTranslationDraft {
  return {
    meaningText,
    phoneticTranscription: `/${meaningText}/`,
    sentences: [sentence(`Une phrase avec ${meaningText}.`)]
  }
}

test('adding a language translates every meaning the entry already holds', () => {
  const entry = Entry.capture(backfillContract, twoMeanings)
  const missing = entry.sensesMissing('fr')
  assert.equal(missing.length, 2)

  entry.addLanguageToAllSenses(backfillContract, 'FR', new Map([
    [missing[0].id, backfill('château')],
    [missing[1].id, backfill('serrure')]
  ]))

  assert.deepStrictEqual(
    entry.senses.map((s) => s.translations.map((t) => t.languageCode)),
    [['en', 'de', 'fr'], ['en', 'de', 'fr']]
  )
  assert.deepStrictEqual(
    entry.senses.map((s) => s.translationFor('fr')?.meaningText),
    ['château', 'serrure']
  )
  assert.equal(entry.sensesMissing('fr').length, 0)
})

test('a meaning the backfill supplies nothing for stays a sparse spoke', () => {
  const entry = Entry.capture(backfillContract, twoMeanings)
  const [first] = entry.sensesMissing('fr')

  entry.addLanguageToAllSenses(backfillContract, 'fr', new Map([[first.id, backfill('château')]]))

  assert.deepStrictEqual(entry.sensesMissing('fr').map((s) => s.senseKey), ['urządzenie do zamykania'])
})

test('a backfill draft keyed by an unknown sense id is ignored, not attached anywhere', () => {
  const entry = Entry.capture(backfillContract, twoMeanings)
  const [first] = entry.sensesMissing('fr')

  entry.addLanguageToAllSenses(backfillContract, 'fr', new Map([
    [first.id, backfill('château')],
    ['not-a-sense-of-this-entry', backfill('fermeture éclair')]
  ]))

  assert.deepStrictEqual(
    entry.senses.map((s) => s.translationFor('fr')?.meaningText),
    ['château', undefined]
  )
})

test('an omitted phoneticTranscription becomes null', () => {
  const entry = Entry.capture(contract, draft([
    sense('budowla obronna', [{
      languageCode: 'en',
      meaningText: 'castle',
      sentences: [sentence('A castle.')]
    }])
  ]))

  assert.equal(entry.senses[0].translations[0].phoneticTranscription, null)
})

test('backfilling a language every sense already covers raises LanguageAlreadyPresentError', () => {
  const entry = Entry.capture(backfillContract, twoMeanings)

  assert.throws(
    () => entry.addLanguageToAllSenses(backfillContract, 'en', new Map()),
    (error: unknown) => error instanceof LanguageAlreadyPresentError && error.languageCode === 'en'
  )
})

test('backfilling a language the collection does not teach raises LanguageNotTaughtError', () => {
  const entry = Entry.capture(backfillContract, twoMeanings)

  assert.throws(
    () => entry.addLanguageToAllSenses(backfillContract, 'es', new Map()),
    (error: unknown) => error instanceof LanguageNotTaughtError && error.languageCode === 'es'
  )
})

test('a backfill draft that breaks a precondition leaves the entry untouched', () => {
  const entry = Entry.capture(backfillContract, twoMeanings)
  const missing = entry.sensesMissing('fr')

  assert.throws(
    () => entry.addLanguageToAllSenses(backfillContract, 'fr', new Map([
      [missing[0].id, backfill('château')],
      [missing[1].id, { ...backfill('serrure'), sentences: [] }]
    ])),
    TranslationWithoutSentenceError
  )
  // Not one of the two got attached — the second draft's failure must not
  // leave the first meaning translated and the other not.
  assert.equal(entry.sensesMissing('fr').length, 2)
})

// --- the language contract ---------------------------------------------------

test('the contract lowercases target codes and compares case-insensitively', () => {
  const legacy = LanguageContract.of('col-1', 'PL', ['EN', ' De '])

  assert.deepStrictEqual(legacy.targetLanguageCodes, ['en', 'de'])
  assert.equal(legacy.teaches('en'), true)
  assert.equal(legacy.teaches(' DE '), true)
  assert.equal(legacy.teaches('fr'), false)
  // The native code is kept verbatim: it is stamped onto the entry and
  // interpolated into the model's prompt.
  assert.equal(legacy.nativeLanguageCode, 'PL')
})
