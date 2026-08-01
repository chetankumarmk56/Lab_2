import { useEffect, useRef, useState, type FormEvent } from 'react'
import { deleteEvalRun, getEvalSuites, listEvalRuns, runEvalsStream } from '../api'
import { Check, Lock, Play, Trash } from '../components/icons'
import type {
  EvalCheck,
  EvalEvent,
  EvalRunSummary,
  EvalSuiteMeta,
  EvalTotals,
  EvalRegression,
} from '../types'

/** The eval loop, as a picture (house style: what + why per stage). */
const PIPELINE = [
  { n: 1, name: 'Golden cases', what: 'Curated questions with known-correct outcomes, stored as data files.', why: 'Eval quality lives in reviewable data, not in code.' },
  { n: 2, name: 'Run the real labs', what: 'Adapters call the production agents — same prompts, same options.', why: 'If the eval passes, the thing users run passes.' },
  { n: 3, name: 'Grade', what: 'Deterministic checks first (SQL execution-match, hit@k, citations); LLM judge optional.', why: 'Free and unarguable beats clever; the judge must show its reasoning.' },
  { n: 4, name: 'Score & cost', what: 'Every case reports pass/fail, latency, and its real dollar cost.', why: 'Model choice becomes a measured trade-off, not a vibe.' },
  { n: 5, name: 'Compare', what: 'Each run is stored and diffed against the previous one.', why: 'An eval without regression tracking is just a screenshot.' },
]

interface CaseView {
  question: string
  status: 'running' | 'pass' | 'fail'
  checks: EvalCheck[]
  cost_usd: number
  ms: number
  preview: string
}

interface SuiteView {
  title: string
  expected: number
  order: string[]
  cases: Record<string, CaseView>
  done?: { passed: number; failed: number; cost_usd: number; ms: number }
}

interface LiveRun {
  runId: string | null
  model: string
  judge: boolean
  order: string[]
  suites: Record<string, SuiteView>
  totals: EvalTotals | null
  regression: EvalRegression | null
  error: string | null
}

const blankLive = (): LiveRun => ({
  runId: null,
  model: '',
  judge: false,
  order: [],
  suites: {},
  totals: null,
  regression: null,
  error: null,
})

function PassChip({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span className={`l6-flag ${ok ? 'l6-flag-ok' : 'l6-flag-warn'}`}>
      {ok ? <Check width={11} height={11} /> : '✕'} {label ?? (ok ? 'pass' : 'fail')}
    </span>
  )
}

function pct(passed: number, total: number): string {
  return total === 0 ? '—' : `${Math.round((passed / total) * 100)}%`
}

