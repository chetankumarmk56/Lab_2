export type DocType = 'Job Aid' | 'User Manual' | 'Training Guide'

/** An approved agency template from the library. */
export interface Template {
  id: string
  name: string
  agency: string
  brand: string
}

/** Response from GET /api/lab4/templates. */
export interface TemplatesResult {
  templates: Template[]
}

/** Document-control metadata every government SOP/job aid carries. */
export interface DocControl {
  document_id?: string
  version?: string
  effective_date?: string
  review_date?: string
  owner?: string
  approver?: string
  classification?: string
}

export interface RoleResponsibility {
  role: string
  responsibility: string
}

export interface DecisionBranch {
  condition: string
  action: string
}

export interface Decision {
  question: string
  branches: DecisionBranch[]
}

export type CalloutType = 'warning' | 'caution' | 'note'

export interface Callout {
  type: CalloutType
  text: string
}

export interface ProcedureStep {
  title: string
  detail?: string
  role?: string
  decision?: Decision
  callout?: Callout
}

export interface ProcedureSection {
  heading: string
  steps: ProcedureStep[]
}

export interface Definition {
  term: string
  definition: string
}

export interface Revision {
  version: string
  date: string
  author: string
  summary: string
}

export interface Approval {
  role: string
  name?: string
  date?: string
}

/** The structured, production-grade job aid the agent produces. */
export interface JobAid {
  title: string
  document_type: string
  control?: DocControl
  purpose?: string
  scope?: string
  audience?: string
  roles?: RoleResponsibility[]
  prerequisites?: string[]
  procedure?: ProcedureSection[]
  quick_reference?: string[]
  definitions?: Definition[]
  revision_history?: Revision[]
  approvals?: Approval[]
}

/** Response from POST /api/lab4/generate. */
export interface GenerateJobAidResult {
  job_aid: JobAid
  template_name: string
  filename: string
  docx_base64: string
}
