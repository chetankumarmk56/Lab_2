/** A cell value returned from a permit SELECT query. */
export type Cell = string | number | boolean | null

/** The tabular result of the SQL the agent ran. */
export interface ResultTable {
  ok: boolean
  columns: string[]
  rows: Cell[][]
  error?: string
}

/** Response from POST /api/lab2/ask. */
export interface PermitAnswer {
  answer: string
  sql: string | null
  table: ResultTable | null
  error: string | null
}

/** Dataset summary from GET /api/lab2/dataset — powers the "what can I ask" hint. */
export interface PermitDataset {
  total: number
  types: { name: string; count: number }[]
  statuses: { name: string; count: number }[]
  date_range: { min: string | null; max: string | null }
}

/** One newline-delimited event from POST /api/lab2/ask/stream. */
export type PermitStreamEvent =
  | { type: 'status'; phase: 'writing' | 'running' }
  | { type: 'sql'; sql: string }
  | { type: 'table'; table: ResultTable }
  | { type: 'answer_reset' }
  | { type: 'delta'; text: string }
  | { type: 'done'; answer: string; sql: string | null; refused: boolean; error: string | null }
