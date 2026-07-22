import { useRef, useState } from 'react'
import { askPermits } from '../api'
import Markdown from '../components/Markdown'
import { download, stamp, toCsv } from '../lib/download'
import { Check, Copy, Download, Play, Trash } from '../components/icons'
import type { ResultTable } from '../types'

const EXAMPLES = [
  'How many electrical permits are still pending from June?',
  'List the 5 most recent permit applications.',
  'What is the total fee collected for approved permits?',
  'How many permits of each type were submitted?',
  'Which plumbing permits were rejected?',
]

/** One question/answer exchange in the conversation. */
interface ChatTurn {
  id: number
  question: string
  answer: string
  sql: string | null
  table: ResultTable | null
  error: string | null
}

/** Typing this (case-insensitive) wipes the conversation instead of querying. */
function isClearCommand(s: string): boolean {
  const t = s.trim().toLowerCase()
  return t === 'clear' || t === '/clear'
}

/**
 * The UI owns the SQL panel, so strip any SQL the model still embeds in its
 * prose answer — removes fenced code blocks and dangling "SQL:" labels.
 */
function stripEmbeddedSql(answer: string): string {
  if (!answer) return ''
  return answer
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^[ \t]*\*{0,2}(here'?s the |the )?sql( (query|i ran|used|statement))?:?\*{0,2}[ \t]*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function downloadTurnCsv(turn: ChatTurn): void {
  if (!turn.table) return
  download(`permit-results-${stamp()}.csv`, toCsv(turn.table.columns, turn.table.rows), 'text/csv;charset=utf-8')
}

function downloadTurnMd(turn: ChatTurn): void {
  const parts = [`# Permit Query\n`, `**Question:** ${turn.question}\n`, turn.answer]
  if (turn.sql) parts.push(`\n## SQL\n\n\`\`\`sql\n${turn.sql}\n\`\`\``)
  download(`permit-answer-${stamp()}.md`, parts.join('\n'), 'text/markdown;charset=utf-8')
}

function CopyButton({ text }: { text: string }) {
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

function TurnCard({ turn }: { turn: ChatTurn }) {
  return (
    <div className="result chat-turn">
      <div className="result-head">
        <div className="rh-title"><span className="q-tag">Q</span> <b>{turn.question}</b></div>
        <div className="result-actions">
          {turn.table && <button className="btn btn-ghost btn-sm" onClick={() => downloadTurnCsv(turn)}><Download width={14} height={14} /> CSV</button>}
          <button className="btn btn-ghost btn-sm" onClick={() => downloadTurnMd(turn)}><Download width={14} height={14} /> .md</button>
        </div>
      </div>

      <div className="result-body">
        {turn.answer ? (
          <Markdown>{turn.answer}</Markdown>
        ) : turn.error ? (
          <div className="error"><strong>Agent error</strong> — {turn.error}</div>
        ) : (
          <p className="rows-note">No answer returned.</p>
        )}

        {turn.sql && (
          <div className="code-card">
            <div className="code-card-head">
              <span className="cc-label">SQL the agent ran</span>
              <CopyButton text={turn.sql} />
            </div>
            <pre>{turn.sql}</pre>
          </div>
        )}
      </div>

      {turn.table && (
        <div className="section">
          <div className="section-label">
            <span>Results · {turn.table.rows.length} {turn.table.rows.length === 1 ? 'row' : 'rows'}</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>{turn.table.columns.map((c) => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {turn.table.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => <td key={j}>{cell === null ? '—' : String(cell)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {turn.table.rows.length === 0 && <p className="rows-note">No matching rows.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Lab2PermitQuery() {
  const [question, setQuestion] = useState('')
  const [history, setHistory] = useState<ChatTurn[]>([])
  const [pending, setPending] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const idRef = useRef(0)

  function clearChat() {
    setHistory([])
    setError('')
  }

  async function ask(q?: string) {
    const query = (q ?? question).trim()
    if (!query || loading) return

    if (isClearCommand(query)) {
      clearChat()
      setQuestion('')
      return
    }

    setQuestion('')
    setError('')
    setPending(query)
    setLoading(true)
    // Newest answer renders at the top; jump there so it's immediately visible.
    window.scrollTo({ top: 0, behavior: 'smooth' })
    try {
      const data = await askPermits(query)
      const turn: ChatTurn = {
        id: idRef.current++,
        question: query,
        answer: stripEmbeddedSql(data.answer ?? ''),
        sql: data.sql,
        table: data.table && data.table.ok ? data.table : null,
        error: data.error,
      }
      setHistory((h) => [...h, turn])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPending(null)
      setLoading(false)
    }
  }

  const hasChat = history.length > 0 || pending !== null

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="eyebrow">Lab 02 <span className="sector-tag">Public Sector</span></div>
        <h2>Permit Status Query</h2>
        <p>
          Ask about building-permit applications in plain English. The agent writes a
          read-only SQL query, runs it, and answers — with the exact SQL shown separately.
          Type <code>clear</code> to reset the conversation.
        </p>
      </div>

      <div className="console chat-console">
        <div className="controls">
          <input
            className="field"
            type="text"
            value={question}
            placeholder="Ask about permits…  (type “clear” to reset the chat)"
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

      {error && <div className="error"><strong>Error</strong> — {error}</div>}

      {hasChat ? (
        <div className="chat-log">
          <div className="chat-log-head">
            <span className="chat-log-title">
              Conversation · {history.length} {history.length === 1 ? 'query' : 'queries'}
              {history.length > 1 && ' · newest first'}
            </span>
            <button className="linkish" onClick={clearChat} disabled={loading || history.length === 0}>
              <Trash width={13} height={13} /> Clear chat
            </button>
          </div>

          {pending && (
            <div className="result chat-turn">
              <div className="result-head">
                <div className="rh-title"><span className="q-tag">Q</span> <b>{pending}</b></div>
              </div>
              <div className="result-body">
                <div className="agent-status"><span className="spinner" /> The agent is writing SQL and querying the permits database…</div>
              </div>
            </div>
          )}

          {history.slice().reverse().map((turn) => <TurnCard key={turn.id} turn={turn} />)}
        </div>
      ) : (
        <div className="empty">
          <div className="empty-mark">💬</div>
          <p>Ask a permit question to start the conversation. Type <code>clear</code> anytime to reset it.</p>
        </div>
      )}
    </div>
  )
}
