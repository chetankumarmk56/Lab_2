/**
 * Canned agent runs for the guide's replays.
 *
 * Every SQL statement here was executed against the seeded `agentic_labs`
 * database and the rows are the real result — so the guide teaches accurate
 * numbers. The agent's prose is hand-written in the voice its system prompt
 * asks for (concise, no SQL, no dumped tables — see
 * backend/app/agents/lab2_permit_query.py).
 *
 * Nothing here calls the backend: the guide works with no API key, no database
 * and no running server. To swap in a genuine recording later, replace the
 * `answer`/`sql`/`rows` of a Run and the players pick it up unchanged.
 */

export interface Run {
  id: string
  question: string
  sql: string
  columns: string[]
  rows: (string | number)[][]
  answer: string
  /** A write request the agent declines — Lab 2's read-only guarantee. */
  refused?: boolean
}

export const PERMIT_RUNS: Run[] = [
  {
    id: 'pending-june',
    question: 'How many electrical permits are still pending from June?',
    sql: `SELECT permit_number, applicant_name, address, submitted_date, fee
FROM permits
WHERE permit_type ILIKE 'electrical'
  AND status ILIKE 'pending'
  AND submitted_date >= '2026-06-01'
  AND submitted_date <  '2026-07-01'
ORDER BY submitted_date;`,
    columns: ['permit_number', 'applicant_name', 'address', 'submitted_date', 'fee'],
    rows: [
      ['P-2026-1001', 'Aisha Rahman', '509 Commerce St', '2026-06-03', 261],
      ['P-2026-1037', 'Robert Novak', '7012 Cedar Ln', '2026-06-08', 237],
      ['P-2026-1002', 'Sofia Rossi', '3757 Cedar Ln', '2026-06-11', 215],
      ['P-2026-1003', 'Aisha Rahman', '9035 Oak St', '2026-06-24', 274],
    ],
    answer:
      'Four electrical permits from June are still pending. The oldest was submitted on June 3 by Aisha Rahman (509 Commerce St) and has been waiting the longest; the most recent came in June 24. Together they represent $987 in fees.',
  },
  {
    id: 'count-by-type',
    question: 'How many permits of each type were submitted?',
    sql: `SELECT permit_type, COUNT(*) AS permit_count
FROM permits
GROUP BY permit_type
ORDER BY permit_count DESC;`,
    columns: ['permit_type', 'permit_count'],
    rows: [
      ['Electrical', 18],
      ['Building', 14],
      ['Plumbing', 10],
      ['Mechanical', 8],
    ],
    answer:
      'Electrical leads with 18 permits, followed by Building at 14, Plumbing at 10 and Mechanical at 8 — 50 in total.',
  },
  {
    id: 'recent-five',
    question: 'List the 5 most recent permit applications.',
    sql: `SELECT permit_number, permit_type, applicant_name, status, submitted_date
FROM permits
ORDER BY submitted_date DESC
LIMIT 5;`,
    columns: ['permit_number', 'permit_type', 'applicant_name', 'status', 'submitted_date'],
    rows: [
      ['P-2026-1015', 'Plumbing', 'James Carter', 'Issued', '2026-07-09'],
      ['P-2026-1025', 'Electrical', 'Maria Gonzalez', 'Approved', '2026-07-09'],
      ['P-2026-1008', 'Electrical', 'Aisha Rahman', 'Pending', '2026-07-07'],
      ['P-2026-1039', 'Building', 'Grace Liu', 'Rejected', '2026-07-06'],
      ['P-2026-1048', 'Plumbing', 'Wei Chen', 'Under Review', '2026-07-06'],
    ],
    answer:
      'The five newest applications all arrived in the first half of July. Two came in on July 9 — a plumbing permit for James Carter (already issued) and an electrical permit for Maria Gonzalez (approved). The rest are still moving through review.',
  },
  {
    id: 'refusal',
    question: 'Mark permit P-2026-1001 as approved.',
    sql: '',
    columns: [],
    rows: [],
    refused: true,
    answer:
      "I can't change permit records — I have read-only access to the permits database. I can tell you anything about P-2026-1001, but approving it has to happen in the permit system by someone with authority to decide.",
  },
]

/** Lab 3's queue, as seeded. `expected` is what the triage agent proposes. */
export interface WorkOrder {
  wo: string
  machine: string
  description: string
  urgency: 'safety' | 'production-stopping' | 'routine'
  crew: string
  reason: string
}

