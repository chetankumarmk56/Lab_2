/** Lab 3 — two tools, one of them denied at runtime. The human is the write path. */
import { useState } from 'react'
import Chapter from '../Chapter'
import UnderTheHood, { Snippet } from '../UnderTheHood'
import { WORK_ORDERS } from '../transcripts'
import { Check, Lock } from '../../components/icons'

const URGENCY_LABEL: Record<string, string> = {
  safety: 'Safety',
  'production-stopping': 'Production-stopping',
  routine: 'Routine',
}

/** One card per urgency band — enough to show the sort without a wall of text. */
const GATE_SAMPLE = [
  WORK_ORDERS.find((w) => w.urgency === 'safety')!,
  WORK_ORDERS.find((w) => w.urgency === 'production-stopping')!,
  WORK_ORDERS.find((w) => w.urgency === 'routine')!,
]

function Stage({ active }: { active: number }) {
  const [approved, setApproved] = useState<string[]>([])

  return (
    <div className="g-panels">
      {/* 0 — the raw queue, in the order it arrived */}
      <div className={`g-panel ${active === 0 ? 'on' : ''}`}>
        <div className="g-queue">
          {WORK_ORDERS.slice(0, 6).map((w, i) => (
            <div key={w.wo} className="g-queue-row" style={{ animationDelay: `${i * 70}ms` }}>
              <code>{w.wo}</code>
              <span>{w.description}</span>
            </div>
          ))}
        </div>
        <p className="g-panel-note">
          Nine work orders, filed in whatever order operators happened to hit send. Nothing marks
          which one is dangerous.
        </p>
      </div>

      {/* 1 — sorted, with reasons */}
      <div className={`g-panel ${active === 1 ? 'on' : ''}`}>
        <div className="g-lanes">
          {(['safety', 'production-stopping', 'routine'] as const).map((u) => (
            <div key={u} className={`g-lane u-${u}`}>
              <div className="g-lane-head">
                {URGENCY_LABEL[u]}
                <em>{WORK_ORDERS.filter((w) => w.urgency === u).length}</em>
              </div>
              {WORK_ORDERS.filter((w) => w.urgency === u).slice(0, 3).map((w, i) => (
                <div key={w.wo} className="g-lane-card" style={{ animationDelay: `${i * 80}ms` }}>
                  <code>{w.wo}</code>
                  <b>{w.machine}</b>
                  <span>{w.crew}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="g-panel-note">
          Anything mentioning injury, shock, burning or exposure to moving parts is forced to
          <b> safety</b>, whatever else the text says.
        </p>
      </div>

      {/* 2 — the write attempt, denied */}
      <div className={`g-panel ${active === 2 ? 'on' : ''}`}>
        <div className="g-deny">
          <div className="g-deny-call">
            <code>assign_work_order</code>
            <span>WO-4501 → Hydraulics</span>
          </div>
          <div className="g-deny-x" aria-hidden="true">✕</div>
          <div className="g-deny-msg">
            <Lock width={14} height={14} />
            Assignments require human approval in the dashboard. Propose only; do not write.
          </div>
        </div>
        <p className="g-panel-note">
          The tool exists and the agent can see it. A permission callback refuses the call every
          time it's attempted.
        </p>
      </div>

      {/* 3 — the human closes the loop */}
      <div className={`g-panel ${active === 3 ? 'on' : ''}`}>
        <div className="g-gate">
          {GATE_SAMPLE.map((w) => {
            const done = approved.includes(w.wo)
            return (
              <div key={w.wo} className={`g-gate-card u-${w.urgency} ${done ? 'done' : ''}`}>
                <div className="g-gate-top">
                  <code>{w.wo}</code>
                  <span className={`g-badge u-${w.urgency}`}>{URGENCY_LABEL[w.urgency]}</span>
                </div>
                <b>{w.machine}</b>
                <p>{w.reason}</p>
                <div className="g-gate-foot">
                  <span>{w.crew}</span>
                  {done ? (
                    <span className="g-gate-done"><Check width={13} height={13} /> Assigned</span>
                  ) : (
                    <button type="button" className="g-gate-btn" onClick={() => setApproved((a) => [...a, w.wo])}>
                      Approve
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <p className="g-panel-note">
          Press Approve — that click is the only thing in this lab that writes to the database.
          {approved.length > 0 && <b> {approved.length} assigned.</b>}
        </p>
      </div>
    </div>
  )
}

export default function Lab3Chapter() {
  return (
    <Chapter
      id="lab3"
      num={3}
      title="Work Order Triage"
      sector="Manufacturing"
      thesis="The agent proposes. A person disposes."
      hook={
        <p>
          Operators file work orders all shift. Somewhere in the pile is the one about a guard
          interlock that stopped engaging — and it looks exactly like the one about a squeaky
          hinge until someone reads it.
        </p>
      }
      beats={[
        {
          label: 'Queue',
          title: 'Nine requests, no order',
          body: (
            <p>
              The agent calls <code>read_work_orders</code> and gets the queue as filed. Reading it
              is not the hard part; deciding what jumps the line is.
            </p>
          ),
        },
        {
          label: 'Triage',
          title: 'Urgency, crew, and one sentence of why',
          body: (
            <p>
              Each order gets a band, a crew, and a reason short enough to scan. The reason matters
              more than the label — it's what lets a lead disagree quickly.
            </p>
          ),
        },
        {
          label: 'Denied',
          title: 'It tries to assign. It gets refused.',
          body: (
            <p>
              The write tool is registered and visible, and a permission callback denies every call
              to it during triage. The refusal is machinery, not obedience.
            </p>
          ),
        },
        {
          label: 'Approve',
          title: 'The human is the write path',
          body: (
            <p>
              A maintenance lead reads the proposals and approves the ones that are right. Only then
              does anything change — which is exactly how you'd want it on a plant floor.
            </p>
          ),
        },
      ]}
      stage={(active) => <Stage active={active} />}
    >
      <UnderTheHood summary="The permission callback" source="backend/app/agents/lab3_triage.py">
        <p>
          <code>can_use_tool</code> runs before every tool call. Here it allows exactly one tool by
          name and denies everything else — including tools added later, which fail closed:
        </p>
        <Snippet lang="python">{`async def _deny_writes(tool_name, input_data, context):
    if tool_name == "mcp__workorders__read_work_orders":
        return PermissionResultAllow(updated_input=input_data)
    return PermissionResultDeny(
        message="Assignments require human approval in the dashboard. "
                "Propose only; do not write."
    )`}</Snippet>
        <p>
          Using a callback also forces the SDK's streaming mode — the prompt has to be an async
          iterable rather than a string, which <code>agent_runtime.py</code> handles.
        </p>
      </UnderTheHood>
    </Chapter>
  )
}
