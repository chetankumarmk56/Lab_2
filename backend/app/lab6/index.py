"""Lab 6 — build the corpus index once, then run searches that return a full
stage-by-stage trace (timings, scores, per-term evidence) for the UI.

The index is deliberately in-memory and rebuilt on demand: the corpus is a
folder of markdown files, small enough that indexing takes milliseconds with
TF-IDF (one embeddings API round-trip with Voyage). `POST /api/lab6/reindex`
invalidates it, so documents can be edited live during a walkthrough.
"""
from __future__ import annotations

import logging
import threading
from time import perf_counter

from ..config import LAB6_VOYAGE_MODEL, VOYAGE_API_KEY
from .chunking import (
    CHUNK_OVERLAP_CHARS,
    CHUNK_TARGET_CHARS,
    Chunk,
    build_chunks,
    load_documents,
)
from .embedding import TfidfBackend, VoyageBackend, tokenize
from .retrieval import RRF_K, Bm25Index, rrf_fuse
from .uploads import USER_PREFIX

log = logging.getLogger(__name__)

# Each retriever hands its top-N to the fusion stage. Wider than the final k so
# fusion has real material to disagree about.
RETRIEVER_POOL = 10
# Cap on fusion candidates echoed to the UI (union of both pools can reach 20).
FUSION_DISPLAY_CAP = 12

# "Nothing relevant" gates, per backend (cosine scales differ between a sparse
# TF-IDF space and a dense semantic space). Used for the low-confidence badge.
_LOW_CONF_COSINE = {"tfidf": 0.07, "voyage": 0.30}


def _preview(text: str, limit: int = 240) -> str:
    flat = " ".join(text.split())
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"


