import { filePost, jsonPost, request } from './client'
import type { RagAskResponse, RagChunk, RagCorpus, RagUploadResponse } from '../types'

export const getRagCorpus = () => request<RagCorpus>('/api/lab6/corpus')

export const getRagChunks = (docId: string) =>
  request<{ doc_id: string; chunks: RagChunk[] }>(`/api/lab6/chunks/${docId}`)

export const askRag = (question: string, k: number, retrieveOnly: boolean) =>
  request<RagAskResponse>('/api/lab6/ask', jsonPost({ question, k, retrieve_only: retrieveOnly }))

export const reindexRag = () => request<RagCorpus>('/api/lab6/reindex', { method: 'POST' })

export const uploadRagDoc = (file: File) =>
  request<RagUploadResponse>('/api/lab6/upload', filePost('file', file))

export const deleteRagDoc = (docId: string) =>
  request<RagCorpus>(`/api/lab6/docs/${docId}`, { method: 'DELETE' })
