import { test } from 'node:test'
import * as assert from 'node:assert'
import { TranslationDraft, RequestedLanguages, senseTranslationFromProviderPayload } from '../../src/domain/translationDraft.js'
import { DegenerateDraftError, MalformedDraftError } from '../../src/domain/translator.js'

// This file is the specification of what the model may legally do to us.
// Every payload below is either observed or permitted by the tool schema:
// `minItems` is advisory on a tool schema rather than enforced, and nothing
// below `glossText` is type-checked by the provider at all. Before this value
// object existed, `ai/translate.ts:148` cast every one of these shapes to a
// provider type unchecked and handed it straight to the extension's React
// state.
//
// The shape inverted in this change: the model is now asked for meanings
// containing per-language translations, not languages containing meanings.
// Two payload-level consequences get their own tests below — a language absent
// from ONE meaning is a legal sparse spoke, while a language absent from EVERY
// meaning is the gap `degenerateLanguageCodes()` reports.

const requested = RequestedLanguages.of('pl', ['en', 'de'])

function translation (languageCode: string, meaningText: string): unknown {
  return {
    languageCode,
    meaningText,
    phoneticTranscription: `/${meaningText}/`,
    sentences: [{ targetText: `A sentence with ${meaningText}.`, nativeGlossText: 'Zdanie po polsku.' }]
  }
}

function payload (senses: unknown): unknown {
  return { normalizedNativeText: 'zamek', senses }
}

// --- totality: the only two ways out are a valid draft or MalformedDraftError ---

test('a non-object payload raises MalformedDraftError', () => {
  for (const bad of [null, undefined, 'zamek', 42, ['zamek'], true]) {
    assert.throws(
      () => TranslationDraft.fromProviderPayload(bad, requested),
      MalformedDraftError,
      `expected ${String(bad)} to be rejected`
    )
  }
})

test('a missing, non-string or blank normalizedNativeText raises MalformedDraftError', () => {
  for (const bad of [undefined, null, 42, '', '   ']) {
    assert.throws(
      () => TranslationDraft.fromProviderPayload({ normalizedNativeText: bad, senses: [] }, requested),
      MalformedDraftError,
      `expected ${String(bad)} to be rejected`
    )
  }
})

// --- the grouping the inversion buys ---

test('meanings are the top level, each carrying its own per-language words', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    { glossText: 'budowla obronna', translations: [translation('en', 'castle'), translation('de', 'Burg')] },
    { glossText: 'urządzenie do zamykania', translations: [translation('en', 'lock'), translation('de', 'Schloss')] }
  ]), requested)

  assert.deepStrictEqual(draft.senses.map((sense) => sense.glossText), ['budowla obronna', 'urządzenie do zamykania'])
  assert.deepStrictEqual(
    draft.senses.map((sense) => sense.translations.map((t) => t.meaningText)),
    [['castle', 'Burg'], ['lock', 'Schloss']]
  )
})

test('a missing or non-array senses value yields no senses at all', () => {
  for (const bad of [undefined, 'senses', 42, { en: 'castle' }]) {
    const draft = TranslationDraft.fromProviderPayload(
      { normalizedNativeText: 'zamek', senses: bad }, requested
    )

    assert.deepStrictEqual(draft.senses, [], `expected ${String(bad)} to yield no senses`)
    assert.equal(draft.isDegenerate(), true)
  }
})

// --- alignment, one level down (design test 22) ---

test('a reordered translation list is re-keyed against what was requested', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    { glossText: 'budowla obronna', translations: [translation('de', 'Burg'), translation('en', 'castle')] }
  ]), requested)

  const [sense] = draft.toWire().senses
  assert.deepStrictEqual(sense.translations.map((t) => t.languageCode), ['en', 'de'])
  assert.equal(sense.translations[0].meaningText, 'castle')
  assert.equal(sense.translations[1].meaningText, 'Burg')
})

