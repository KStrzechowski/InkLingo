import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import CollectionDetailPage from '../../src/pages/CollectionDetailPage'
import { createCollection, createEntry, createSentence, createTranslation } from '../helpers/collections'
import type { AddedEntryTranslation, CollectionDetail } from '../../src/api/collections'

// FR-018's gap detection: a collection teaches a set of languages, an entry
// saved before the collection gained one is missing it, and the page offers to
// backfill exactly those. The oracle here is that rule — not the button's
// label, which renders the raw code (`Add EN` for a legacy-cased target) rather
// than languageLabel(). Every assertion below keys off the language, matched
// case-insensitively, so it stays about the behaviour rather than the copy.
//
// jsdom has no speechSynthesis, so useSpeech settles ready-with-no-voices and
// the page also renders its "No voice is installed on this computer for …"
// line. That is why gap controls are located by role and name rather than by
// text.

vi.mock('../../src/api/collections', () => ({
  getCollection: vi.fn(),
  addEntryTranslation: vi.fn(),
  listCollections: vi.fn(),
  createCollection: vi.fn()
}))

const { getCollection, addEntryTranslation } = await import('../../src/api/collections')

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function deferred<T> (): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function renderPage (collection: CollectionDetail): Promise<void> {
  vi.mocked(getCollection).mockResolvedValue(collection)
  render(
    <MemoryRouter initialEntries={[`/collections/${collection.id}`]}>
      <Routes>
        <Route path="/collections/:id" element={<CollectionDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
  await screen.findByRole('heading', { name: collection.name })
}

// A gap control for one language, matched case-insensitively so a legacy
// uppercase target is found by the same query as a normalized one.
function gapControl (languageCode: string): HTMLElement | null {
  return screen.queryByRole('button', { name: new RegExp(`^add ${languageCode}$`, 'i') })
}

function entryItem (wordOrPhrase: string): HTMLElement {
  const word = screen.getByText(wordOrPhrase)
  const item = word.closest('li')
  if (item === null) {
    throw new Error(`no list item found for "${wordOrPhrase}"`)
  }
  return item
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('CollectionDetailPage language-gap detection', () => {
  it('offers no backfill for an entry that already has every target language', async () => {
    await renderPage(createCollection({
      targetLanguageCodes: ['en', 'de'],
      entries: [createEntry('kot', { languages: ['en', 'de'] })]
    }))

    expect(gapControl('en')).toBeNull()
    expect(gapControl('de')).toBeNull()
    expect(screen.queryByText('Missing:')).not.toBeInTheDocument()
  })

  it('offers exactly the language an entry predates', async () => {
    await renderPage(createCollection({
      targetLanguageCodes: ['en', 'de'],
      entries: [createEntry('kot', { languages: ['en'] })]
    }))

    expect(gapControl('de')).toBeInTheDocument()
    expect(gapControl('en')).toBeNull()
  })

  // POST /api/collections lowercases on write, but collections created before
  // that normalization landed still hold codes like 'EN'. Comparing them
  // case-sensitively would never match the saved 'en' translation and would
  // offer to backfill a language the entry already has.
  it('does not offer a language the entry already has under a legacy uppercase code', async () => {
    await renderPage(createCollection({
      targetLanguageCodes: ['EN', 'PL'],
      entries: [createEntry('kot', {
        translations: [createTranslation('en'), createTranslation('pl')],
        sentences: [createSentence('en'), createSentence('pl')]
      })]
    }))

    expect(gapControl('en')).toBeNull()
    expect(gapControl('pl')).toBeNull()
  })

  it('tracks gaps per entry in a multi-language collection', async () => {
    await renderPage(createCollection({
      targetLanguageCodes: ['en', 'de', 'fr'],
      entries: [
        createEntry('kot', { languages: ['en', 'de', 'fr'] }),
        createEntry('pies', { languages: ['en'] })
      ]
    }))

    const complete = entryItem('kot')
    const partial = entryItem('pies')
    expect(within(complete).queryByRole('button', { name: /^add /i })).toBeNull()
    expect(within(partial).getByRole('button', { name: /^add de$/i })).toBeInTheDocument()
    expect(within(partial).getByRole('button', { name: /^add fr$/i })).toBeInTheDocument()
    expect(within(partial).queryByRole('button', { name: /^add en$/i })).toBeNull()
  })

  it('offers every target language for an entry with no translations at all', async () => {
    await renderPage(createCollection({
      targetLanguageCodes: ['en', 'de'],
      entries: [createEntry('kot', { translations: [], sentences: [] })]
    }))

    expect(gapControl('en')).toBeInTheDocument()
    expect(gapControl('de')).toBeInTheDocument()
  })
})

describe('CollectionDetailPage backfill', () => {
  function backfilled (languageCode: string, meaningText: string, sentenceText: string): AddedEntryTranslation {
    return {
      entryId: 'unused',
      translation: createTranslation(languageCode, { meaningText }),
      sentence: createSentence(languageCode, { sentenceText })
    }
  }

  it('splices the new rows into that entry alone and closes its gap', async () => {
    await renderPage(createCollection({
      targetLanguageCodes: ['en', 'de'],
      entries: [
        createEntry('kot', { languages: ['en'] }),
        createEntry('pies', { languages: ['en'] })
      ]
    }))
    vi.mocked(addEntryTranslation).mockResolvedValue(backfilled('de', 'Katze', 'Die Katze schläft.'))

    fireEvent.click(within(entryItem('kot')).getByRole('button', { name: /^add de$/i }))

    // Exact row text: a loose /Katze/ would match the sentence row too.
    expect(await screen.findByText('de: Katze')).toBeInTheDocument()
    expect(screen.getByText('de: Die Katze schläft.')).toBeInTheDocument()
    // The gap it was raised for is closed…
    expect(within(entryItem('kot')).queryByRole('button', { name: /^add de$/i })).toBeNull()
    // …and the other entry is visibly as it was.
    expect(within(entryItem('pies')).getByRole('button', { name: /^add de$/i })).toBeInTheDocument()
  })

  // The server lowercases the code before storing it, so a legacy-cased target
  // closes its own gap on the round trip rather than offering the button again.
  it('closes a legacy-cased gap with the lowercased code the server echoes', async () => {
    await renderPage(createCollection({
      targetLanguageCodes: ['EN'],
      entries: [createEntry('kot', { translations: [], sentences: [] })]
    }))
    vi.mocked(addEntryTranslation).mockResolvedValue(backfilled('en', 'cat', 'The cat sleeps.'))

    fireEvent.click(screen.getByRole('button', { name: /^add en$/i }))

    expect(await screen.findByText('en: cat')).toBeInTheDocument()
    expect(gapControl('en')).toBeNull()
  })

  // One backfill at a time: addingKey is a page-global lock, so a second click
  // anywhere cannot start a competing AI call.
  it('locks every gap control while one backfill is in flight', async () => {
    await renderPage(createCollection({
      targetLanguageCodes: ['en', 'de'],
      entries: [
        createEntry('kot', { languages: ['en'] }),
        createEntry('pies', { languages: ['en'] })
      ]
    }))
    const pending = deferred<AddedEntryTranslation>()
    vi.mocked(addEntryTranslation).mockReturnValue(pending.promise)

    fireEvent.click(within(entryItem('kot')).getByRole('button', { name: /^add de$/i }))

    expect(await screen.findByRole('button', { name: 'Adding…' })).toBeInTheDocument()
    expect(within(entryItem('pies')).getByRole('button', { name: /^add de$/i })).toBeDisabled()

    await act(async () => {
      pending.resolve(backfilled('de', 'Katze', 'Die Katze schläft.'))
      await pending.promise
    })

    expect(within(entryItem('pies')).getByRole('button', { name: /^add de$/i })).toBeEnabled()
  })

  it('surfaces a failed backfill and leaves the entry as it was', async () => {
    await renderPage(createCollection({
      targetLanguageCodes: ['en', 'de'],
      entries: [createEntry('kot', { languages: ['en'] })]
    }))
    vi.mocked(addEntryTranslation).mockRejectedValue(new Error('network is down'))

    fireEvent.click(screen.getByRole('button', { name: /^add de$/i }))

    expect(await screen.findByText('Request failed')).toBeInTheDocument()
    // Still offered, because nothing was added.
    expect(gapControl('de')).toBeInTheDocument()
  })
})
