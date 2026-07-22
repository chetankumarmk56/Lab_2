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

export interface JobAidStep {
  title: string
  detail?: string
  note?: string
}

export interface JobAidSection {
  heading: string
  steps: JobAidStep[]
}

/** The structured job aid the agent produces from a tested workflow. */
export interface JobAid {
  title: string
  document_type: string
  audience?: string
  purpose?: string
  overview?: string
  prerequisites?: string[]
  sections?: JobAidSection[]
  tips?: string[]
}

/** Response from POST /api/lab4/generate. */
export interface GenerateJobAidResult {
  job_aid: JobAid
  template_name: string
  filename: string
  docx_base64: string
}