test('a language code the model was not asked for is dropped', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    { glossText: 'budowla obronna', translations: [translation('en', 'castle'), translation('fr', 'château')] }
  ]), requested)

  assert.deepStrictEqual(
    draft.toWire().senses[0].translations.map((t) => t.languageCode),
    ['en']
  )
})

// Design test 22, and the semantic change alignment carries: the old
// language-first version materialized a skipped language as an empty block,
// because a language was the top level and had to exist. A language missing
// from one meaning is now a sparse spoke — `suwak` has no single German word —
// so it is left absent rather than fabricated empty.
test('a language missing from one meaning is left absent, not fabricated', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    { glossText: 'budowla obronna', translations: [translation('en', 'castle'), translation('de', 'Burg')] },
    { glossText: 'suwak', translations: [translation('en', 'zipper')] }
  ]), requested)

  assert.deepStrictEqual(
    draft.toWire().senses.map((sense) => sense.translations.map((t) => t.languageCode)),
    [['en', 'de'], ['en']]
  )
  // A sparse spoke is not a degraded answer, so it is not reported as one.
  assert.deepStrictEqual(draft.degenerateLanguageCodes(), [])
})

// Matching is lenient; emitting is not. The draft always carries the code that
// was *requested*, never the provider's spelling of it, because that code is
// what the client renders against and what the backfill route inserts.
test('language codes are matched leniently but always emitted as requested', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    { glossText: 'budowla obronna', translations: [translation(' EN ', 'castle'), translation('De', 'Burg')] }
  ]), requested)

  assert.deepStrictEqual(draft.degenerateLanguageCodes(), [])
  assert.deepStrictEqual(
    draft.toWire().senses[0].translations.map((t) => t.languageCode),
    ['en', 'de']
  )
})

test('a languageCode that is not a string is skipped instead of throwing', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    { glossText: 'budowla obronna', translations: [translation(42 as unknown as string, 'castle'), 'not a translation'] }
  ]), requested)

  assert.deepStrictEqual(draft.senses, [])
  assert.deepStrictEqual(draft.degenerateLanguageCodes(), ['en', 'de'])
})

test('a non-array translations value yields no sense rather than throwing', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    { glossText: 'budowla obronna', translations: 'castle' },
    { glossText: 'suwak' }
  ]), requested)

  assert.deepStrictEqual(draft.senses, [])
})

// --- sense-level hygiene ---

test('a sense whose glossText is not a non-blank string is dropped', () => {
  for (const bad of [42, null, undefined, '', '   ', { text: 'budowla' }]) {
    const draft = TranslationDraft.fromProviderPayload(payload([
      { glossText: bad, translations: [translation('en', 'castle')] }
    ]), requested)

    assert.deepStrictEqual(draft.senses, [], `expected ${String(bad)} to be dropped`)
  }
})

test('a sense whose translations all fail hygiene is dropped entirely', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    { glossText: 'budowla obronna', translations: [] },
    { glossText: 'suwak', translations: [translation('en', 'zipper')] }
  ]), requested)

  assert.deepStrictEqual(draft.senses.map((sense) => sense.glossText), ['suwak'])
})

// --- translation-level hygiene ---

test('a translation whose meaningText is not a non-blank string is dropped', () => {
  for (const bad of [42, null, undefined, '', '   ', { text: 'castle' }]) {
    const draft = TranslationDraft.fromProviderPayload(payload([
      {
        glossText: 'budowla obronna',
        translations: [{ ...(translation('en', 'castle') as object), meaningText: bad }, translation('de', 'Burg')]
      }
    ]), requested)

    assert.deepStrictEqual(
      draft.toWire().senses[0].translations.map((t) => t.languageCode),
      ['de'],
      `expected ${String(bad)} to be dropped`
    )
  }
})

test('a translation with an empty sentences array is dropped — a word with no example teaches nothing', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    {
      glossText: 'budowla obronna',
      translations: [
        { languageCode: 'en', meaningText: 'castle', phoneticTranscription: '/castle/', sentences: [] },
        translation('de', 'Burg')
      ]
    }
  ]), requested)

  assert.deepStrictEqual(
    draft.toWire().senses[0].translations.map((t) => t.languageCode),
    ['de']
  )
})

