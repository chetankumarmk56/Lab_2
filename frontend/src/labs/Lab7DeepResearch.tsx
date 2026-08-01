import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  deleteRun,
  getLab7Config,
  getRunEvents,
  listRuns,
  planResearch,
  runDynamicResearchStream,
  runResearchStream,
} from '../api'
import Markdown from '../components/Markdown'
import { ArrowRight, ArrowUp, Check, Lock, Play, Reset, Trash } from '../components/icons'
import type {
  CriticIssue,
  Lab7Config,
  ResearchEvent,
  ResearchFinding,
  ResearchPlan,
  ResearchSource,
  ResearchStage,
  RunSummary,
} from '../types'

const EXAMPLES = [
  'What are current best practices for securing MCP servers?',
  'How are governments using AI to speed up building-permit review?',
  'pgvector vs dedicated vector databases for small RAG systems — where is the tradeoff line?',
]

/** Planned mode: the workflow pattern, as a picture. */
const PIPELINE = [
  { n: 1, name: 'Plan', what: 'The planner decomposes your question into independent angles.', why: 'The model plans; code executes the plan.' },
  { n: 2, name: 'Approve', what: 'You review the plan — trim angles, then run it.', why: 'The human gate: nothing executes until approved.' },
  { n: 3, name: 'Research ×N', what: 'Parallel researchers, each with web tools only.', why: 'Independent sub-questions are the honest reason to parallelize.' },
  { n: 4, name: 'Synthesize', what: 'One writer merges all findings into a cited brief.', why: 'One citation space across every worker.' },
  { n: 5, name: 'Verify', what: 'An adversarial critic checks the brief against the evidence.', why: 'Trust comes from refutation attempts, not confidence.' },
]

/** Agent-loop mode: the loop itself, as a picture. */
const LOOP_PIPELINE = [
  { n: 1, name: 'Think', what: 'The lead writes a decision log: what it knows, what is missing.', why: 'The loop is visible because the reasoning is.' },
  { n: 2, name: 'Act', what: 'It chooses ONE of its tools: delegate_research, submit_draft, finalize.', why: 'Agency = choosing among alternatives, every iteration.' },
  { n: 3, name: 'Observe', what: 'Tool results come back — findings, verdicts, or refusals.', why: 'Next decisions are grounded in what actually happened.' },
  { n: 4, name: 'Repeat / Finish', what: 'Loop until finalize — which code refuses until a draft passed verification.', why: 'The model drives; the rails are code.' },
]

const STAGE_LABELS: Record<ResearchStage, string> = {
  research: 'Research',
  synthesize: 'Synthesize',
  verify: 'Verify',
  revise: 'Revise',
}
const STAGE_ORDER: ResearchStage[] = ['research', 'synthesize', 'verify', 'revise']

type Mode = 'planned' | 'loop'

interface WorkerView {
  title: string
  status: 'pending' | 'running' | 'done' | 'failed'
  activity: { kind: string; label: string }[]
  ms?: number
  searches?: number
  fetches?: number
  summary?: string
  findings?: ResearchFinding[]
  error?: string | null
  cost_usd?: number
}

interface LoopTurn {
  n: number
  thought: string
  tool: string
  detail: string
  workerIds: number[]
}

interface VerdictView {
  verdict: 'approved' | 'needs_revision'
  confidence: number | null
  issues: CriticIssue[]
  error: string | null
  attempt?: number
}

interface RunState {
  stage: ResearchStage | null
  stagesDone: ResearchStage[]
  workers: Record<number, WorkerView>
  turns: LoopTurn[]
  budget: { used: number; max: number } | null
  notes: string[]
  sources: ResearchSource[]
  reports: { revision: number; report_md: string }[]
  verdicts: VerdictView[]
  citations: { cited: number[]; invalid: number[]; total_sources: number } | null
  runId: string | null
  totals: { ms: number; agents: number; tool_calls: number; iterations?: number; cost_usd?: number } | null
  error: string | null
}

const blankRun = (): RunState => ({
  stage: null,
  stagesDone: [],
  workers: {},
  turns: [],
  budget: null,
  notes: [],
  sources: [],
  reports: [],
  verdicts: [],
  citations: null,
  runId: null,
  totals: null,
  error: null,
})

