"""Lab 6 · RAG stage 3 — turn text into vectors.

Two interchangeable backends behind one idea (map text into a vector space
where "similar meaning" ≈ "small angle", then rank by cosine similarity):

  - **TF-IDF (default, fully local).** A classic sparse vector space built from
    the corpus itself. Zero API keys, deterministic, and — the reason it's the
    demo default — every similarity score decomposes into per-term
    contributions the UI can display ("this chunk matched because of
    *reinspection* and *fee*").

  - **Voyage AI (optional, semantic).** Dense embeddings from Anthropic's
    embeddings partner, used when VOYAGE_API_KEY is set. Captures meaning
    beyond shared vocabulary ("lapsed permit" ≈ "expired permit") at the cost
    of term-level explainability.

Both backends L2-normalize their vectors, so cosine similarity is a plain dot
product everywhere downstream.
"""
from __future__ import annotations

import json
import math
import re
import urllib.request
from collections import Counter

# ── Tokenization (shared by TF-IDF and BM25) ────────────────────────

_TOKEN_RE = re.compile(r"[a-z0-9]+(?:'[a-z]+)?")

# Small English stopword list: words so common they carry no ranking signal.
STOPWORDS = frozenset(
    """
    a an and are as at be been by for from had has have he i if in into is it
    its may must nor not of on or our she so such that the their them then
    there these they this to under until upon was we were what when where
    which who will with would you your
    """.split()
)


def _fold(token: str) -> str:
    """Light plural folding so 'permits' matches 'permit' (no full stemmer)."""
    if token.endswith("'s"):
        token = token[:-2]
    if len(token) > 3 and token.endswith("ies"):
        return token[:-3] + "y"
    if len(token) > 3 and token.endswith("s") and not token.endswith(("ss", "us", "is")):
        return token[:-1]
    return token


def tokenize(text: str) -> list[str]:
    """Lowercase → words/numbers → drop stopwords → fold plurals."""
    return [
        _fold(t)
        for t in _TOKEN_RE.findall(text.lower())
        if t not in STOPWORDS and len(t) > 1
    ]


# ── Backend 1: local TF-IDF vector space ────────────────────────────


class TfidfBackend:
    """Sparse TF-IDF vectors: weight = (1 + log tf) · idf, L2-normalized."""

    name = "tfidf-local"

    def __init__(self) -> None:
        self.n_docs = 0
        self.idf: dict[str, float] = {}
        self.vectors: list[dict[str, float]] = []

    def fit(self, token_lists: list[list[str]]) -> "TfidfBackend":
        self.n_docs = len(token_lists)
        df = Counter(t for tokens in token_lists for t in set(tokens))
        # Smoothed idf: rare terms score high, ubiquitous terms near zero.
        self.idf = {
            t: math.log((self.n_docs + 1) / (count + 1)) + 1.0
            for t, count in df.items()
        }
        self.vectors = [self._vector(tokens) for tokens in token_lists]
        return self

    @property
    def dims(self) -> int:
        return len(self.idf)

    def _vector(self, tokens: list[str]) -> dict[str, float]:
        tf = Counter(tokens)
        # Unknown query terms get the max-rarity idf (seen in no corpus doc).
        default_idf = math.log(self.n_docs + 1.0) + 1.0
        weights = {
            t: (1.0 + math.log(c)) * self.idf.get(t, default_idf)
            for t, c in tf.items()
        }
        norm = math.sqrt(sum(w * w for w in weights.values())) or 1.0
        return {t: w / norm for t, w in weights.items()}

    def embed_query(self, tokens: list[str]) -> dict[str, float]:
        return self._vector(tokens)

    @staticmethod
    def cosine(q: dict[str, float], d: dict[str, float]) -> float:
        if len(d) < len(q):
            q, d = d, q
        return sum(w * d[t] for t, w in q.items() if t in d)

    @staticmethod
    def contributions(
        q: dict[str, float], d: dict[str, float], top: int = 5
    ) -> list[dict]:
        """Per-term share of a cosine score — the 'why did this match' data."""
        parts = [(t, q[t] * d[t]) for t in q if t in d]
        parts.sort(key=lambda p: p[1], reverse=True)
        return [{"term": t, "weight": round(w, 4)} for t, w in parts[:top] if w > 0]


# ── Backend 2: Voyage AI semantic embeddings (optional) ─────────────

_VOYAGE_URL = "https://api.voyageai.com/v1/embeddings"
_VOYAGE_BATCH = 96


class VoyageBackend:
    """Dense semantic embeddings via the Voyage AI REST API (stdlib-only)."""

    def __init__(self, api_key: str, model: str) -> None:
        self.api_key = api_key
        self.model = model
        self.name = f"voyage:{model}"

    def embed(self, texts: list[str], input_type: str) -> list[list[float]]:
        """input_type is 'document' for chunks, 'query' for questions."""
        out: list[list[float]] = []
        for start in range(0, len(texts), _VOYAGE_BATCH):
            batch = texts[start : start + _VOYAGE_BATCH]
            req = urllib.request.Request(
                _VOYAGE_URL,
                data=json.dumps(
                    {"model": self.model, "input": batch, "input_type": input_type}
                ).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.api_key}",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=45) as resp:
                payload = json.load(resp)
            rows = sorted(payload["data"], key=lambda r: r["index"])
            out.extend(_normalize(r["embedding"]) for r in rows)
        return out

    @staticmethod
    def cosine(a: list[float], b: list[float]) -> float:
        return sum(x * y for x, y in zip(a, b))


def _normalize(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]
