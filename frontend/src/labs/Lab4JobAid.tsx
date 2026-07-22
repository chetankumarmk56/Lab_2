import { useEffect, useState } from 'react'
import { generateJobAid, getLab4Templates } from '../api'
import Markdown from '../components/Markdown'
import { download } from '../lib/download'
import { Check, Download, Play, Upload } from '../components/icons'
import type { CalloutType, DocType, GenerateJobAidResult, JobAid, Template } from '../types'

const DOC_TYPES: DocType[] = ['Job Aid', 'User Manual', 'Training Guide']
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

type WorkflowMode = 'paste' | 'upload' | 'link'
type TemplateMode = 'library' | 'upload' | 'link'
type SegOption = string | { value: string; label: string }

interface SegProps {
  options: SegOption[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

function Seg({ options, value, onChange, disabled }: SegProps) {
  return (
    <div className="segmented">
      {options.map((o) => {
        const val = typeof o === 'string' ? o : o.value
        const label = typeof o === 'string' ? o : o.label
        return (
          <button
            key={val}
            className={`seg ${value === val ? 'active' : ''}`}
            onClick={() => onChange(val)}
            disabled={disabled}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

const CALLOUT_EMOJI: Record<CalloutType, string> = { warning: '⚠️', caution: '❗', note: 'ℹ️' }

/** Escape a value for a GFM table cell. */
const cell = (v: string | undefined) => (v ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ')

function jobAidToMarkdown(ja: JobAid): string {
  const L: string[] = []
  const c = ja.control ?? {}
  L.push(`# ${ja.title || 'Job Aid'}`)
  const meta = [ja.document_type, ja.audience, c.classification].filter(Boolean).join(' · ')
  if (meta) L.push(`*${meta}*`)

  const controlRows: [string, string | undefined][] = [
    ['Document ID', c.document_id],
    ['Version', c.version],
    ['Effective date', c.effective_date],
    ['Next review', c.review_date],
    ['Owner', c.owner],
    ['Approver', c.approver],
  ]
  const ctrl = controlRows.filter(([, v]) => v)
  if (ctrl.length) {
    L.push('\n## Document Control', '| Field | Value |', '|---|---|')
    ctrl.forEach(([k, v]) => L.push(`| ${k} | ${cell(v)} |`))
  }

  if (ja.purpose) L.push('\n## Purpose', ja.purpose)
  if (ja.scope) L.push('\n## Scope', ja.scope)

  if (ja.roles?.length) {
    L.push('\n## Roles & Responsibilities', '| Role | Responsibility |', '|---|---|')
    ja.roles.forEach((r) => L.push(`| ${cell(r.role)} | ${cell(r.responsibility)} |`))
  }

  if (ja.prerequisites?.length) {
    L.push('\n## Before You Start')
    ja.prerequisites.forEach((p) => L.push(`- ${p}`))
  }

  ;(ja.procedure ?? []).forEach((sec) => {
    L.push(`\n## ${sec.heading || 'Procedure'}`)
    ;(sec.steps ?? []).forEach((s, i) => {
      let line = `${i + 1}. **${s.title || ''}**`
      if (s.role) line += ` _[${s.role}]_`
      if (s.detail && s.detail !== s.title) line += ` — ${s.detail}`
      L.push(line)
      if (s.decision) {
        L.push(`   - **${s.decision.question}**`)
        ;(s.decision.branches ?? []).forEach((b) => L.push(`     - ${b.condition} → ${b.action}`))
      }
      if (s.callout) {
        L.push(`   > ${CALLOUT_EMOJI[s.callout.type] ?? 'ℹ️'} **${s.callout.type.toUpperCase()}:** ${s.callout.text}`)
      }
    })
  })

  if (ja.quick_reference?.length) {
    L.push('\n## Quick Reference Card')
    ja.quick_reference.forEach((q, i) => L.push(`${i + 1}. ${q}`))
  }

  if (ja.definitions?.length) {
    L.push('\n## Definitions & Acronyms', '| Term | Definition |', '|---|---|')
    ja.definitions.forEach((d) => L.push(`| ${cell(d.term)} | ${cell(d.definition)} |`))
  }

  if (ja.revision_history?.length) {
    L.push('\n## Revision History', '| Version | Date | Author | Summary |', '|---|---|---|---|')
    ja.revision_history.forEach((r) => L.push(`| ${cell(r.version)} | ${cell(r.date)} | ${cell(r.author)} | ${cell(r.summary)} |`))
  }

  if (ja.approvals?.length) {
    L.push('\n## Approval', '| Role | Name | Date |', '|---|---|---|')
    ja.approvals.forEach((a) => L.push(`| ${cell(a.role)} | ${cell(a.name)} | ${cell(a.date)} |`))
  }

  return L.join('\n')
}

function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

export default function Lab4JobAid() {
  const [templates, setTemplates] = useState<Template[]>([])

  const [wfMode, setWfMode] = useState<WorkflowMode>('paste')
  const [wfText, setWfText] = useState('')
  const [wfFile, setWfFile] = useState<File | null>(null)
  const [wfUrl, setWfUrl] = useState('')

  const [docType, setDocType] = useState<DocType>('Job Aid')

  const [tplMode, setTplMode] = useState<TemplateMode>('library')
  const [tplId, setTplId] = useState('')
  const [tplFile, setTplFile] = useState<File | null>(null)
  const [tplUrl, setTplUrl] = useState('')

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<GenerateJobAidResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getLab4Templates()
      .then((d) => {
        setTemplates(d.templates || [])
        if (d.templates?.length) setTplId(d.templates[0].id)
      })
      .catch(() => setTemplates([]))
  }, [])

  const hasWorkflow =
    (wfMode === 'paste' && wfText.trim().length > 20) ||
    (wfMode === 'upload' && !!wfFile) ||
    (wfMode === 'link' && wfUrl.trim().length > 0)

  async function useSample() {
    try {
      const res = await fetch('/api/lab4/sample')
      const text = await res.text()
      setWfMode('paste')
      setWfText(text)
    } catch {
      setError('Could not load the sample workflow.')
    }
  }

  async function onGenerate() {
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('doc_type', docType)
      if (wfMode === 'paste') fd.append('workflow_text', wfText)
      if (wfMode === 'upload' && wfFile) fd.append('workflow_file', wfFile)
      if (wfMode === 'link') fd.append('workflow_url', wfUrl)
      if (tplMode === 'library') fd.append('template_id', tplId)
      if (tplMode === 'upload' && tplFile) fd.append('template_file', tplFile)
      if (tplMode === 'link') fd.append('template_url', tplUrl)

      const data = await generateJobAid(fd)
      setResult(data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function onDownload() {
    if (!result) return
    download(result.filename, b64ToBlob(result.docx_base64, DOCX_MIME), DOCX_MIME)
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="eyebrow">Lab 04 <span className="sector-tag">Public Sector</span></div>
        <h2>Citizen Service Job Aid Generator</h2>
        <p>
          Turn a tested workflow into a formatted job aid in your agency's template. Pick a
          workflow, choose the document type and template, and generate a downloadable Word file.
        </p>
      </div>

      <div className="console wizard">
        {/* Step 1 — workflow */}
        <div className="wstep">
          <div className="wstep-head">
            <span className="step-num">1</span>
            <span className="wstep-title">Tested workflow</span>
            <button className="linkish wstep-aux" onClick={useSample}><Download width={13} height={13} /> Use sample</button>
          </div>
          <Seg
            options={[{ value: 'paste', label: 'Paste' }, { value: 'upload', label: 'Upload' }, { value: 'link', label: 'Link' }]}
            value={wfMode}
            onChange={(v) => setWfMode(v as WorkflowMode)}
            disabled={loading}
          />
          {wfMode === 'paste' && (
            <textarea
              className="textarea"
              value={wfText}
              placeholder="Paste the tested workflow steps here…"
              onChange={(e) => setWfText(e.target.value)}
            />
          )}
          {wfMode === 'upload' && (
            <label className="file-field">
              <input type="file" accept=".txt,.md,.docx" onChange={(e) => setWfFile(e.target.files?.[0] ?? null)} />
              <span className="file-trigger"><Upload width={15} height={15} /> Choose file</span>
              <span className={`file-name ${wfFile ? '' : 'none'}`}>{wfFile ? wfFile.name : 'No file selected'}</span>
            </label>
          )}
          {wfMode === 'link' && (
            <input className="field" type="url" value={wfUrl} placeholder="https://…/tested-workflow" onChange={(e) => setWfUrl(e.target.value)} />
          )}
        </div>

        {/* Step 2 — document type */}
        <div className="wstep">
          <div className="wstep-head">
            <span className="step-num">2</span>
            <span className="wstep-title">Document type</span>
          </div>
          <Seg options={DOC_TYPES} value={docType} onChange={(v) => setDocType(v as DocType)} disabled={loading} />
        </div>

        {/* Step 3 — template */}
        <div className="wstep">
          <div className="wstep-head">
            <span className="step-num">3</span>
            <span className="wstep-title">Template</span>
          </div>
          <Seg
            options={[{ value: 'library', label: 'Library' }, { value: 'upload', label: 'Upload .docx' }, { value: 'link', label: 'Link' }]}
            value={tplMode}
            onChange={(v) => setTplMode(v as TemplateMode)}
            disabled={loading}
          />
          {tplMode === 'library' && (
            <select className="select wide" value={tplId} onChange={(e) => setTplId(e.target.value)}>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.agency}</option>)}
            </select>
          )}
          {tplMode === 'upload' && (
            <label className="file-field">
              <input type="file" accept=".docx" onChange={(e) => setTplFile(e.target.files?.[0] ?? null)} />
              <span className="file-trigger"><Upload width={15} height={15} /> Choose .docx</span>
              <span className={`file-name ${tplFile ? '' : 'none'}`}>{tplFile ? tplFile.name : 'No file selected'}</span>
            </label>
          )}
          {tplMode === 'link' && (
            <input className="field" type="url" value={tplUrl} placeholder="https://…/agency-template.docx" onChange={(e) => setTplUrl(e.target.value)} />
          )}
        </div>

        <div className="wizard-actions">
          <button className="btn btn-primary" onClick={onGenerate} disabled={loading || !hasWorkflow}>
            {loading ? <><span className="spinner" /> Generating…</> : <><Play width={15} height={15} /> Generate job aid</>}
          </button>
          {!hasWorkflow && <span className="hint-inline">Add a tested workflow to begin</span>}
        </div>
      </div>

      {loading && (
        <div className="agent-status"><span className="spinner" /> The agent is structuring the job aid and formatting the document…</div>
      )}
      {error && <div className="error"><strong>Error</strong> — {error}</div>}

      {result && !loading && (
        <div className="result">
          <div className="result-head">
            <div className="rh-title">
              <b>{result.job_aid.document_type || 'Job Aid'}</b>
              {result.job_aid.control?.document_id && (
                <span className="meta-pill">{result.job_aid.control.document_id} · v{result.job_aid.control.version ?? '1.0'}</span>
              )}
              {result.template_name && <span className="meta-pill">{result.template_name}</span>}
            </div>
            <div className="result-actions">
              <button className="btn btn-primary btn-sm" onClick={onDownload}><Download width={14} height={14} /> Download .docx</button>
            </div>
          </div>
          <div className="result-body">
            <div className="notice notice-inline"><Check width={15} height={15} /> Formatted in “{result.template_name}” and ready to download as Word.</div>
            <Markdown>{jobAidToMarkdown(result.job_aid)}</Markdown>
          </div>
        </div>
      )}
    </div>
  )
}