function CitationsFlag({ c }: { c: NonNullable<RunState['citations']> }) {
  return c.invalid.length === 0 ? (
    <span className="l6-flag l6-flag-ok">
      <Check width={11} height={11} /> citations valid · cites {c.cited.length} of{' '}
      {c.total_sources} sources
    </span>
  ) : (
    <span className="l6-flag l6-flag-warn">
      invalid citation numbers: {c.invalid.map((n) => `[${n}]`).join(' ')}
    </span>
  )
}

function StageRail({ run }: { run: RunState }) {
  const visible = STAGE_ORDER.filter(
    (s) => s !== 'revise' || run.stage === 'revise' || run.stagesDone.includes('revise'),
  )
  return (
    <div className="l7-rail">
      {visible.map((s, i) => {
        const state = run.stagesDone.includes(s) ? 'done' : run.stage === s ? 'active' : 'pending'
        return (
          <span key={s} className="l7-rail-item">
            {i > 0 && <ArrowRight width={12} height={12} className="l7-rail-arrow" />}
            <span className={`l7-rail-chip is-${state}`}>
              {state === 'active' && <span className="spinner" />}
              {state === 'done' && <Check width={11} height={11} />}
              {STAGE_LABELS[s]}
            </span>
          </span>
        )
      })}
    </div>
  )
}

function WorkerCard({ id, w, model }: { id: number; w: WorkerView; model: string }) {
  return (
    <div className={`l7-worker is-${w.status}`}>
      <div className="l7-worker-head">
        <span className="l6-pipe-num">{id}</span>
        <b>{w.title}</b>
        <span className="l7-worker-tag">{model}</span>
        <span className="l7-worker-state">
          {w.status === 'running' && <span className="spinner" />}
          {w.status === 'done' && <Check width={12} height={12} />}
          {w.status === 'failed' && '✕'}
          {w.status === 'pending' && 'queued'}
        </span>
      </div>

      {w.activity.length > 0 && (
        <div className="l7-feed">
          {w.activity.slice(-6).map((a, i) => (
            <div key={i} className="l7-feed-line" title={a.label}>
              <em>{a.kind}</em> {a.label}
            </div>
          ))}
        </div>
      )}

      {w.status === 'done' && (
        <>
          <p className="l7-worker-sum">{w.summary || 'No summary returned.'}</p>
          <div className="l7-worker-meta">
            {w.searches} searches · {w.fetches} fetches · {(w.findings ?? []).length} findings ·{' '}
            {((w.ms ?? 0) / 1000).toFixed(1)} s
            {w.cost_usd != null && w.cost_usd > 0 ? ` · $${w.cost_usd.toFixed(3)}` : ''}
          </div>
          {(w.findings ?? []).length > 0 && (
            <details className="l7-findings">
              <summary>findings</summary>
              {(w.findings ?? []).map((f, i) => (
                <div key={i} className="l7-finding">
                  <p>{f.claim}</p>
                  <a href={f.url} target="_blank" rel="noreferrer">
                    {f.source_title || f.url}
                  </a>
                  {f.quote && <em> — “{f.quote}”</em>}
                </div>
              ))}
            </details>
          )}
        </>
      )}
      {w.status === 'failed' && (
        <p className="l7-worker-err">Worker failed — {w.error}. The run continues without it.</p>
      )}
    </div>
  )
}

function VerdictFlags({ v }: { v: VerdictView }) {
  return v.verdict === 'approved' ? (
    <span className="l6-flag l6-flag-ok">
      <Check width={11} height={11} /> verified against the evidence
      {v.confidence != null && ` · confidence ${v.confidence}`}
    </span>
  ) : (
    <span className="l6-flag l6-flag-warn">
      critic found {v.issues.length} {v.issues.length === 1 ? 'issue' : 'issues'}
    </span>
  )
}

