"""Lab 6 — Policy Q&A (RAG) API.

Every response exposes the pipeline's internals — chunk provenance, both
retriever rankings with per-term evidence, the fused selection, the exact
augmented prompt, and stage timings — so the frontend can show *how* the
answer was produced, not just the answer.
"""
import asyncio
import re
from time import perf_counter

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from ..agents.lab6_doc_qa import (
    NOT_IN_CONTEXT_SENTINEL,
    SYSTEM_PROMPT,
    answer_from_sources,
    build_user_prompt,
)
from ..config import CLAUDE_MODEL, LAB6_TOP_K
from ..lab6 import index as corpus_index
from ..lab6 import uploads
from ..lab6.chunking import build_chunks

router = APIRouter(prefix="/api/lab6", tags=["Lab 6 — Policy Q&A (RAG)"])

_CITATION_RE = re.compile(r"\[(\d{1,2})\]")


class AskRequest(BaseModel):
    question: str
    k: int = Field(default=LAB6_TOP_K, ge=1, le=8)
    retrieve_only: bool = False


async def _get_index() -> corpus_index.CorpusIndex:
    """Load (or lazily build) the index off the event loop."""
    try:
        return await asyncio.to_thread(corpus_index.get_index)
    except Exception as exc:  # noqa: BLE001 - corpus/config problem, not a bug in the request
        raise HTTPException(status_code=500, detail=f"Corpus index unavailable: {exc}") from exc


@router.get("/corpus")
async def corpus():
    """Corpus + chunking + embedding summary (powers the pipeline explainer)."""
    idx = await _get_index()
    return idx.summary()


