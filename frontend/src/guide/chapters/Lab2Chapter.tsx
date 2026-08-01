/** Lab 2 — one MCP tool, three independent locks. The chapter with the live replay. */
import { useState } from 'react'
import Chapter from '../Chapter'
import Replay from '../Replay'
import UnderTheHood, { Snippet } from '../UnderTheHood'
import { PERMIT_RUNS } from '../transcripts'

const LOCKS = [
  { n: 1, t: 'The SQL text is checked', d: 'One statement, and it must start with SELECT or WITH. A semicolon in the middle is a rejection.' },
  { n: 2, t: 'The transaction is read-only', d: 'The connection sets read-only mode before the query runs, so a write cannot commit even if one slipped through.' },
  { n: 3, t: 'The database role can only read', d: 'It connects as labs_readonly, a role granted SELECT and nothing else. Postgres itself is the last word.' },
]

function Stage({ active, runId, onPick }: { active: number; runId: string; onPick: (id: string) => void }) {
  const run = PERMIT_RUNS.find((r) => r.id === runId) ?? PERMIT_RUNS[0]
  const refusalRun = PERMIT_RUNS.find((r) => r.refused)!

  return (
    <div className="g-panels">
      {/* 0–2 share the replay, so the reader watches one run unfold across three beats */}
      <div className={`g-panel ${active <= 2 ? 'on' : ''}`}>
        <div className="g-chips">
          {PERMIT_RUNS.filter((r) => !r.refused).map((r) => (
            <button
              key={r.id}
              type="button"
              className={`g-chip ${r.id === runId ? 'on' : ''}`}
              onClick={() => onPick(r.id)}
            >
              {r.question}
            </button>
          ))}
        </div>
        <Replay run={run} play={active <= 2} />
      </div>

      {/* 3 — the three locks */}
      <div className={`g-panel ${active === 3 ? 'on' : ''}`}>
        <div className="g-locks">
          {LOCKS.map((l, i) => (
            <div key={l.n} className="g-lock" style={{ animationDelay: `${i * 140}ms` }}>
              <span className="g-lock-n">{l.n}</span>
              <div>
                <b>{l.t}</b>
                <p>{l.d}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="g-panel-note">
          Three independent layers. Defeating one still leaves two, and the last one isn't
          application code at all.
        </p>
      </div>

      {/* 4 — the refusal */}
      <div className={`g-panel ${active === 4 ? 'on' : ''}`}>
        <Replay run={refusalRun} play={active === 4} />
      </div>
    </div>
  )
}

export default function Lab2Chapter() {
  const [runId, setRunId] = useState(PERMIT_RUNS[0].id)

  return (
    <Chapter
      id="lab2"
      num={2}
      title="Permit Status Query"
      sector="Public Sector"
      thesis="Plain English in, read-only SQL out — with the receipts attached."
      hook={
        <p>
          Counter staff field the same questions all day: what's still pending, what did we
          collect, which ones were rejected. The answers live in a database nobody at the
          counter writes SQL against.
        </p>
      }
      beats={[
        {
          label: 'Ask',
          title: 'Ask it the way you’d ask a colleague',
          body: (
            <p>
              No syntax, no column names. Pick one of the questions above the stage and watch
              the same run play out — the agent is given the table's shape in its prompt and
              works out the rest.
            </p>
          ),
        },
        {
          label: 'Query',
          title: 'One SELECT, written on the spot',
          body: (
            <p>
              It writes a single statement and calls <code>run_select</code>. Case-insensitive
              matching, month filters resolved against 2026 — the fiddly details a clerk
              shouldn't have to know.
            </p>
          ),
        },
        {
          label: 'Answer',
          title: 'The answer, and the evidence behind it',
          body: (
            <p>
              The reply is prose, not a data dump — but the exact SQL and every row it saw stay
              one click away in the console. An answer you can't check is a rumour.
            </p>
          ),
        },
        {
          label: 'Locks',
          title: 'Read-only, three times over',
          body: (
            <p>
              "Read-only" is a claim, so the lab makes it structural. Three independent
              mechanisms enforce it, and only one of them is application code.
            </p>
          ),
        },
        {
          label: 'Refuse',
          title: 'Ask it to change something',
          body: (
            <p>
              Try to approve a permit and it declines — and the tool is never called at all.
              The console shows a read-only badge rather than burying the refusal in prose.
            </p>
          ),
        },
      ]}
      stage={(active) => <Stage active={active} runId={runId} onPick={setRunId} />}
    >
      <UnderTheHood summary="The MCP tool and its guard" source="backend/app/mcp_tools/permits.py">
        <p>
          The tool is defined in-process with the SDK's <code>@tool</code> decorator and served by an
          in-memory MCP server — no separate process, no port. The first of the three locks is a
          plain function:
        </p>
        <Snippet lang="python">{`def _looks_read_only(sql: str) -> bool:
    stripped = sql.strip().rstrip(";")
    if ";" in stripped:            # reject chained statements
        return False
    return bool(_SELECT_RE.match(stripped))`}</Snippet>
        <p>
          The second is <code>conn.read_only = True</code> on the connection; the third is the
          <code> labs_readonly</code> role created by <code>backend/db/seed.py</code>, which holds
          <code> SELECT</code> and nothing more.
        </p>
      </UnderTheHood>
    </Chapter>
  )
}
