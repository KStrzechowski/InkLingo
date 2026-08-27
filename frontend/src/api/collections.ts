import { AI_REQUEST_TIMEOUT_MS, apiClient } from './client'

export interface Collection {
  id: string
  name: string
  nativeLanguageCode: string
  targetLanguageCodes: string[]
  createdAt: string
}

// A sentence has no `languageCode` of its own — it belongs to its
// translation, so a cross-wired sentence is unrepresentable on the wire
// exactly as it is in the backend's domain (`backend/src/domain/sense.ts`).
export interface EntrySentence {
  id: string
  sentenceText: string
  nativeGlossText: string
}

// One word for one meaning in one target language.
export interface EntryTranslation {
  id: string
  languageCode: string
  meaningText: string
  phoneticTranscription: string | null
  sentences: EntrySentence[]
}

// One distinct meaning of the entry, named in the native language via
// `glossText`, holding one translation per target language that has a word
// for it — a language absent from `translations` is a legal sparse spoke.
export interface EntrySense {
  id: string
  glossText: string
  translations: EntryTranslation[]
}

export interface Entry {
  id: string
  wordOrPhrase: string
  sourceLanguageCode: string
  createdAt: string
  senses: EntrySense[]
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

export async function getCollection (id: string): Promise<CollectionDetail> {
  const res = await apiClient.get<CollectionDetail>(`/api/collections/${id}`)
  return res.data
}

// FR-018: backfill one existing entry with a language the collection gained
// after that entry was saved. One entry, one language, user-triggered.
//
// Returns the whole updated entry (decision A9), not a partial shape the
// caller merges by hand — under D-2 the backfill can add a word to several
// meanings at once, so there is no single "the translation" left to name.
export async function addEntryTranslation (
  collectionId: string,
  entryId: string,
  languageCode: string
): Promise<Entry> {
  const res = await apiClient.post<Entry>(
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
