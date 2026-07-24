import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { askPermitsStream, getPermitDataset } from '../api'
import Markdown from '../components/Markdown'
import { download, stamp, toCsv } from '../lib/download'
import { ArrowRight, Check, Copy, Database, Download, Lock, Trash } from '../components/icons'
import type { Cell, PermitDataset, ResultTable } from '../types'

const EXAMPLES = [
  'How many electrical permits are still pending from June?',
  'List the 5 most recent permit applications.',
  'What is the total fee collected for approved permits?',
  'How many permits of each type were submitted?',
  'Which plumbing permits were rejected?',
]

/** Marker the agent prefixes onto a refusal; hidden from the user, drives the badge. */
const SENTINEL = '[[READONLY_REFUSAL]]'

/** Columns rendered as USD currency / friendly dates in the results table. */
const MONEY_COL = /(^|_)(fee|fees|amount|amt|cost|price)(_|$)/i
const DATE_COL = /date/i
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/** Live state of one question as it streams, or a finished turn in history. */
interface TurnData {
  question: string
  answer: string // raw (may hold the sentinel / stray SQL); cleaned at render
  sql: string | null
  table: ResultTable | null
  refused: boolean
  error: string | null
  phase: 'writing' | 'running' | 'answering' | 'done'
}
interface ChatTurn extends TurnData {
  id: number
}

/** Typing this (case-insensitive) wipes the conversation instead of querying. */
function isClearCommand(s: string): boolean {
  const t = s.trim().toLowerCase()
  return t === 'clear' || t === '/clear'
}

/**
 * The UI owns the SQL panel and the refusal badge, so strip anything the model
 * still embeds in its prose — fenced code, "SQL:" labels, and the sentinel.
 */
function cleanAnswer(raw: string): string {
  if (!raw) return ''
  return raw
    .split(SENTINEL).join('')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^[ \t]*\*{0,2}(here'?s the |the )?sql( (query|i ran|used|statement))?:?\*{0,2}[ \t]*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isMoneyCol(column: string): boolean {
  return MONEY_COL.test(column)
}

/** Format a cell for display: fees as currency, dates as "Jun 3, 2026". */
function formatCell(column: string, value: Cell): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number' && isMoneyCol(column)) return usd.format(value)
  if (typeof value === 'string' && DATE_COL.test(column)) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
    if (m) {
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
    }
  }
  return String(value)
}

function downloadTurnCsv(turn: ChatTurn): void {
  if (!turn.table) return
  download(`permit-results-${stamp()}.csv`, toCsv(turn.table.columns, turn.table.rows), 'text/csv;charset=utf-8')
}

