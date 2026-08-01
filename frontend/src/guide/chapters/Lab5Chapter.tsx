/** Lab 5 — the capstone: an MCP server generated at runtime for a database you bring. */
import { useState } from 'react'
import Chapter from '../Chapter'
import UnderTheHood, { Snippet } from '../UnderTheHood'
import { Check, Database, Lock, Server } from '../../components/icons'

const DRIVERS = [
  { id: 'postgres', label: 'PostgreSQL', port: 5432 },
  { id: 'mysql', label: 'MySQL', port: 3306 },
  { id: 'mssql', label: 'SQL Server', port: 1433 },
]

const LIMITS = [
  { k: 'Row cap', v: '500 rows per query' },
  { k: 'Connect timeout', v: '8 seconds' },
  { k: 'Statement timeout', v: '15 seconds' },
  { k: 'Session', v: 'read-only, set per connection' },
]

function Stage({ active }: { active: number }) {
  const [driver, setDriver] = useState(DRIVERS[0])

  return (
    <div className="g-panels">
      {/* 0 — connect */}
      <div className={`g-panel ${active === 0 ? 'on' : ''}`}>
        <div className="g-drivers">
          {DRIVERS.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`g-driver ${d.id === driver.id ? 'on' : ''}`}
              onClick={() => setDriver(d)}
            >
              <Database width={14} height={14} /> {d.label}
            </button>
          ))}
        </div>
        <div className="g-form">
          <div className="g-form-row"><span>host</span><b>analytics.internal</b></div>
          <div className="g-form-row"><span>port</span><b>{driver.port}</b></div>
          <div className="g-form-row"><span>database</span><b>operations</b></div>
          <div className="g-form-row"><span>username</span><b>reporting_ro</b></div>
          <div className="g-form-row secret">
            <span>password</span>
            <b>••••••••••••</b>
            <em><Lock width={11} height={11} /> encrypted at rest</em>
          </div>
        </div>
        <p className="g-panel-note">
          The password is sealed with a Fernet key before it touches the database, and the
          credential table is deliberately not readable by the read-only role.
        </p>
      </div>

      {/* 1 — the server assembles */}
      <div className={`g-panel ${active === 1 ? 'on' : ''}`}>
        <div className="g-build">
          <div className="g-build-node src"><Database width={16} height={16} /> your {driver.label}</div>
          <span className="g-build-wire" aria-hidden="true" />
          <div className="g-build-node srv">
            <Server width={16} height={16} />
            <b>MCP server</b>
            <span className="g-build-tool">list_tables()</span>
            <span className="g-build-tool">run_query(sql)</span>
          </div>
          <span className="g-build-wire" aria-hidden="true" />
          <div className="g-build-node agent">◆ agent</div>
        </div>
        <p className="g-panel-note">
          Two tools, generated for this connection and nothing else. No config file, no deploy step.
        </p>
      </div>

      {/* 2 — structural read-only */}
      <div className={`g-panel ${active === 2 ? 'on' : ''}`}>
        <div className="g-limits">
          {LIMITS.map((l, i) => (
            <div key={l.k} className="g-limit" style={{ animationDelay: `${i * 90}ms` }}>
              <Check width={13} height={13} />
              <span>{l.k}</span>
              <b>{l.v}</b>
            </div>
          ))}
        </div>
        <p className="g-panel-note">
          Statements are parsed into a syntax tree and checked by shape — not by scanning for scary
          words, which is the trick that string matching keeps losing to.
        </p>
      </div>

      {/* 3 — ask your own data */}
      <div className={`g-panel ${active === 3 ? 'on' : ''}`}>
        <div className="g-ask">
          <div className="g-ask-q">Which sites missed their target last quarter?</div>
          <div className="g-ask-tool"><Server width={12} height={12} /> list_tables → 14 tables</div>
          <div className="g-ask-tool"><Server width={12} height={12} /> run_query → 6 rows</div>
          <div className="g-ask-a">
            <span>◆ Agent</span>
            <p>
              Six of the fourteen sites finished below target, with the two largest gaps at
              Riverside and Fairview. Everything else landed within two percent.
            </p>
          </div>
        </div>
        <p className="g-panel-note">
          Same conversation as Lab 2 — except the data is yours, and nobody wrote a tool for it.
        </p>
      </div>
    </div>
  )
}

export default function Lab5Chapter() {
  return (
    <Chapter
      id="lab5"
      num={5}
      title="MCP Server Builder"
      sector="Capstone"
      thesis="Point it at a database it has never seen. The tools build themselves."
      hook={
        <p>
          The first four labs each had a tool someone wrote in advance. The capstone asks the
          harder question: what happens when the data source shows up at runtime and nobody has
          written anything?
        </p>
      }
      beats={[
        {
          label: 'Connect',
          title: 'Bring your own database',
          body: (
            <p>
              PostgreSQL, MySQL or SQL Server. The connection is verified before it's saved, and the
              password is encrypted at rest — plaintext is never stored, not even briefly.
            </p>
          ),
        },
        {
          label: 'Generate',
          title: 'A read-only MCP server, made to order',
          body: (
            <p>
              Two tools appear for that connection: one to list tables, one to run a single SELECT.
              This is MCP's actual promise — capability as something you compose, not something you
              hardcode.
            </p>
          ),
        },
        {
          label: 'Bound',
          title: 'Read-only without a human in the loop',
          body: (
            <p>
              Lab 3 needed an approval gate because its agent had a write tool. This one doesn't have
              one to deny. Statements are validated against a parsed syntax tree, then capped and
              timed out.
            </p>
          ),
        },
        {
          label: 'Ask',
          title: 'And now it answers questions about your data',
          body: (
            <p>
              Everything from Lab 2 applies — plain English in, SQL and rows kept as evidence — but
              against a schema the agent discovers for itself.
            </p>
          ),
        },
      ]}
      stage={(active) => <Stage active={active} />}
    >
      <UnderTheHood summary="Why this needs no approval gate" source="backend/app/agents/lab5_query.py">
        <p>
          The agent is handed exactly the registered server's tool ids, and <code>tools=[]</code>
          removes every built-in. There is no write path to deny, so read-only is structural rather
          than enforced:
        </p>
        <Snippet lang="python">{`return ClaudeAgentOptions(
    system_prompt=SYSTEM_PROMPT,
    model=CLAUDE_MODEL,
    mcp_servers={reg.key: reg.server},
    allowed_tools=reg.tool_ids,
    tools=[],                       # no file/bash/web capability at all
    permission_mode="bypassPermissions",
    setting_sources=[],
)`}</Snippet>
        <p className="g-hood-foot">
          Per-driver sessions are set read-only before any query runs — for Postgres that's
          <code> conn.read_only = True</code> plus a <code>statement_timeout</code>; MySQL and SQL
          Server have their own equivalents in <code>backend/app/lab5/drivers/</code>.
        </p>
      </UnderTheHood>
    </Chapter>
  )
}
