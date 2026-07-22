import { useEffect, useState } from 'react'
import { getQueue, triageWorkOrders, approveAssignment, resetTriage } from '../api.js'
import { download, toCsv, stamp } from '../lib/download.js'
import { Download, Play, Reset, Check } from '../components/icons.jsx'

const CREWS = ['Safety Response', 'Hydraulics', 'CNC / Machining', 'Electrical', 'General Maintenance']

function Badge({ urgency }) {
  if (!urgency) return <span className="hint-inline">—</span>
  return <span className={`badge ${urgency}`}>{urgency.replace('-', ' ')}</span>
}

export default function Lab3Triage() {
  const [orders, setOrders] = useState([])
  const [crewSel, setCrewSel] = useState({})
  const [loading, setLoading] = useState(false)
  const [triaged, setTriaged] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      const data = await getQueue()
      setOrders(data.orders || [])
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => { load() }, [])

  async function runTriage() {
    setLoading(true)
    setError('')
    try {
      const data = await triageWorkOrders()
      setOrders(data.orders || [])
      setTriaged(true)
      const sel = {}
      for (const o of data.orders || []) if (o.proposed_crew) sel[o.id] = o.proposed_crew
      setCrewSel(sel)
      if (data.error && !(data.orders || []).length) setError(data.error)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function approve(o) {
    const crew = crewSel[o.id] || o.proposed_crew
    const urgency = o.proposed_urgency || 'routine'
    if (!crew) return
    setError('')
    try {
      const res = await approveAssignment({ work_order_id: o.id, crew, urgency })
      if (res.ok) {
        const data = await getQueue()
        const map = Object.fromEntries((data.orders || []).map((x) => [x.id, x]))
        setOrders((prev) => prev.map((x) => ({ ...x, ...map[x.id] })))
      } else {
        setError(res.error || 'Assignment failed')
      }
    } catch (e) {
      setError(e.message)
    }
  }

  async function reset() {
    setLoading(true)
    setError('')
    try {
      await resetTriage()
      setTriaged(false)
      setCrewSel({})
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function downloadCsv() {
    const headers = ['WO', 'Machine', 'Issue', 'Urgency', 'Crew', 'Status']
    const rows = orders.map((o) => {
      const assigned = o.status === 'Assigned' || !!o.crew
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

  const assignedCount = orders.filter((o) => o.status === 'Assigned' || o.crew).length

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

      <div className="result">
        <div className="result-head">
          <div className="rh-title">
            <b>Work Order Queue</b>
            <span className="meta-pill">{orders.length} orders · {assignedCount} assigned</span>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>WO</th>
                <th>Machine / issue</th>
                <th>Urgency</th>
                <th>Crew</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const assigned = o.status === 'Assigned' || !!o.crew
                return (
                  <tr key={o.id} className={o.proposed_urgency === 'safety' && !assigned ? 'is-safety' : ''}>
                    <td className="mono">{o.wo_number}</td>
                    <td style={{ whiteSpace: 'normal' }}>
                      <div className="wo-machine">{o.machine}</div>
                      <div className="reason">{o.description}</div>
                    </td>
                    <td>
                      <Badge urgency={assigned ? o.urgency : o.proposed_urgency} />
                      {!assigned && o.reason && <div className="reason">{o.reason}</div>}
                    </td>
                    <td>
                      {assigned ? (
                        o.crew
                      ) : triaged ? (
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
                      {assigned ? (
                        <span className="assigned-pill"><Check width={14} height={14} /> Assigned</span>
                      ) : triaged ? (
                        <button className="btn btn-primary btn-sm" onClick={() => approve(o)}>Approve</button>
                      ) : (
                        <span className="hint-inline">Run triage</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!orders.length && <p className="rows-note">No work orders in the queue.</p>}
        </div>
      </div>
    </div>
  )
}
