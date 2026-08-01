"""Lab 6 · RAG stage 4 — rank chunks against the question, two ways, then fuse.

Two retrievers with complementary failure modes run on every question:

  - **Vector search** (see embedding.py) ranks by cosine similarity in the
    embedding space — strong on paraphrase, weak on exact identifiers.
  - **BM25** (this module) is the classic lexical ranking function — strong on
    exact terms like "Form AP-2" or "$75", weak when the question uses
    different words than the document.

Their rankings are merged with **Reciprocal Rank Fusion**:

    fused(chunk) = Σ over lists containing it of  1 / (K + rank)

RRF only looks at *ranks*, never raw scores, so it needs no score calibration
between two retrievers whose scores live on completely different scales — that
is exactly why it's the standard first choice for hybrid retrieval.
"""
from __future__ import annotations

import math
from collections import Counter

# Standard RRF constant: dampens the gap between rank 1 and rank 2 so one
# retriever can't dominate the fusion on its own.
RRF_K = 60


class Bm25Index:
    """Okapi BM25 with the conventional k1/b defaults."""

    k1 = 1.5   # term-frequency saturation: repeats help, with diminishing returns
    b = 0.75   # length normalization: long chunks don't win just by being long

    def __init__(self) -> None:
        self.doc_tokens: list[Counter] = []
        self.doc_len: list[int] = []
        self.avgdl = 1.0
        self.idf: dict[str, float] = {}

    def fit(self, token_lists: list[list[str]]) -> "Bm25Index":
        self.doc_tokens = [Counter(tokens) for tokens in token_lists]
        self.doc_len = [len(tokens) for tokens in token_lists]
        n = len(token_lists)
        self.avgdl = (sum(self.doc_len) / n) if n else 1.0
        df = Counter(t for tokens in token_lists for t in set(tokens))
        self.idf = {
            t: math.log(1.0 + (n - count + 0.5) / (count + 0.5))
            for t, count in df.items()
        }
        return self

    def _term_score(self, term: str, doc_i: int) -> float:
        tf = self.doc_tokens[doc_i].get(term, 0)
        if tf == 0:
            return 0.0
        idf = self.idf.get(term, 0.0)
        denom = tf + self.k1 * (1 - self.b + self.b * self.doc_len[doc_i] / self.avgdl)
        return idf * tf * (self.k1 + 1) / denom

    def score_all(self, query_tokens: list[str]) -> list[float]:
        terms = set(query_tokens)
        return [
            sum(self._term_score(t, i) for t in terms)
            for i in range(len(self.doc_tokens))
        ]

    def contributions(self, query_tokens: list[str], doc_i: int, top: int = 5) -> list[dict]:
        """Per-term share of a BM25 score — mirrors TfidfBackend.contributions."""
        parts = [(t, self._term_score(t, doc_i)) for t in set(query_tokens)]
        parts.sort(key=lambda p: p[1], reverse=True)
        return [{"term": t, "weight": round(w, 4)} for t, w in parts[:top] if w > 0]


def rrf_fuse(rankings: list[list[int]], k: int = RRF_K) -> list[dict]:
    """Merge ranked id lists. Returns candidates sorted by fused score.

    Each candidate carries its per-list ranks (1-based, None if absent from
    that list) so the UI can show exactly how the fused score was assembled.
    """
    fused: dict[int, dict] = {}
    for list_i, ranked_ids in enumerate(rankings):
        for rank0, chunk_id in enumerate(ranked_ids):
            entry = fused.setdefault(
                chunk_id,
                {"chunk_id": chunk_id, "score": 0.0, "ranks": [None] * len(rankings)},
            )
            entry["score"] += 1.0 / (k + rank0 + 1)
            entry["ranks"][list_i] = rank0 + 1
    out = sorted(
        fused.values(),
        key=lambda e: (
            -e["score"],
            min(r for r in e["ranks"] if r is not None),
            e["chunk_id"],
        ),
    )
    for entry in out:
        entry["score"] = round(entry["score"], 5)
    return out
