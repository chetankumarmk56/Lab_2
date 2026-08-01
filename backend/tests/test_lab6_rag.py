"""Lab 6 — RAG pipeline tests: retrieval quality + invariants (no network, no DB).

The golden-set test is the load-bearing one. RAG quality is measured at the
retrieval stage first — if the right document isn't in the top-k, no prompt or
model can save the answer — so hit@k is asserted before any LLM is involved.
All tests force the local TF-IDF backend, so they are deterministic and free.
"""
import pytest
from fastapi.testclient import TestClient

from app.config import LAB6_DOCS_DIR
from app.lab6 import index as corpus_index
from app.lab6.chunking import CHUNK_OVERLAP_CHARS, CHUNK_TARGET_CHARS, build_chunks, load_documents
from app.lab6.embedding import TfidfBackend, tokenize
from app.lab6.index import CorpusIndex
from app.lab6.retrieval import rrf_fuse
from app.main import app

client = TestClient(app)


@pytest.fixture(scope="module")
def index() -> CorpusIndex:
    return CorpusIndex.build(use_semantic=False)


# ── Stage 1-2: ingest + chunking invariants ─────────────────────────

def test_corpus_loads_and_chunks_cover_every_doc():
    docs = load_documents()
    chunks = build_chunks(docs)
    assert len(docs) >= 6
    assert {d["doc_id"] for d in docs} == {c.doc_id for c in chunks}
    # ids are dense and ordered — the UI and citations rely on this
    assert [c.id for c in chunks] == list(range(len(chunks)))


def test_chunk_sizes_are_bounded():
    chunks = build_chunks(load_documents())
    # A chunk may exceed the target via the accept-overshoot rule (a sub-minimum
    # lead-in + one long paragraph + carried overlap), but a chunk beyond this
    # bound would mean the packer isn't flushing at all.
    bound = CHUNK_TARGET_CHARS * 2 + CHUNK_OVERLAP_CHARS
    assert all(len(c.text) <= bound for c in chunks)


def test_overlap_prefix_is_copied_from_previous_chunk():
    chunks = build_chunks(load_documents())
    overlapped = [c for c in chunks if c.overlap_prefix_chars > 0]
    assert overlapped, "expected at least one overlapping chunk in the corpus"
    by_id = {c.id: c for c in chunks}
    for chunk in overlapped:
        prev = by_id[chunk.id - 1]
        assert prev.doc_id == chunk.doc_id
        tail = chunk.text[: chunk.overlap_prefix_chars]
        assert prev.text.endswith(tail)
        assert len(tail) <= CHUNK_OVERLAP_CHARS


# ── Stage 3: embedding ──────────────────────────────────────────────

def test_tokenize_folds_plurals_and_drops_stopwords():
    assert tokenize("The permits and the fees for inspections") == [
        "permit", "fee", "inspection",
    ]


def test_tfidf_self_similarity_is_maximal():
    backend = TfidfBackend().fit([
        tokenize("reinspection fee is seventy five dollars"),
        tokenize("appeals are filed with the board"),
    ])
    q = backend.embed_query(tokenize("reinspection fee is seventy five dollars"))
    self_score = TfidfBackend.cosine(q, backend.vectors[0])
    other_score = TfidfBackend.cosine(q, backend.vectors[1])
    assert self_score == pytest.approx(1.0, abs=1e-9)
    assert other_score < self_score


# ── Stage 4: fusion ─────────────────────────────────────────────────

def test_rrf_prefers_agreement_between_retrievers():
    fused = rrf_fuse([[7, 2], [7, 9]])
    assert fused[0]["chunk_id"] == 7
    assert fused[0]["ranks"] == [1, 1]
    # 1/(60+1) from each list
    assert fused[0]["score"] == pytest.approx(2 / 61, abs=1e-4)


# ── Retrieval quality: golden hit@k over the real corpus ────────────

GOLDEN = [
    ("How long is a building permit valid?", "04-expiration-renewal"),
    ("Can I extend my permit before it expires?", "04-expiration-renewal"),
    ("What is the reinspection fee?", "02-fees-and-payment"),
    ("How much notice do I need to schedule an inspection?", "03-inspections"),
    ("How do I appeal a permit denial and what is the deadline?", "06-appeals"),
    ("What insurance must a licensed contractor carry?", "05-contractor-licensing"),
    ("Do I need a permit to replace a light switch?", "07-electrical-standards"),
    ("How long are permit records retained?", "08-records-privacy"),
    ("What documents are required with a permit application?", "01-application-intake"),
]


def test_golden_questions_hit_expected_doc_at_k5(index: CorpusIndex):
    for question, expected_doc in GOLDEN:
        trace = index.search(question, k=5)
        selected_docs = {c["doc_id"] for c in trace["selected"]}
        assert expected_doc in selected_docs, (
            f"{question!r} retrieved {sorted(selected_docs)}, expected {expected_doc}"
        )


