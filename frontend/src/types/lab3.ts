import type { ToolCall } from './agent'

export type Urgency = 'safety' | 'production-stopping' | 'routine'

/** A maintenance work order, optionally enriched with the agent's triage proposal. */
export interface WorkOrder {
  id: number
  wo_number: string
  machine: string
  description: string
  submitted_by?: string
  submitted_at?: string
  status: string
  crew?: string | null
  urgency?: string | null
  approved_by?: string | null
  assigned_at?: string | null
  /* Filled in by /triage (the agent's proposal — not yet written). */
  proposed_urgency?: Urgency | null
  proposed_crew?: string | null
  reason?: string | null
}

/** Response from GET /api/lab3/queue. */
export interface QueueResult {
  orders: WorkOrder[]
}

/** Response from POST /api/lab3/triage. */
export interface TriageResult {
  orders: WorkOrder[]
  tool_calls: ToolCall[]
  raw: string
  error: string | null
}

/** Payload for POST /api/lab3/approve (the human-in-the-loop write). */
export interface ApprovePayload {
  work_order_id: number
  crew: string
  urgency: string
  approved_by?: string
}

/** Response from POST /api/lab3/approve. */
export interface ApproveResult {
  ok: boolean
  assignment_id?: number
  assigned_at?: string
  error?: string
}

/** Payload for POST /api/lab3/work-orders (an operator filing a request). */
export interface CreateWorkOrderPayload {
  machine: string
  description: string
  submitted_by?: string
}

/** Response from POST /api/lab3/work-orders. */
export interface CreateWorkOrderResult {
  ok: boolean
  order: WorkOrder
}