test('a translation keeps only the sentences carrying both halves of the pair', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    {
      glossText: 'budowla obronna',
      translations: [{
        languageCode: 'en',
        meaningText: 'castle',
        phoneticTranscription: '/castle/',
        sentences: [
          { targetText: 'The castle stands.', nativeGlossText: 'Zamek stoi.' },
          { targetText: 'A castle falls.', nativeGlossText: '' },
          { targetText: 42, nativeGlossText: 'Zamek upada.' },
          'not a sentence at all'
        ]
      }]
    }
  ]), requested)

  assert.deepStrictEqual(draft.toWire().senses[0].translations[0].sentences, [
    { targetText: 'The castle stands.', nativeGlossText: 'Zamek stoi.' }
  ])
})

test('a blank or non-string phoneticTranscription normalizes to null', () => {
  for (const bad of ['', '   ', 42, undefined, { ipa: '/castle/' }]) {
    const draft = TranslationDraft.fromProviderPayload(payload([
      {
        glossText: 'budowla obronna',
        translations: [{ ...(translation('en', 'castle') as object), phoneticTranscription: bad }]
      }
    ]), requested)

    assert.equal(
      draft.toWire().senses[0].translations[0].phoneticTranscription,
      null,
      `expected ${String(bad)} to normalize to null`
    )
  }
})

// --- usability ---

// The question `isDegenerate` asks changed with the level. It used to be
// "did every requested language come back empty?"; now that meanings are the
// top level, a draft with no meanings is exactly a draft with nothing under
// any language, and it is the one the adapter's retry fires on.
test('isDegenerate is true only when no meaning came back at all', () => {
  const noSenses = TranslationDraft.fromProviderPayload(payload([]), requested)
  const oneLanguageOnly = TranslationDraft.fromProviderPayload(payload([
    { glossText: 'budowla obronna', translations: [translation('en', 'castle')] }
  ]), requested)
  const populated = TranslationDraft.fromProviderPayload(payload([
    { glossText: 'budowla obronna', translations: [translation('en', 'castle'), translation('de', 'Burg')] }
  ]), requested)

  assert.equal(noSenses.isDegenerate(), true)
  assert.equal(oneLanguageOnly.isDegenerate(), false)
  assert.equal(populated.isDegenerate(), false)
})

test('degenerateLanguageCodes names the languages absent from every meaning', () => {
  const noSenses = TranslationDraft.fromProviderPayload(payload([]), requested)
  // `de` appears under no meaning at all — a gap the user will see, unlike the
  // sparse spoke above where it appears under one meaning and not another.
  const englishOnly = TranslationDraft.fromProviderPayload(payload([
    { glossText: 'budowla obronna', translations: [translation('en', 'castle')] },
    { glossText: 'suwak', translations: [translation('en', 'zipper')] }
  ]), requested)
  const populated = TranslationDraft.fromProviderPayload(payload([
    { glossText: 'budowla obronna', translations: [translation('en', 'castle'), translation('de', 'Burg')] }
  ]), requested)

  assert.deepStrictEqual(noSenses.degenerateLanguageCodes(), ['en', 'de'])
  assert.deepStrictEqual(englishOnly.degenerateLanguageCodes(), ['de'])
  assert.deepStrictEqual(populated.degenerateLanguageCodes(), [])
})

// --- projections ---