function downloadTurnMd(turn: ChatTurn): void {
  const parts = [`# Permit Query\n`, `**Question:** ${turn.question}\n`, cleanAnswer(turn.answer)]
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

/** A compact summary of the permits data, so staff know what's askable (intro only). */
function DatasetStrip({ data }: { data: PermitDataset }) {
  const fmt = (d: string | null) => (d ? formatCell('date', d) : '—')
  return (
    <div className="l2-dataset">
      <div className="l2-ds-head">
        <Database width={14} height={14} /> <b>{data.total}</b> permits in the database — ask about any of these:
      </div>
      <div className="l2-ds-groups">
        <div className="l2-ds-group">
          <span className="l2-ds-label">Types</span>
          {data.types.map((t) => (
            <span key={t.name} className="l2-ds-pill">{t.name} <em>{t.count}</em></span>
          ))}
        </div>
        <div className="l2-ds-group">
          <span className="l2-ds-label">Statuses</span>
          {data.statuses.map((s) => (
            <span key={s.name} className="l2-ds-pill">{s.name} <em>{s.count}</em></span>
          ))}
        </div>
        <div className="l2-ds-group">
          <span className="l2-ds-label">Submitted</span>
          <span className="l2-ds-pill">{fmt(data.date_range.min)} – {fmt(data.date_range.max)}</span>
        </div>
      </div>
    </div>
  )
}

/** Slim one-line dataset hint for the persistent header. */
function DatasetHint({ data }: { data: PermitDataset }) {
  const f = (d: string | null) => (d ? formatCell('date', d) : '—')
  return (
    <span className="l2-hint">
      <Database width={13} height={13} />
      <b>{data.total}</b> permits · {data.types.length} types · {f(data.date_range.min)} – {f(data.date_range.max)}
    </span>
  )
}

/** "SQL · N rows" summary label for the collapsible evidence disclosure. */
function evidenceLabel(turn: ChatTurn | TurnData): string {
  const parts: string[] = []
  if (turn.sql) parts.push('SQL')
  if (turn.table) {
    const n = turn.table.rows.length
    parts.push(`${n} ${n === 1 ? 'row' : 'rows'}`)
  }
  return parts.join(' · ')
}

/** The inner SQL card + results table shared by the live and collapsed evidence. */
function EvidenceBody({ turn, live }: { turn: ChatTurn | TurnData; live?: boolean }) {
  return (
    <div className="l2-evidence-body">
      {turn.sql && (
        <div className="code-card">
          <div className="code-card-head">
            <span className="cc-label">SQL the agent ran</span>
            {!live && <CopyButton text={turn.sql} />}
          </div>
          <pre>{turn.sql}</pre>
        </div>
      )}
      {turn.table && (
        <div>
          <p className="l2-res-label">
            Results · {turn.table.rows.length} {turn.table.rows.length === 1 ? 'row' : 'rows'}
          </p>
          <div className="l2-res-card">
            <div className="l2-table-scroll">
              <table className="data-table">
                <thead>
                  <tr>{turn.table.columns.map((c) => <th key={c} className={isMoneyCol(c) ? 'num' : undefined}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {turn.table.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => {
                        const col = turn.table!.columns[j] ?? ''
                        return <td key={j} className={isMoneyCol(col) ? 'num' : undefined}>{formatCell(col, cell)}</td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {turn.table.rows.length === 0 && <p className="rows-note">No matching rows.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * SQL panel + results, tucked into the agent turn.
 * While a turn is streaming (`live`) the evidence is shown in a plain, always-
 * expanded container — no <details> toggle — so nothing snaps shut on the reader.
 * A finished turn uses an uncontrolled-style <details> whose open state lives in
 * React state (seeded once from `defaultOpen`), so parent re-renders never force
 * it back open and completion never collapses what the reader was just watching.
 */
function Evidence({ turn, live, defaultOpen }: { turn: ChatTurn | TurnData; live?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  if (!turn.sql && !turn.table) return null

  if (live) {
    return (
      <div className="l2-evidence l2-evidence-live">
        <div className="l2-evidence-livehead">
          <Database width={13} height={13} /> {evidenceLabel(turn)}
        </div>
        <EvidenceBody turn={turn} live />
      </div>
    )
  }

  return (
    <details
      className="l2-evidence"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <Database width={13} height={13} /> {evidenceLabel(turn)}
      </summary>
      <EvidenceBody turn={turn} />
    </details>
  )
}

/**
 * One exchange = right-aligned user bubble + full-width agent turn.
 * `live` renders the currently-streaming turn; otherwise a finished history entry.
 */
function TurnView({ turn, live, defaultOpen }: { turn: ChatTurn | TurnData; live?: boolean; defaultOpen?: boolean }) {
  const answer = cleanAnswer(turn.answer)
  const streaming = live && turn.phase === 'answering'
  const showActions = !live && (answer.length > 0 || turn.table != null)

  return (
    <div className="l2-exchange">
      <div className="l2-user">
        <div className="l2-bubble">{turn.question}</div>
      </div>

      <div className={`l2-agent ${turn.refused ? 'is-refusal' : ''}`}>
        <div className="l2-agent-label">
          <span className="l2-diamond" aria-hidden="true">◆</span> Agent
        </div>

        {turn.refused && (
          <div className="l2-refusal">
            <Lock width={14} height={14} />
            <span>Read-only agent — this write request was declined. No data was changed.</span>
          </div>
        )}

        {answer ? (
          <div className="l2-answer">
            <Markdown>{answer + (streaming ? ' ▍' : '')}</Markdown>
          </div>
        ) : turn.error ? (
          <div className="error"><strong>Agent error</strong> — {turn.error}</div>
        ) : live ? (
          <div className="l2-phase" role="status" aria-live="polite">
            <span className="spinner" />
            {turn.phase === 'running'
              ? 'Running the query and reading the results…'
              : 'Writing a read-only SQL query…'}
          </div>
        ) : (
          <p className="l2-note">No answer returned.</p>
        )}

        <Evidence turn={turn} live={live} defaultOpen={defaultOpen} />

        {showActions && 'id' in turn && (
          <div className="l2-actions">
            {turn.table && (
              <button className="btn btn-ghost btn-sm" onClick={() => downloadTurnCsv(turn)}>
                <Download width={14} height={14} /> CSV
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => downloadTurnMd(turn)}>
              <Download width={14} height={14} /> .md
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Lab2PermitQuery() {
  const [question, setQuestion] = useState('')
  const [history, setHistory] = useState<ChatTurn[]>([])
  const [streaming, setStreaming] = useState<TurnData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dataset, setDataset] = useState<PermitDataset | null>(null)
  const [showJump, setShowJump] = useState(false)
  const idRef = useRef(0)
  const streamRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickRef = useRef(true) // follow the newest turn unless the user scrolls up

  useEffect(() => {
    getPermitDataset().then(setDataset).catch(() => {/* enhancement only — ignore */})
  }, [])

  // Stick to the bottom on a new turn and continuously while streaming — but only
  // when the reader is parked near the bottom. useLayoutEffect snaps pre-paint, so
  // there's no flicker as the streamed answer grows the message height. When the
  // message region has no internal overflow (mobile: the whole window scrolls),
  // follow by scrolling the bottom sentinel into view instead.
  useLayoutEffect(() => {
    const el = streamRef.current
    if (!el || !stickRef.current) return
    if (el.scrollHeight > el.clientHeight + 1) {
      el.scrollTop = el.scrollHeight
    } else {
      bottomRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [history, streaming])

  function onStreamScroll() {
    const el = streamRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    stickRef.current = nearBottom
    setShowJump((prev) => (prev === !nearBottom ? prev : !nearBottom))
  }

  function jumpToLatest() {
    const el = streamRef.current
    if (!el) return
    stickRef.current = true
    setShowJump(false)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' })
  }

  function autoGrow() {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  function resetInput() {
    setQuestion('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
  }

  function onInputChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setQuestion(e.target.value)
    autoGrow()
  }

  function onInputKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      ask()
    }
  }

  function clearChat() {
    setHistory([])
    setError('')
  }

  async function ask(q?: string) {
    const query = (q ?? question).trim()
    if (!query || loading) return

    if (isClearCommand(query)) {
      clearChat()
      resetInput()
      return
    }

    resetInput()
    setError('')
    setLoading(true)
    // Newest turn renders at the bottom; re-engage follow so it scrolls into view.
    stickRef.current = true
    setShowJump(false)

    let cur: TurnData = {
      question: query, answer: '', sql: null, table: null,
      refused: false, error: null, phase: 'writing',
    }
    setStreaming(cur)
    const update = (patch: Partial<TurnData>) => {
      cur = { ...cur, ...patch }
      setStreaming(cur)
    }

    try {
      await askPermitsStream(query, (ev) => {
        switch (ev.type) {
          case 'status':
            update({ phase: ev.phase })
            break
          case 'sql':
            update({ sql: ev.sql })
            break
          case 'table':
            update({ table: ev.table.ok ? ev.table : null })
            break
          case 'answer_reset':
            update({ answer: '' })
            break
          case 'delta': {
            const answer = cur.answer + ev.text
            update({ answer, phase: 'answering', refused: cur.refused || answer.includes(SENTINEL) })
            break
          }
          case 'done': {
            const finished: ChatTurn = {
              id: idRef.current++,
              question: cur.question,
              answer: cleanAnswer(ev.answer).length ? ev.answer : cur.answer,
              sql: ev.sql ?? cur.sql,
              table: cur.table,
              refused: ev.refused || cur.refused,
              error: ev.error,
              phase: 'done',
            }
            setHistory((h) => [...h, finished])
            setStreaming(null)
            break
          }
        }
      })
    } catch (e) {
      setError((e as Error).message)
      setStreaming(null)
    } finally {
      setLoading(false)
    }
  }

  const hasChat = history.length > 0 || streaming !== null

  return (
    <div className="l2-root">
      <header className="l2-head">
        <div>
          <div className="eyebrow">Lab 02 <span className="l2-sector">Public Sector</span></div>
          <h2 className="l2-title">Permit Status Query</h2>
        </div>
        <div className="l2-head-aux">
          {dataset && <DatasetHint data={dataset} />}
          {history.length > 0 && (
            <button className="linkish" onClick={clearChat} disabled={loading} aria-label="Clear conversation">
              <Trash width={13} height={13} /> Clear
            </button>
          )}
        </div>
      </header>

      <div className="l2-scroll">
        <div className="l2-stream" ref={streamRef} onScroll={onStreamScroll}>
          <div className="l2-thread">
            {error && <div className="error"><strong>Error</strong> — {error}</div>}

            {hasChat ? (
              <>
                {history.map((turn, i) => (
                  <TurnView key={turn.id} turn={turn} defaultOpen={i === history.length - 1} />
                ))}
                {streaming && <TurnView turn={streaming} live />}
              </>
            ) : (
              <div className="l2-intro">
                <div className="l2-intro-head">
                  <span className="l2-intro-mark" aria-hidden="true">◆</span>
                  <div>
                    <h3>Ask about building permits</h3>
                    <p>
                      Plain-English questions become read-only SQL. The agent runs the query and
                      answers — with the exact SQL and rows tucked into each reply. Type{' '}
                      <code>clear</code> anytime to reset the conversation.
                    </p>
                  </div>
                </div>
                {dataset && <DatasetStrip data={dataset} />}
                <div>
                  <span className="l2-intro-examples-label">Try one</span>
                  <div className="chips">
                    {EXAMPLES.map((ex) => (
                      <button key={ex} className="chip" onClick={() => ask(ex)} disabled={loading}>{ex}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} className="l2-anchor" aria-hidden="true" />
          </div>
        </div>

        {showJump && hasChat && (
          <button className="l2-jump" onClick={jumpToLatest} aria-label="Jump to latest message">
            <ArrowRight width={14} height={14} /> Latest
          </button>
        )}
      </div>

      <form
        className="l2-composer"
        onSubmit={(e) => { e.preventDefault(); ask() }}
      >
        <div className="l2-composer-inner">
          <div className="l2-composer-box">
            <label className="l2-vh" htmlFor="l2-ask">Ask about permits</label>
            <textarea
              id="l2-ask"
              ref={inputRef}
              className="l2-input"
              rows={1}
              value={question}
              placeholder="Ask about permits…  (type “clear” to reset the chat)"
              onChange={onInputChange}
              onKeyDown={onInputKeyDown}
            />
            <button
              type="submit"
              className="l2-send"
              disabled={loading || !question.trim()}
              aria-label={loading ? 'Asking…' : 'Send question'}
            >
              {loading ? <span className="spinner" /> : <ArrowRight width={18} height={18} />}
            </button>
          </div>
          <p className="l2-composer-hint">
            Enter to send · Shift+Enter for a new line · type <code>clear</code> to reset
          </p>
        </div>
      </form>
    </div>
  )
}
