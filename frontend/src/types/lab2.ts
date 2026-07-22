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
