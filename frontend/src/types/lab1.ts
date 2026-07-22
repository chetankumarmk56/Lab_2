import type { AgentResult } from './agent'

/** Time span (ISO timestamps) covered by a baseline shift log. */
export interface BaselineSpan {
  start: string
  end: string
}

/** Metadata about the current "previous shift" baseline (never the raw CSV). */
export interface BaselineInfo {
  source_name: string
  updated_at: string
  row_count: number
  line_count: number
  span: BaselineSpan | null
}

/** Response from POST /api/lab1/generate — the report plus the baseline it used. */
export interface ShiftReportResult extends AgentResult {
  baseline?: BaselineInfo
}

/** Response from set-previous / reset-previous. */
export interface BaselineMutationResult {
  ok: boolean
  baseline: BaselineInfo
}

/** Response from GET /api/lab1/baseline-info. */
export interface BaselineInfoResult {
  baseline: BaselineInfo
}
