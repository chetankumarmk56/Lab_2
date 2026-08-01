"""Lab 6 — user-uploaded corpus documents: receive → extract → normalize → store.

An upload becomes one more markdown file in the corpus folder, prefixed
`user-` so seeded policy docs and user additions are distinguishable (and only
uploads are deletable). After storing, the caller invalidates the index; the
next build re-chunks and re-embeds the whole corpus — wholesale rebuilds are
deliberate: at corpus scale they cost milliseconds and keep every derived
structure (idf table, BM25 stats, vectors) trivially consistent.

Extraction mirrors Lab 4's workflow intake: .md/.txt are decoded, .pdf goes
through pypdf, and a text-layer-less scan gets a clear 400 instead of an empty
corpus entry.
"""
from __future__ import annotations

import io
import re
from pathlib import Path

from ..config import LAB6_DOCS_DIR

# Filename prefix that marks a document as user-uploaded (and thus removable).
USER_PREFIX = "user-"

ALLOWED_EXTENSIONS = {".md", ".markdown", ".txt", ".pdf"}
MAX_UPLOAD_BYTES = 500 * 1024   # policy text, not datasets — half a MB is plenty
MIN_TEXT_CHARS = 80             # below this there is nothing worth indexing

_H1_RE = re.compile(r"^#\s+\S", re.MULTILINE)
_SLUG_RE = re.compile(r"[^a-z0-9]+")


class UploadError(ValueError):
    """A user-fixable problem with the uploaded file (surfaces as HTTP 400)."""


def extract_text(filename: str, raw: bytes) -> tuple[str, str, int | None]:
    """Turn the uploaded bytes into plain text.

    Returns (kind, text, pages) where kind is 'md' | 'txt' | 'pdf' and pages is
    only set for PDFs.
    """
    ext = Path(filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise UploadError(
            f"Unsupported file type '{ext or 'none'}' — upload .md, .txt, or .pdf."
        )
    if len(raw) > MAX_UPLOAD_BYTES:
        raise UploadError(
            f"File is {len(raw) // 1024} KB; the corpus accepts up to {MAX_UPLOAD_BYTES // 1024} KB."
        )

    if ext == ".pdf":
        try:
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(raw))
            pages = [page.extract_text() or "" for page in reader.pages]
        except Exception as exc:  # noqa: BLE001 - malformed/encrypted PDFs
            raise UploadError(f"Could not read the PDF: {exc}") from exc
        text = "\n\n".join(part.strip() for part in pages if part.strip())
        if len(text) < MIN_TEXT_CHARS:
            raise UploadError(
                "The PDF has no extractable text layer (a scanned image?) — "
                "upload a text-based PDF, .md, or .txt."
            )
        return "pdf", text, len(reader.pages)

    kind = "txt" if ext == ".txt" else "md"
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1", errors="replace")
    text = text.replace("\r\n", "\n").replace("\x00", "").strip()
    if len(text) < MIN_TEXT_CHARS:
        raise UploadError(
            f"Only {len(text)} characters of text — a corpus document needs at "
            f"least {MIN_TEXT_CHARS} to be worth indexing."
        )
    return kind, text, None


def _pretty_title(filename: str) -> str:
    stem = Path(filename or "document").stem
    words = re.sub(r"[-_]+", " ", stem).strip()
    return words.title() if words else "Uploaded Document"


def normalize_markdown(filename: str, kind: str, text: str) -> str:
    """Ensure the stored document has an H1 title (chunk provenance needs one)."""
    if kind == "md" and _H1_RE.search(text):
        return text
    return f"# {_pretty_title(filename)}\n\n{text}"


def _slugify(filename: str) -> str:
    stem = Path(filename or "document").stem.lower()
    slug = _SLUG_RE.sub("-", stem).strip("-")[:40].strip("-")
    return slug or "document"


def store_document(filename: str, markdown: str) -> str:
    """Write the normalized markdown into the corpus folder; returns the doc_id."""
    base = f"{USER_PREFIX}{_slugify(filename)}"
    doc_id = base
    counter = 2
    while (LAB6_DOCS_DIR / f"{doc_id}.md").exists():
        doc_id = f"{base}-{counter}"
        counter += 1
    (LAB6_DOCS_DIR / f"{doc_id}.md").write_text(markdown, encoding="utf-8")
    return doc_id


def delete_document(doc_id: str) -> bool:
    """Remove an uploaded document. Seeded corpus docs are not deletable."""
    if not re.fullmatch(r"[a-z0-9-]+", doc_id or ""):
        raise UploadError("Invalid document id.")
    if not doc_id.startswith(USER_PREFIX):
        raise UploadError("Only uploaded documents (user-*) can be removed.")
    path = LAB6_DOCS_DIR / f"{doc_id}.md"
    if not path.exists():
        return False
    path.unlink()
    return True