export default function Lab8Evals() {
  const [meta, setMeta] = useState<EvalSuiteMeta[]>([])
  const [configuredModel, setConfiguredModel] = useState('')
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [model, setModel] = useState<string>('configured')
  const [judge, setJudge] = useState(false)
  const [running, setRunning] = useState(false)
  const [live, setLive] = useState<LiveRun | null>(null)
  const [history, setHistory] = useState<EvalRunSummary[]>([])
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  function refresh() {
    listEvalRuns()
      .then((r) => setHistory(r.runs))
      .catch(() => {/* history is an enhancement */})
  }

  useEffect(() => {
    getEvalSuites()
      .then((r) => {
        setMeta(r.suites)
        setConfiguredModel(r.configured_model)
        setModelOptions(r.model_options)
        setSelected(new Set(r.suites.filter((s) => !s.heavy).map((s) => s.suite)))
      })
      .catch((e) => setError((e as Error).message))
    refresh()
  }, [])

  function toggleSuite(name: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function runSelected(e?: FormEvent) {
    e?.preventDefault()
    if (running || selected.size === 0) return
    setRunning(true)
    setError('')
    const initial = blankLive()
    setLive(initial)

    const patch = (fn: (s: LiveRun) => void) =>
      setLive((prev) => {
        if (!prev) return prev
        const next: LiveRun = {
          ...prev,
          order: [...prev.order],
          suites: Object.fromEntries(
            Object.entries(prev.suites).map(([k, v]) => [
              k,
              { ...v, order: [...v.order], cases: { ...v.cases } },
            ]),
          ),
        }
        fn(next)
        return next
      })

    const onEvent = (ev: EvalEvent) => {
      switch (ev.type) {
        case 'run_meta':
          patch((s) => {
            s.runId = ev.run_id
            s.model = ev.model
            s.judge = ev.judge
          })
          break
        case 'suite_start':
          patch((s) => {
            s.order.push(ev.suite)
            s.suites[ev.suite] = { title: ev.title, expected: ev.cases, order: [], cases: {} }
          })
          break
        case 'case_start':
          patch((s) => {
            const suite = s.suites[ev.suite]
            if (!suite) return
            suite.order.push(ev.case_id)
            suite.cases[ev.case_id] = {
              question: ev.question,
              status: 'running',
              checks: [],
              cost_usd: 0,
              ms: 0,
              preview: '',
            }
          })
          break
        case 'case_done':
          patch((s) => {
            const suite = s.suites[ev.suite]
            if (!suite) return
            suite.cases[ev.case_id] = {
              question: ev.question,
              status: ev.pass ? 'pass' : 'fail',
              checks: ev.checks,
              cost_usd: ev.cost_usd,
              ms: ev.ms,
              preview: ev.preview,
            }
          })
          break
        case 'suite_done':
          patch((s) => {
            const suite = s.suites[ev.suite]
            if (suite)
              suite.done = { passed: ev.passed, failed: ev.failed, cost_usd: ev.cost_usd, ms: ev.ms }
          })
          break
        case 'done':
          patch((s) => {
            s.totals = ev.totals
            s.regression = ev.regression
            s.error = ev.error
          })
          break
      }
    }

    const ctl = new AbortController()
    abortRef.current = ctl
    try {
      await runEvalsStream(
        [...selected],
        model === 'configured' ? null : model,
        judge,
        onEvent,
        ctl.signal,
      )
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message)
    } finally {
      abortRef.current = null
      setRunning(false)
      refresh()
    }
  }

  async function removeRun(runId: string) {
    try {
      await deleteEvalRun(runId)
      refresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  /** Matrix: latest stored run per (model, suite) → pass rate. */
  const matrixModels = [...new Set(history.map((r) => r.model))]
  const matrixSuites = meta.map((s) => s.suite)
  function matrixCell(modelId: string, suite: string): string | null {
    for (const run of history) {
      if (run.model !== modelId) continue
      const sr = run.suites.find((s) => s.suite === suite)
      if (sr) return pct(sr.passed, sr.passed + sr.failed)
    }
    return null
  }

  return (
    <div className="panel l6-root">
      <div className="panel-head">
        <div className="eyebrow">
          Lab 08 <span className="sector-tag">Quality · Evals</span>
        </div>
        <h2>Eval Harness — how you know it works</h2>
        <p>
          Labs 2, 6 and 7 become systems under test: golden cases run against the real agents,
          deterministic graders (plus an optional LLM judge that must show its reasoning) score
          them, and every run is stored, costed, and diffed against the previous one.
        </p>
        {configuredModel && (
          <div className="l6-hint">
            configured model <b>{configuredModel}</b> · retrieval cases are free · answer/SQL
            cases spend real tokens · the Lab 7 suite is marked heavy (minutes per case)
          </div>
        )}
      </div>

      <div className="l6-pipe l7-pipe5">
        {PIPELINE.map((s) => (
          <div key={s.n} className="l6-pipe-card">
            <div className="l6-pipe-top">
              <span className="l6-pipe-num">{s.n}</span>
              <span className="l6-pipe-name">{s.name}</span>
            </div>
            <p className="l6-pipe-what">{s.what}</p>
            <p className="l6-pipe-why">why: {s.why}</p>
          </div>
        ))}
      </div>

      {/* ── Run configuration ──────────────────────────────────────── */}
      <form className="l6-ask" onSubmit={runSelected}>
        <div className="l8-suites">
          {meta.map((s) => (
            <label key={s.suite} className={`l8-suite ${selected.has(s.suite) ? '' : 'is-off'}`}>
              <input
                type="checkbox"
                checked={selected.has(s.suite)}
                onChange={() => toggleSuite(s.suite)}
                disabled={running}
              />
              <span className="l8-suite-body">
                <b>
                  {s.title}
                  <em className="l8-count">{s.case_count} cases</em>
                  {s.heavy && <em className="l8-heavy">heavy</em>}
                </b>
                <span>{s.description}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="l6-controls">
          <label className="l6-ctl" title="Run the same suites on a different tier to compare quality and cost.">
            model
            <select value={model} onChange={(e) => setModel(e.target.value)} disabled={running}>
              <option value="configured">configured ({configuredModel || '…'})</option>
              {modelOptions
                .filter((m) => m !== configuredModel)
                .map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
            </select>
          </label>
          <label className="l6-ctl l6-check" title="Adds an LLM-as-judge faithfulness check to answer cases — its reasoning is displayed.">
            <input type="checkbox" checked={judge} onChange={(e) => setJudge(e.target.checked)} disabled={running} />
            LLM judge
          </label>
          <span className="l7-gate-note">
            <Lock width={11} height={11} /> nothing runs until you press Run — heavy suites are
            deselected by default
          </span>
          <div className="l6-controls-right">
            {running && (
              <button type="button" className="btn btn-ghost" onClick={() => abortRef.current?.abort()}>
                Stop
              </button>
            )}
            <button type="submit" className="btn btn-primary" disabled={running || selected.size === 0}>
              {running ? <span className="spinner" /> : <Play width={14} height={14} />}
              {running ? 'Running evals…' : `Run ${selected.size} suite${selected.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </form>

      {error && (
        <div className="error">
          <strong>Error</strong> — {error}
        </div>
      )}

      {/* ── Live results ───────────────────────────────────────────── */}
      {live && (
        <div className="l6-trace">
          {live.order.map((name) => {
            const suite = live.suites[name]
            return (
              <div key={name} className="l6-stage">
                <div className="l6-stage-head">
                  <span className="l6-stage-n">✓</span>
                  <b>{suite.title}</b>
                  <span className="l6-ms">
                    {suite.done
                      ? `${suite.done.passed}/${suite.done.passed + suite.done.failed} passed · $${suite.done.cost_usd.toFixed(2)} · ${(suite.done.ms / 1000).toFixed(1)} s`
                      : `${suite.order.length}/${suite.expected} cases…`}
                  </span>
                </div>
                <div className="l8-cases">
                  {suite.order.map((caseId) => {
                    const c = suite.cases[caseId]
                    return (
                      <details key={caseId} className={`l8-case is-${c.status}`}>
                        <summary>
                          <span className="l8-case-id">{caseId}</span>
                          <span className="l8-case-q" title={c.question}>
                            {c.question}
                          </span>
                          <span className="l8-case-meta">
                            {c.status === 'running' ? (
                              <span className="spinner" />
                            ) : (
                              <>
                                {(c.ms / 1000).toFixed(1)} s
                                {c.cost_usd > 0 ? ` · $${c.cost_usd.toFixed(3)}` : ' · free'}
                              </>
                            )}
                          </span>
                          {c.status !== 'running' && <PassChip ok={c.status === 'pass'} />}
                        </summary>
                        <div className="l8-checks">
                          {c.checks.map((chk, i) => (
                            <div key={i} className={`l8-check ${chk.pass ? '' : 'is-fail'}`}>
                              <span className="l8-check-name">{chk.pass ? '✓' : '✕'} {chk.name}</span>
                              <span className="l8-check-detail">{chk.detail}</span>
                            </div>
                          ))}
                          {c.preview && <p className="l8-preview">“{c.preview}”</p>}
                        </div>
                      </details>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {live.totals && (
            <div className="l6-stage">
              <div className="l6-stage-head">
                <span className="l6-stage-n">Σ</span>
                <b>Run result</b>
                <span className="l6-ms">
                  {live.totals.passed}/{live.totals.cases} passed · ${live.totals.cost_usd.toFixed(2)} ·{' '}
                  {(live.totals.ms / 1000).toFixed(1)} s · {live.model}
                </span>
              </div>
              <div className="l6-flags">
                <PassChip
                  ok={live.totals.failed === 0}
                  label={live.totals.failed === 0 ? 'all cases passed' : `${live.totals.failed} failing`}
                />
                {live.regression ? (
                  live.regression.regressions.length === 0 ? (
                    <span className="l6-flag l6-flag-ok">
                      <Check width={11} height={11} /> no regressions vs {live.regression.compared_to} (
                      {live.regression.shared_cases} shared cases)
                    </span>
                  ) : (
                    <span className="l6-flag l6-flag-warn">
                      REGRESSIONS: {live.regression.regressions.join(', ')}
                    </span>
                  )
                ) : (
                  <span className="l6-flag l6-flag-ok">first recorded run — future runs diff against it</span>
                )}
                {live.regression && live.regression.fixes.length > 0 && (
                  <span className="l6-flag l6-flag-ok">fixed: {live.regression.fixes.join(', ')}</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Model × suite matrix (from stored history) ─────────────── */}
      {history.length > 0 && (
        <div className="l6-stage">
          <div className="l6-stage-head">
            <span className="l6-stage-n">⊞</span>
            <b>Pass rate by model × suite</b>
            <span className="l6-ms">latest stored run per combination</span>
          </div>
          <div className="l6-fuse-scroll">
            <table className="l6-fuse">
              <thead>
                <tr>
                  <th>Suite</th>
                  {matrixModels.map((m) => (
                    <th key={m} className="num">{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixSuites.map((s) => (
                  <tr key={s}>
                    <td>{s}</td>
                    {matrixModels.map((m) => (
                      <td key={m} className="num">{matrixCell(m, s) ?? '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Stored runs ────────────────────────────────────────────── */}
      <details className="l6-panel l7-history">
        <summary>
          Eval history — {history.length} stored {history.length === 1 ? 'run' : 'runs'}
        </summary>
        {history.length === 0 ? (
          <p className="l6-empty">No stored runs yet — every eval run is saved automatically.</p>
        ) : (
          <div className="l7-runs">
            {history.map((r) => (
              <div key={r.run_id} className="l7-run">
                <span className={`l7-run-mode ${r.model_overridden ? 'is-loop' : 'is-planned'}`}>
                  {r.model}
                </span>
                <span className="l7-run-q">
                  {r.suites.map((s) => s.suite).join(' + ')}
                  {r.judge ? ' · judge on' : ''}
                </span>
                <span className="l7-run-meta">
                  {new Date(r.started_at).toLocaleString()} · {r.totals.passed}/{r.totals.cases} passed ·{' '}
                  ${r.totals.cost_usd.toFixed(2)}
                  {r.regression && r.regression.regressions.length > 0
                    ? ` · ${r.regression.regressions.length} regression(s)`
                    : ''}
                </span>
                <button
                  className="l7-run-x"
                  title="Delete this stored run"
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
