/** Lab 7 — Deep Research (orchestration) types. Mirrors backend/app/routers/lab7.py. */

export interface ResearchAngle {
  id: number
  title: string
  objective: string
  queries: string[]
}

export interface ResearchPlan {
  restated_goal: string
  synthesis_focus: string
  angles: ResearchAngle[]
}

/** Response from POST /api/lab7/plan. */
export interface PlanResponse {
  plan: ResearchPlan | null
  error: string | null
  cost_usd?: number
}

/** Model tiering + safety caps from GET /api/lab7/config. */
export interface Lab7Config {
  orchestrator_model: string
  researcher_model: string
  max_breadth: number
  worker_concurrency: number
  worker_max_turns: number
  dyn_max_researchers: number
  dyn_max_turns: number
}

export interface ResearchFinding {
  claim: string
  source_title: string
  url: string
  quote: string
}

export interface ResearchSource {
  n: number
  title: string
  url: string
}

export interface CriticIssue {
  excerpt: string
  problem: string
}

export type ResearchStage = 'research' | 'synthesize' | 'verify' | 'revise'

/** One NDJSON event from /run/stream (planned) or /run-dynamic/stream (agent loop).
 *  `turn` fields and the turn/budget/note events only occur in agent-loop mode. */
export type ResearchEvent =
  | { type: 'stage'; stage: ResearchStage; status: 'start'; workers?: number }
  | { type: 'worker'; angle_id: number; status: 'running'; title: string; turn?: number }
  | { type: 'tool'; angle_id: number; kind: 'search' | 'fetch' | 'tool'; label: string; turn?: number }
  | {
      type: 'worker_done'
      angle_id: number
      title: string
      ms: number
      searches: number
      fetches: number
      summary: string
      findings: ResearchFinding[]
      error: string | null
      turn?: number
      cost_usd?: number
      usage?: { input_tokens: number; output_tokens: number }
    }
  | { type: 'sources'; sources: ResearchSource[] }
  | { type: 'report'; revision: number; report_md: string; ms: number; cost_usd?: number }
  | {
      type: 'verdict'
      verdict: 'approved' | 'needs_revision'
      confidence: number | null
      issues: CriticIssue[]
      error: string | null
      ms: number
      attempt?: number
      cost_usd?: number
    }
  | { type: 'turn'; n: number; thought: string; tool: string; detail: string }
  | { type: 'budget'; researchers_used: number; researchers_max: number }
  | { type: 'note'; text: string }
  | { type: 'run_meta'; run_id: string; mode: 'planned' | 'loop'; question: string; started_at: string }
  | { type: 'citations'; cited: number[]; invalid: number[]; total_sources: number }
  | {
      type: 'done'
      error: string | null
      totals: { ms: number; agents: number; tool_calls: number; iterations?: number; cost_usd?: number }
    }

/** One recorded run, as listed by GET /api/lab7/runs. */
export interface RunSummary {
  run_id: string
  mode: 'planned' | 'loop'
  question: string
  started_at: string | null
  finished: boolean
  ok: boolean
  error: string | null
  totals: { ms: number; agents: number; tool_calls: number; iterations?: number; cost_usd?: number } | null
  has_report: boolean
}

/** The full recorded stream of one run (GET /api/lab7/runs/{id}) — replay fuel. */
export interface RecordedRun {
  run_id: string
  events: { t: number; event: ResearchEvent }[]
}
