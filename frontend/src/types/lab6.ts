/** Lab 6 — Policy Q&A (RAG) types. Mirrors backend/app/routers/lab6.py. */

/** One corpus document, as summarized by GET /api/lab6/corpus. */
export interface RagDocSummary {
  doc_id: string
  source: string
  title: string
  chars: number
  chunks: number
  uploaded: boolean
}

/** Index summary from GET /api/lab6/corpus (and POST /reindex). */
export interface RagCorpus {
  backend: string
  note: string | null
  built_ms: number
  chunk_count: number
  vector_dims: number
  params: {
    chunk_target_chars: number
    chunk_overlap_chars: number
    retriever_pool: number
    rrf_k: number
  }
  docs: RagDocSummary[]
}

/** One chunk with full text, from GET /api/lab6/chunks/{doc_id}. */
export interface RagChunk {
  chunk_id: number
  doc_id: string
  source: string
  title: string
  heading: string
  chars: number
  overlap_prefix_chars: number
  text: string
}

/** Per-term share of a retrieval score — the "why did this match" evidence. */
export interface RagTermWeight {
  term: string
  weight: number
}

/** One ranked retrieval hit (vector or lexical). */
export interface RagHit {
  chunk_id: number
  doc_id: string
  source: string
  title: string
  heading: string
  chars: number
  overlap_prefix_chars: number
  rank: number
  score: number
  preview: string
  terms: RagTermWeight[]
}

/** One fusion candidate with its per-retriever ranks and RRF score. */
export interface RagFusionCandidate {
  chunk_id: number
  source: string
  title: string
  heading: string
  score: number
  vector_rank: number | null
  lexical_rank: number | null
  selected: boolean
}

/** One numbered source block pasted into the model's prompt. */
export interface RagContextBlock {
  n: number
  chunk_id: number
  source: string
  title: string
  heading: string
  text: string
  chars: number
}

/** The per-stage trace of one /ask run. */
export interface RagStages {
  query: { ms: number; terms: string[]; dims: number }
  vector: { ms: number; hits: RagHit[] }
  lexical: { ms: number; hits: RagHit[] }
  fusion: { ms: number; rrf_k: number; candidates: RagFusionCandidate[] }
  augment: {
    ms: number
    system_prompt: string
    user_prompt: string
    context: RagContextBlock[]
    prompt_chars: number
    prompt_tokens_est: number
  }
  generate: { ms: number; model: string; skipped: boolean }
}

/** Response from POST /api/lab6/ask. */
export interface RagAskResponse {
  question: string
  k: number
  backend: string
  low_confidence: boolean
  stages: RagStages
  answer: string | null
  citations: number[]
  refused: boolean
  error: string | null
}

/** The per-stage ingestion trace of one POST /api/lab6/upload. */
export interface RagUploadTrace {
  receive: { filename: string; size_bytes: number; kind: string; ms: number }
  extract: { chars: number; pages: number | null; preview: string; ms: number }
  chunk: { ms: number; sections: number; chunks: RagChunk[] }
  index: {
    ms: number
    backend: string
    chunk_count_before: number | null
    chunk_count_after: number
    vector_dims_before: number | null
    vector_dims_after: number
  }
}

/** Response from POST /api/lab6/upload. */
export interface RagUploadResponse {
  doc: RagDocSummary
  trace: RagUploadTrace
  corpus: RagCorpus
}
