import { useEffect, useState } from 'react'
import { approveAssignment, createWorkOrder, getQueue, resetTriage, triageWorkOrders } from '../api'
import { download, stamp, toCsv } from '../lib/download'
import { Check, Download, Play, Plus, Reset } from '../components/icons'
import type { ToolCall, WorkOrder } from '../types'

const CREWS = ['Safety Response', 'Hydraulics', 'CNC / Machining', 'Electrical', 'General Maintenance']

type Tab = 'queue' | 'assignments'

function isAssigned(o: WorkOrder): boolean {
  return o.status === 'Assigned' || !!o.crew
}

function fmtTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Badge({ urgency }: { urgency?: string | null }) {
  if (!urgency) return <span className="hint-inline">—</span>
  return <span className={`badge ${urgency}`}>{urgency.replace('-', ' ')}</span>
}

export default function Lab3Triage() {
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [crewSel, setCrewSel] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(false)
  const [triaged, setTriaged] = useState(false)
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([])
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('queue')
  const [adding, setAdding] = useState(false)
  const [newMachine, setNewMachine] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    try {
      const data = await getQueue()
      setOrders(data.orders || [])
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => { load() }, [])

  async function runTriage() {
    setLoading(true)
    setError('')
    setTab('queue')
    try {
      const data = await triageWorkOrders()
      setOrders(data.orders || [])
      setTriaged(true)
      setToolCalls(data.tool_calls || [])
      const sel: Record<number, string> = {}
      for (const o of data.orders || []) if (o.proposed_crew) sel[o.id] = o.proposed_crew
      setCrewSel(sel)
      if (data.error && !(data.orders || []).length) setError(data.error)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function approve(o: WorkOrder) {
    const crew = crewSel[o.id] || o.proposed_crew
    const urgency = o.proposed_urgency || 'routine'
    if (!crew) return
    setError('')
    try {
      const res = await approveAssignment({ work_order_id: o.id, crew, urgency })
      if (res.ok) {
        const data = await getQueue()
        const map = Object.fromEntries((data.orders || []).map((x) => [x.id, x] as const))
        setOrders((prev) => prev.map((x) => ({ ...x, ...map[x.id] })))
      } else {
        setError(res.error || 'Assignment failed')
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function reset() {
    setLoading(true)
    setError('')
    try {
      await resetTriage()
      setTriaged(false)
      setToolCalls([])
      setCrewSel({})
      setTab('queue')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function addOrder() {
    const machine = newMachine.trim()
    const description = newDescription.trim()
    if (!machine || !description) return
    setSubmitting(true)
    setError('')
    try {
      const res = await createWorkOrder({ machine, description })
      // Append (don't reload) so existing triage proposals in state survive.
      setOrders((prev) => [...prev, res.order])
      setNewMachine('')
      setNewDescription('')
      setAdding(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  function downloadCsv() {
    const headers = ['WO', 'Machine', 'Issue', 'Urgency', 'Crew', 'Status']
    const rows = orders.map((o) => {
      const assigned = isAssigned(o)
      return [
        o.wo_number,
        o.machine,
        o.description,
        assigned ? o.urgency : o.proposed_urgency || '',
        assigned ? o.crew : crewSel[o.id] || o.proposed_crew || '',
        o.status || (assigned ? 'Assigned' : 'New'),
      ]
    })
    download(`work-orders-${stamp()}.csv`, toCsv(headers, rows), 'text/csv;charset=utf-8')
  }

  const incoming = orders.filter((o) => !isAssigned(o))
  const assigned = orders.filter(isAssigned)
  const readCalls = toolCalls.filter((t) => t.name.includes('read_work_orders')).length

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="eyebrow">Lab 03 <span className="sector-tag">Manufacturing</span></div>
        <h2>Maintenance Work Order Triage</h2>
        <p>
          The agent reads the incoming work-order queue, classifies each by urgency, and
          proposes a crew. Safety-critical items rise to the top.{' '}
          <strong>Nothing is assigned until you click Approve.</strong>
        </p>
      </div>

      <div className="console">
        <div className="toolbar">
          <button className="btn btn-primary" onClick={runTriage} disabled={loading}>
            {loading ? <><span className="spinner" /> Triaging…</> : <><Play width={15} height={15} /> Run triage</>}
          </button>
          <button className="btn btn-subtle" onClick={reset} disabled={loading}><Reset width={15} height={15} /> Reset demo</button>
          <button className="btn btn-ghost" onClick={downloadCsv} disabled={!orders.length}><Download width={15} height={15} /> Assignments CSV</button>
        </div>
      </div>

      {error && <div className="error"><strong>Error</strong> — {error}</div>}

      {/* Two MCP tool domains, as tabs */}
      <div className="mcp-tabs">
        <button className={`mcp-tab ${tab === 'queue' ? 'active' : ''}`} onClick={() => setTab('queue')}>
          <span className="t-title">Incoming Queue</span>
          <span className="t-tool"><span className="t-rw read">read</span> <code>read_work_orders</code></span>
          <span className="t-count">{incoming.length} new</span>
        </button>
        <button className={`mcp-tab ${tab === 'assignments' ? 'active' : ''}`} onClick={() => setTab('assignments')}>
          <span className="t-title">Crew Assignments</span>
          <span className="t-tool"><span className="t-rw write">write</span> <code>assign_crew</code></span>
          <span className="t-count">{assigned.length} assigned</span>
        </button>
      </div>

      {tab === 'queue' ? (
        <div className="result">
          <div className="result-head">
            <div className="rh-title"><b>Incoming Work-Order Queue</b><span className="meta-pill">read_work_orders</span></div>
            <div className="result-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setAdding((a) => !a)}>
                <Plus width={14} height={14} /> Add work order
              </button>
            </div>
          </div>
          {adding && (
            <div className="add-form">
              <input
                className="field"
                placeholder="Machine (e.g. Hydraulic Press #5)"
                value={newMachine}
                onChange={(e) => setNewMachine(e.target.value)}
              />
              <input
                className="field desc"
                placeholder="Describe the issue…"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addOrder() }}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={addOrder}
                disabled={submitting || !newMachine.trim() || !newDescription.trim()}
              >
                {submitting ? <><span className="spinner" /> Adding…</> : 'Add to queue'}
              </button>
              <button className="btn btn-subtle btn-sm" onClick={() => setAdding(false)} disabled={submitting}>Cancel</button>
            </div>
          )}
          <p className="tab-caption">
            The agent <strong>reads</strong> these new orders through the <code>read_work_orders</code> MCP
            tool, then proposes an urgency and crew for each — a proposal only.
            {triaged && readCalls > 0 && <> The tool was called <strong>{readCalls}×</strong> this run.</>}
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>WO</th><th>Machine / issue</th><th>Urgency</th><th>Crew</th><th>Action</th></tr>
              </thead>
              <tbody>
                {incoming.map((o) => (
                  <tr key={o.id} className={o.proposed_urgency === 'safety' ? 'is-safety' : ''}>
                    <td className="mono">{o.wo_number}</td>
                    <td style={{ whiteSpace: 'normal' }}>
                      <div className="wo-machine">{o.machine}</div>
                      <div className="reason">{o.description}</div>
                    </td>
                    <td>
                      <Badge urgency={o.proposed_urgency} />
                      {o.reason && <div className="reason">{o.reason}</div>}
                    </td>
                    <td>
                      {o.proposed_urgency ? (
                        <select
                          className="select"
                          value={crewSel[o.id] || o.proposed_crew || ''}
                          onChange={(e) => setCrewSel((s) => ({ ...s, [o.id]: e.target.value }))}
                        >
                          {CREWS.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      ) : (
                        <span className="hint-inline">—</span>
                      )}
                    </td>
                    <td>
                      {o.proposed_urgency ? (
                        <button className="btn btn-primary btn-sm" onClick={() => approve(o)}>Approve</button>
                      ) : (
                        <span className="hint-inline">Run triage</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {incoming.length === 0 && (
              <p className="rows-note">Queue empty — every work order has been triaged and assigned.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="result">
          <div className="result-head">
            <div className="rh-title"><b>Crew Assignments</b><span className="meta-pill">assign_crew</span></div>
          </div>
          <p className="tab-caption">
            Each row here was <strong>written</strong> by the <code>assign_crew</code> MCP tool — but only
            after you clicked <strong>Approve</strong>. The triage agent is denied this tool, so it can never
            write an assignment on its own.
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>WO</th><th>Machine</th><th>Urgency</th><th>Crew</th><th>Approved by</th><th>Assigned</th></tr>
              </thead>
              <tbody>
                {assigned.map((o) => (
                  <tr key={o.id}>
                    <td className="mono">{o.wo_number}</td>
                    <td style={{ whiteSpace: 'normal' }}><div className="wo-machine">{o.machine}</div></td>
                    <td><Badge urgency={o.urgency} /></td>
                    <td>
                      <span className="assigned-pill"><Check width={13} height={13} /> {o.crew}</span>
                    </td>
                    <td className="hint-inline">{o.approved_by || 'maintenance-lead'}</td>
                    <td className="hint-inline">{fmtTime(o.assigned_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {assigned.length === 0 && (
              <p className="rows-note">No assignments yet. Run triage, then Approve an order to write one via <code>assign_crew</code>.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
