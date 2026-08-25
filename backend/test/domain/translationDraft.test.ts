import { test } from 'node:test'
import * as assert from 'node:assert'
import { TranslationDraft, RequestedLanguages } from '../../src/domain/translationDraft.js'
import { MalformedDraftError } from '../../src/domain/translator.js'

// This file is the specification of what the model may legally do to us.
// Every payload below is either observed or permitted by the tool schema: the
// `variants` array carries no enforced `minItems`, and nothing below
// `languageCode` is type-checked by the provider at all. Before this value
// object existed, `ai/translate.ts:148` cast every one of these shapes to
// `TranslationResult` unchecked and handed it straight to the extension's
// React state.

const requested = RequestedLanguages.of('pl', ['en', 'de'])

function sense (meaningText: string): unknown {
  return {
    meaningText,
    phoneticTranscription: `/${meaningText}/`,
    sentences: [{ targetText: `A sentence with ${meaningText}.`, nativeGlossText: 'Zdanie po polsku.' }]
  }
}

function payload (languages: unknown): unknown {
  return { normalizedNativeText: 'pies', languages }
}

// --- totality: the only two ways out are a valid draft or MalformedDraftError ---

test('a non-object payload raises MalformedDraftError', () => {
  for (const bad of [null, undefined, 'pies', 42, ['pies'], true]) {
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
      () => TranslationDraft.fromProviderPayload({ normalizedNativeText: bad, languages: [] }, requested),
      MalformedDraftError,
      `expected ${String(bad)} to be rejected`
    )
  }
})

// --- alignment: alignToRequested's behaviour, moved down from translate.test.ts:80 ---

test('a missing languages key yields one empty language per requested code', () => {
  const draft = TranslationDraft.fromProviderPayload({ normalizedNativeText: 'pies' }, requested)

  assert.deepStrictEqual(draft.toWire().languages, [
    { languageCode: 'en', variants: [] },
    { languageCode: 'de', variants: [] }
  ])
})

test('a non-array languages value is treated as no languages at all', () => {
  const draft = TranslationDraft.fromProviderPayload(payload({ en: 'dog' }), requested)

  assert.deepStrictEqual(draft.degenerateLanguageCodes(), ['en', 'de'])
})

test('a reordered language list is re-keyed against what was requested', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    { languageCode: 'de', variants: [sense('Hund')] },
    { languageCode: 'en', variants: [sense('dog')] }
  ]), requested)

  const wire = draft.toWire()
  assert.deepStrictEqual(wire.languages.map((language) => language.languageCode), ['en', 'de'])
  assert.equal(wire.languages[0].variants[0].meaningText, 'dog')
  assert.equal(wire.languages[1].variants[0].meaningText, 'Hund')
})

test('a language code the model was not asked for is dropped', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    { languageCode: 'en', variants: [sense('dog')] },
    { languageCode: 'fr', variants: [sense('chien')] }
  ]), requested)

  assert.deepStrictEqual(draft.toWire().languages.map((language) => language.languageCode), ['en', 'de'])
})

test('a language the model skipped comes back empty rather than absent', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    { languageCode: 'en', variants: [sense('dog')] }
  ]), requested)

  const wire = draft.toWire()
  assert.equal(wire.languages.length, 2)
  assert.deepStrictEqual(wire.languages[1], { languageCode: 'de', variants: [] })
})

// Matching is lenient; emitting is not. The draft always carries the code that
// was *requested*, never the provider's spelling of it, because that code is
// what the client renders against and what the backfill route inserts.
test('language codes are matched leniently but always emitted as requested', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    { languageCode: ' EN ', variants: [sense('dog')] },
    { languageCode: 'De', variants: [sense('Hund')] }
  ]), requested)

  assert.deepStrictEqual(draft.degenerateLanguageCodes(), [])
  assert.deepStrictEqual(draft.toWire().languages.map((language) => language.languageCode), ['en', 'de'])
  assert.equal(draft.renderingFor('en')?.languageCode, 'en')
})

test('a languageCode that is not a string is skipped instead of throwing', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    { languageCode: 42, variants: [sense('dog')] },
    'not a language block at all'
  ]), requested)

  assert.deepStrictEqual(draft.degenerateLanguageCodes(), ['en', 'de'])
})

// --- sense-level hygiene ---

test('a sense whose meaningText is not a non-blank string is dropped', () => {
  for (const bad of [42, null, undefined, '', '   ', { text: 'dog' }]) {
    const draft = TranslationDraft.fromProviderPayload(payload([
      { languageCode: 'en', variants: [{ ...(sense('dog') as object), meaningText: bad }] }
    ]), requested)

    assert.deepStrictEqual(draft.toWire().languages[0].variants, [], `expected ${String(bad)} to be dropped`)
  }
})

test('a sense with an empty sentences array is dropped — a sense with no example teaches nothing', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    { languageCode: 'en', variants: [{ meaningText: 'dog', phoneticTranscription: '/dog/', sentences: [] }] }
  ]), requested)

  assert.deepStrictEqual(draft.toWire().languages[0].variants, [])
})

