import { filePost, request } from './client'
import type {
  BaselineInfoResult,
  BaselineMutationResult,
  ShiftReportResult,
} from '../types'

export const generateShiftReport = (file: File) =>
  request<ShiftReportResult>('/api/lab1/generate', filePost('file', file))

export const setPreviousShift = (file: File) =>
  request<BaselineMutationResult>('/api/lab1/set-previous', filePost('file', file))

export const resetBaseline = () =>
  request<BaselineMutationResult>('/api/lab1/reset-previous', { method: 'POST' })

export const getBaselineInfo = () =>
  request<BaselineInfoResult>('/api/lab1/baseline-info')
