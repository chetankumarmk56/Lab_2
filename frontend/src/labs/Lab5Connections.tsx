import { useEffect, useState } from 'react'
import {
  deleteConnection,
  deployServer,
  getConnections,
  getDrivers,
  queryConnection,
  saveConnection,
  testConnection,
  verifyServer,
} from '../api'
import Markdown from '../components/Markdown'
import { ArrowRight, Check, Database, Download, Lock, Play, Plus, Server, Trash } from '../components/icons'
import { download } from '../lib/download'
import type {
  ConnectionMeta,
  DeployResult,
  DriverInfo,
  Lab5QueryResult,
  TestConnectionResult,
  VerifyResult,
} from '../types'

const STEPS = ['Database', 'Details', 'Test', 'Generate', 'Verify', 'Ready']

interface FieldErrors {
  host?: string
  port?: string
  database?: string
  username?: string
  password?: string
}

function errMessage(e: unknown): string {
  const m = (e as Error).message
  return m && m !== '[object Object]' ? m : 'Please check the connection details.'
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="stepper">
      {STEPS.map((label, i) => {
        const n = i + 1
        const state = n < step ? 'done' : n === step ? 'active' : 'todo'
        return (
          <div key={label} className={`step-node ${state}`}>
            <span className="step-dot">{n < step ? <Check width={12} height={12} /> : n}</span>
            <span className="step-label">{label}</span>
          </div>
        )
      })}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'verified' ? 'ok' : status === 'failed' ? 'bad' : 'mid'
  return <span className={`conn-status ${cls}`}>{status}</span>
}

