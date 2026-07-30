import { apiClient } from './client'

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
}

export interface EntrySentence {
  id: string
  languageCode: string
  sentenceText: string
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

export async function getCollection (id: string): Promise<CollectionDetail> {
  const res = await apiClient.get<CollectionDetail>(`/api/collections/${id}`)
  return res.data
}
