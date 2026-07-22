"""Lab 4 — render a structured job aid into a branded .docx.

Opens a template canvas (see lab4_templates) and appends the job-aid content
using the template's own Title/Heading/Normal styles, so the output inherits the
template's fonts, colours, header and footer.
"""
import io
from datetime import date
from pathlib import Path

from docx import Document
from docx.shared import Inches, Pt, RGBColor


def _para(doc, text="", *, italic=False, bold=False, size=None, color=None, indent=None):
    p = doc.add_paragraph()
    if text:
        r = p.add_run(text)
        r.italic = italic
        r.bold = bold
        if size is not None:
            r.font.size = Pt(size)
        if color:
            r.font.color.rgb = RGBColor.from_string(color)
    if indent:
        p.paragraph_format.left_indent = Inches(indent)
    return p


def render_job_aid(job_aid: dict, base_path: Path) -> bytes:
    doc = Document(str(base_path))

    doc.add_paragraph(job_aid.get("title") or "Job Aid", style="Title")

    meta = [job_aid.get("document_type") or "Job Aid"]
    if job_aid.get("audience"):
        meta.append(f"Audience: {job_aid['audience']}")
    meta.append(f"Generated {date.today().isoformat()}")
    _para(doc, "  ·  ".join(meta), size=9, color="6B7280")

    if job_aid.get("purpose"):
        doc.add_paragraph("Purpose", style="Heading 1")
        _para(doc, job_aid["purpose"])

    if job_aid.get("overview"):
        _para(doc, job_aid["overview"])

    prerequisites = job_aid.get("prerequisites") or []
    if prerequisites:
        doc.add_paragraph("Before You Start", style="Heading 1")
        for item in prerequisites:
            doc.add_paragraph(str(item), style="List Bullet")

    for section in job_aid.get("sections") or []:
        doc.add_paragraph(section.get("heading") or "Steps", style="Heading 1")
        for i, step in enumerate(section.get("steps") or [], 1):
            title = step.get("title") or step.get("detail") or ""
            p = doc.add_paragraph()
            p.add_run(f"{i}. {title}").bold = True
            detail = step.get("detail")
            if detail and detail != title:
                _para(doc, detail, indent=0.3)
            note = step.get("note")
            if note:
                _para(doc, f"Note: {note}", italic=True, indent=0.3, color="9A6A00")

    tips = job_aid.get("tips") or []
    if tips:
        doc.add_paragraph("Tips & Edge Cases", style="Heading 1")
        for tip in tips:
            doc.add_paragraph(str(tip), style="List Bullet")

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
