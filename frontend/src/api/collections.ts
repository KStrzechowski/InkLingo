import { AI_REQUEST_TIMEOUT_MS, apiClient } from './client'

export interface Collection {
  id: string
  name: string
  nativeLanguageCode: string
  targetLanguageCodes: string[]
  createdAt: string
}

export interface EntryTranslation {
  id: string
  languageCode: string
  meaningText: string
  phoneticTranscription: string | null
}

export interface EntrySentence {
  id: string
  languageCode: string
  sentenceText: string
  nativeGlossText: string | null
  createdAt: string
}

export interface Entry {
  id: string
  wordOrPhrase: string
  sourceLanguageCode: string
  createdAt: string
  translations: EntryTranslation[]
  sentences: EntrySentence[]
}

export interface CollectionDetail extends Collection {
  entries: Entry[]
}

export async function listCollections (): Promise<Collection[]> {
  const res = await apiClient.get<{ collections: Collection[] }>('/api/collections')
  return res.data.collections
}

export async function createCollection (name: string, nativeLanguageCode: string, targetLanguageCodes: string[]): Promise<Collection> {
  const res = await apiClient.post<Collection>('/api/collections', { name, nativeLanguageCode, targetLanguageCodes })
  return res.data
}

export interface AddedEntryTranslation {
  entryId: string
  translation: EntryTranslation
  sentence: EntrySentence
}

export async function getCollection (id: string): Promise<CollectionDetail> {
  const res = await apiClient.get<CollectionDetail>(`/api/collections/${id}`)
  return res.data
}

// FR-018: backfill one existing entry with a language the collection gained
// after that entry was saved. One entry, one language, user-triggered.
export async function addEntryTranslation (
  collectionId: string,
  entryId: string,
  languageCode: string
): Promise<AddedEntryTranslation> {
  const res = await apiClient.post<AddedEntryTranslation>(
    `/api/collections/${collectionId}/entries/${entryId}/translations`,
    { languageCode },
    // This one waits on a live model call, so it gets the long deadline rather
    // than the client's 8s default — otherwise we abandon a generation the
    // server is still completing. Deliberately not replaySafe: abandoning it is
    // exactly what must not happen twice.
    { timeout: AI_REQUEST_TIMEOUT_MS }
  )
  return res.data
}