export default function Lab5Connections() {
  const [drivers, setDrivers] = useState<DriverInfo[]>([])
  const [connections, setConnections] = useState<ConnectionMeta[]>([])
  const [mode, setMode] = useState<'list' | 'wizard' | 'query'>('list')

  // wizard state
  const [step, setStep] = useState(1)
  const [driver, setDriver] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState<number | ''>('')
  const [database, setDatabase] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [sslMode, setSslMode] = useState('')
  const [connId, setConnId] = useState<number | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null)
  const [deploy, setDeploy] = useState<DeployResult | null>(null)
  const [showCode, setShowCode] = useState(false)
  const [verify, setVerify] = useState<VerifyResult | null>(null)

  // query console state
  const [activeConn, setActiveConn] = useState<ConnectionMeta | null>(null)
  const [question, setQuestion] = useState('')
  const [qLoading, setQLoading] = useState(false)
  const [qResult, setQResult] = useState<Lab5QueryResult | null>(null)
  const [qError, setQError] = useState('')

  async function refreshConnections() {
    try {
      const d = await getConnections()
      setConnections(d.connections || [])
    } catch {
      /* non-fatal */
    }
  }

  useEffect(() => {
    getDrivers().then((d) => setDrivers(d.drivers || [])).catch(() => setDrivers([]))
    refreshConnections()
  }, [])

  const driverMeta = drivers.find((d) => d.id === driver)

  function startWizard() {
    setStep(1)
    setDriver('')
    setHost('')
    setPort('')
    setDatabase('')
    setUsername('')
    setPassword('')
    setName('')
    setSslMode('')
    setConnId(null)
    setFieldErrors({})
    setError('')
    setTestResult(null)
    setDeploy(null)
    setShowCode(false)
    setVerify(null)
    setMode('wizard')
  }

  function pickDriver(d: DriverInfo) {
    if (!d.available) return
    setDriver(d.id)
    setPort(d.default_port)
    setStep(2)
  }

  function validateDetails(): boolean {
    const fe: FieldErrors = {}
    if (!host.trim()) fe.host = 'Host or IP is required.'
    if (port === '' || !Number.isInteger(port) || port < 1 || port > 65535) fe.port = 'Port must be a whole number 1–65535.'
    if (!database.trim()) fe.database = 'Database name is required.'
    if (!username.trim()) fe.username = 'Username is required.'
    if (!password) fe.password = 'Password is required.'
    setFieldErrors(fe)
    return Object.keys(fe).length === 0
  }

  async function submitDetails() {
    if (!validateDetails()) return
    setBusy(true)
    setError('')
    try {
      // Re-editing after a save must not orphan the previous row (it holds an
      // encrypted password) — remove it first so one wizard attempt = one row.
      if (connId != null) {
        try { await deleteConnection(connId) } catch { /* ignore */ }
        setConnId(null)
      }
      const res = await saveConnection({
        driver,
        host: host.trim(),
        port: Number(port),
        database: database.trim(),
        username: username.trim(),
        password,
        name: name.trim() || undefined,
        ssl_mode: sslMode.trim() || undefined,
      })
      setConnId(res.id)
      setPassword('') // don't keep the plaintext in memory after it's stored
      setTestResult(null)
      setStep(3)
    } catch (e) {
      const detail = (e as { detail?: { fields?: FieldErrors } }).detail
      if (detail && typeof detail === 'object' && detail.fields) setFieldErrors(detail.fields)
      setError(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function runTest() {
    if (connId == null) return
    setBusy(true)
    setError('')
    setTestResult(null)
    try {
      setTestResult(await testConnection(connId))
    } catch (e) {
      setError(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function runDeploy() {
    if (connId == null) return
    setBusy(true)
    setError('')
    try {
      const res = await deployServer(connId)
      setDeploy(res)
      if (res.ok) setStep(5)
    } catch (e) {
      setError(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function runVerify() {
    if (connId == null) return
    setBusy(true)
    setError('')
    try {
      const res = await verifyServer(connId)
      setVerify(res)
      if (res.ok) {
        setStep(6)
        refreshConnections()
      }
    } catch (e) {
      setError(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function openQuery(conn: ConnectionMeta) {
    setActiveConn(conn)
    setQuestion('')
    setQResult(null)
    setQError('')
    setMode('query')
  }

  async function runQuery() {
    if (!activeConn || !question.trim()) return
    setQLoading(true)
    setQError('')
    setQResult(null)
    try {
      const res = await queryConnection(activeConn.id, question.trim())
      setQResult(res)
    } catch (e) {
      setQError(errMessage(e))
    } finally {
      setQLoading(false)
    }
  }

  async function removeConn(id: number) {
    try {
      await deleteConnection(id)
      await refreshConnections()
    } catch {
      /* ignore */
    }
  }

  const head = (
    <div className="panel-head">
      <div className="eyebrow">Lab 05 <span className="sector-tag">Capstone</span></div>
      <h2>On-the-Fly MCP Server Builder</h2>
      <p>
        Connect your own database and get an auto-generated, deployed, and registered{' '}
        <strong>read-only</strong> MCP query server — no code. Write operations are blocked before they
        reach the database.
      </p>
    </div>
  )

  // ── Query console ──
  if (mode === 'query' && activeConn) {
    const table = qResult?.table && qResult.table.ok ? qResult.table : null
    return (
      <div className="panel">
        {head}
        <div className="console">
          <div className="controls">
            <button className="btn btn-subtle btn-sm" onClick={() => setMode('list')}>← Connections</button>
            <span className="conn-current"><Database width={14} height={14} /> {activeConn.name || activeConn.database} <span className="hint-inline">({activeConn.driver})</span></span>
          </div>
          <div className="controls" style={{ marginTop: 12 }}>
            <input
              className="field"
              value={question}
              placeholder="Ask a question about this database…"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runQuery() }}
            />
            <button className="btn btn-primary" onClick={runQuery} disabled={qLoading || !question.trim()}>
              {qLoading ? <><span className="spinner" /> Asking…</> : <><Play width={15} height={15} /> Ask</>}
            </button>
          </div>
        </div>

        {qLoading && <div className="agent-status"><span className="spinner" /> The agent is exploring your schema and writing a read-only query…</div>}
        {qError && <div className="error"><strong>Error</strong> — {qError}</div>}

        {qResult && !qLoading && (
          <div className="result">
            <div className="result-head"><div className="rh-title"><b>Answer</b></div></div>
            <div className="result-body">
              <Markdown>{qResult.answer}</Markdown>
              {qResult.sql && (
                <div className="code-card">
                  <div className="code-card-head"><span className="cc-label">SQL the agent ran</span></div>
                  <pre>{qResult.sql}</pre>
                </div>
              )}
            </div>
            {table && (
              <div className="section">
                <div className="section-label"><span>Results · {table.rows.length} {table.rows.length === 1 ? 'row' : 'rows'}</span></div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead><tr>{table.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                    <tbody>
                      {table.rows.map((row, i) => (
                        <tr key={i}>{row.map((cell, j) => <td key={j}>{cell === null ? '—' : String(cell)}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Connection list ──
  if (mode === 'list') {
    return (
      <div className="panel">
        {head}
        <div className="console">
          <div className="toolbar">
            <button className="btn btn-primary" onClick={startWizard}><Plus width={15} height={15} /> Connect a database</button>
          </div>
        </div>

        {connections.length === 0 ? (
          <div className="empty">
            <div className="empty-mark">🔌</div>
            <p>No databases connected yet. Click <strong>Connect a database</strong> to generate your first read-only MCP server.</p>
          </div>
        ) : (
          <div className="conn-list">
            {connections.map((c) => (
              <div key={c.id} className="conn-card">
                <div className="conn-main">
                  <span className="conn-icon"><Database width={16} height={16} /></span>
                  <div>
                    <div className="conn-name">{c.name || c.database} <StatusBadge status={c.status} /></div>
                    <div className="conn-meta">{c.driver} · {c.username}@{c.host}:{c.port}/{c.database}</div>
                  </div>
                </div>
                <div className="conn-actions">
                  {c.status === 'verified' && (
                    <button className="btn btn-ghost btn-sm" onClick={() => openQuery(c)}><Play width={13} height={13} /> Query</button>
                  )}
                  <button className="btn btn-subtle btn-sm" onClick={() => removeConn(c.id)}><Trash width={13} height={13} /> Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Wizard ──
  return (
    <div className="panel">
      {head}
      <Stepper step={step} />

      <div className="console">
        {error && <div className="error"><strong>Error</strong> — {error}</div>}

        {/* Step 1 — Database type */}
        {step === 1 && (
          <div className="wstep">
            <div className="wstep-head"><span className="step-num">1</span><span className="wstep-title">Choose your database engine</span></div>
            <div className="engine-grid">
              {drivers.map((d) => (
                <button key={d.id} className={`engine-card ${d.available ? '' : 'disabled'}`} onClick={() => pickDriver(d)} disabled={!d.available}>
                  <Database width={20} height={20} />
                  <span className="engine-label">{d.label}</span>
                  {!d.available && <span className="engine-note">not available here</span>}
                  {d.available && d.reduced_guarantees && <span className="engine-note warn">use a read-only login</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2 — Connection details */}
        {step === 2 && (
          <div className="wstep">
            <div className="wstep-head"><span className="step-num">2</span><span className="wstep-title">Connection details — {driverMeta?.label}</span></div>
            <div className="form-grid">
              <label className="form-field"><span>Host / IP</span>
                <input className={`field ${fieldErrors.host ? 'invalid' : ''}`} value={host} onChange={(e) => setHost(e.target.value)} placeholder="db.example.com" />
                {fieldErrors.host && <em className="field-err">{fieldErrors.host}</em>}
              </label>
              <label className="form-field narrow"><span>Port</span>
                <input className={`field ${fieldErrors.port ? 'invalid' : ''}`} type="number" value={port} onChange={(e) => setPort(e.target.value === '' ? '' : Number(e.target.value))} />
                {fieldErrors.port && <em className="field-err">{fieldErrors.port}</em>}
              </label>
              <label className="form-field"><span>Database name</span>
                <input className={`field ${fieldErrors.database ? 'invalid' : ''}`} value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="analytics" />
                {fieldErrors.database && <em className="field-err">{fieldErrors.database}</em>}
              </label>
              <label className="form-field"><span>Username</span>
                <input className={`field ${fieldErrors.username ? 'invalid' : ''}`} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="readonly_user" />
                {fieldErrors.username && <em className="field-err">{fieldErrors.username}</em>}
              </label>
              <label className="form-field"><span>Password <Lock width={11} height={11} /></span>
                <input className={`field ${fieldErrors.password ? 'invalid' : ''}`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="••••••••" />
                {fieldErrors.password && <em className="field-err">{fieldErrors.password}</em>}
              </label>
              <label className="form-field"><span>Display name <span className="hint-inline">(optional)</span></span>
                <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Production analytics" />
              </label>
              <label className="form-field narrow"><span>SSL mode <span className="hint-inline">(optional)</span></span>
                <input className="field" value={sslMode} onChange={(e) => setSslMode(e.target.value)} placeholder="require" />
              </label>
            </div>
            <p className="ta-foot">🔒 The password is encrypted at rest (Fernet) the moment you continue, and never shown again, logged, returned, or placed in generated code. Use a <strong>SELECT-only</strong> database user for the strongest guarantee.</p>
            <div className="wizard-actions">
              <button className="btn btn-subtle" onClick={() => setStep(1)}>Back</button>
              <button className="btn btn-primary" onClick={submitDetails} disabled={busy}>
                {busy ? <><span className="spinner" /> Saving…</> : <>Save & continue <ArrowRight width={15} height={15} /></>}
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Test connection */}
        {step === 3 && (
          <div className="wstep">
            <div className="wstep-head"><span className="step-num">3</span><span className="wstep-title">Test the connection</span></div>
            <p className="ta-foot">We'll make a real connection and run a trivial read to confirm it works.</p>
            {testResult && (
              testResult.ok
                ? <div className="notice"><Check width={15} height={15} /> {testResult.message}</div>
                : <div className="error"><strong>{testResult.category.replace('_', ' ')}</strong> — {testResult.message}</div>
            )}
            <div className="wizard-actions">
              <button className="btn btn-subtle" onClick={() => setStep(2)}>Back</button>
              <button className="btn btn-primary" onClick={runTest} disabled={busy}>
                {busy ? <><span className="spinner" /> Testing…</> : <><Play width={15} height={15} /> {testResult ? 'Test again' : 'Test connection'}</>}
              </button>
              {testResult?.ok && (
                <button className="btn btn-primary" onClick={() => setStep(4)}>Continue <ArrowRight width={15} height={15} /></button>
              )}
            </div>
          </div>
        )}

        {/* Step 4 — Generate & deploy */}
        {step === 4 && (
          <div className="wstep">
            <div className="wstep-head"><span className="step-num">4</span><span className="wstep-title">Generate & deploy the MCP server</span></div>
            <p className="ta-foot">Generates a read-only MCP server (validated SELECT-only) and registers it in-process, ready for tool calling.</p>
            {deploy && (
              <>
                <div className="deploy-logs">
                  {deploy.logs.map((l, i) => <div key={i} className="log-line"><Check width={12} height={12} /> {l}</div>)}
                </div>
                {deploy.ok && deploy.code && (
                  <div className="code-card" style={{ marginTop: 12 }}>
                    <div className="code-card-head">
                      <span className="cc-label">Generated MCP server code</span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="copy-btn" onClick={() => setShowCode((s) => !s)}>{showCode ? 'Hide' : 'View'}</button>
                        <button className="copy-btn" onClick={() => download(`mcp_server_${connId}.py`, deploy.code || '', 'text/x-python')}><Download width={12} height={12} /> .py</button>
                      </div>
                    </div>
                    {showCode && <pre style={{ maxHeight: 280, overflow: 'auto' }}>{deploy.code}</pre>}
                  </div>
                )}
                {!deploy.ok && <div className="error"><strong>Deployment failed</strong> — {deploy.error}</div>}
              </>
            )}
            <div className="wizard-actions">
              <button className="btn btn-subtle" onClick={() => setStep(3)}>Back</button>
              <button className="btn btn-primary" onClick={runDeploy} disabled={busy}>
                {busy ? <><span className="spinner" /> Generating…</> : <><Server width={15} height={15} /> {deploy && !deploy.ok ? 'Retry' : 'Generate & deploy'}</>}
              </button>
            </div>
          </div>
        )}

        {/* Step 5 — Verify */}
        {step === 5 && (
          <div className="wstep">
            <div className="wstep-head"><span className="step-num">5</span><span className="wstep-title">Verify read-only access</span></div>
            <p className="ta-foot">Confirms the server responds, the connection works, SELECT works, and writes are blocked.</p>
            {verify && (
              <ul className="verify-list">
                {verify.checks.map((c, i) => (
                  <li key={i} className={c.ok ? 'ok' : 'bad'}>
                    <span className="v-mark">{c.ok ? <Check width={13} height={13} /> : '✕'}</span> {c.label}
                    {c.detail && <span className="hint-inline"> · {c.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
            <div className="wizard-actions">
              <button className="btn btn-subtle" onClick={() => setStep(4)}>Back</button>
              <button className="btn btn-primary" onClick={runVerify} disabled={busy}>
                {busy ? <><span className="spinner" /> Verifying…</> : <><Check width={15} height={15} /> {verify && !verify.ok ? 'Verify again' : 'Verify'}</>}
              </button>
            </div>
          </div>
        )}

        {/* Step 6 — Success */}
        {step === 6 && (
          <div className="wstep">
            <div className="success-panel">
              <div className="success-title"><Check width={22} height={22} /> Ready for read-only queries</div>
              <ul className="verify-list">
                <li className="ok"><span className="v-mark"><Check width={13} height={13} /></span> Database connected</li>
                <li className="ok"><span className="v-mark"><Check width={13} height={13} /></span> MCP server generated</li>
                <li className="ok"><span className="v-mark"><Check width={13} height={13} /></span> Deployment successful</li>
                <li className="ok"><span className="v-mark"><Check width={13} height={13} /></span> Registered successfully</li>
                <li className="ok"><span className="v-mark"><Check width={13} height={13} /></span> Write operations blocked</li>
              </ul>
              <div className="wizard-actions">
                <button className="btn btn-subtle" onClick={() => setMode('list')}>All connections</button>
                <button className="btn btn-primary" onClick={() => { const c = connections.find((x) => x.id === connId); if (c) openQuery(c) }}>
                  <Play width={15} height={15} /> Ask your database
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