export default function Lab7DeepResearch() {
  const [config, setConfig] = useState<Lab7Config | null>(null)
  const [mode, setMode] = useState<Mode>('planned')
  const [question, setQuestion] = useState('')
  const [breadth, setBreadth] = useState(3)
  const [planning, setPlanning] = useState(false)
  const [plan, setPlan] = useState<ResearchPlan | null>(null)
  const [included, setIncluded] = useState<Set<number>>(new Set())
  const [running, setRunning] = useState(false)
  const [run, setRun] = useState<RunState | null>(null)
  const [error, setError] = useState('')
  const [dynBudget, setDynBudget] = useState(6)
  const [planCost, setPlanCost] = useState<number | null>(null)
  const [historyRuns, setHistoryRuns] = useState<RunSummary[]>([])
  const [replaying, setReplaying] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const replayCancelRef = useRef(false)

  function refreshHistory() {
    listRuns()
      .then((r) => setHistoryRuns(r.runs))
      .catch(() => {/* history panel is an enhancement — ignore */})
  }

  useEffect(() => {
    getLab7Config().then(setConfig).catch(() => {/* header enhancement only */})
    refreshHistory()
  }, [])

  function switchMode(next: Mode) {
    if (running || planning || next === mode) return
    setMode(next)
    setPlan(null)
    setRun(null)
    setError('')
  }

  /** One reducer for both modes — the event stream is the shared contract. */
  function makeEventHandler(patch: (fn: (s: RunState) => void) => void) {
    const ensureWorker = (s: RunState, id: number, title = `Researcher ${id}`) => {
      if (!s.workers[id]) s.workers[id] = { title, status: 'pending', activity: [] }
      return s.workers[id]
    }
    return (ev: ResearchEvent) => {
      switch (ev.type) {
        case 'stage':
          patch((s) => {
            if (s.stage && !s.stagesDone.includes(s.stage)) s.stagesDone.push(s.stage)
            s.stage = ev.stage
          })
          break
        case 'turn':
          patch((s) => {
            s.turns.push({ n: ev.n, thought: ev.thought, tool: ev.tool, detail: ev.detail, workerIds: [] })
          })
          break
        case 'budget':
          patch((s) => {
            s.budget = { used: ev.researchers_used, max: ev.researchers_max }
          })
          break
        case 'note':
          patch((s) => {
            s.notes.push(ev.text)
          })
          break
        case 'run_meta':
          patch((s) => {
            s.runId = ev.run_id
          })
          break
        case 'citations':
          patch((s) => {
            s.citations = { cited: ev.cited, invalid: ev.invalid, total_sources: ev.total_sources }
          })
          break
        case 'worker':
          patch((s) => {
            const w = ensureWorker(s, ev.angle_id, ev.title)
            s.workers[ev.angle_id] = { ...w, title: ev.title, status: 'running' }
            if (ev.turn != null) {
              const t = s.turns.find((x) => x.n === ev.turn)
              if (t && !t.workerIds.includes(ev.angle_id)) t.workerIds.push(ev.angle_id)
            }
          })
          break
        case 'tool':
          patch((s) => {
            const w = ensureWorker(s, ev.angle_id)
            s.workers[ev.angle_id] = {
              ...w,
              activity: [...w.activity, { kind: ev.kind, label: ev.label }],
            }
          })
          break
        case 'worker_done':
          patch((s) => {
            const w = ensureWorker(s, ev.angle_id, ev.title)
            s.workers[ev.angle_id] = {
              ...w,
              status: ev.error ? 'failed' : 'done',
              ms: ev.ms,
              searches: ev.searches,
              fetches: ev.fetches,
              summary: ev.summary,
              findings: ev.findings,
              error: ev.error,
              cost_usd: ev.cost_usd,
            }
          })
          break
        case 'sources':
          patch((s) => {
            s.sources = ev.sources
          })
          break
        case 'report':
          patch((s) => {
            s.reports.push({ revision: ev.revision, report_md: ev.report_md })
          })
          break
        case 'verdict':
          patch((s) => {
            s.verdicts.push({
              verdict: ev.verdict,
              confidence: ev.confidence,
              issues: ev.issues,
              error: ev.error,
              attempt: ev.attempt,
            })
          })
          break
        case 'done':
          patch((s) => {
            if (s.stage && !s.stagesDone.includes(s.stage)) s.stagesDone.push(s.stage)
            s.stage = null
            s.totals = ev.totals
            s.error = ev.error
          })
          break
      }
    }
  }

  function startRun(initial: RunState) {
    setRunning(true)
    setError('')
    setRun(initial)
    const patch = (fn: (s: RunState) => void) =>
      setRun((prev) => {
        if (!prev) return prev
        const next: RunState = {
          ...prev,
          workers: { ...prev.workers },
          turns: prev.turns.map((t) => ({ ...t, workerIds: [...t.workerIds] })),
          stagesDone: [...prev.stagesDone],
          notes: [...prev.notes],
          reports: [...prev.reports],
          verdicts: [...prev.verdicts],
        }
        fn(next)
        return next
      })
    return makeEventHandler(patch)
  }

  async function doPlan(q?: string) {
    const query = (q ?? question).trim()
    if (!query || planning || running) return
    setQuestion(query)
    setPlanning(true)
    setError('')
    setPlan(null)
    setPlanCost(null)
    setRun(null)
    try {
      const res = await planResearch(query, breadth)
      if (res.error || !res.plan) {
        setError(res.error || 'Planning failed.')
      } else {
        setPlan(res.plan)
        setPlanCost(res.cost_usd ?? null)
        setIncluded(new Set(res.plan.angles.map((a) => a.id)))
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPlanning(false)
    }
  }

  function stopRun() {
    abortRef.current?.abort()
    replayCancelRef.current = true
  }

  async function removeRun(runId: string) {
    try {
      await deleteRun(runId)
      refreshHistory()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  /** Replay a recorded run offline: same reducer, original pacing (gaps capped). */
  async function replayRun(summary: RunSummary) {
    if (running || planning) return
    setMode(summary.mode)
    setQuestion(summary.question)
    setPlan(null)
    setPlanCost(null)
    setError('')
    let recorded
    try {
      recorded = await getRunEvents(summary.run_id)
    } catch (e) {
      setError((e as Error).message)
      return
    }
    setReplaying(true)
    replayCancelRef.current = false
    const handler = startRun(blankRun())
    // Pace against a wall-clock schedule (gaps capped at 2.5s). Scheduling by
    // cumulative target — not by sleeping each gap — keeps the replay on time
    // even when the browser throttles timers; a hidden tab skips pacing.
    const start = performance.now()
    let prev = 0
    let scheduled = 0
    for (const { t, event } of recorded.events) {
      scheduled += Math.min(Math.max(t - prev, 0), 2500)
      prev = t
      if (!document.hidden) {
        const wait = scheduled - (performance.now() - start)
        if (wait > 15) await new Promise((r) => setTimeout(r, wait))
      }
      if (replayCancelRef.current) break
      handler(event)
    }
    setReplaying(false)
    setRunning(false)
  }

  function toggleAngle(id: number) {
    setIncluded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        if (next.size > 1) next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  async function runPlan() {
    if (!plan || running) return
    const approved: ResearchPlan = {
      ...plan,
      angles: plan.angles.filter((a) => included.has(a.id)),
    }
    const initial = blankRun()
    approved.angles.forEach((a, i) => {
      initial.workers[i + 1] = { title: a.title, status: 'pending', activity: [] }
    })
    const onEvent = startRun(initial)
    const ctl = new AbortController()
    abortRef.current = ctl
    try {
      await runResearchStream(question, approved, onEvent, ctl.signal)
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setRun((prev) =>
          prev ? { ...prev, stage: null, notes: [...prev.notes, 'Stopped by you — partial results kept.'] } : prev,
        )
      } else {
        setError((e as Error).message)
      }
    } finally {
      abortRef.current = null
      setRunning(false)
      refreshHistory()
    }
  }

  async function runLoop() {
    const query = question.trim()
    if (!query || running || planning) return
    const onEvent = startRun(blankRun())
    const ctl = new AbortController()
    abortRef.current = ctl
    try {
      await runDynamicResearchStream(query, dynBudget, onEvent, ctl.signal)
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setRun((prev) =>
          prev ? { ...prev, stage: null, notes: [...prev.notes, 'Stopped by you — partial results kept.'] } : prev,
        )
      } else {
        setError((e as Error).message)
      }
    } finally {
      abortRef.current = null
      setRunning(false)
      refreshHistory()
    }
  }

  const finalReport = run?.reports.length ? run.reports[run.reports.length - 1] : null
  const draftReport = run && run.reports.length > 1 ? run.reports[0] : null
  const lastVerdict = run?.verdicts.length ? run.verdicts[run.verdicts.length - 1] : null
  const strip = mode === 'planned' ? PIPELINE : LOOP_PIPELINE
  const maxBudget = config?.dyn_max_researchers ?? 6
  const budgetOptions = Array.from({ length: Math.max(maxBudget - 1, 1) }, (_, i) => i + 2)

  /** attempt number for the k-th submit_draft turn → its verdict. */
  function verdictForTurn(turn: LoopTurn): VerdictView | null {
    if (!run || turn.tool !== 'submit_draft') return null
    const attempt = run.turns.filter((t) => t.tool === 'submit_draft' && t.n <= turn.n).length
    return run.verdicts.find((v) => v.attempt === attempt) ?? null
  }

  return (
    <div className="panel l6-root">
      <div className="panel-head">
        <div className="eyebrow">
          Lab 07 <span className="sector-tag">Orchestration · Multi-agent</span>
        </div>
        <h2>Deep Research — orchestration in the open</h2>
        <p>
          Two ways to run the same agent team, side by side. <b>Planned</b>: code owns the
          control flow and executes an approved plan. <b>Agent loop</b>: the lead agent runs a
          live think → choose-a-tool → observe loop and decides everything itself — inside
          hard rails owned by code.
        </p>
        {config && (
          <div className="l6-hint">
            lead/planner/critic on <b>{config.orchestrator_model}</b> · researchers on{' '}
            <b>{config.researcher_model}</b> ·{' '}
            {mode === 'planned'
              ? `≤${config.worker_concurrency} workers in parallel · ≤${config.worker_max_turns} turns each`
              : `rails: ≤${config.dyn_max_researchers} researchers total · ≤${config.dyn_max_turns} lead turns · finalize gated on verification`}
          </div>
        )}
      </div>

      {/* ── Mode switch ────────────────────────────────────────────── */}
      <div className="l7-mode" role="tablist" aria-label="Orchestration mode">
        <button
          role="tab"
          aria-selected={mode === 'planned'}
          className={mode === 'planned' ? 'active' : ''}
          onClick={() => switchMode('planned')}
          disabled={running || planning}
        >
          Planned · workflow
          <span>deterministic: code runs an approved plan</span>
        </button>
        <button
          role="tab"
          aria-selected={mode === 'loop'}
          className={mode === 'loop' ? 'active' : ''}
          onClick={() => switchMode('loop')}
          disabled={running || planning}
        >
          Autonomous · agent loop
          <span>the lead agent decides each step, live</span>
        </button>
      </div>

      {/* ── The pattern, as a picture ──────────────────────────────── */}
      <div className={`l6-pipe ${mode === 'planned' ? 'l7-pipe5' : 'l7-pipe4'}`}>
        {strip.map((s) => (
          <div key={s.n} className="l6-pipe-card">
            <div className="l6-pipe-top">
              <span className="l6-pipe-num">{s.n}</span>
              <span className="l6-pipe-name">{s.name}</span>
              {mode === 'planned' && s.n === 2 && <span className="l6-pipe-ms">you</span>}
              {mode === 'loop' && s.n === 2 && <span className="l6-pipe-ms">3 tools</span>}
            </div>
            <p className="l6-pipe-what">{s.what}</p>
            <p className="l6-pipe-why">why: {s.why}</p>
          </div>
        ))}
      </div>

      {/* ── Question ───────────────────────────────────────────────── */}
      <form
        className="l6-ask"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          if (mode === 'planned') doPlan()
          else runLoop()
        }}
      >
        <label className="l6-vh" htmlFor="l7-q">
          Research question
        </label>
        <textarea
          id="l7-q"
          className="l6-input"
          rows={2}
          value={question}
          placeholder="Ask a research question…"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (mode === 'planned') doPlan()
              else runLoop()
            }
          }}
        />
        <div className="l6-controls">
          {mode === 'planned' ? (
            <>
              <label className="l6-ctl" title="How many parallel research angles the planner should propose.">
                breadth
                <select value={breadth} onChange={(e) => setBreadth(Number(e.target.value))}>
                  {[2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <span className="l7-gate-note">
                <Lock width={11} height={11} /> planning costs one model call — research runs
                only after you approve
              </span>
            </>
          ) : (
            <>
              <label
                className="l6-ctl"
                title="This run's researcher budget — lower it to watch the budget rail fire live."
              >
                budget
                <select value={dynBudget} onChange={(e) => setDynBudget(Number(e.target.value))}>
                  {budgetOptions.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <span className="l7-gate-note">
                <Lock width={11} height={11} /> runs immediately — the rails (budget, turn cap,
                verified finalize) are the only guarantees
              </span>
            </>
          )}
          <div className="l6-controls-right">
            {running && (
              <button type="button" className="btn btn-ghost" onClick={stopRun}>
                Stop
              </button>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={planning || running || !question.trim()}
            >
              {planning || (running && mode === 'loop') ? (
                <span className="spinner" />
              ) : mode === 'planned' ? (
                <ArrowUp width={15} height={15} />
              ) : (
                <Play width={14} height={14} />
              )}
              {mode === 'planned'
                ? planning
                  ? 'Planning…'
                  : 'Plan research'
                : running
                  ? 'Agent loop running…'
                  : 'Run agent loop'}
            </button>
          </div>
        </div>
        <div className="chips">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="chip"
              onClick={() => (mode === 'planned' ? doPlan(ex) : setQuestion(ex))}
              disabled={planning || running}
            >
              {ex}
            </button>
          ))}
        </div>
      </form>

      {error && (
        <div className="error">
          <strong>Error</strong> — {error}
        </div>
      )}

      {replaying && (
        <div className="l7-replay-banner">
          ▶ REPLAY — a recorded run, re-rendered with its original pacing. No model calls, no
          cost, no network.
        </div>
      )}

      {/* ── Planned mode: the approval gate ────────────────────────── */}
      {mode === 'planned' && plan && (
        <div className="l6-stage">
          <div className="l6-stage-head">
            <span className="l6-stage-n">2</span>
            <b>The plan — approve to execute</b>
            <span className="l6-ms">
              {included.size} of {plan.angles.length} angles selected
              {planCost != null && planCost > 0 ? ` · planned for $${planCost.toFixed(3)}` : ''}
            </span>
          </div>
          {plan.restated_goal && <p className="l6-stage-sub">Goal: {plan.restated_goal}</p>}
          <div className="l7-angles">
            {plan.angles.map((a) => (
              <label key={a.id} className={`l7-angle ${included.has(a.id) ? '' : 'is-off'}`}>
                <input
                  type="checkbox"
                  checked={included.has(a.id)}
                  onChange={() => toggleAngle(a.id)}
                  disabled={running}
                />
                <span className="l7-angle-body">
                  <b>{a.title}</b>
                  <span className="l7-angle-obj">{a.objective}</span>
                  <span className="l6-terms">
                    {a.queries.map((q, i) => (
                      <span key={i} className="l6-term">
                        {q}
                      </span>
                    ))}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="l7-gate-foot">
            <button className="btn btn-primary" onClick={runPlan} disabled={running || included.size === 0}>
              {running ? <span className="spinner" /> : <Play width={14} height={14} />}
              {running
                ? 'Running…'
                : `Run plan — ${included.size} researcher${included.size === 1 ? '' : 's'}`}
            </button>
            <button className="linkish" onClick={() => doPlan()} disabled={planning || running}>
              <Reset width={13} height={13} /> Re-plan
            </button>
            <span className="l7-gate-note">
              deselecting an angle removes that worker — the plan you run is the plan you see
            </span>
          </div>
        </div>
      )}

      {/* ── Planned mode: the run ──────────────────────────────────── */}
      {mode === 'planned' && run && (
        <div className="l6-trace">
          <div className="l6-stage">
            <div className="l6-stage-head">
              <span className="l6-stage-n">3</span>
              <b>Execution</b>
              {run.totals && (
                <span className="l6-ms">
                  {run.totals.agents} agents · {run.totals.tool_calls} tool calls ·{' '}
                  {(run.totals.ms / 1000).toFixed(1)} s
                  {run.totals.cost_usd != null ? ` · $${run.totals.cost_usd.toFixed(2)}` : ''}
                </span>
              )}
            </div>
            <StageRail run={run} />
            <div className="l7-workers">
              {Object.entries(run.workers).map(([id, w]) => (
                <WorkerCard key={id} id={Number(id)} w={w} model={config?.researcher_model ?? 'worker'} />
              ))}
            </div>
          </div>

          {run.sources.length > 0 && (
            <div className="l6-stage">
              <div className="l6-stage-head">
                <span className="l6-stage-n">4</span>
                <b>Shared citation space</b>
                <span className="l6-ms">{run.sources.length} deduped sources</span>
              </div>
              <div className="l7-sources">
                {run.sources.map((s) => (
                  <div key={s.n} className="l7-source">
                    <span className="l6-ctx-n">[{s.n}]</span>{' '}
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(finalReport || lastVerdict) && (
            <div className="l6-stage">
              <div className="l6-stage-head">
                <span className="l6-stage-n">5</span>
                <b>Brief + verification</b>
                {finalReport && <span className="l6-ms">revision {finalReport.revision}</span>}
              </div>

              {(lastVerdict || run.citations) && (
                <div className="l6-flags">
                  {lastVerdict && <VerdictFlags v={lastVerdict} />}
                  {run.citations && <CitationsFlag c={run.citations} />}
                </div>
              )}

              {lastVerdict && lastVerdict.issues.length > 0 && (
                <details className="l7-issues">
                  <summary>what the critic flagged</summary>
                  {lastVerdict.issues.map((i, k) => (
                    <p key={k}>
                      <em>“{i.excerpt}”</em> — {i.problem}
                    </p>
                  ))}
                </details>
              )}

              {finalReport && (
                <div className="l7-report">
                  <Markdown>{finalReport.report_md}</Markdown>
                </div>
              )}

              {draftReport && (
                <details className="l7-issues">
                  <summary>the pre-revision draft (what the critic reviewed)</summary>
                  <div className="l7-report l7-report-old">
                    <Markdown>{draftReport.report_md}</Markdown>
                  </div>
                </details>
              )}
            </div>
          )}

          {run.error && (
            <div className="error">
              <strong>Run ended early</strong> — {run.error}
            </div>
          )}
        </div>
      )}

      {/* ── Agent-loop mode: the loop, live ────────────────────────── */}
      {mode === 'loop' && run && (
        <div className="l6-trace">
          <div className="l6-stage">
            <div className="l6-stage-head">
              <span className="l6-stage-n">∞</span>
              <b>The lead&apos;s loop</b>
              <span className="l6-ms">
                {run.totals
                  ? `${run.totals.iterations ?? run.turns.length} iterations · ${run.totals.agents} agents · ${run.totals.tool_calls} tool calls · ${(run.totals.ms / 1000).toFixed(1)} s${run.totals.cost_usd != null ? ` · $${run.totals.cost_usd.toFixed(2)}` : ''}`
                  : `${run.turns.length} iterations so far`}
              </span>
            </div>

            <div className="l7-roster">
              <div className={`l7-rtool ${run.budget && run.budget.used >= run.budget.max ? 'is-spent' : ''}`}>
                <b>delegate_research</b>
                <span>spawn 1-3 parallel researchers</span>
                <em>
                  budget {run.budget ? `${run.budget.used}/${run.budget.max}` : '0/–'} used
                </em>
              </div>
              <div className="l7-rtool">
                <b>submit_draft</b>
                <span>send a draft to the adversarial critic</span>
                <em>{run.verdicts.length} review{run.verdicts.length === 1 ? '' : 's'}</em>
              </div>
              <div className="l7-rtool">
                <b>finalize</b>
                <span>publish — refused until a draft passes review</span>
                <em>{finalReport ? 'published ✓' : 'locked'}</em>
              </div>
            </div>

            <div className="l7-loop">
              {run.turns.map((t) => {
                const v = verdictForTurn(t)
                return (
                  <div key={t.n} className="l7-turn">
                    <div className="l7-turn-head">
                      <span className="l7-turn-n">{t.n}</span>
                      {t.thought ? (
                        <p className="l7-thought">{t.thought}</p>
                      ) : (
                        <p className="l7-thought l7-thought-empty">(no narration this turn)</p>
                      )}
                    </div>
                    <div className="l7-turn-action">
                      <ArrowRight width={12} height={12} />
                      chose <span className="l7-action">{t.tool}</span>
                      <span className="l7-action-detail">{t.detail}</span>
                    </div>
                    {t.workerIds.length > 0 && (
                      <div className="l7-workers l7-workers-nested">
                        {t.workerIds.map((id) =>
                          run.workers[id] ? (
                            <WorkerCard key={id} id={id} w={run.workers[id]} model={config?.researcher_model ?? 'worker'} />
                          ) : null,
                        )}
                      </div>
                    )}
                    {v && (
                      <div className="l6-flags">
                        <VerdictFlags v={v} />
                        {v.issues.length > 0 && (
                          <details className="l7-issues">
                            <summary>flagged</summary>
                            {v.issues.map((i, k) => (
                              <p key={k}>
                                <em>“{i.excerpt}”</em> — {i.problem}
                              </p>
                            ))}
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              {running && (
                <div className="l7-turn l7-turn-pending">
                  <span className="spinner" />{' '}
                  {run.turns.length === 0 ? 'the lead is planning its first move…' : 'the lead is thinking…'}
                </div>
              )}
            </div>
          </div>

          {run.sources.length > 0 && (
            <div className="l6-stage">
              <div className="l6-stage-head">
                <span className="l6-stage-n">§</span>
                <b>Shared citation space</b>
                <span className="l6-ms">{run.sources.length} deduped sources</span>
              </div>
              <div className="l7-sources">
                {run.sources.map((s) => (
                  <div key={s.n} className="l7-source">
                    <span className="l6-ctx-n">[{s.n}]</span>{' '}
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(finalReport || run.notes.length > 0) && (
            <div className="l6-stage">
              <div className="l6-stage-head">
                <span className="l6-stage-n">✓</span>
                <b>Published brief</b>
                {finalReport && finalReport.revision > 0 && (
                  <span className="l6-ms">after {finalReport.revision} draft{finalReport.revision === 1 ? '' : 's'}</span>
                )}
              </div>
              <div className="l6-flags">
                {run.notes.map((n, i) => (
                  <span key={i} className="l6-flag l6-flag-warn">
                    {n}
                  </span>
                ))}
                {lastVerdict && <VerdictFlags v={lastVerdict} />}
                {run.citations && <CitationsFlag c={run.citations} />}
              </div>
              {finalReport && (
                <div className="l7-report">
                  <Markdown>{finalReport.report_md}</Markdown>
                </div>
              )}
            </div>
          )}

          {run.error && (
            <div className="error">
              <strong>Run ended early</strong> — {run.error}
            </div>
          )}
        </div>
      )}

      {/* ── Run history: every run is recorded — replay them offline, free ── */}
      <details className="l6-panel l7-history">
        <summary>
          Run history — {historyRuns.length} recorded {historyRuns.length === 1 ? 'run' : 'runs'} ·
          replay any of them offline (no model calls, no cost)
        </summary>
        {historyRuns.length === 0 ? (
          <p className="l6-empty">
            Nothing recorded yet — every run you start from now on is saved automatically.
          </p>
        ) : (
          <div className="l7-runs">
            {historyRuns.map((r) => (
              <div key={r.run_id} className="l7-run">
                <span className={`l7-run-mode is-${r.mode}`}>{r.mode}</span>
                <span className="l7-run-q" title={r.question}>
                  {r.question}
                </span>
                <span className="l7-run-meta">
                  {r.started_at ? new Date(r.started_at).toLocaleString() : '—'}
                  {r.totals
                    ? ` · ${(r.totals.ms / 1000).toFixed(0)} s · $${(r.totals.cost_usd ?? 0).toFixed(2)}`
                    : ''}
                  {!r.finished ? ' · incomplete' : r.ok ? '' : ' · failed'}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => replayRun(r)}
                  disabled={running || planning}
                >
                  <Play width={12} height={12} /> Replay
                </button>
                <button
                  className="l7-run-x"
                  title="Delete this recording"
                  onClick={() => removeRun(r.run_id)}
                  disabled={running}
                >
                  <Trash width={12} height={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </details>
    </div>
  )
}