@router.get("/chunks/{doc_id}")
async def chunks(doc_id: str):
    """All chunks of one document — powers the chunk inspector."""
    idx = await _get_index()
    result = idx.doc_chunks(doc_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Unknown document '{doc_id}'.")
    return {"doc_id": doc_id, "chunks": result}


@router.post("/reindex")
async def reindex():
    """Drop and rebuild the index — lets you edit corpus docs live, then re-ask."""
    corpus_index.invalidate()
    idx = await _get_index()
    return idx.summary()


@router.post("/upload")
async def upload(file: UploadFile = File(...)):
    """Ingest a user document (.md/.txt/.pdf) and return the ingestion trace.

    The trace mirrors the ask trace: one entry per stage — receive → extract →
    chunk → index rebuild — each with timings and before/after stats, so the UI
    can show ingestion happening, not just report that it happened.
    """
    t0 = perf_counter()
    raw = await file.read()
    receive_ms = round((perf_counter() - t0) * 1000, 1)
    filename = file.filename or "document"

    t0 = perf_counter()
    try:
        kind, text, pages = await asyncio.to_thread(uploads.extract_text, filename, raw)
    except uploads.UploadError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    extract_ms = round((perf_counter() - t0) * 1000, 1)

    markdown = uploads.normalize_markdown(filename, kind, text)

    # Time the chunking pass on just this document. (The rebuild below re-chunks
    # the whole corpus; this isolates the stage the trace is explaining.)
    m = re.search(r"^#\s+(.+)$", markdown, re.MULTILINE)
    title = m.group(1).strip() if m else filename
    t0 = perf_counter()
    local_chunks = build_chunks(
        [{"doc_id": "upload", "source": filename, "title": title, "text": markdown}]
    )
    chunk_ms = round((perf_counter() - t0) * 1000, 1)
    sections = len({c.heading for c in local_chunks})

    # Before/after stats for the rebuild stage (None on a cold start).
    prev = corpus_index.peek()
    chunks_before = len(prev.chunks) if prev else None
    dims_before = prev.dims if prev else None

    doc_id = await asyncio.to_thread(uploads.store_document, filename, markdown)
    corpus_index.invalidate()
    t0 = perf_counter()
    try:
        idx = await asyncio.to_thread(corpus_index.get_index)
    except Exception as exc:  # noqa: BLE001 - roll the file back; never wedge the corpus
        await asyncio.to_thread(uploads.delete_document, doc_id)
        corpus_index.invalidate()
        raise HTTPException(status_code=500, detail=f"Index rebuild failed: {exc}") from exc
    index_ms = round((perf_counter() - t0) * 1000, 1)

    summary = idx.summary()
    flat = " ".join(text.split())
    return {
        "doc": next((d for d in summary["docs"] if d["doc_id"] == doc_id), None),
        "trace": {
            "receive": {
                "filename": filename,
                "size_bytes": len(raw),
                "kind": kind,
                "ms": receive_ms,
            },
            "extract": {
                "chars": len(text),
                "pages": pages,
                "preview": flat[:200] + ("…" if len(flat) > 200 else ""),
                "ms": extract_ms,
            },
            "chunk": {
                "ms": chunk_ms,
                "sections": sections,
                "chunks": idx.doc_chunks(doc_id) or [],
            },
            "index": {
                "ms": index_ms,
                "backend": idx.backend_name,
                "chunk_count_before": chunks_before,
                "chunk_count_after": len(idx.chunks),
                "vector_dims_before": dims_before,
                "vector_dims_after": idx.dims,
            },
        },
        "corpus": summary,
    }


@router.delete("/docs/{doc_id}")
async def remove_document(doc_id: str):
    """Remove an uploaded (user-*) document and rebuild; seeded docs are fixed."""
    try:
        removed = await asyncio.to_thread(uploads.delete_document, doc_id)
    except uploads.UploadError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not removed:
        raise HTTPException(status_code=404, detail=f"No uploaded document '{doc_id}'.")
    corpus_index.invalidate()
    idx = await _get_index()
    return idx.summary()


@router.post("/ask")
async def ask(body: AskRequest):
    """Run the full RAG pipeline and return the answer WITH its trace."""
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question must not be empty.")

    idx = await _get_index()
    try:
        trace = await asyncio.to_thread(idx.search, question, body.k)
    except Exception as exc:  # noqa: BLE001 - e.g. Voyage network failure at query time
        raise HTTPException(status_code=502, detail=f"Retrieval failed: {exc}") from exc

    # ── Augment: number the fused selection and assemble the exact prompt ──
    t0 = perf_counter()
    selected = trace.pop("selected")
    context = [
        {
            "n": i + 1,
            "chunk_id": c["chunk_id"],
            "source": c["source"],
            "title": c["title"],
            "heading": c["heading"],
            "text": c["text"],
            "chars": c["chars"],
        }
        for i, c in enumerate(selected)
    ]
    user_prompt = build_user_prompt(question, context) if context else ""
    prompt_chars = len(SYSTEM_PROMPT) + len(user_prompt)
    trace["stages"]["augment"] = {
        "ms": round((perf_counter() - t0) * 1000, 1),
        "system_prompt": SYSTEM_PROMPT,
        "user_prompt": user_prompt,
        "context": context,
        "prompt_chars": prompt_chars,
        "prompt_tokens_est": prompt_chars // 4,  # rough 4-chars/token heuristic
    }

    # ── Generate: grounded answer from the no-tools agent ──
    answer: str | None = None
    refused = False
    error: str | None = None
    skipped = body.retrieve_only or not context
    generate_ms = 0.0
    if not skipped:
        t0 = perf_counter()
        result = await answer_from_sources(question, context)
        generate_ms = round((perf_counter() - t0) * 1000, 1)
        error = result["error"]
        raw = result["result"] or ""
        refused = NOT_IN_CONTEXT_SENTINEL in raw
        answer = raw.replace(NOT_IN_CONTEXT_SENTINEL, "").strip() or None
    elif not context:
        # Retrieval found nothing at all — refuse without spending a model call.
        refused = True

    trace["stages"]["generate"] = {
        "ms": generate_ms,
        "model": CLAUDE_MODEL,
        "skipped": skipped,
    }

    citations = sorted(
        {
            int(m)
            for m in _CITATION_RE.findall(answer or "")
            if 1 <= int(m) <= len(context)
        }
    )

    return {
        "question": question,
        "k": body.k,
        **trace,  # backend, low_confidence, stages
        "answer": answer,
        "citations": citations,
        "refused": refused,
        "error": error,
    }
