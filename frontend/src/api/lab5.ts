import { jsonPost, request } from './client'
import type {
  ConnectionsResult,
  DeployResult,
  DriversResult,
  Lab5QueryResult,
  SaveConnectionPayload,
  SaveConnectionResult,
  TestConnectionResult,
  VerifyResult,
} from '../types'

export const getDrivers = () => request<DriversResult>('/api/lab5/drivers')

export const getConnections = () => request<ConnectionsResult>('/api/lab5/connections')

export const saveConnection = (payload: SaveConnectionPayload) =>
  request<SaveConnectionResult>('/api/lab5/connections', jsonPost(payload))

export const testConnection = (id: number) =>
  request<TestConnectionResult>(`/api/lab5/connections/${id}/test`, { method: 'POST' })

export const deployServer = (id: number) =>
  request<DeployResult>(`/api/lab5/connections/${id}/deploy`, { method: 'POST' })

export const verifyServer = (id: number) =>
  request<VerifyResult>(`/api/lab5/connections/${id}/verify`, { method: 'POST' })

export const queryConnection = (id: number, question: string) =>
  request<Lab5QueryResult>(`/api/lab5/connections/${id}/query`, jsonPost({ question }))

export const deleteConnection = (id: number) =>
  request<{ ok: boolean }>(`/api/lab5/connections/${id}`, { method: 'DELETE' })
