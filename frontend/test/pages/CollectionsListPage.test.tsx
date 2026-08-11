import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import CollectionsListPage from '../../src/pages/CollectionsListPage'
import type { Collection } from '../../src/api/collections'

// Two things live here. The recovery cases exist because of the defect
// context/foundation/lessons.md records under "Clearing a failure signal
// doesn't restore the view it was raised over": after a failed load,
// `collections` stayed [] and a successful create appended to it, showing the
// user one collection as their complete list. The form cases cover the
// language coupling — the picker must not be able to build a request the API
// would reject (native language as its own target, or more than five targets).

vi.mock('../../src/api/collections', () => ({
  listCollections: vi.fn(),
  createCollection: vi.fn(),
  getCollection: vi.fn(),
  addEntryTranslation: vi.fn()
}))

const { listCollections, createCollection } = await import('../../src/api/collections')

let sequence = 0

function collection (name: string, overrides: Partial<Collection> = {}): Collection {
  sequence += 1
  return {
    id: `collection-${sequence}`,
    name,
    nativeLanguageCode: 'en',
    targetLanguageCodes: ['pl'],
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides
  }
}

async function renderPage (): Promise<void> {
  render(
    <MemoryRouter>
      <CollectionsListPage />
    </MemoryRouter>
  )
  await screen.findByRole('heading', { name: 'Your collections' })
}

function targetCheckbox (label: string): HTMLInputElement {
  return screen.getByRole('checkbox', { name: label })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(listCollections).mockResolvedValue([])
})

describe('CollectionsListPage load recovery', () => {
  it('offers a retry when the list fails to load', async () => {
    vi.mocked(listCollections).mockRejectedValue(new Error('offline'))

    await renderPage()

    expect(screen.getByText('Request failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    // "No collections yet." would be a claim about the server that this page
    // is in no position to make.
    expect(screen.queryByText('No collections yet.')).not.toBeInTheDocument()
  })

  it('keeps the error and the retry when the retry also fails', async () => {
    vi.mocked(listCollections).mockRejectedValue(new Error('offline'))
    await renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByText('Request failed')).toBeInTheDocument()
  })

  it('recovers the list on a successful retry', async () => {
    vi.mocked(listCollections)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([collection('Polski'), collection('Русский')])
    await renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('link', { name: 'Polski' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Русский' })).toBeInTheDocument()
    expect(screen.queryByText('Request failed')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  // The case the lesson was written about: without the retry, this ends with a
  // single collection rendered as the user's complete list.
  it('shows every collection after a failed load, a retry and a create', async () => {
    const existing = [collection('Polski'), collection('Русский')]
    const created = collection('Deutsch')
    vi.mocked(listCollections)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(existing)
      .mockResolvedValue([...existing, created])
    vi.mocked(createCollection).mockResolvedValue(created)
    await renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('link', { name: 'Polski' })

    fireEvent.change(screen.getByPlaceholderText('Collection name'), { target: { value: 'Deutsch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByRole('link', { name: 'Deutsch' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Polski' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Русский' })).toBeInTheDocument()
  })

  // A create that succeeds while the list is still broken proves the server is
  // reachable, so the real list is fetched rather than the one new row being
  // rendered as if it were all of them.
  it('fetches the real list when a create succeeds while the load is still failing', async () => {
    const existing = [collection('Polski'), collection('Русский')]
    const created = collection('Deutsch')
    vi.mocked(listCollections)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([...existing, created])
    vi.mocked(createCollection).mockResolvedValue(created)
    await renderPage()

    fireEvent.change(screen.getByPlaceholderText('Collection name'), { target: { value: 'Deutsch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByRole('link', { name: 'Polski' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Deutsch' })).toBeInTheDocument()
  })
})

describe('CollectionsListPage language picker', () => {
  it('drops the newly chosen native language from the picked targets', async () => {
    await renderPage()
    // Defaults are native English with Polish picked as a target.
    expect(targetCheckbox('Polish')).toBeChecked()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pl' } })

    // Polish is now the native language, so it is no longer offered — and the
    // backend rejects a collection whose native language is also a target.
    expect(screen.queryByRole('checkbox', { name: 'Polish' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('caps the picked targets at five', async () => {
    await renderPage()

    for (const label of ['Russian', 'German', 'French', 'Spanish']) {
      fireEvent.click(targetCheckbox(label))
    }

    expect(screen.getByText('I\'m learning (5 of 5)')).toBeInTheDocument()
    expect(targetCheckbox('Italian')).toBeDisabled()
    // Already-picked ones stay clickable, so the choice is reversible.
    expect(targetCheckbox('Russian')).toBeEnabled()

    fireEvent.click(targetCheckbox('Russian'))

    expect(targetCheckbox('Italian')).toBeEnabled()
  })

  it('will not submit a collection with no target language', async () => {
    await renderPage()

    fireEvent.click(targetCheckbox('Polish'))

    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()

    fireEvent.click(targetCheckbox('German'))

    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
  })
})
