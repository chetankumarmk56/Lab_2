import { jsonPost, request } from './client'
import type {
  ApprovePayload,
  ApproveResult,
  CreateWorkOrderPayload,
  CreateWorkOrderResult,
  QueueResult,
  TriageResult,
} from '../types'

export const getQueue = () => request<QueueResult>('/api/lab3/queue')

export const createWorkOrder = (payload: CreateWorkOrderPayload) =>
  request<CreateWorkOrderResult>('/api/lab3/work-orders', jsonPost(payload))

export const triageWorkOrders = () =>
  request<TriageResult>('/api/lab3/triage', { method: 'POST' })

export const resetTriage = () =>
  request<{ ok: boolean }>('/api/lab3/reset', { method: 'POST' })

export const approveAssignment = (payload: ApprovePayload) =>
  request<ApproveResult>('/api/lab3/approve', jsonPost(payload))
