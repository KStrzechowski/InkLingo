import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import App from '../../src/popup/App.tsx'
import { deferred, installFakeBrowser, uninstallFakeBrowser, type FakeBrowser } from '../helpers/webext.ts'
import {
  createCollection,
  createSense,
  createSenseTranslation,
  createSentence,
  createTranslationResult
} from '../helpers/translations.ts'
import type { Collection, TranslationResult } from '../../src/types.ts'
import type { CreateEntryBody } from '../../src/messages.ts'

// jsdom has no speechSynthesis, so useSpeech settles to ready-with-no-voices
// (src/speech.ts:25-27, 35-38). Every language block therefore renders its
// "No <Language> voice is installed on this computer" line and every play
// button is disabled. That is unavoidable here and harmless — but it is why
// the locators below go through roles and accessible names rather than loose
// text matching, which would collide with that copy.

const LAST_COLLECTION_KEY = 'lastCollectionId'

let fake: FakeBrowser

beforeEach(() => {
  fake = installFakeBrowser()
})

afterEach(() => {
  uninstallFakeBrowser()
})

function signedIn (collections: Collection[]): void {
  fake.handlers['auth-status'] = () => ({ authenticated: true })
  fake.handlers['list-collections'] = () => collections
}

async function renderReady (collections: Collection[]): Promise<void> {
  signedIn(collections)
  render(<App />)
  await screen.findByRole('combobox')
}

// Types a word and submits. Resolves once the results section has rendered —
// or immediately, when the caller expects no results.
async function translate (word = 'kot'): Promise<void> {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: word } })
  fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
  await screen.findByRole('button', { name: 'Save to collection' })
}

// Submits without waiting for a result — the races are only observable while a
// call is still in flight.
function startTranslate (word = 'kot'): void {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: word } })
  fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
}

function saveButton (): HTMLElement {
  return screen.getByRole('button', { name: 'Save to collection' })
}

function meaningCheckbox (glossText: string): HTMLElement {
  return screen.getByRole('checkbox', { name: glossText })
}

function sentenceRadio (targetText: string | RegExp): HTMLElement {
  return screen.getByRole('radio', { name: targetText })
}

function regenerateButton (): HTMLElement {
  return screen.getByRole('button', { name: 'New sentences' })
}

function savedEntry (): CreateEntryBody {
  const message = fake.sent.find((candidate) => candidate.type === 'save-entry')
  if (message === undefined || message.type !== 'save-entry') {
    throw new Error('no save-entry message was sent')
  }
  return message.entry
}

describe('popup bootstrap', () => {
  it('shows the login view when the background reports no session', async () => {
    fake.handlers['auth-status'] = () => ({ authenticated: false })

    render(<App />)

    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument()
  })

  it('loads collections and renders the picker when authenticated', async () => {
    const collection = createCollection({ name: 'Polish to English' })
    await renderReady([collection])

    expect(screen.getByRole('combobox')).toHaveValue(collection.id)
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument()
  })

  // The background script answers errors as { ok: false, error }, never as a
  // rejected sendMessage — the fake models that, and this is the case proving
  // the popup unwraps it rather than hanging on a pending promise.
  it('surfaces a background failure as an error, not a stuck loading state', async () => {
    fake.handlers['auth-status'] = () => {
      throw new Error('Your session expired — log in again.')
    }

    render(<App />)

    expect(await screen.findByText('Your session expired — log in again.')).toBeInTheDocument()
  })

  // FR-013's "default to the last-used collection".
  it('opens on the last-used collection', async () => {
    const first = createCollection({ name: 'First' })
    const second = createCollection({ name: 'Second' })
    fake.store[LAST_COLLECTION_KEY] = second.id

    await renderReady([first, second])

    expect(screen.getByRole('combobox')).toHaveValue(second.id)
  })

  // A collection deleted in the web app since the last capture must not leave
  // the popup pointing at nothing — the input would be unusable.
  it('falls back to the first collection when the stored one is gone', async () => {
    const first = createCollection({ name: 'First' })
    fake.store[LAST_COLLECTION_KEY] = 'collection-that-no-longer-exists'

    await renderReady([first])

    expect(screen.getByRole('combobox')).toHaveValue(first.id)
  })
})