def test_search_trace_is_ranked_and_bounded(index: CorpusIndex):
    trace = index.search("What is the reinspection fee?", k=3)
    vec = trace["stages"]["vector"]["hits"]
    lex = trace["stages"]["lexical"]["hits"]
    assert vec == sorted(vec, key=lambda h: -h["score"])
    assert lex == sorted(lex, key=lambda h: -h["score"])
    assert len(trace["selected"]) <= 3
    selected_ids = {c["chunk_id"] for c in trace["selected"]}
    top_fused = [c for c in trace["stages"]["fusion"]["candidates"] if c["selected"]]
    assert {c["chunk_id"] for c in top_fused} == selected_ids


def test_off_corpus_question_triggers_low_confidence_gate(index: CorpusIndex):
    trace = index.search("best zucchini lasagna oven temperature", k=5)
    assert trace["low_confidence"] is True
    assert trace["selected"] == []


# ── Router: retrieve-only integration (no LLM call, no API key) ─────

def test_ask_endpoint_retrieve_only_returns_full_trace():
    r = client.post(
        "/api/lab6/ask",
        json={"question": "What is the reinspection fee?", "retrieve_only": True},
    )
    assert r.status_code == 200
    body = r.json()
    stages = body["stages"]
    assert body["answer"] is None
    assert stages["generate"]["skipped"] is True
    assert stages["lexical"]["hits"], "expected lexical hits for an on-corpus question"
    assert stages["augment"]["context"], "expected context blocks in the augment stage"
    assert "[1]" in stages["augment"]["user_prompt"]
    assert stages["augment"]["system_prompt"].startswith("You are a policy assistant")


def test_corpus_and_chunk_endpoints():
    r = client.get("/api/lab6/corpus")
    assert r.status_code == 200
    summary = r.json()
    assert summary["chunk_count"] > 0
    doc_id = summary["docs"][0]["doc_id"]

    r2 = client.get(f"/api/lab6/chunks/{doc_id}")
    assert r2.status_code == 200
    assert all(c["doc_id"] == doc_id for c in r2.json()["chunks"])

    assert client.get("/api/lab6/chunks/nope").status_code == 404


# ── Upload ingestion: the live corpus round-trip ────────────────────

UPLOAD_MD = b"""# Parking Permit Policy

## Monthly Parking Permits

A monthly parking permit costs $40 and is valid for one calendar month from the
date of purchase. Permits are issued at the parking office and must be displayed
on the dashboard at all times while parked in a county lot.

## Renewal

Monthly permits renew automatically when a payment method is on file. Cancel at
least 5 business days before the renewal date to avoid the next charge.
"""


def test_upload_ingest_ask_delete_roundtrip():
    client.get("/api/lab6/corpus")  # warm the index so before-stats are present
    doc_id = None
    try:
        r = client.post(
            "/api/lab6/upload",
            files={"file": ("Parking Policy.md", UPLOAD_MD, "text/markdown")},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        doc_id = body["doc"]["doc_id"]
        assert doc_id.startswith("user-parking-policy")
        assert body["doc"]["uploaded"] is True

        trace = body["trace"]
        assert trace["receive"]["kind"] == "md"
        assert trace["extract"]["chars"] > 100
        assert trace["chunk"]["sections"] >= 2
        assert len(trace["chunk"]["chunks"]) >= 2
        assert all(c["doc_id"] == doc_id for c in trace["chunk"]["chunks"])
        assert trace["index"]["chunk_count_after"] == (
            trace["index"]["chunk_count_before"] + len(trace["chunk"]["chunks"])
        )

        # The uploaded content is immediately retrievable.
        r2 = client.post(
            "/api/lab6/ask",
            json={
                "question": "How much does a monthly parking permit cost?",
                "retrieve_only": True,
            },
        )
        assert r2.status_code == 200
        sources = {c["source"] for c in r2.json()["stages"]["augment"]["context"]}
        assert any(s.startswith("user-parking-policy") for s in sources), sources

        # Delete restores the corpus.
        r3 = client.delete(f"/api/lab6/docs/{doc_id}")
        assert r3.status_code == 200
        assert all(d["doc_id"] != doc_id for d in r3.json()["docs"])
        doc_id = None
    finally:
        if doc_id:  # a failed assertion above must not leave the file behind
            (LAB6_DOCS_DIR / f"{doc_id}.md").unlink(missing_ok=True)
            corpus_index.invalidate()


def test_upload_rejects_wrong_type_and_empty_content():
    r = client.post(
        "/api/lab6/upload",
        files={"file": ("evil.exe", b"MZ\x90\x00", "application/octet-stream")},
    )
    assert r.status_code == 400

    r2 = client.post(
        "/api/lab6/upload", files={"file": ("tiny.md", b"# Hi", "text/markdown")}
    )
    assert r2.status_code == 400


def test_seeded_documents_cannot_be_deleted():
    assert client.delete("/api/lab6/docs/01-application-intake").status_code == 400
    assert client.delete("/api/lab6/docs/user-does-not-exist").status_code == 404
