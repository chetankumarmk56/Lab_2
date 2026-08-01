import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { askRag, deleteRagDoc, getRagChunks, getRagCorpus, reindexRag, uploadRagDoc } from '../api'
import { ArrowUp, Check, Database, Layers, Lock, Reset, Trash, Upload } from '../components/icons'
import type {
  RagAskResponse,
  RagChunk,
  RagContextBlock,
  RagCorpus,
  RagFusionCandidate,
  RagHit,
  RagTermWeight,
  RagUploadResponse,
} from '../types'

const EXAMPLES = [
  'How long is a building permit valid, and can I extend it?',
  'What is the reinspection fee and when is it charged?',
  'Do I need a permit to replace a light switch?',
  'How do I appeal a permit denial, and what is the deadline?',
  'What insurance and bonding must a licensed contractor carry?',
]

/** Deliberately NOT covered by the corpus — demos the grounding refusal. */
const OFF_CORPUS = 'What are the noise rules for weekend construction?'

/** The six RAG stages — the story the whole screen tells. */
const PIPELINE = [
  { n: 1, name: 'Ingest', what: 'Markdown policy docs are loaded from disk.', why: 'The corpus is the only knowledge the agent will get.' },
  { n: 2, name: 'Chunk', what: 'Heading-aware chunks with a small overlap.', why: 'One chunk ≈ one rule → precise retrieval + clean citations.' },
  { n: 3, name: 'Embed + index', what: 'Every chunk becomes a vector; BM25 stats are built.', why: 'Similar meaning ⇒ nearby vectors, searchable in milliseconds.' },
  { n: 4, name: 'Retrieve + fuse', what: 'Vector cosine and BM25 each rank chunks; RRF merges them.', why: 'Two retrievers with complementary failure modes beat either alone.' },
  { n: 5, name: 'Augment', what: 'Top-k chunks are pasted into the prompt as numbered sources.', why: 'The model sees evidence, never the whole corpus.' },
  { n: 6, name: 'Generate', what: 'A no-tools agent answers with [n] citations — or refuses.', why: 'Grounding: no source, no claim.' },
]

function ScoreBar({ score, max }: { score: number; max: number }) {
  const pct = max > 0 ? Math.max(4, Math.round((score / max) * 100)) : 0
  return (
    <span className="l6-bar-wrap" aria-hidden="true">
      <span className="l6-bar" style={{ width: `${pct}%` }} />
    </span>
  )
}

function TermPills({ terms }: { terms: RagTermWeight[] }) {
  if (!terms.length) return <span className="l6-term l6-term-sem">semantic match</span>
  return (
    <>
      {terms.map((t) => (
        <span key={t.term} className="l6-term" title={`contribution ${t.weight}`}>
          {t.term}
        </span>
      ))}
    </>
  )
}