export const WORK_ORDERS: WorkOrder[] = [
  {
    wo: 'WO-4501',
    machine: 'Hydraulic Press #2',
    description:
      "Hydraulic press #2 is leaking oil onto the floor by the operator station — it's a slip hazard and someone could get hurt.",
    urgency: 'safety',
    crew: 'Hydraulics',
    reason: 'Oil on the walkway is a slip hazard to the operator.',
  },
  {
    wo: 'WO-4505',
    machine: 'Forklift Charger',
    description:
      "Forklift charging station breaker keeps tripping and there's a smell of burning — feels like a shock risk.",
    urgency: 'safety',
    crew: 'Electrical',
    reason: 'Burning smell plus a tripping breaker points to a shock and fire risk.',
  },
  {
    wo: 'WO-4506',
    machine: 'Press #3',
    description:
      "The guard interlock on press #3 isn't engaging, so the operator is exposed to moving parts — injury risk.",
    urgency: 'safety',
    crew: 'Safety Response',
    reason: 'A failed interlock leaves the operator exposed to moving parts.',
  },
  {
    wo: 'WO-4502',
    machine: 'CNC Mill #4',
    description:
      'CNC mill #4 threw a spindle alarm and shut down; the machine is down and the line is stopped.',
    urgency: 'production-stopping',
    crew: 'CNC / Machining',
    reason: 'The mill is down and the line behind it has stopped.',
  },
  {
    wo: 'WO-4508',
    machine: 'Air Compressor',
    description: 'Main air compressor pressure is dropping and several machines are slowing down.',
    urgency: 'production-stopping',
    crew: 'General Maintenance',
    reason: 'Falling air pressure is slowing multiple machines at once.',
  },
  {
    wo: 'WO-4504',
    machine: 'Conveyor #1',
    description: 'Conveyor belt #1 is making a grinding noise but is still running.',
    urgency: 'routine',
    crew: 'General Maintenance',
    reason: 'Noisy but still running — worth inspecting before it fails.',
  },
  {
    wo: 'WO-4507',
    machine: 'CNC Mill #2',
    description: 'Coolant is low on CNC #2 and needs a refill.',
    urgency: 'routine',
    crew: 'CNC / Machining',
    reason: 'Routine consumable top-up.',
  },
  {
    wo: 'WO-4503',
    machine: 'Packaging Line',
    description: 'Control panel indicator light is flickering on the packaging line. Everything still runs.',
    urgency: 'routine',
    crew: 'Electrical',
    reason: 'Cosmetic indicator fault with no effect on output.',
  },
  {
    wo: 'WO-4509',
    machine: 'Tool Crib',
    description: 'Squeaky hinge on the tool-crib door.',
    urgency: 'routine',
    crew: 'General Maintenance',
    reason: 'Minor comfort issue, no production impact.',
  },
]

/**
 * Lab 1: per-line totals.
 *
 * `prev*` are the real totals computed from the seeded baseline
 * (backend/data/lab1/previous_shift.csv — 12 hourly rows across 3 lines).
 * The current-shift figures are illustrative: that file is whatever the user
 * uploads at run time, so there is no "real" one to quote. Line-3 is shaped to
 * show what an exception looks like, which is the section of the report worth
 * teaching.
 */
export interface LineTotals {
  line: string
  units: number
  prevUnits: number
  downtime: number
  prevDowntime: number
  defects: number
  prevDefects: number
}

export const SHIFT_LINES: LineTotals[] = [
  { line: 'Line-1', units: 281, prevUnits: 287, downtime: 12, prevDowntime: 10, defects: 6, prevDefects: 5 },
  { line: 'Line-2', units: 274, prevUnits: 279, downtime: 18, prevDowntime: 16, defects: 8, prevDefects: 7 },
  { line: 'Line-3', units: 198, prevUnits: 270, downtime: 47, prevDowntime: 10, defects: 19, prevDefects: 3 },
]

/** Lab 4's shipped templates (backend/app/lab4_templates.py). */
export const TEMPLATES = [
  { id: 'dmv-blue', name: 'State DMV — Official Blue', agency: 'State Department of Motor Vehicles', brand: '#1d4ed8' },
  { id: 'county-green', name: 'County Citizen Services — Green', agency: 'County Citizen Services', brand: '#15803d' },
  { id: 'training-slate', name: 'Statewide Training — Slate', agency: 'Statewide Training Division', brand: '#475569' },
]
