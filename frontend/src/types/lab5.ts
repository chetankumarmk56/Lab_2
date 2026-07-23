/** Lab 5 — On-the-Fly MCP Server Builder types. */

export interface DriverInfo {
  id: string
  label: string
  available: boolean
  default_port: number
  reduced_guarantees: boolean
}
export interface DriversResult {
  drivers: DriverInfo[]
}

/** Connection metadata — the API NEVER returns the password or ciphertext. */
export interface ConnectionMeta {
  id: number
  name: string | null
  driver: string
  host: string
  port: number
  database: string
  username: string
  ssl_mode: string | null
  status: string
  last_error_category: string | null
  last_verified_at: string | null
  created_at: string
  updated_at: string
}
export interface ConnectionsResult {
  connections: ConnectionMeta[]
}

export interface SaveConnectionPayload {
  driver: string
  host: string
  port: number
  database: string
  username: string
  password: string
  name?: string
  ssl_mode?: string
}
export interface SaveConnectionResult {
  id: number
  connection: ConnectionMeta
}

export interface TestConnectionResult {
  ok: boolean
  category: string
  message: string
}

export interface DeployResult {
  ok: boolean
  status: string
  server_url?: string
  tool_ids?: string[]
  logs: string[]
  code?: string
  error?: string
}

export interface VerifyCheck {
  label: string
  ok: boolean
  detail?: string
}
export interface VerifyResult {
  ok: boolean
  checks: VerifyCheck[]
}

export type QueryCell = string | number | boolean | null
export interface QueryTable {
  ok: boolean
  columns: string[]
  rows: QueryCell[][]
}
export interface Lab5QueryResult {
  answer: string
  sql: string | null
  table: QueryTable | null
  error: string | null
}
