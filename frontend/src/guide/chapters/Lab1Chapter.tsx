/** Lab 1 — file tools, scoped to one folder. The simplest way to give an agent power. */
import Chapter from '../Chapter'
import UnderTheHood, { Snippet } from '../UnderTheHood'
import { SHIFT_LINES } from '../transcripts'
import { Check, Upload } from '../../components/icons'

const TOOLS = [
  { name: 'Read', on: true },
  { name: 'Glob', on: true },
  { name: 'Grep', on: true },
  { name: 'Write', on: false },
  { name: 'Bash', on: false },
  { name: 'WebFetch', on: false },
]

function delta(now: number, before: number) {
  const d = now - before
  const pct = before === 0 ? 0 : Math.round((d / before) * 100)
  return { d, pct, bad: d < 0 }
}

function Stage({ active }: { active: number }) {
  return (
    <div className="g-panels">
      {/* 0 — the two files land in a scratch folder */}
      <div className={`g-panel ${active === 0 ? 'on' : ''}`}>
        <div className="g-files">
          {['current_shift.csv', 'previous_shift.csv'].map((f, i) => (
            <div key={f} className="g-file" style={{ animationDelay: `${i * 120}ms` }}>
              <Upload width={15} height={15} />
              <div>
                <b>{f}</b>
                <span>12 hourly rows · 3 lines</span>
              </div>
            </div>
          ))}
        </div>
        <p className="g-panel-note">
          Both files are written into a scratch directory created for this one request,
          and that directory is the agent's entire world.
        </p>
      </div>

      {/* 1 — the tool belt */}
      <div className={`g-panel ${active === 1 ? 'on' : ''}`}>
        <div className="g-tools">
          {TOOLS.map((t, i) => (
            <span key={t.name} className={`g-tool ${t.on ? 'on' : 'off'}`} style={{ animationDelay: `${i * 60}ms` }}>
              {t.on && <Check width={12} height={12} />}
              {t.name}
            </span>
          ))}
        </div>
        <p className="g-panel-note">
          Three read-only tools are handed over. There is no write tool, no shell and no
          network — not "it was told not to", but <em>it does not have them</em>.
        </p>
      </div>

      {/* 2 — the numbers */}
      <div className={`g-panel ${active === 2 ? 'on' : ''}`}>
        <table className="g-table">
          <thead>
            <tr><th>Line</th><th className="num">Units</th><th className="num">Downtime</th><th className="num">Defects</th></tr>
          </thead>
          <tbody>
            {SHIFT_LINES.map((l, i) => {
              const u = delta(l.units, l.prevUnits)
              const flag = l.line === 'Line-3'
              return (
                <tr key={l.line} className={flag ? 'flag' : ''} style={{ animationDelay: `${i * 90}ms` }}>
                  <td>{l.line}</td>
                  <td className="num">
                    {l.units} <em className={u.bad ? 'down' : 'up'}>{u.bad ? '▼' : '▲'}{Math.abs(u.pct)}%</em>
                  </td>
                  <td className="num">{l.downtime}m</td>
                  <td className="num">{l.defects}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="g-panel-note">Every total is summed from the raw rows — the prompt forbids estimating.</p>
      </div>

      {/* 3 — the exception */}
      <div className={`g-panel ${active === 3 ? 'on' : ''}`}>
        <div className="g-report">
          <div className="g-report-h">Shift Report · Exceptions</div>
          <div className="g-except">
            <b>Line-3 — output down 27%</b>
            <p>
              198 units against 270 last shift, with downtime up from 10 to 47 minutes and
              defects more than five times higher. Worth a look before the next shift starts.
            </p>
          </div>
          <p className="g-report-foot">Lines 1 and 2 are within normal variance.</p>
        </div>
      </div>
    </div>
  )
}

export default function Lab1Chapter() {
  return (
    <Chapter
      id="lab1"
      num={1}
      title="Shift Report"
      sector="Manufacturing"
      thesis="Give it files, and only files."
      hook={
        <p>
          A supervisor ends every shift the same way: two spreadsheets, a calculator, and
          twenty minutes working out whether anything actually went wrong. The numbers are
          all there — reading them is the tedious part.
        </p>
      }
      beats={[
        {
          label: 'Input',
          title: 'Two CSVs, one scratch folder',
          body: (
            <p>
              You upload the shift that just ended and the one before it. The backend drops both
              into a throwaway directory and points the agent at it. Nothing else on the machine
              is reachable.
            </p>
          ),
        },
        {
          label: 'Tools',
          title: 'Three tools, all read-only',
          body: (
            <p>
              The agent gets <code>Read</code>, <code>Glob</code> and <code>Grep</code>. That is the
              whole tool belt. This is the first idea the labs teach: the safest capability is the
              one you never granted.
            </p>
          ),
        },
        {
          label: 'Work',
          title: 'It does the arithmetic itself',
          body: (
            <p>
              Units, downtime and defects are totalled per line and compared against the previous
              shift. The system prompt is explicit — compute every total from the raw rows, never
              guess.
            </p>
          ),
        },
        {
          label: 'Output',
          title: 'The part a human actually reads',
          body: (
            <p>
              A one-page report: summary, a table by line, and an exceptions section that says what
              looks wrong and why. If nothing is abnormal, it has to say that explicitly — silence
              is not an answer.
            </p>
          ),
        },
      ]}
      stage={(active) => <Stage active={active} />}
    >
      <UnderTheHood summary="How the sandbox is built" source="backend/app/agents/lab1_shift_report.py">
        <p>
          The bound is the options object, not the wording of the prompt. <code>tools</code> lists what
          exists; <code>cwd</code> is a per-request temp directory; <code>setting_sources=[]</code> keeps
          the run hermetic so a stray local <code>.claude</code> config can't widen it.
        </p>
        <Snippet lang="python">{`options = ClaudeAgentOptions(
    system_prompt=SYSTEM_PROMPT,
    model=CLAUDE_MODEL,
    cwd=str(workdir),
    tools=["Read", "Glob", "Grep"],          # only read-only file tools available
    allowed_tools=["Read", "Glob", "Grep"],  # pre-approved (no permission prompt)
    permission_mode="bypassPermissions",     # server context: never block on a prompt
    setting_sources=[],                      # hermetic: ignore local .claude settings
)`}</Snippet>
      </UnderTheHood>
    </Chapter>
  )
}
