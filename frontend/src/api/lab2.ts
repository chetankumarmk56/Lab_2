import { jsonPost, request } from './client'
import type { PermitAnswer } from '../types'

export const askPermits = (question: string) =>
  request<PermitAnswer>('/api/lab2/ask', jsonPost({ question }))