describe('popup meaning and sentence selection (D-3)', () => {
  const meanings = ['cat (the animal)', 'cat (jazz slang)']

  function twoMeaningResult (): TranslationResult {
    return createTranslationResult({ glossTexts: meanings, languageCodes: ['en'] })
  }

  // Every meaning starts checked — the common case is a single meaning, and
  // requiring a click just to enable the common case would be pure friction.
  // Nothing beneath that is picked yet, so save stays disabled.
  it('checks every meaning by default and leaves every sentence unpicked', async () => {
    await renderReady([createCollection()])
    fake.handlers.translate = () => twoMeaningResult()

    await translate()

    expect(meaningCheckbox(meanings[0])).toBeChecked()
    expect(meaningCheckbox(meanings[1])).toBeChecked()
    expect(screen.getAllByRole('radio').filter((radio) => (radio as HTMLInputElement).checked)).toHaveLength(0)
    expect(saveButton()).toBeDisabled()
  })

  // Unchecking a meaning drops its sentence picks, so re-checking it starts
  // over rather than silently resurrecting a stale pick.
  it('drops sentence picks when a meaning is unchecked', async () => {
    const result = createTranslationResult({
      senses: [
        createSense(meanings[0], { translations: [createSenseTranslation('en', { sentences: [createSentence({ targetText: 'The cat sleeps.' })] })] })
      ]
    })
    await renderReady([createCollection()])
    fake.handlers.translate = () => result

    await translate()
    fireEvent.click(sentenceRadio(/The cat sleeps/))
    expect(saveButton()).toBeEnabled()

    fireEvent.click(meaningCheckbox(meanings[0]))
    expect(screen.queryByRole('radio', { name: /The cat sleeps/ })).not.toBeInTheDocument()

    fireEvent.click(meaningCheckbox(meanings[0]))
    expect(sentenceRadio(/The cat sleeps/)).not.toBeChecked()
    expect(saveButton()).toBeDisabled()
  })

  // The model can legally omit a language from one meaning (a sparse spoke).
  // That language simply has no row under this meaning, and must not hold the
  // save gate hostage for the languages it does have.
  it('a sparse spoke does not block save for a checked meaning', async () => {
    const result = createTranslationResult({
      senses: [
        createSense('budowla obronna', {
          translations: [createSenseTranslation('en', { sentences: [createSentence({ targetText: 'The castle stands.' })] })]
        })
      ]
    })
    await renderReady([createCollection({ targetLanguageCodes: ['en', 'de'] })])
    fake.handlers.translate = () => result

    await translate()
    // Only English is offered for this meaning — no German row exists to pick.
    expect(screen.queryByRole('heading', { name: /German/i })).not.toBeInTheDocument()

    fireEvent.click(sentenceRadio(/The castle stands/))

    expect(saveButton()).toBeEnabled()
  })

  it('counts fully-picked meanings in the progress line', async () => {
    const result = createTranslationResult({
      senses: [
        createSense(meanings[0], { translations: [createSenseTranslation('en', { sentences: [createSentence({ targetText: 'The cat sleeps.' })] })] }),
        createSense(meanings[1], { translations: [createSenseTranslation('en', { sentences: [createSentence({ targetText: 'That cat can play.' })] })] })
      ]
    })
    await renderReady([createCollection()])
    fake.handlers.translate = () => result

    await translate()

    expect(screen.getByText('0 of 2 meanings chosen')).toBeInTheDocument()

    fireEvent.click(sentenceRadio(/The cat sleeps/))

    expect(screen.getByText('1 of 2 meanings chosen')).toBeInTheDocument()
  })

  it('keeps save disabled while any checked meaning still needs a sentence', async () => {
    const result = createTranslationResult({
      senses: [
        createSense(meanings[0], { translations: [createSenseTranslation('en', { sentences: [createSentence({ targetText: 'The cat sleeps.' })] })] }),
        createSense(meanings[1], { translations: [createSenseTranslation('en', { sentences: [createSentence({ targetText: 'That cat can play.' })] })] })
      ]
    })
    await renderReady([createCollection()])
    fake.handlers.translate = () => result

    await translate()
    fireEvent.click(sentenceRadio(/The cat sleeps/))

    // The second meaning is still checked (default) but has no sentence pick.
    expect(saveButton()).toBeDisabled()
  })

  // The pairing is the point: each meaning's saved word and sentence are its
  // own, not shared across languages or meanings.
  it('saves each checked meaning with its own words and sentences per language', async () => {
    const result = createTranslationResult({
      normalizedNativeText: 'kot',
      senses: [
        createSense('zwierzę domowe', {
          translations: [
            createSenseTranslation('en', { meaningText: 'cat', sentences: [createSentence({ targetText: 'The cat sleeps.', nativeGlossText: 'Kot śpi.' })] }),
            createSenseTranslation('de', { meaningText: 'Katze', sentences: [createSentence({ targetText: 'Die Katze schläft.', nativeGlossText: 'Kot śpi.' })] })
          ]
        })
      ]
    })
    const collection = createCollection({ name: 'Polski', targetLanguageCodes: ['en', 'de'] })
    await renderReady([collection])
    fake.handlers.translate = () => result
    fake.handlers['save-entry'] = () => ({
      id: 'entry-1',
      wordOrPhrase: 'kot',
      sourceLanguageCode: 'pl',
      createdAt: '2026-08-01T00:00:00.000Z'
    })

    await translate()
    fireEvent.click(sentenceRadio(/The cat sleeps/))
    fireEvent.click(sentenceRadio(/Die Katze schläft/))
    fireEvent.click(saveButton())

    await screen.findByText(/Saved/)
    const entry = savedEntry()
    expect(entry.wordOrPhrase).toBe('kot')
    expect(entry.senses).toEqual([{
      glossText: 'zwierzę domowe',
      translations: [
        {
          languageCode: 'en',
          meaningText: 'cat',
          phoneticTranscription: null,
          sentences: [{ sentenceText: 'The cat sleeps.', nativeGlossText: 'Kot śpi.' }]
        },
        {
          languageCode: 'de',
          meaningText: 'Katze',
          phoneticTranscription: null,
          sentences: [{ sentenceText: 'Die Katze schläft.', nativeGlossText: 'Kot śpi.' }]
        }
      ]
    }])
  })

  // Two meanings, each fully picked, both land in the save payload.
  it('saves every fully-picked checked meaning, not just one', async () => {
    const result = createTranslationResult({
      senses: [
        createSense(meanings[0], { translations: [createSenseTranslation('en', { meaningText: 'cat', sentences: [createSentence({ targetText: 'The cat sleeps.' })] })] }),
        createSense(meanings[1], { translations: [createSenseTranslation('en', { meaningText: 'cool cat', sentences: [createSentence({ targetText: 'That cat can play.' })] })] })
      ]
    })
    await renderReady([createCollection()])
    fake.handlers.translate = () => result
    fake.handlers['save-entry'] = () => ({
      id: 'entry-1',
      wordOrPhrase: 'znormalizowane słowo',
      sourceLanguageCode: 'pl',
      createdAt: '2026-08-01T00:00:00.000Z'
    })

    await translate()
    fireEvent.click(sentenceRadio(/The cat sleeps/))
    fireEvent.click(sentenceRadio(/That cat can play/))
    fireEvent.click(saveButton())

    await screen.findByText(/Saved/)
    expect(savedEntry().senses.map((sense) => sense.glossText)).toEqual(meanings)
  })

  it('clears the capture and remembers the choice when the collection changes', async () => {
    const first = createCollection({ name: 'First' })
    const second = createCollection({ name: 'Second' })
    await renderReady([first, second])
    fake.handlers.translate = () => createTranslationResult()

    await translate()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: second.id } })

    expect(screen.queryByRole('button', { name: 'Save to collection' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(fake.store[LAST_COLLECTION_KEY]).toBe(second.id)
  })
})

