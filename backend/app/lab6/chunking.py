"""Lab 6 · RAG stages 1-2 — ingest the corpus and chunk it.

Chunking strategy (deliberately simple and inspectable):

  1. Split each markdown document into sections at headings. Headings are
     strong semantic boundaries — a chunk should never straddle two topics.
  2. Pack whole paragraphs into chunks of about CHUNK_TARGET_CHARS characters.
     Whole paragraphs, because a sentence torn in half embeds/retrieves badly.
  3. When a section spills into a second chunk, carry the tail of the previous
     chunk forward as overlap, so a fact that sits on a chunk boundary is still
     retrievable from at least one side.

Every chunk keeps its provenance (document, heading) — that provenance is what
makes the citations in the final answer possible.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from ..config import LAB6_DOCS_DIR

# ~500 chars ≈ 125 tokens: small enough that a chunk is one focused idea (and
# retrieval is precise), large enough to carry a complete rule with its context.
CHUNK_TARGET_CHARS = 500
# ~120 chars ≈ the last sentence or two of the previous chunk.
CHUNK_OVERLAP_CHARS = 120
# Never flush a chunk smaller than this — a short lead-in paragraph should ride
# along with the list it introduces (modest overshoot beats fragment chunks).
MIN_PACK_CHARS = 250

_HEADING_RE = re.compile(r"^(#{1,3})\s+(.*)$")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


@dataclass
class Chunk:
    """One retrievable unit of the corpus, with provenance."""

    id: int                    # global chunk id (stable for one index build)
    doc_id: str                # filename stem, e.g. "03-inspections"
    source: str                # filename, e.g. "03-inspections.md"
    title: str                 # document title (from the H1)
    heading: str               # nearest section heading
    text: str                  # the chunk text handed to embedding/BM25
    overlap_prefix_chars: int  # leading chars duplicated from the previous chunk

    def meta(self) -> dict:
        return {
            "chunk_id": self.id,
            "doc_id": self.doc_id,
            "source": self.source,
            "title": self.title,
            "heading": self.heading,
            "chars": len(self.text),
            "overlap_prefix_chars": self.overlap_prefix_chars,
        }

    def public(self) -> dict:
        return {**self.meta(), "text": self.text}


def load_documents() -> list[dict]:
    """Read every markdown file in the corpus folder (sorted, deterministic)."""
    docs: list[dict] = []
    for path in sorted(LAB6_DOCS_DIR.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        title = path.stem
        for line in text.splitlines():
            m = _HEADING_RE.match(line)
            if m and len(m.group(1)) == 1:
                title = m.group(2).strip()
                break
        docs.append({"doc_id": path.stem, "source": path.name, "title": title, "text": text})
    return docs


def _sections(text: str, fallback_heading: str) -> list[tuple[str, str]]:
    """Split markdown into (heading, body) pairs at #/##/### headings."""
    sections: list[tuple[str, str]] = []
    heading = fallback_heading
    buf: list[str] = []

    def flush() -> None:
        body = "\n".join(buf).strip()
        if body:
            sections.append((heading, body))

    for line in text.splitlines():
        m = _HEADING_RE.match(line)
        if m:
            flush()
            buf = []
            # The H1 is the document title; body after it is a preamble.
            heading = fallback_heading if len(m.group(1)) == 1 else m.group(2).strip()
        else:
            buf.append(line)
    flush()
    return sections


def _split_long_paragraph(para: str, target: int) -> list[str]:
    """A single paragraph bigger than a chunk gets split at sentence ends."""
    if len(para) <= target * 1.5:
        return [para]
    parts: list[str] = []
    cur = ""
    for sent in _SENTENCE_SPLIT_RE.split(para):
        if cur and len(cur) + 1 + len(sent) > target:
            parts.append(cur)
            cur = sent
        else:
            cur = f"{cur} {sent}" if cur else sent
    if cur:
        parts.append(cur)
    return parts


def _overlap_tail(text: str, overlap: int) -> str:
    """Last ~`overlap` chars of a chunk, trimmed to a sentence/word boundary."""
    if overlap <= 0 or len(text) <= overlap:
        return ""
    tail = text[-overlap:]
    dot = tail.find(". ")
    if 0 <= dot < len(tail) - 2:
        return tail[dot + 2 :]
    space = tail.find(" ")
    return tail[space + 1 :] if space >= 0 else tail


def _pack_section(body: str) -> list[tuple[str, int]]:
    """Pack a section's paragraphs into (chunk_text, overlap_prefix_chars) pieces."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
    pieces: list[tuple[str, int]] = []
    cur = ""
    cur_overlap = 0
    for para in paragraphs:
        for piece in _split_long_paragraph(para, CHUNK_TARGET_CHARS):
            full = cur and len(cur) + 2 + len(piece) > CHUNK_TARGET_CHARS
            if full and len(cur) >= MIN_PACK_CHARS:
                pieces.append((cur, cur_overlap))
                tail = _overlap_tail(cur, CHUNK_OVERLAP_CHARS)
                cur_overlap = len(tail)
                cur = f"{tail}\n\n{piece}" if tail else piece
            else:
                cur = f"{cur}\n\n{piece}" if cur else piece
    if cur:
        pieces.append((cur, cur_overlap))
    return pieces


def build_chunks(docs: list[dict]) -> list[Chunk]:
    """Chunk the whole corpus; ids are assigned in document order."""
    chunks: list[Chunk] = []
    for doc in docs:
        for heading, body in _sections(doc["text"], doc["title"]):
            for text, overlap in _pack_section(body):
                chunks.append(
                    Chunk(
                        id=len(chunks),
                        doc_id=doc["doc_id"],
                        source=doc["source"],
                        title=doc["title"],
                        heading=heading,
                        text=text,
                        overlap_prefix_chars=overlap,
                    )
                )
    return chunks
