import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import CollectionDetailPage from '../../src/pages/CollectionDetailPage'
import { createCollection, createEntry, createSense, createSentence, createTranslation } from '../helpers/collections'
import { deferred } from '../helpers/deferred'
import type { CollectionDetail, Entry } from '../../src/api/collections'

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

// Scoped to `<strong>`, not a bare text match: with single-meaning entries
// the default gloss equals the word itself, so the word also appears in the
// meaning heading right beneath it.
function entryItem (wordOrPhrase: string): HTMLElement {
  const word = screen.getByText(wordOrPhrase, { selector: 'strong' })
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
        translations: [createTranslation('en'), createTranslation('pl')]
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
      entries: [createEntry('kot', { translations: [] })]
    }))

    expect(gapControl('en')).toBeInTheDocument()
    expect(gapControl('de')).toBeInTheDocument()
  })

  // A meaning missing one language is a sparse spoke, not a gap the entry as
  // a whole has — the gap-detection set draws from every sense's
  // translations, so a language covered by ANY meaning is not offered.
  it('does not offer a language a different meaning of the same entry already has', async () => {
    await renderPage(createCollection({
      targetLanguageCodes: ['en', 'de'],
      entries: [createEntry('zamek', {
        senses: [
          createSense('budowla obronna', { languageCodes: ['en', 'de'] }),
          createSense('zamknięcie drzwi', { languageCodes: ['en'] })
        ]
      })]
    }))

    expect(gapControl('en')).toBeNull()
    expect(gapControl('de')).toBeNull()
  })
})

describe('CollectionDetailPage backfill', () => {
  // The backend returns the whole updated entry (decision A9), so the mock
  // has to build a complete post-backfill entry rather than a delta — the
  // page just replaces the entry with whatever this resolves to.
  function backfilledEntry (entry: Entry, languageCode: string, meaningText: string, sentenceText: string): Entry {
    return {
      ...entry,
      senses: entry.senses.map((sense, index) => (
        index === 0
          ? { ...sense, translations: [...sense.translations, createTranslation(languageCode, { meaningText, sentences: [createSentence({ sentenceText })] })] }
          : sense
      ))
    }
  }

  it('replaces that entry alone and closes its gap', async () => {
    const kot = createEntry('kot', { languages: ['en'] })
    const pies = createEntry('pies', { languages: ['en'] })
    await renderPage(createCollection({
      targetLanguageCodes: ['en', 'de'],
      entries: [kot, pies]
    }))
    vi.mocked(addEntryTranslation).mockResolvedValue(backfilledEntry(kot, 'de', 'Katze', 'Die Katze schläft.'))

    fireEvent.click(within(entryItem('kot')).getByRole('button', { name: /^add de$/i }))

    // Exact row text: a loose /Katze/ would match the sentence row too.
    expect(await screen.findByText('de: Katze')).toBeInTheDocument()
    expect(screen.getByText('Die Katze schläft.')).toBeInTheDocument()
    // The gap it was raised for is closed…
    expect(within(entryItem('kot')).queryByRole('button', { name: /^add de$/i })).toBeNull()
    // …and the other entry is visibly as it was.
    expect(within(entryItem('pies')).getByRole('button', { name: /^add de$/i })).toBeInTheDocument()
  })

  // The server lowercases the code before storing it, so a legacy-cased target
  // closes its own gap on the round trip rather than offering the button again.
  it('closes a legacy-cased gap with the lowercased code the server echoes', async () => {
    const kot = createEntry('kot', { translations: [] })
    await renderPage(createCollection({
      targetLanguageCodes: ['EN'],
      entries: [kot]
    }))
    vi.mocked(addEntryTranslation).mockResolvedValue(backfilledEntry(kot, 'en', 'cat', 'The cat sleeps.'))

    fireEvent.click(screen.getByRole('button', { name: /^add en$/i }))

    expect(await screen.findByText('en: cat')).toBeInTheDocument()
    expect(gapControl('en')).toBeNull()
  })

  // One backfill at a time: addingKey is a page-global lock, so a second click
  // anywhere cannot start a competing AI call.
  it('locks every gap control while one backfill is in flight', async () => {
    const kot = createEntry('kot', { languages: ['en'] })
    const pies = createEntry('pies', { languages: ['en'] })
    await renderPage(createCollection({
      targetLanguageCodes: ['en', 'de'],
      entries: [kot, pies]
    }))
    const pending = deferred<Entry>()
    vi.mocked(addEntryTranslation).mockReturnValue(pending.promise)

    fireEvent.click(within(entryItem('kot')).getByRole('button', { name: /^add de$/i }))

    expect(await screen.findByRole('button', { name: 'Adding…' })).toBeInTheDocument()
    expect(within(entryItem('pies')).getByRole('button', { name: /^add de$/i })).toBeDisabled()

    await act(async () => {
      pending.resolve(backfilledEntry(kot, 'de', 'Katze', 'Die Katze schläft.'))
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

  // D-2: a backfill can add a word to more than one meaning at once. The page
  // does not merge per meaning — it just takes whatever entry the server
  // returns — so both new words show up from a single replacement.
  it('shows every meaning\'s new word when a backfill covers more than one', async () => {
    const zamek = createEntry('zamek', {
      senses: [
        createSense('budowla obronna', { languageCodes: ['en'] }),
        createSense('zamknięcie drzwi', { languageCodes: ['en'] })
      ]
    })
    await renderPage(createCollection({
      targetLanguageCodes: ['en', 'fr'],
      entries: [zamek]
    }))
    const updated: Entry = {
      ...zamek,
      senses: zamek.senses.map((sense) => ({
        ...sense,
        translations: [...sense.translations, createTranslation('fr', { meaningText: `fr-${sense.glossText}`, sentences: [createSentence({ sentenceText: `fr sentence for ${sense.glossText}` })] })]
      }))
    }
    vi.mocked(addEntryTranslation).mockResolvedValue(updated)

    fireEvent.click(screen.getByRole('button', { name: /^add fr$/i }))

    expect(await screen.findByText('fr: fr-budowla obronna')).toBeInTheDocument()
    expect(screen.getByText('fr: fr-zamknięcie drzwi')).toBeInTheDocument()
  })
})
