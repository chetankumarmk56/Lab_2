import { useState } from 'react'
import { askPermits } from '../api.js'
import Markdown from '../components/Markdown.jsx'
import { download, toCsv, stamp } from '../lib/download.js'
import { Copy, Check, Download, Play } from '../components/icons.jsx'

const EXAMPLES = [
  'How many electrical permits are still pending from June?',
  'List the 5 most recent permit applications.',
  'What is the total fee collected for approved permits?',
  'How many permits of each type were submitted?',
  'Which plumbing permits were rejected?',
]

/**
 * The UI owns the SQL panel, so strip any SQL the model still embeds in its
 * prose answer — removes fenced code blocks and dangling "SQL:" labels. This
 * guarantees the SQL is never shown twice, independent of the agent prompt.
 */
function stripEmbeddedSql(answer) {
  if (!answer) return ''
  return answer
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^[ \t]*\*{0,2}(here'?s the |the )?sql( (query|i ran|used|statement))?:?\*{0,2}[ \t]*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function CopyButton({ text }) {
  const [done, setDone] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 1600)
    } catch {
      /* clipboard blocked — ignore */
    }
  }
  return (
    <button className={`copy-btn ${done ? 'done' : ''}`} onClick={copy}>
      {done ? <Check width={13} height={13} /> : <Copy width={13} height={13} />}
      {done ? 'Copied' : 'Copy'}
    </button>
  )
}

export default function Lab2PermitQuery() {
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState('')
  const [loading, setLoading] = useState(false)
  const [resp, setResp] = useState(null)
  const [error, setError] = useState('')

  async function ask(q) {
    const query = (q ?? question).trim()
    if (!query) return
    setQuestion(query)
    setAsked(query)
    setLoading(true)
    setError('')
    setResp(null)
    try {
      const data = await askPermits(query)
      setResp(data)
      if (data.error && !data.answer) setError(data.error)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const table = resp?.table && resp.table.ok ? resp.table : null
  const answer = stripEmbeddedSql(resp?.answer)

  function downloadCsv() {
    if (!table) return
    download(`permit-results-${stamp()}.csv`, toCsv(table.columns, table.rows), 'text/csv;charset=utf-8')
  }

  function downloadMd() {
    const parts = [`# Permit Query\n`, `**Question:** ${asked}\n`, answer]
    if (resp?.sql) parts.push(`\n## SQL\n\n\`\`\`sql\n${resp.sql}\n\`\`\``)
    download(`permit-answer-${stamp()}.md`, parts.join('\n'), 'text/markdown;charset=utf-8')
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="eyebrow">Lab 02 <span className="sector-tag">Public Sector</span></div>
        <h2>Permit Status Query</h2>
        <p>
          Ask about building-permit applications in plain English. The agent writes a
          read-only SQL query, runs it, and answers — with the exact SQL shown separately.
        </p>
      </div>

      <div className="console">
        <div className="controls">
          <input
            className="field"
            type="text"
            value={question}
            placeholder="e.g. How many electrical permits are still pending from June?"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') ask() }}
          />
          <button className="btn btn-primary" onClick={() => ask()} disabled={loading || !question.trim()}>
            {loading ? <><span className="spinner" /> Asking…</> : <><Play width={15} height={15} /> Ask</>}
          </button>
        </div>
        <div className="chips">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip" onClick={() => ask(ex)} disabled={loading}>{ex}</button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="agent-status"><span className="spinner" /> The agent is writing SQL and querying the permits database…</div>
      )}
      {error && <div className="error"><strong>Agent error</strong> — {error}</div>}

      {resp && answer && !loading && (
        <div className="result">
          <div className="result-head">
            <div className="rh-title"><b>Answer</b></div>
            <div className="result-actions">
              {table && <button className="btn btn-ghost btn-sm" onClick={downloadCsv}><Download width={14} height={14} /> Results CSV</button>}
              <button className="btn btn-ghost btn-sm" onClick={downloadMd}><Download width={14} height={14} /> Answer .md</button>
            </div>
          </div>

          <div className="result-body">
            <Markdown>{answer}</Markdown>

            {resp.sql && (
              <div className="code-card">
                <div className="code-card-head">
                  <span className="cc-label">SQL the agent ran</span>
                  <CopyButton text={resp.sql} />
                </div>
                <pre>{resp.sql}</pre>
              </div>
            )}
          </div>

          {table && (
            <div className="section">
              <div className="section-label">
                <span>Results · {table.rows.length} {table.rows.length === 1 ? 'row' : 'rows'}</span>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>{table.columns.map((c) => <th key={c}>{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => <td key={j}>{cell === null ? '—' : String(cell)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {table.rows.length === 0 && <p className="rows-note">No matching rows.</p>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
