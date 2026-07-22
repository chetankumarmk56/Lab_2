import { useEffect, useRef, useState } from 'react'
import {
  generateShiftReport,
  setPreviousShift,
  resetBaseline,
  getBaselineInfo,
} from '../api.js'
import Markdown from '../components/Markdown.jsx'
import { download, stamp } from '../lib/download.js'
import { Upload, Download, Play, Bookmark, Reset, Layers, Check } from '../components/icons.jsx'

function baselineSummary(b) {
  if (!b) return ''
  const bits = []
  if (typeof b.row_count === 'number') bits.push(`${b.row_count} readings`)
  if (typeof b.line_count === 'number') bits.push(`${b.line_count} lines`)
  return bits.join(' · ')
}

export default function Lab1ShiftReport() {
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState('')
  const [toolCalls, setToolCalls] = useState([])
  const [error, setError] = useState('')
  const [baseline, setBaseline] = useState(null)
  const [savingPrev, setSavingPrev] = useState(false)
  const [notice, setNotice] = useState('')
  const inputRef = useRef(null)

  // Load the current baseline so the user can see what they're comparing against.
  // Degrades gracefully if the endpoint isn't available yet (e.g. backend not restarted).
  useEffect(() => {
    getBaselineInfo()
      .then((d) => setBaseline(d.baseline))
      .catch(() => setBaseline(null))
  }, [])

  async function onGenerate() {
    if (!file) return
    setLoading(true)
    setError('')
    setReport('')
    setToolCalls([])
    setNotice('')
    try {
      const data = await generateShiftReport(file)
      setReport(data.result || '')
      setToolCalls(data.tool_calls || [])
      if (data.baseline) setBaseline(data.baseline)
      if (data.error && !data.result) setError(data.error)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function onDownload() {
    download(`shift-report-${stamp()}.md`, report, 'text/markdown;charset=utf-8')
  }

  async function onSetPrevious() {
    if (!file) return
    setSavingPrev(true)
    setError('')
    try {
      const res = await setPreviousShift(file)
      setBaseline(res.baseline)
      setNotice(`“${file.name}” is now the baseline — your next upload will compare against it.`)
    } catch (e) {
      setError(e.message)
    } finally {
      setSavingPrev(false)
    }
  }

  async function onReset() {
    setSavingPrev(true)
    setError('')
    try {
      const res = await resetBaseline()
      setBaseline(res.baseline)
      setNotice('Baseline reset to the original seeded sample.')
    } catch (e) {
      setError(e.message)
    } finally {
      setSavingPrev(false)
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="eyebrow">Lab 01 <span className="sector-tag">Manufacturing</span></div>
        <h2>Production Shift Report</h2>
        <p>
          Drop an end-of-shift machine log (CSV). The agent reads it, compares it to the
          previous shift, and writes a one-page report with an exceptions section.
        </p>
      </div>

      <div className="console">
        <div className="controls">
          <label className="file-field">
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setNotice('') }}
            />
            <span className="file-trigger"><Upload width={15} height={15} /> Choose CSV</span>
            <span className={`file-name ${file ? '' : 'none'}`}>{file ? file.name : 'No file selected'}</span>
          </label>

          <button className="btn btn-primary" onClick={onGenerate} disabled={!file || loading}>
            {loading ? <><span className="spinner" /> Generating…</> : <><Play width={15} height={15} /> Generate report</>}
          </button>

          <a className="linkish" href="/api/lab1/sample"><Download width={14} height={14} /> Sample log</a>
        </div>

        {baseline && (
          <div className="baseline-bar">
            <span className="bl-tag"><Layers width={13} height={13} /> Baseline</span>
            <span className="bl-source">{baseline.source_name}</span>
            <span className="bl-meta">{baselineSummary(baseline)}</span>
            <button className="linkish bl-reset" onClick={onReset} disabled={savingPrev}>
              <Reset width={13} height={13} /> Reset baseline
            </button>
          </div>
        )}
      </div>

      {notice && <div className="notice"><Check width={15} height={15} /> {notice}</div>}
      {loading && (
        <div className="agent-status"><span className="spinner" /> The agent is reading the logs and computing shift totals…</div>
      )}
      {error && <div className="error"><strong>Error</strong> — {error}</div>}

      {report && !loading && (
        <div className="result">
          <div className="result-head">
            <div className="rh-title">
              <b>Shift Report</b>
              {toolCalls.length > 0 && <span className="meta-pill">{toolCalls.length} file reads</span>}
            </div>
            <div className="result-actions">
              <button className="btn btn-ghost btn-sm" onClick={onSetPrevious} disabled={!file || savingPrev} title="Make the uploaded shift the new comparison baseline">
                {savingPrev ? <><span className="spinner" /> Saving…</> : <><Bookmark width={14} height={14} /> Set as previous</>}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={onDownload}><Download width={14} height={14} /> Download .md</button>
            </div>
          </div>
          <div className="result-body">
            <Markdown>{report}</Markdown>
          </div>
        </div>
      )}
    </div>
  )
}