describe('popup sentence regeneration', () => {
  const meanings = ['cat (the animal)', 'cat (jazz slang)']

  // Generation is non-deterministic: a fresh response can order the senses
  // differently or return a different set. Pairing by position would attach
  // one sense's sentences to another.
  it('replaces the sentences of the same meaning even when the order changes', async () => {
    const first = createTranslationResult({
      senses: [
        createSense(meanings[0], { translations: [createSenseTranslation('en', { sentences: [createSentence({ targetText: 'The cat sleeps.' })] })] }),
        createSense(meanings[1], { translations: [createSenseTranslation('en', { sentences: [createSentence({ targetText: 'That cat can play.' })] })] })
      ]
    })
    // Same two meanings, reversed, with new sentences.
    const second = createTranslationResult({
      senses: [
        createSense(meanings[1], { translations: [createSenseTranslation('en', { sentences: [createSentence({ targetText: 'A cool cat indeed.' })] })] }),
        createSense(meanings[0], { translations: [createSenseTranslation('en', { sentences: [createSentence({ targetText: 'A cat crossed the road.' })] })] })
      ]
    })
    let calls = 0
    await renderReady([createCollection()])
    fake.handlers.translate = () => {
      calls += 1
      return calls === 1 ? first : second
    }

    await translate()
    // Both meanings are checked by default; regenerate the first one's sentences.
    const regenerateButtons = screen.getAllByRole('button', { name: 'New sentences' })
    fireEvent.click(regenerateButtons[0])

    expect(await screen.findByRole('radio', { name: /A cat crossed the road/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /The cat sleeps/ })).not.toBeInTheDocument()
    // The jazz-slang meaning was not the one regenerated, so its own
    // (unrelated) sentence list must be untouched.
    expect(screen.getByRole('radio', { name: /That cat can play/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /A cool cat indeed/ })).not.toBeInTheDocument()
  })

  it('reports a meaning the model no longer offers instead of silently keeping the old sentences', async () => {
    const first = createTranslationResult({
      senses: [createSense(meanings[0], { translations: [createSenseTranslation('en', { sentences: [createSentence({ targetText: 'The cat sleeps.' })] })] })]
    })
    const second = createTranslationResult({
      senses: [createSense('feline', { translations: [createSenseTranslation('en', { sentences: [createSentence({ targetText: 'A feline appeared.' })] })] })]
    })
    let calls = 0
    await renderReady([createCollection()])
    fake.handlers.translate = () => {
      calls += 1
      return calls === 1 ? first : second
    }

    await translate()
    fireEvent.click(regenerateButton())

    expect(await screen.findByText('No new English sentences came back for this meaning — try again.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /The cat sleeps/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /A feline appeared/ })).not.toBeInTheDocument()
  })

  // Regenerating one meaning's language must not disturb an unrelated
  // meaning's own checked state or sentence pick — independent by
  // construction now that checking is per meaning, not a shared radio.
  it('leaves an unrelated meaning\'s checked state and pick untouched by another meaning\'s regeneration', async () => {
    const first = createTranslationResult({
      senses: [
        createSense(meanings[0], { translations: [createSenseTranslation('en', { sentences: [createSentence({ targetText: 'The cat sleeps.' })] })] }),
        createSense(meanings[1], { translations: [createSenseTranslation('en', { sentences: [createSentence({ targetText: 'That cat can play.' })] })] })
      ]
    })
    const pending = deferred<TranslationResult>()
    let calls = 0
    await renderReady([createCollection()])
    fake.handlers.translate = () => {
      calls += 1
      return calls === 1 ? first : pending.promise
    }

    await translate()
    fireEvent.click(sentenceRadio(/That cat can play/))
    const regenerateButtons = screen.getAllByRole('button', { name: 'New sentences' })
    fireEvent.click(regenerateButtons[0])

    await act(async () => {
      pending.resolve(createTranslationResult({
        senses: [createSense(meanings[0], { translations: [createSenseTranslation('en', { sentences: [createSentence({ targetText: 'A cat crossed the road.' })] })] })]
      }))
      await pending.promise
    })

    expect(meaningCheckbox(meanings[1])).toBeChecked()
    expect(sentenceRadio(/That cat can play/)).toBeChecked()
  })
})

// The three cases below are races: a call that lands after the user has moved
// on. None of them is reachable by hand — they need a ~5s AI call to be
// interrupted at the right moment, and Firefox destroys the popup document the
// instant it loses focus (src/useSpeech.ts:49-51). That is why three commits of
// churn in this file never surfaced them, and why the deferred responses in
// test/helpers/webext.ts exist.
describe('popup in-flight races', () => {
  // E-1. The backend only rejects the mismatch when the two collections'
  // target languages differ (backend/src/routes/api/collections/index.ts:289-296);
  // when they overlap — as here — it writes the entry, stamping the *new*
  // collection's native language onto a word normalized against the old one.
  it('drops a translate that lands after the collection changed', async () => {
    const polish = createCollection({ name: 'Polski', nativeLanguageCode: 'pl', targetLanguageCodes: ['en'] })
    const russian = createCollection({ name: 'Русский', nativeLanguageCode: 'ru', targetLanguageCodes: ['en'] })
    const pending = deferred<TranslationResult>()
    await renderReady([polish, russian])
    fake.handlers.translate = () => pending.promise

    startTranslate('kot')
    await screen.findByRole('button', { name: 'Translating…' })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: russian.id } })

    await act(async () => {
      pending.resolve(createTranslationResult({ normalizedNativeText: 'kot', languageCodes: ['en'] }))
      await pending.promise
    })

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save to collection' })).not.toBeInTheDocument()
    // And the abandoned call must not strand the form: dropping a result is
    // not the same as leaving the UI mid-request forever.
    expect(screen.getByRole('button', { name: 'Translate' })).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeEnabled()
  })

  // E-2, first half: the submit button was already disabled while a call ran,
  // but Enter in the input was not — that is how a second concurrent call gets
  // started.
  it('locks the word input while a call is in flight', async () => {
    const pending = deferred<TranslationResult>()
    await renderReady([createCollection()])
    fake.handlers.translate = () => pending.promise

    startTranslate('kot')
    await screen.findByRole('button', { name: 'Translating…' })

    expect(screen.getByRole('textbox')).toBeDisabled()
  })

  // E-2, second half: the continuation used to rebuild state from the `capture`
  // it closed over before the await, so a regeneration landing after the
  // capture was cleared would resurrect it. Both the generation guard and the
  // functional write cover this one — see the next case for the guard alone.
  it('does not resurrect a cleared capture when a regeneration lands late', async () => {
    const first = createCollection({ name: 'First' })
    const second = createCollection({ name: 'Second' })
    const pending = deferred<TranslationResult>()
    const meanings = ['cat (the animal)', 'cat (jazz slang)']
    let calls = 0
    await renderReady([first, second])
    fake.handlers.translate = () => {
      calls += 1
      return calls === 1
        ? createTranslationResult({ glossTexts: meanings, languageCodes: ['en'] })
        : pending.promise
    }

    await translate()
    fireEvent.click(screen.getAllByRole('button', { name: 'New sentences' })[0])
    fireEvent.change(screen.getByRole('combobox'), { target: { value: second.id } })

    await act(async () => {
      pending.resolve(createTranslationResult({ glossTexts: meanings, languageCodes: ['en'] }))
      await pending.promise
    })

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save to collection' })).not.toBeInTheDocument()
  })

  // The generation guard on its own. Here the capture is not merely cleared but
  // *replaced* by a newer word, so a functional write is no longer protection —
  // it would splice the cat's fresh sentences into the dog's results. Only
  // knowing the result is stale prevents that.
  it('does not splice a late regeneration into a different word’s results', async () => {
    const first = createCollection({ name: 'First' })
    const second = createCollection({ name: 'Second' })
    const pending = deferred<TranslationResult>()
    const meanings = ['cat (the animal)', 'cat (jazz slang)']
    let calls = 0
    await renderReady([first, second])
    fake.handlers.translate = () => {
      calls += 1
      if (calls === 1) {
        return createTranslationResult({
          senses: [createSense(meanings[0], { translations: [createSenseTranslation('en', { sentences: [createSentence({ targetText: 'The cat sleeps.' })] })] })]
        })
      }
      if (calls === 2) {
        return pending.promise
      }
      return createTranslationResult({
        normalizedNativeText: 'pies',
        senses: [createSense('dog', { translations: [createSenseTranslation('en', { meaningText: 'dog', sentences: [createSentence({ targetText: 'The dog barks.' })] })] })]
      })
    }

    await translate('kot')
    fireEvent.click(regenerateButton())
    // Abandons the regeneration and frees the form for the next word.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: second.id } })
    await translate('pies')

    await act(async () => {
      pending.resolve(createTranslationResult({
        senses: [createSense(meanings[0], { translations: [createSenseTranslation('en', { sentences: [createSentence({ targetText: 'A cat crossed the road.' })] })] })]
      }))
      await pending.promise
    })

    expect(meaningCheckbox('dog')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /The dog barks/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /A cat crossed the road/ })).not.toBeInTheDocument()
  })

  // F1 from the p1-p7 impl-review. The entry lands in the collection it was
  // saved to either way — what must not happen is the pre-await id being
  // written back as "last used", silently undoing a switch made while the save
  // was in flight.
  it('does not rewrite the last-used collection when one is chosen mid-save', async () => {
    const first = createCollection({ name: 'First' })
    const second = createCollection({ name: 'Second' })
    const pending = deferred<{ id: string, wordOrPhrase: string, sourceLanguageCode: string, createdAt: string }>()
    await renderReady([first, second])
    fake.handlers.translate = () => createTranslationResult({
      senses: [createSense('cat', { translations: [createSenseTranslation('en', { meaningText: 'cat', sentences: [createSentence({ targetText: 'The cat sleeps.' })] })] })]
    })
    fake.handlers['save-entry'] = () => pending.promise

    await translate('kot')
    fireEvent.click(sentenceRadio(/The cat sleeps/))
    fireEvent.click(saveButton())
    fireEvent.change(screen.getByRole('combobox'), { target: { value: second.id } })

    await act(async () => {
      pending.resolve({
        id: 'entry-1',
        wordOrPhrase: 'kot',
        sourceLanguageCode: 'pl',
        createdAt: '2026-08-01T00:00:00.000Z'
      })
      await pending.promise
    })

    expect(fake.store[LAST_COLLECTION_KEY]).toBe(second.id)
    // The entry still went to the collection that was active when it was saved.
    const sent = fake.sent.find((candidate) => candidate.type === 'save-entry')
    expect(sent !== undefined && sent.type === 'save-entry' && sent.collectionId).toBe(first.id)
  })
})
