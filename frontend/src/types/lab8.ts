/** Lab 8 — Eval Harness types. Mirrors backend/app/routers/lab8.py. */

export interface EvalSuiteMeta {
  suite: string
  title: string
  description: string
  target: string
  heavy: boolean
  case_count: number
  case_ids: string[]
}

export interface EvalSuitesResponse {
  suites: EvalSuiteMeta[]
  configured_model: string
  model_options: string[]
}

/** One grader verdict: deterministic check or the LLM judge (with reasoning). */
export interface EvalCheck {
  name: string
  pass: boolean
  detail: string
}

export interface EvalCaseResult {
  case_id: string
  question: string
  pass: boolean
  checks: EvalCheck[]
  cost_usd: number
  ms: number
  preview: string
}

export interface EvalSuiteResult {
  suite: string
  title: string
  passed: number
  failed: number
  cost_usd: number
  ms: number
  cases: EvalCaseResult[]
}

export interface EvalTotals {
  cases: number
  passed: number
  failed: number
  cost_usd: number
  ms: number
}

export interface EvalRegression {
  compared_to: string | null
  compared_model: string | null
  shared_cases: number
  regressions: string[]
  fixes: string[]
}

/** One stored eval run (GET /api/lab8/results). */
export interface EvalRunSummary {
  run_id: string
  started_at: string
  model: string
  model_overridden: boolean
  judge: boolean
  totals: EvalTotals
  suites: EvalSuiteResult[]
  regression: EvalRegression | null
}

/** One NDJSON event from POST /api/lab8/run/stream. */
export type EvalEvent =
  | {
      type: 'run_meta'
      run_id: string
      model: string
      model_overridden: boolean
      judge: boolean
      suites: string[]
      started_at: string
    }
  | { type: 'suite_start'; suite: string; title: string; cases: number }
  | { type: 'case_start'; suite: string; case_id: string; question: string }
  | ({ type: 'case_done'; suite: string } & EvalCaseResult)
  | { type: 'suite_done'; suite: string; title: string; passed: number; failed: number; cost_usd: number; ms: number }
  | { type: 'done'; run_id: string; error: string | null; totals: EvalTotals; regression: EvalRegression | null }
