/** Lab 4 — no tools at all. The bound is the output schema. */
import { useState } from 'react'
import Chapter from '../Chapter'
import UnderTheHood, { Snippet } from '../UnderTheHood'
import { TEMPLATES } from '../transcripts'
import { Download } from '../../components/icons'

const RAW_WORKFLOW = `1. Ask for photo ID and proof of address.
2. If the address is out of county, send them to the county desk.
3. Look up the record in PRMS. If there's a hold, don't proceed —
   a supervisor has to clear it first.
4. Take payment. Cash goes in the drawer, cards through the terminal.
5. Print the receipt and staple it to the yellow copy.`

const CALLOUTS = [
  { kind: 'warning', text: 'Never proceed past a hold — clearing one requires a supervisor.' },
  { kind: 'caution', text: 'Out-of-county addresses are the most common misroute at this desk.' },
  { kind: 'note', text: 'The yellow copy is the office record; the white copy goes to the applicant.' },
]

function Stage({ active }: { active: number }) {
  const [tpl, setTpl] = useState(TEMPLATES[0])

  return (
    <div className="g-panels">
      {/* 0 — what a tested workflow actually looks like */}
      <div className={`g-panel ${active === 0 ? 'on' : ''}`}>
        <pre className="g-raw">{RAW_WORKFLOW}</pre>
        <p className="g-panel-note">
          Notes from someone who has done the job — conditional, abbreviated, and full of knowledge
          that has never been written down anywhere else.
        </p>
      </div>

      {/* 1 — no tools */}
      <div className={`g-panel ${active === 1 ? 'on' : ''}`}>
        <div className="g-notools">
          <span className="g-notools-mark" aria-hidden="true">∅</span>
          <b>tools = []</b>
          <p>
            No files, no database, no network, no shell. Text goes in, structure comes out. The
            entire attack surface is the prompt.
          </p>
        </div>
      </div>

      {/* 2 — the analysis */}
      <div className={`g-panel ${active === 2 ? 'on' : ''}`}>
        <div className="g-struct">
          <div className="g-struct-row"><span>Roles</span><b>Counter staff · Supervisor</b></div>
          <div className="g-struct-row"><span>Prerequisites</span><b>PRMS access · Card terminal</b></div>
          <div className="g-struct-row"><span>Decisions</span><b>Out of county? · Hold on record?</b></div>
          <div className="g-struct-row"><span>Definitions</span><b>PRMS · Hold · Yellow copy</b></div>
        </div>
        <div className="g-callouts">
          {CALLOUTS.map((c, i) => (
            <div key={c.kind} className={`g-callout k-${c.kind}`} style={{ animationDelay: `${i * 110}ms` }}>
              <b>{c.kind}</b>
              <span>{c.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 3 — branded document */}
      <div className={`g-panel ${active === 3 ? 'on' : ''}`}>
        <div className="g-swatches">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`g-swatch ${t.id === tpl.id ? 'on' : ''}`}
              style={{ ['--sw' as string]: t.brand }}
              onClick={() => setTpl(t)}
            >
              {t.name.split('—')[0].trim()}
            </button>
          ))}
        </div>
        <div className="g-doc" style={{ ['--brand' as string]: tpl.brand }}>
          <div className="g-doc-bar" />
          <div className="g-doc-agency">{tpl.agency}</div>
          <div className="g-doc-title">Counter Transaction — Job Aid</div>
          <div className="g-doc-meta">JA-DMV-REG-001 · v1.0 · Internal — For Counter Staff Use</div>
          <div className="g-doc-lines">
            {Array.from({ length: 7 }, (_, i) => <span key={i} style={{ width: `${88 - i * 7}%` }} />)}
          </div>
          <span className="g-doc-dl"><Download width={13} height={13} /> job-aid.docx</span>
        </div>
      </div>
    </div>
  )
}

export default function Lab4Chapter() {
  return (
    <Chapter
      id="lab4"
      num={4}
      title="Job Aid Generator"
      sector="Public Sector"
      thesis="No tools. The schema is the leash."
      hook={
        <p>
          Every office has a procedure that exists only in one person's head. It works, it's been
          tested a hundred times, and it has never been written down in a form anyone else could
          follow.
        </p>
      }
      beats={[
        {
          label: 'Input',
          title: 'Paste what you actually do',
          body: (
            <p>
              Rough notes, conditionals, shorthand. No template to fill in — that's the point, since
              filling in a template is the work people avoid.
            </p>
          ),
        },
        {
          label: 'Bounds',
          title: 'An agent with no tools at all',
          body: (
            <p>
              This one gets nothing: no filesystem, no database, no network. When an agent's only job
              is transforming text you hand it, extra capability is pure risk.
            </p>
          ),
        },
        {
          label: 'Analysis',
          title: 'It reorganises rather than reformats',
          body: (
            <p>
              Roles get separated from steps, conditionals become explicit decision points, and the
              dangerous bits are lifted out as warnings. That last move is the difference between a
              document and a job aid.
            </p>
          ),
        },
        {
          label: 'Output',
          title: 'One JSON object, then a real .docx',
          body: (
            <p>
              The agent returns strict JSON — the schema is the contract that keeps it honest. The
              backend renders it into a branded Word document. Switch agency above and watch it
              restyle.
            </p>
          ),
        },
      ]}
      stage={(active) => <Stage active={active} />}
    >
      <UnderTheHood summary="Why the output is JSON, not prose" source="backend/app/agents/lab4_job_aid.py">
        <p>
          A schema does two jobs here. It makes the output renderable by <code>python-docx</code>, and
          it constrains what the model is allowed to invent — every field has to be grounded in the
          submitted workflow:
        </p>
        <Snippet lang="json">{`{
  "title": string,
  "control": { "document_id", "version", "owner", "approver", "classification" },
  "roles":   [ { "role": string, "responsibility": string } ],
  "steps":   [ { "n": int, "action": string, "decision": {...}? } ],
  "callouts":[ { "kind": "warning" | "caution" | "note", "text": string } ]
}`}</Snippet>
        <p className="g-hood-foot">
          The prompt's instruction is blunt about the limit: <em>omit any field you genuinely cannot
          infer; never invent facts that aren't supported by the workflow.</em>
        </p>
      </UnderTheHood>
    </Chapter>
  )
}