function HitColumn({ label, sub, hits }: { label: string; sub: string; hits: RagHit[] }) {
  const max = hits.length ? hits[0].score : 0
  return (
    <div className="l6-col">
      <div className="l6-col-head">
        <b>{label}</b>
        <span>{sub}</span>
      </div>
      {hits.length === 0 && <p className="l6-empty">No hits — this retriever found no signal.</p>}
      {hits.map((h) => (
        <div key={h.chunk_id} className="l6-hit" title={h.preview}>
          <span className="l6-rank">{h.rank}</span>
          <div className="l6-hit-body">
            <div className="l6-hit-top">
              <span className="l6-hit-title">
                {h.title} <em>· {h.heading}</em>
              </span>
              <span className="l6-score">{h.score.toFixed(3)}</span>
            </div>
            <ScoreBar score={h.score} max={max} />
            <div className="l6-terms">
              <TermPills terms={h.terms} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function FusionTable({ candidates, k }: { candidates: RagFusionCandidate[]; k: number }) {
  const max = candidates.length ? candidates[0].score : 0
  return (
    <div className="l6-fuse-scroll">
      <table className="l6-fuse">
        <thead>
          <tr>
            <th>Chunk</th>
            <th className="num">Vector rank</th>
            <th className="num">BM25 rank</th>
            <th>RRF score</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.chunk_id} className={c.selected ? 'is-selected' : ''}>
              <td>
                <span className="l6-hit-title">
                  {c.title} <em>· {c.heading}</em>
                </span>
              </td>
              <td className="num">{c.vector_rank ?? '—'}</td>
              <td className="num">{c.lexical_rank ?? '—'}</td>
              <td>
                <div className="l6-fuse-score">
                  <span className="l6-score">{c.score.toFixed(4)}</span>
                  <ScoreBar score={c.score} max={max} />
                </div>
              </td>
              <td>
                {c.selected && (
                  <span className="l6-sel">
                    <Check width={11} height={11} /> top-{k}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ChunkCard({ chunk }: { chunk: RagChunk }) {
  const ov = chunk.overlap_prefix_chars
  const head = ov > 0 ? chunk.text.slice(0, ov) : ''
  const rest = ov > 0 ? chunk.text.slice(ov) : chunk.text
  return (
    <div className="l6-chunk">
      <div className="l6-chunk-head">
        <span className="l6-chunk-id">#{chunk.chunk_id}</span>
        <span className="l6-chunk-heading">{chunk.heading}</span>
        <span className="l6-chunk-meta">
          {chunk.chars} chars
          {ov > 0 && <em className="l6-ov-tag"> · first {ov} repeated from previous chunk</em>}
        </span>
      </div>
      <p className="l6-chunk-text">
        {ov > 0 && <mark className="l6-ov">{head}</mark>}
        {rest}
      </p>
    </div>
  )
}

/** Answer text with [n] rendered as clickable citation chips. */
function AnswerText({
  text,
  valid,
  onCite,
}: {
  text: string
  valid: Set<number>
  onCite: (n: number) => void
}) {
  const paragraphs = text.split(/\n{2,}/)
  return (
    <>
      {paragraphs.map((para, i) => (
        <p key={i}>
          {para.split(/(\[\d{1,2}\])/g).map((part, j) => {
            const m = /^\[(\d{1,2})\]$/.exec(part)
            if (m && valid.has(Number(m[1]))) {
              return (
                <button
                  key={j}
                  className="l6-cite"
                  onClick={() => onCite(Number(m[1]))}
                  title={`Jump to source [${m[1]}]`}
                >
                  {m[1]}
                </button>
              )
            }
            return <span key={j}>{part}</span>
          })}
        </p>
      ))}
    </>
  )
}

export default function Lab6PolicyRag() {
  const [corpus, setCorpus] = useState<RagCorpus | null>(null)
  const [chunkCache, setChunkCache] = useState<Record<string, RagChunk[]>>({})
  const [openDoc, setOpenDoc] = useState<string | null>(null)
  const [reindexing, setReindexing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [uploadRes, setUploadRes] = useState<RagUploadResponse | null>(null)

  const [question, setQuestion] = useState('')
  const [k, setK] = useState(5)
  const [retrieveOnly, setRetrieveOnly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<RagAskResponse | null>(null)

  const [openCtx, setOpenCtx] = useState<Set<number>>(new Set())
  const [flash, setFlash] = useState<number | null>(null)

  useEffect(() => {
    getRagCorpus().then(setCorpus).catch((e) => setError((e as Error).message))
  }, [])

  async function showDoc(docId: string) {
    if (openDoc === docId) {
      setOpenDoc(null)
      return
    }
    setOpenDoc(docId)
    if (!chunkCache[docId]) {
      try {
        const res = await getRagChunks(docId)
        setChunkCache((c) => ({ ...c, [docId]: res.chunks }))
      } catch {
        /* inspector is an enhancement — ignore */
      }
    }
  }

  async function reindex() {
    setReindexing(true)
    try {
      setCorpus(await reindexRag())
      setChunkCache({})
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setReindexing(false)
    }
  }

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!f || uploading) return
    setUploading(true)
    setUploadError('')
    try {
      const res = await uploadRagDoc(f)
      setUploadRes(res)
      setCorpus(res.corpus)
      setChunkCache({})
      setOpenDoc(null)
    } catch (err) {
      setUploadError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  async function removeDoc(docId: string) {
    try {
      const c = await deleteRagDoc(docId)
      setCorpus(c)
      setChunkCache({})
      if (openDoc === docId) setOpenDoc(null)
      if (uploadRes?.doc.doc_id === docId) setUploadRes(null)
    } catch (err) {
      setUploadError((err as Error).message)
    }
  }

  async function ask(q?: string) {
    const query = (q ?? question).trim()
    if (!query || loading) return
    setQuestion(query)
    setLoading(true)
    setError('')
    try {
      const res = await askRag(query, k, retrieveOnly)
      setResult(res)
      setOpenCtx(new Set())
      setFlash(null)
      requestAnimationFrame(() =>
        document.getElementById('l6-trace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    ask()
  }

  function cite(n: number) {
    setOpenCtx((prev) => new Set(prev).add(n))
    setFlash(n)
    requestAnimationFrame(() =>
      document.getElementById(`l6-src-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    )
    window.setTimeout(() => setFlash((f) => (f === n ? null : f)), 1600)
  }

  const st = result?.stages
  const retrieveMs = st ? Math.round((st.vector.ms + st.lexical.ms + st.fusion.ms) * 10) / 10 : null
  /** Live value shown on each pipeline card (corpus stats before a run, timings after). */
  const pipeChip = (n: number): string | null => {
    if (n === 1) return corpus ? `${corpus.docs.length} docs` : null
    if (n === 2) return corpus ? `${corpus.chunk_count} chunks` : null
    if (n === 3) return st ? `${st.query.ms} ms` : corpus ? `${corpus.vector_dims}-dim` : null
    if (n === 4) return retrieveMs !== null ? `${retrieveMs} ms` : null
    if (n === 5) return st ? `${st.augment.ms} ms` : null
    if (n === 6) return st ? (st.generate.skipped ? 'skipped' : `${(st.generate.ms / 1000).toFixed(1)} s`) : null
    return null
  }

  const validCitations = new Set(result?.citations ?? [])

  return (
    <div className="panel l6-root">
      <div className="panel-head">
        <div className="eyebrow">
          Lab 06 <span className="sector-tag">Public Sector · RAG</span>
        </div>
        <h2>Policy Q&A — RAG in the open</h2>
        <p>
          Ask about Riverbend County permit policy. Every stage of the pipeline — chunking,
          embedding, both retrievers, rank fusion, the exact prompt, and the grounded answer —
          is shown below, so you can explain <em>how</em> the answer was produced.
        </p>
        {corpus && (
          <div className="l6-hint">
            <Database width={13} height={13} /> {corpus.docs.length} documents ·{' '}
            {corpus.chunk_count} chunks · <b>{corpus.backend}</b> ({corpus.vector_dims}-dim) ·
            indexed in {corpus.built_ms} ms
            {corpus.note && <span className="l6-note-warn"> — {corpus.note}</span>}
          </div>
        )}
      </div>

      {/* ── The pipeline, as a picture ─────────────────────────────── */}
      <div className="l6-pipe">
        {PIPELINE.map((s) => (
          <div key={s.n} className="l6-pipe-card">
            <div className="l6-pipe-top">
              <span className="l6-pipe-num">{s.n}</span>
              <span className="l6-pipe-name">{s.name}</span>
              {pipeChip(s.n) && <span className="l6-pipe-ms">{pipeChip(s.n)}</span>}
            </div>
            <p className="l6-pipe-what">{s.what}</p>
            <p className="l6-pipe-why">why: {s.why}</p>
          </div>
        ))}
      </div>

      {/* ── Corpus & chunk inspector (stages 1-2, live) ────────────── */}
      <details className="l6-panel l6-corpus">
        <summary>
          <Layers width={14} height={14} /> Corpus &amp; chunking
          {corpus && (
            <span className="l6-sum-meta">
              target {corpus.params.chunk_target_chars} chars · overlap{' '}
              {corpus.params.chunk_overlap_chars} chars — click a document to see its chunks
            </span>
          )}
        </summary>
        {corpus && (
          <>
            <div className="l6-upload-row">
              <label className={`l6-upload ${uploading ? 'is-busy' : ''}`}>
                {uploading ? <span className="spinner" /> : <Upload width={14} height={14} />}
                {uploading ? 'Ingesting…' : 'Add a document (.md, .txt, .pdf)'}
                <input
                  type="file"
                  accept=".md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf"
                  onChange={onUpload}
                  disabled={uploading}
                />
              </label>
              <span className="l6-foot-hint">
                Your file joins the corpus immediately — the ingestion trace below shows every
                step, and the new text is instantly askable.
              </span>
            </div>

            {uploadError && (
              <div className="error">
                <strong>Upload failed</strong> — {uploadError}
              </div>
            )}

            {uploadRes && (
              <div className="l6-utrace">
                <div className="l6-utrace-head">
                  <b>Ingestion trace — {uploadRes.trace.receive.filename}</b>
                  <button className="linkish" onClick={() => setUploadRes(null)}>
                    Dismiss
                  </button>
                </div>
                <div className="l6-ustages">
                  <div className="l6-ustage">
                    <div className="l6-ustage-top">
                      <span className="l6-pipe-num">1</span>
                      <b>Receive</b>
                      <span className="l6-pipe-ms">{uploadRes.trace.receive.ms} ms</span>
                    </div>
                    <p>
                      {(uploadRes.trace.receive.size_bytes / 1024).toFixed(1)} KB{' '}
                      {uploadRes.trace.receive.kind.toUpperCase()} accepted and validated
                      (type + size limits).
                    </p>
                  </div>
                  <div className="l6-ustage">
                    <div className="l6-ustage-top">
                      <span className="l6-pipe-num">2</span>
                      <b>Extract</b>
                      <span className="l6-pipe-ms">{uploadRes.trace.extract.ms} ms</span>
                    </div>
                    <p title={uploadRes.trace.extract.preview}>
                      {uploadRes.trace.extract.chars.toLocaleString()} chars of text
                      {uploadRes.trace.extract.pages != null &&
                        ` from ${uploadRes.trace.extract.pages} PDF pages`}
                      , normalized to markdown with an H1 title.
                    </p>
                  </div>
                  <div className="l6-ustage">
                    <div className="l6-ustage-top">
                      <span className="l6-pipe-num">3</span>
                      <b>Chunk</b>
                      <span className="l6-pipe-ms">{uploadRes.trace.chunk.ms} ms</span>
                    </div>
                    <p>
                      <span className="l6-delta">{uploadRes.trace.chunk.chunks.length} chunks</span>{' '}
                      across {uploadRes.trace.chunk.sections}{' '}
                      {uploadRes.trace.chunk.sections === 1 ? 'section' : 'sections'}, heading-aware
                      with overlap — shown below.
                    </p>
                  </div>
                  <div className="l6-ustage">
                    <div className="l6-ustage-top">
                      <span className="l6-pipe-num">4</span>
                      <b>Embed + index</b>
                      <span className="l6-pipe-ms">{uploadRes.trace.index.ms} ms</span>
                    </div>
                    <p>
                      Chunks{' '}
                      <span className="l6-delta">
                        {uploadRes.trace.index.chunk_count_before ?? '—'} →{' '}
                        {uploadRes.trace.index.chunk_count_after}
                      </span>
                      {' · '}
                      {uploadRes.trace.index.backend.startsWith('tfidf')
                        ? 'vocabulary '
                        : 'dimensions '}
                      <span className="l6-delta">
                        {uploadRes.trace.index.vector_dims_before ?? '—'} →{' '}
                        {uploadRes.trace.index.vector_dims_after}
                      </span>
                      {' — '}the whole index is rebuilt so idf/BM25 stats stay consistent.
                    </p>
                  </div>
                </div>
                <details className="l6-utrace-chunks" open>
                  <summary>
                    The {uploadRes.trace.chunk.chunks.length} new chunks, as stored in the index
                  </summary>
                  <div className="l6-chunks">
                    {uploadRes.trace.chunk.chunks.map((c) => (
                      <ChunkCard key={c.chunk_id} chunk={c} />
                    ))}
                  </div>
                </details>
              </div>
            )}

            <div className="l6-docgrid">
              {corpus.docs.map((d) => (
                <div
                  key={d.doc_id}
                  role="button"
                  tabIndex={0}
                  className={`l6-doc ${openDoc === d.doc_id ? 'active' : ''}`}
                  onClick={() => showDoc(d.doc_id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      showDoc(d.doc_id)
                    }
                  }}
                >
                  <span className="l6-doc-title">
                    {d.title}
                    {d.uploaded && <em className="l6-doc-up">uploaded</em>}
                  </span>
                  <span className="l6-doc-meta">
                    {d.source} · {d.chunks} chunks · {d.chars} chars
                  </span>
                  {d.uploaded && (
                    <button
                      className="l6-doc-x"
                      title="Remove this uploaded document from the corpus"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeDoc(d.doc_id)
                      }}
                    >
                      <Trash width={12} height={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="l6-corpus-foot">
              <button className="linkish" onClick={reindex} disabled={reindexing}>
                <Reset width={13} height={13} /> {reindexing ? 'Reindexing…' : 'Reindex corpus'}
              </button>
              <span className="l6-foot-hint">
                Upload above, or edit files in <code>backend/data/lab6/docs/</code> and reindex —
                either way, ingestion is a live pipeline, not a build step.
              </span>
            </div>
            {openDoc && chunkCache[openDoc] && (
              <div className="l6-chunks">
                {chunkCache[openDoc].map((c) => (
                  <ChunkCard key={c.chunk_id} chunk={c} />
                ))}
              </div>
            )}
          </>
        )}
      </details>

      {/* ── Ask ────────────────────────────────────────────────────── */}
      <form className="l6-ask" onSubmit={onSubmit}>
        <label className="l6-vh" htmlFor="l6-q">
          Ask a policy question
        </label>
        <textarea
          id="l6-q"
          className="l6-input"
          rows={2}
          value={question}
          placeholder="Ask about permits, inspections, fees, appeals…"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              ask()
            }
          }}
        />
        <div className="l6-controls">
          <label className="l6-ctl" title="How many fused chunks are handed to the model as sources.">
            top-k
            <select value={k} onChange={(e) => setK(Number(e.target.value))}>
              {[3, 4, 5, 6, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="l6-ctl l6-check" title="Run stages 3-5 only — free, instant, no model call.">
            <input
              type="checkbox"
              checked={retrieveOnly}
              onChange={(e) => setRetrieveOnly(e.target.checked)}
            />
            retrieve only
          </label>
          <div className="l6-controls-right">
            <button type="submit" className="btn btn-primary" disabled={loading || !question.trim()}>
              {loading ? <span className="spinner" /> : <ArrowUp width={15} height={15} />}
              {loading ? (retrieveOnly ? 'Retrieving…' : 'Running pipeline…') : 'Ask'}
            </button>
          </div>
        </div>
        <div className="chips">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="chip" onClick={() => ask(ex)} disabled={loading}>
              {ex}
            </button>
          ))}
          <button
            type="button"
            className="chip l6-chip-off"
            onClick={() => ask(OFF_CORPUS)}
            disabled={loading}
            title="Not covered by the corpus — demonstrates the grounded refusal."
          >
            {OFF_CORPUS}
          </button>
        </div>
      </form>

      {error && (
        <div className="error">
          <strong>Error</strong> — {error}
        </div>
      )}

      {/* ── The trace: what actually happened, stage by stage ──────── */}
      {result && st && (
        <div className="l6-trace" id="l6-trace">
          <div className="l6-stage">
            <div className="l6-stage-head">
              <span className="l6-stage-n">3</span>
              <b>Embed the question</b>
              <span className="l6-ms">{st.query.ms} ms</span>
            </div>
            <p className="l6-stage-sub">
              “{result.question}” → a {st.query.dims.toLocaleString()}-dimension vector in the same
              space as the chunks ({result.backend}). Query terms after tokenizing, stopword
              removal and plural folding:
            </p>
            <div className="l6-terms l6-terms-lg">
              {st.query.terms.map((t, i) => (
                <span key={`${t}-${i}`} className="l6-term">
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div className="l6-stage">
            <div className="l6-stage-head">
              <span className="l6-stage-n">4</span>
              <b>Retrieve — two rankings, then fuse</b>
              <span className="l6-ms">{retrieveMs} ms</span>
            </div>
            <div className="l6-cols">
              <HitColumn
                label="Vector search"
                sub={`cosine similarity · ${st.vector.ms} ms`}
                hits={st.vector.hits}
              />
              <HitColumn label="Lexical search" sub={`BM25 · ${st.lexical.ms} ms`} hits={st.lexical.hits} />
            </div>
            <div className="l6-fuse-head">
              <b>Reciprocal Rank Fusion</b>
              <span className="l6-formula">
                score(c) = Σ 1 / ({st.fusion.rrf_k} + rank) — ranks only, so no score calibration
                needed between retrievers
              </span>
            </div>
            <FusionTable candidates={st.fusion.candidates} k={result.k} />
          </div>

          <div className="l6-stage">
            <div className="l6-stage-head">
              <span className="l6-stage-n">5</span>
              <b>Augment — the evidence handed to the model</b>
              <span className="l6-ms">
                {st.augment.prompt_chars.toLocaleString()} chars · ~{st.augment.prompt_tokens_est.toLocaleString()} tokens
              </span>
            </div>
            {st.augment.context.length === 0 ? (
              <p className="l6-empty">
                Nothing was retrieved above the confidence gate — no context, so generation is
                skipped and the question is refused rather than guessed at.
              </p>
            ) : (
              <div className="l6-ctxs">
                {st.augment.context.map((b: RagContextBlock) => (
                  <details
                    key={b.n}
                    id={`l6-src-${b.n}`}
                    className={`l6-ctx ${flash === b.n ? 'is-flash' : ''}`}
                    open={openCtx.has(b.n)}
                    onToggle={(e) => {
                      const isOpen = (e.currentTarget as HTMLDetailsElement).open
                      setOpenCtx((prev) => {
                        const next = new Set(prev)
                        if (isOpen) next.add(b.n)
                        else next.delete(b.n)
                        return next
                      })
                    }}
                  >
                    <summary>
                      <span className="l6-ctx-n">[{b.n}]</span> {b.title} <em>· {b.heading}</em>
                      <span className="l6-ctx-meta">
                        chunk #{b.chunk_id} · {b.chars} chars
                      </span>
                    </summary>
                    <p className="l6-chunk-text">{b.text}</p>
                  </details>
                ))}
              </div>
            )}
            {st.augment.user_prompt && (
              <details className="l6-prompt">
                <summary>The exact prompt sent to the model</summary>
                <div className="code-card">
                  <div className="code-card-head">
                    <span className="cc-label">system prompt</span>
                  </div>
                  <pre>{st.augment.system_prompt}</pre>
                </div>
                <div className="code-card">
                  <div className="code-card-head">
                    <span className="cc-label">user message (sources + question)</span>
                  </div>
                  <pre>{st.augment.user_prompt}</pre>
                </div>
              </details>
            )}
          </div>

          <div className="l6-stage">
            <div className="l6-stage-head">
              <span className="l6-stage-n">6</span>
              <b>Generate — grounded answer</b>
              <span className="l6-ms">
                {st.generate.skipped ? 'skipped' : `${st.generate.model} · ${(st.generate.ms / 1000).toFixed(1)} s`}
              </span>
            </div>

            <div className="l6-flags">
              {result.low_confidence && (
                <span className="l6-flag l6-flag-warn">low retrieval confidence</span>
              )}
              {result.refused && (
                <span className="l6-flag l6-flag-warn">
                  <Lock width={11} height={11} /> not in corpus — refused instead of guessing
                </span>
              )}
              {!result.refused && result.answer && result.citations.length > 0 && (
                <span className="l6-flag l6-flag-ok">
                  <Check width={11} height={11} /> grounded · cites {result.citations.length}{' '}
                  {result.citations.length === 1 ? 'source' : 'sources'}
                </span>
              )}
            </div>

            {st.generate.skipped && !result.refused ? (
              <p className="l6-empty">
                Generation skipped (retrieve-only mode). Untick “retrieve only” to run the full
                pipeline — stages 3-5 above are identical either way.
              </p>
            ) : result.error ? (
              <div className="error">
                <strong>Agent error</strong> — {result.error}
              </div>
            ) : result.answer ? (
              <div className="l6-answer">
                <AnswerText text={result.answer} valid={validCitations} onCite={cite} />
              </div>
            ) : result.refused ? (
              <p className="l6-empty">
                The corpus doesn’t cover this question, so no answer was produced. That refusal —
                not a made-up answer — is the grounding guarantee.
              </p>
            ) : (
              <p className="l6-empty">No answer returned.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
