"""Lab 6 — Policy Q&A: a from-scratch, fully inspectable RAG pipeline.

Modules map 1:1 to the classic RAG stages so each one can be shown and
explained on its own:

    chunking.py   → ingest + chunk   (markdown → heading-aware chunks with overlap)
    embedding.py  → embed            (local TF-IDF vectors, or Voyage AI semantic)
    retrieval.py  → retrieve         (BM25 lexical ranking + Reciprocal Rank Fusion)
    index.py      → orchestration    (build the index once, run the search trace)

Generation lives in app/agents/lab6_doc_qa.py (no tools — the retrieved chunks
are the agent's only knowledge), and the HTTP surface in app/routers/lab6.py.
"""