test('a sense keeps only the sentences carrying both halves of the pair', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    {
      languageCode: 'en',
      variants: [{
        meaningText: 'dog',
        phoneticTranscription: '/dog/',
        sentences: [
          { targetText: 'The dog barks.', nativeGlossText: 'Pies szczeka.' },
          { targetText: 'A dog runs.', nativeGlossText: '' },
          { targetText: 42, nativeGlossText: 'Pies biegnie.' },
          'not a sentence at all'
        ]
      }]
    }
  ]), requested)

  assert.deepStrictEqual(draft.toWire().languages[0].variants[0].sentences, [
    { targetText: 'The dog barks.', nativeGlossText: 'Pies szczeka.' }
  ])
})

test('a blank or non-string phoneticTranscription normalizes to null', () => {
  for (const bad of ['', '   ', 42, undefined, { ipa: '/dog/' }]) {
    const draft = TranslationDraft.fromProviderPayload(payload([
      { languageCode: 'en', variants: [{ ...(sense('dog') as object), phoneticTranscription: bad }] }
    ]), requested)

    assert.equal(
      draft.toWire().languages[0].variants[0].phoneticTranscription,
      null,
      `expected ${String(bad)} to normalize to null`
    )
  }
})

test('a non-array variants value yields no senses rather than throwing', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    { languageCode: 'en', variants: 'dog' },
    { languageCode: 'de' }
  ]), requested)

  assert.deepStrictEqual(draft.degenerateLanguageCodes(), ['en', 'de'])
})

// --- usability ---

test('isDegenerate is true only when every requested language came back empty', () => {
  const allEmpty = TranslationDraft.fromProviderPayload(payload([
    { languageCode: 'en', variants: [] },
    { languageCode: 'de', variants: [] }
  ]), requested)
  const partial = TranslationDraft.fromProviderPayload(payload([
    { languageCode: 'en', variants: [sense('dog')] },
    { languageCode: 'de', variants: [] }
  ]), requested)
  const populated = TranslationDraft.fromProviderPayload(payload([
    { languageCode: 'en', variants: [sense('dog')] },
    { languageCode: 'de', variants: [sense('Hund')] }
  ]), requested)

  assert.equal(allEmpty.isDegenerate(), true)
  assert.equal(partial.isDegenerate(), false)
  assert.equal(populated.isDegenerate(), false)

  assert.deepStrictEqual(allEmpty.degenerateLanguageCodes(), ['en', 'de'])
  assert.deepStrictEqual(partial.degenerateLanguageCodes(), ['de'])
  assert.deepStrictEqual(populated.degenerateLanguageCodes(), [])
})

// --- projections ---

test('renderingFor returns the first sense and sentence, trimmed and normalized', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    {
      languageCode: 'en',
      variants: [{
        meaningText: '  dog  ',
        phoneticTranscription: '   ',
        sentences: [{ targetText: '  The dog barks.  ', nativeGlossText: '  Pies szczeka.  ' }]
      }, sense('hound')]
    }
  ]), requested)

  assert.deepStrictEqual(draft.renderingFor('en'), {
    languageCode: 'en',
    meaningText: 'dog',
    phoneticTranscription: null,
    sentenceText: 'The dog barks.',
    nativeGlossText: 'Pies szczeka.'
  })
})

test('renderingFor returns null for a language with no usable sense, and for one never requested', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    { languageCode: 'en', variants: [sense('dog')] }
  ]), requested)

  assert.equal(draft.renderingFor('de'), null)
  assert.equal(draft.renderingFor('fr'), null)
})

test('toWire emits the wire key `variants` with the shape the popup already parses', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    { languageCode: 'en', variants: [sense('dog')] },
    { languageCode: 'de', variants: [] }
  ]), requested)

  assert.deepStrictEqual(draft.toWire(), {
    normalizedNativeText: 'pies',
    languages: [
      {
        languageCode: 'en',
        variants: [{
          meaningText: 'dog',
          phoneticTranscription: '/dog/',
          sentences: [{ targetText: 'A sentence with dog.', nativeGlossText: 'Zdanie po polsku.' }]
        }]
      },
      { languageCode: 'de', variants: [] }
    ]
  })
})

test('producedCharacters counts every character of translated text the draft carries', () => {
  const draft = TranslationDraft.fromProviderPayload(payload([
    {
      languageCode: 'en',
      variants: [{
        meaningText: 'dog',
        phoneticTranscription: '/dog/',
        sentences: [{ targetText: 'Woof.', nativeGlossText: 'Hau.' }]
      }]
    },
    { languageCode: 'de', variants: [] }
  ]), requested)

  // 3 (dog) + 5 (/dog/) + 5 (Woof.) + 4 (Hau.) — the empty language costs nothing.
  assert.equal(draft.producedCharacters(), 17)
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