class CorpusIndex:
    """Everything derived from the corpus: chunks, vectors, BM25 stats."""

    def __init__(
        self,
        docs: list[dict],
        chunks: list[Chunk],
        chunk_tokens: list[list[str]],
        bm25: Bm25Index,
        tfidf: TfidfBackend | None,
        voyage: VoyageBackend | None,
        dense_vectors: list[list[float]] | None,
        note: str | None,
        built_ms: float,
    ) -> None:
        self.docs = docs
        self.chunks = chunks
        self.chunk_tokens = chunk_tokens
        self.bm25 = bm25
        self.tfidf = tfidf
        self.voyage = voyage
        self.dense_vectors = dense_vectors
        self.note = note
        self.built_ms = built_ms

    # ── Build ────────────────────────────────────────────────────────

    @classmethod
    def build(cls, use_semantic: bool | None = None) -> "CorpusIndex":
        """Ingest → chunk → tokenize → fit BM25 → embed all chunks.

        use_semantic: None = auto (Voyage when VOYAGE_API_KEY is set);
        False forces the local TF-IDF backend (used by tests).
        """
        t0 = perf_counter()
        docs = load_documents()
        if not docs:
            raise RuntimeError("Lab 6 corpus is empty — no .md files in data/lab6/docs")
        chunks = build_chunks(docs)
        chunk_tokens = [tokenize(c.text) for c in chunks]
        bm25 = Bm25Index().fit(chunk_tokens)

        note: str | None = None
        voyage: VoyageBackend | None = None
        dense: list[list[float]] | None = None
        want_voyage = (VOYAGE_API_KEY is not None) if use_semantic is None else use_semantic

        if want_voyage and VOYAGE_API_KEY:
            try:
                candidate = VoyageBackend(VOYAGE_API_KEY, LAB6_VOYAGE_MODEL)
                dense = candidate.embed([c.text for c in chunks], input_type="document")
                voyage = candidate
            except Exception as exc:  # noqa: BLE001 - degrade, don't break the lab
                note = f"Voyage embeddings unavailable ({exc}); using local TF-IDF instead."
                log.warning("Lab 6: %s", note)
                voyage, dense = None, None

        tfidf = None if voyage else TfidfBackend().fit(chunk_tokens)
        return cls(
            docs=docs,
            chunks=chunks,
            chunk_tokens=chunk_tokens,
            bm25=bm25,
            tfidf=tfidf,
            voyage=voyage,
            dense_vectors=dense,
            note=note,
            built_ms=round((perf_counter() - t0) * 1000, 1),
        )

    # ── Introspection (corpus browser endpoints) ─────────────────────

    @property
    def backend_name(self) -> str:
        return self.voyage.name if self.voyage else TfidfBackend.name

    @property
    def dims(self) -> int:
        if self.voyage and self.dense_vectors:
            return len(self.dense_vectors[0])
        return self.tfidf.dims if self.tfidf else 0

    def summary(self) -> dict:
        per_doc: dict[str, dict] = {}
        for doc in self.docs:
            per_doc[doc["doc_id"]] = {
                "doc_id": doc["doc_id"],
                "source": doc["source"],
                "title": doc["title"],
                "chars": len(doc["text"]),
                "chunks": 0,
                "uploaded": doc["doc_id"].startswith(USER_PREFIX),
            }
        for chunk in self.chunks:
            per_doc[chunk.doc_id]["chunks"] += 1
        return {
            "backend": self.backend_name,
            "note": self.note,
            "built_ms": self.built_ms,
            "chunk_count": len(self.chunks),
            "vector_dims": self.dims,
            "params": {
                "chunk_target_chars": CHUNK_TARGET_CHARS,
                "chunk_overlap_chars": CHUNK_OVERLAP_CHARS,
                "retriever_pool": RETRIEVER_POOL,
                "rrf_k": RRF_K,
            },
            "docs": list(per_doc.values()),
        }

    def doc_chunks(self, doc_id: str) -> list[dict] | None:
        if all(d["doc_id"] != doc_id for d in self.docs):
            return None
        return [c.public() for c in self.chunks if c.doc_id == doc_id]

    def chunk_by_id(self, chunk_id: int) -> Chunk | None:
        if 0 <= chunk_id < len(self.chunks):
            return self.chunks[chunk_id]
        return None

    # ── Search (the visible part of the pipeline) ────────────────────

    def _hit(self, chunk_id: int, rank: int, score: float, terms: list[dict]) -> dict:
        chunk = self.chunks[chunk_id]
        return {
            **chunk.meta(),
            "rank": rank,
            "score": round(score, 4),
            "preview": _preview(chunk.text),
            "terms": terms,
        }

    def search(self, question: str, k: int) -> dict:
        """Run the retrieval stages and return the full trace + selected chunks."""
        q_tokens = tokenize(question)

        # Stage: embed the query into the same space as the chunks.
        t0 = perf_counter()
        if self.voyage:
            q_dense = self.voyage.embed([question], input_type="query")[0]
            q_sparse = None
        else:
            q_sparse = self.tfidf.embed_query(q_tokens)  # type: ignore[union-attr]
            q_dense = None
        query_ms = round((perf_counter() - t0) * 1000, 1)

        # Stage: vector similarity over every chunk.
        t0 = perf_counter()
        if self.voyage:
            scores = [
                VoyageBackend.cosine(q_dense, vec)  # type: ignore[arg-type]
                for vec in self.dense_vectors or []
            ]
        else:
            scores = [
                TfidfBackend.cosine(q_sparse, vec)  # type: ignore[arg-type]
                for vec in self.tfidf.vectors  # type: ignore[union-attr]
            ]
        vector_ranked = sorted(
            (i for i, s in enumerate(scores) if s > 0),
            key=lambda i: (-scores[i], i),
        )[:RETRIEVER_POOL]
        vector_hits = []
        for rank, i in enumerate(vector_ranked, start=1):
            terms = (
                []  # dense embeddings have no term-level decomposition
                if self.voyage
                else TfidfBackend.contributions(q_sparse, self.tfidf.vectors[i])  # type: ignore[union-attr,arg-type]
            )
            vector_hits.append(self._hit(i, rank, scores[i], terms))
        vector_ms = round((perf_counter() - t0) * 1000, 1)

        # Stage: BM25 lexical ranking over every chunk.
        t0 = perf_counter()
        bm_scores = self.bm25.score_all(q_tokens)
        lexical_ranked = sorted(
            (i for i, s in enumerate(bm_scores) if s > 0),
            key=lambda i: (-bm_scores[i], i),
        )[:RETRIEVER_POOL]
        lexical_hits = [
            self._hit(i, rank, bm_scores[i], self.bm25.contributions(q_tokens, i))
            for rank, i in enumerate(lexical_ranked, start=1)
        ]
        lexical_ms = round((perf_counter() - t0) * 1000, 1)

        # Stage: Reciprocal Rank Fusion of the two rankings.
        t0 = perf_counter()
        fused = rrf_fuse([vector_ranked, lexical_ranked])
        selected_ids = [entry["chunk_id"] for entry in fused[:k]]
        candidates = []
        for entry in fused[:FUSION_DISPLAY_CAP]:
            chunk = self.chunks[entry["chunk_id"]]
            candidates.append(
                {
                    "chunk_id": entry["chunk_id"],
                    "source": chunk.source,
                    "title": chunk.title,
                    "heading": chunk.heading,
                    "score": entry["score"],
                    "vector_rank": entry["ranks"][0],
                    "lexical_rank": entry["ranks"][1],
                    "selected": entry["chunk_id"] in selected_ids,
                }
            )
        fusion_ms = round((perf_counter() - t0) * 1000, 1)

        # Confidence gate: is the best evidence strong enough to answer from?
        gate = _LOW_CONF_COSINE["voyage" if self.voyage else "tfidf"]
        best_cosine = scores[vector_ranked[0]] if vector_ranked else 0.0
        low_confidence = not lexical_ranked and best_cosine < gate

        return {
            "backend": self.backend_name,
            "low_confidence": low_confidence,
            "stages": {
                "query": {
                    "ms": query_ms,
                    "terms": q_tokens,
                    "dims": self.dims,
                },
                "vector": {"ms": vector_ms, "hits": vector_hits},
                "lexical": {"ms": lexical_ms, "hits": lexical_hits},
                "fusion": {"ms": fusion_ms, "rrf_k": RRF_K, "candidates": candidates},
            },
            "selected": [self.chunks[i].public() for i in selected_ids],
        }


# ── Process-lifetime cache (mirrors the Lab 5 registry idea) ────────

_index: CorpusIndex | None = None
_lock = threading.Lock()


def get_index() -> CorpusIndex:
    """Build the index on first use; cheap cached lookups afterwards."""
    global _index
    if _index is None:
        with _lock:
            if _index is None:
                _index = CorpusIndex.build()
    return _index


def peek() -> CorpusIndex | None:
    """The cached index if one is built — never triggers a build (used for
    before/after stats in the ingestion trace)."""
    return _index


def invalidate() -> None:
    """Forget the cached index (picked up again on next request)."""
    global _index
    with _lock:
        _index = None