// `renderingFor` — "take the first meaning that has this language and its first
// sentence" — is gone. It was the backfill's way of guessing which meaning a
// new language belonged to, and guessing is what decision D-2 removes: the
// meaning is now an input, so there is one parser per known meaning instead.
test('senseTranslationFromProviderPayload stamps the requested code, ignoring the payload\'s', () => {
  const translation = senseTranslationFromProviderPayload({
    languageCode: 'ZZ',
    meaningText: '  Burg  ',
    phoneticTranscription: '   ',
    sentences: [{ targetText: '  Die Burg steht.  ', nativeGlossText: '  Zamek stoi.  ' }]
  }, 'de')

  assert.equal(translation.languageCode, 'de')
  assert.equal(translation.meaningText, 'Burg')
  // A blank phonetic is a missing one, not an empty string.
  assert.equal(translation.phoneticTranscription, null)
  // Sentence text stays as the model produced it, exactly as on the capture
  // path — `Entry.capture` is what trims on the way to the database.
  assert.deepStrictEqual(translation.sentences, [
    { targetText: '  Die Burg steht.  ', nativeGlossText: '  Zamek stoi.  ' }
  ])
})

test('senseTranslationFromProviderPayload raises rather than returning something unusable', () => {
  assert.throws(
    () => senseTranslationFromProviderPayload('not an object', 'de'),
    MalformedDraftError
  )
  // A word with no example teaches nothing, so it is not a translation — the
  // same rule alignSenseTranslations applies on the capture path.
  assert.throws(
    () => senseTranslationFromProviderPayload({ meaningText: 'Burg', sentences: [] }, 'de'),
    DegenerateDraftError
  )
  assert.throws(
    () => senseTranslationFromProviderPayload({
      meaningText: '   ',
      sentences: [{ targetText: 'Die Burg steht.', nativeGlossText: 'Zamek stoi.' }]
    }, 'de'),
    DegenerateDraftError
  )
  // A sentence missing either half is skipped, which can empty the list.
  assert.throws(
    () => senseTranslationFromProviderPayload({
      meaningText: 'Burg',
      sentences: [{ targetText: 'Die Burg steht.' }]
    }, 'de'),
    DegenerateDraftError
  )
})

test('toWire emits the nested meaning-first shape the response schema declares', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    { glossText: 'budowla obronna', translations: [translation('en', 'castle'), translation('de', 'Burg')] },
    { glossText: 'suwak', translations: [translation('en', 'zipper')] }
  ]), requested)

  assert.deepStrictEqual(draft.toWire(), {
    normalizedNativeText: 'zamek',
    senses: [
      {
        glossText: 'budowla obronna',
        translations: [
          {
            languageCode: 'en',
            meaningText: 'castle',
            phoneticTranscription: '/castle/',
            sentences: [{ targetText: 'A sentence with castle.', nativeGlossText: 'Zdanie po polsku.' }]
          },
          {
            languageCode: 'de',
            meaningText: 'Burg',
            phoneticTranscription: '/Burg/',
            sentences: [{ targetText: 'A sentence with Burg.', nativeGlossText: 'Zdanie po polsku.' }]
          }
        ]
      },
      {
        glossText: 'suwak',
        translations: [{
          languageCode: 'en',
          meaningText: 'zipper',
          phoneticTranscription: '/zipper/',
          sentences: [{ targetText: 'A sentence with zipper.', nativeGlossText: 'Zdanie po polsku.' }]
        }]
      }
    ]
  })
})

test('producedCharacters counts every character of text the draft carries, gloss included', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    {
      glossText: 'budowla',
      translations: [{
        languageCode: 'en',
        meaningText: 'castle',
        phoneticTranscription: '/kas/',
        sentences: [{ targetText: 'Stone.', nativeGlossText: 'Kamien.' }]
      }]
    }
  ]), requested)

  // 7 (budowla) + 6 (castle) + 5 (/kas/) + 6 (Stone.) + 7 (Kamien.)
  assert.equal(draft.producedCharacters(), 31)
})

// The native code is interpolated verbatim into the system prompt, so
// normalizing it here would change the bytes sent to the model. The target
// codes are only ever compared, so they are normalized to make alignment
// total.
test('RequestedLanguages.of normalizes the target codes but leaves the native code as given', () => {
  const languages = RequestedLanguages.of('PL', [' EN ', 'De'])

  assert.equal(languages.nativeLanguageCode, 'PL')
  assert.deepStrictEqual(languages.targetLanguageCodes, ['en', 'de'])
})
