import { request } from './client'
import type { GenerateJobAidResult, TemplatesResult } from '../types'

export const getLab4Templates = () =>
  request<TemplatesResult>('/api/lab4/templates')

export const generateJobAid = (form: FormData) =>
  request<GenerateJobAidResult>('/api/lab4/generate', { method: 'POST', body: form })
