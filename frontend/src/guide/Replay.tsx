/**
 * Replays a recorded agent run on a single rAF-driven timeline.
 *
 * Derived-from-elapsed-time rather than a chain of setTimeouts: one clock means
 * the SQL, the rows and the answer can never drift out of sync, replaying is
 * just resetting the clock, and reduced-motion is just clamping it to the end.
 *
 * No network. The runs live in transcripts.ts.
 */
import { useEffect, useRef, useState } from 'react'
import { Check, Database, Lock, Reset } from '../components/icons'
import type { Run } from './transcripts'
import { usePrefersReducedMotion } from './useInView'

/** Timeline marks, in ms from the start of a run. */
const T = {
  question: 380,
  sqlStart: 520,
  sqlEnd: 2000,
  toolCall: 2200,
  rowsStart: 2400,
  rowsStep: 110,
  answerStart: 3150,
  answerEnd: 4900,
}

function lerpChars(text: string, from: number, to: number, now: number): string {
  if (now <= from) return ''
  if (now >= to) return text
  const ratio = (now - from) / (to - from)
  return text.slice(0, Math.ceil(text.length * ratio))
}

interface Props {
  run: Run
  /** Play from the top when this becomes true (chapter beat scrolled into view). */
  play: boolean
}

export default function Replay({ run, play }: Props) {
  const reduced = usePrefersReducedMotion()
  const [elapsed, setElapsed] = useState(0)
  const [nonce, setNonce] = useState(0)
  const frame = useRef(0)

  const total = run.refused ? T.answerEnd - 1200 : T.answerEnd

  useEffect(() => {
    if (!play) return
    if (reduced) {
      setElapsed(total) // final state, no animation
      return
    }
    let start = 0
    let last = -1
    setElapsed(0) // a new run must not flash the previous one's finished state
    const tick = (now: number) => {
      if (!start) start = now
      const t = now - start
      // Quantise to ~25fps: typing and row-landing read identically, and this
      // subtree stops re-rendering 60 times a second for five seconds.
      const step = Math.floor(t / 40)
      if (step !== last) {
        last = step
        setElapsed(t)
      }
      if (t < total) frame.current = requestAnimationFrame(tick)
      else setElapsed(total)
    }
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
    // `nonce` re-arms the clock when the replay button is pressed, and `run.id`
    // restarts it when the reader picks a different question.
  }, [play, reduced, total, nonce, run.id])

  const now = elapsed
  const sqlShown = run.refused ? '' : lerpChars(run.sql, T.sqlStart, T.sqlEnd, now)
  const answerShown = lerpChars(
    run.answer,
    run.refused ? T.sqlStart : T.answerStart,
    run.refused ? T.sqlEnd + 400 : T.answerEnd,
    now,
  )
  const rowsVisible = run.refused
    ? 0
    : Math.max(0, Math.min(run.rows.length, Math.floor((now - T.rowsStart) / T.rowsStep) + 1))
  const showQuestion = now >= T.question
  const showTool = !run.refused && now >= T.toolCall
  const streaming = answerShown.length > 0 && answerShown.length < run.answer.length
  const done = now >= total

  return (
    <div className={`g-replay ${run.refused ? 'is-refusal' : ''}`}>
      <div className="g-replay-head">
        <span className="g-replay-dot" aria-hidden="true" />
        <span className="g-replay-title">Recorded run</span>
        <button
          type="button"
          className="g-replay-again"
          onClick={() => { setElapsed(0); setNonce((n) => n + 1) }}
          disabled={!play}
        >
          <Reset width={12} height={12} /> Replay
        </button>
      </div>

      <div className="g-replay-body">
        <div className={`g-rp-ask ${showQuestion ? 'in' : ''}`}>{run.question}</div>

        {run.refused ? (
          <div className={`g-rp-refuse ${now >= T.question + 200 ? 'in' : ''}`}>
            <Lock width={14} height={14} />
            <span>Write request declined — the tool was never called.</span>
          </div>
        ) : (
          <>
            <div className="g-rp-step">
              <span className="g-rp-step-label">Agent writes SQL</span>
              <pre className="g-rp-sql">
                {sqlShown}
                {sqlShown.length > 0 && sqlShown.length < run.sql.length && <span className="g-caret" />}
              </pre>
            </div>

            <div className={`g-rp-tool ${showTool ? 'in' : ''}`}>
              <Database width={13} height={13} />
              <code>run_select</code>
              <span className="g-rp-tool-note">read-only · single statement</span>
              {rowsVisible > 0 && <Check width={13} height={13} className="g-rp-tick" />}
            </div>

            {rowsVisible > 0 && (
              <div className="g-rp-table-wrap">
                <table className="g-rp-table">
                  <thead>
                    <tr>{run.columns.map((c) => <th key={c}>{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {run.rows.slice(0, rowsVisible).map((row, i) => (
                      <tr key={i} style={{ animationDelay: `${i * 40}ms` }}>
                        {row.map((cell, j) => (
                          <td key={j} className={typeof cell === 'number' ? 'num' : undefined}>
                            {typeof cell === 'number' && run.columns[j] === 'fee'
                              ? `$${cell.toFixed(2)}`
                              : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <span className="g-rp-rowcount">
                  {run.rows.length} {run.rows.length === 1 ? 'row' : 'rows'} returned
                </span>
              </div>
            )}
          </>
        )}

        {answerShown && (
          <div className="g-rp-answer">
            <span className="g-rp-answer-label">◆ Agent</span>
            <p>
              {answerShown}
              {streaming && <span className="g-caret" />}
            </p>
          </div>
        )}

        {!done && <span className="g-rp-progress" style={{ transform: `scaleX(${Math.min(1, now / total)})` }} />}
      </div>
    </div>
  )
}
