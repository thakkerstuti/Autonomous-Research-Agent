import os
import asyncio
import json

import fitz  # PyMuPDF
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

import app.models as models
from app import study, tasks
from app.auth.deps import get_current_user
from app.database import get_db
from app.log import get_logger

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

MAX_MB = int(os.getenv("PAPER_MAX_MB", "25"))
MAX_BYTES = MAX_MB * 1024 * 1024
MAX_PAGES = int(os.getenv("PAPER_MAX_PAGES", "300"))
PDF_TYPES = {"application/pdf", "application/x-pdf"}
MIN_PAGE_CHARS = 20  # less than this (e.g. a lone page number) counts as no text

log = get_logger("papers")
router = APIRouter(prefix="/papers", tags=["papers"])


def _owned_paper(db: Session, paper_id: str, user: models.User) -> models.Paper:
    """A paper that isn't the caller's is reported as missing, not forbidden."""
    paper = db.query(models.Paper).filter(models.Paper.id == paper_id, models.Paper.user_id == user.id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    return paper


def _check_level(level: str) -> str:
    if level not in tasks.LEVELS:
        raise HTTPException(status_code=400, detail=f"Level must be one of: {', '.join(tasks.LEVELS)}.")
    return level


def _reject(user: models.User, reason: str, status: int = 400, **facts) -> HTTPException:
    log.info("upload rejected user=%s reason=%s %s", user.id[:8], reason, " ".join(f"{k}={v}" for k, v in facts.items()))
    return HTTPException(status_code=status, detail=reason)


@router.get("")
def list_papers(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    papers = db.query(models.Paper).filter(models.Paper.user_id == user.id).order_by(models.Paper.created_at.desc()).all()
    # The list keeps its original three statuses; /status has the detail
    shown = {"ready": "ready", "partial": "ready", "processing": "processing", "failed": "failed", "needs_ocr": "failed"}
    return [
        {
            "id": p.id,
            "title": p.title,
            "authors": "Uploaded PDF",
            "pages": p.page_count or 0,
            "uploaded": p.created_at.strftime("%b %d, %Y") if p.created_at else "Recently",
            "status": shown.get(p.status, "processing"),
        }
        for p in papers
    ]


@router.post("")
def upload_paper(
    level: str = Form("Medium"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    level = _check_level(level)
    name = (file.filename or "").strip()
    if not name.lower().endswith(".pdf"):
        raise _reject(user, "Only .pdf files can be studied.", name_ok=False)
    if (file.content_type or "").lower() not in PDF_TYPES:
        raise _reject(user, "Only PDF files can be studied.", content_type=file.content_type)

    # Read in chunks so an oversized upload is refused without holding it all
    chunks, size = [], 0
    while chunk := file.file.read(1024 * 1024):
        size += len(chunk)
        if size > MAX_BYTES:
            raise _reject(user, f"This PDF is larger than {MAX_MB} MB.", status=413, bytes_over=size)
        chunks.append(chunk)
    data = b"".join(chunks)

    if not data.startswith(b"%PDF"):
        raise _reject(user, "This file isn't a valid PDF.", bytes=size, signature=False)
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception:
        raise _reject(user, "This PDF is damaged and can't be opened.", bytes=size)
    try:
        if doc.needs_pass:
            raise _reject(user, "This PDF is password-protected. Remove the password and upload it again.", bytes=size)
        page_count = len(doc)
        if page_count == 0:
            raise _reject(user, "This PDF has no pages.", bytes=size)
        if page_count > MAX_PAGES:
            raise _reject(user, f"This PDF has {page_count} pages; the limit is {MAX_PAGES}.", bytes=size, pages=page_count)

        # Extract everything first, outside any database transaction, so a long
        # PDF never holds a write lock the processing worker would wait on.
        extracted: list[tuple[int, str, str]] = []  # (page number, text, status)
        failed_extract = image_only = 0
        for i in range(page_count):
            number = i + 1
            try:
                page = doc[i]
                text = page.get_text("text").strip()
                has_images = bool(page.get_images(full=False))
            except Exception as exc:
                failed_extract += 1
                log.warning("extract failed page=%d error=%s", number, type(exc).__name__)
                extracted.append((number, "", "extract_failed"))
                continue
            if len(text) >= MIN_PAGE_CHARS:
                extracted.append((number, text, "ready"))
            else:
                image_only += int(has_images)
                extracted.append((number, text, "no_text"))
    finally:
        doc.close()

    text_pages = sum(1 for _, _, st in extracted if st == "ready")
    no_text = sum(1 for _, _, st in extracted if st == "no_text")

    # One short write: the paper, its pages and the pending explanations together
    paper = models.Paper(
        user_id=user.id,
        title=name[:255],
        page_count=page_count,
        file_size=size,
        level=level,
        status="processing" if text_pages else "needs_ocr",
    )
    db.add(paper)
    db.flush()
    for number, text, st in extracted:
        db.add(models.PaperPage(paper_id=paper.id, page_number=number, text=text, status=st))
        if st == "ready":
            db.add(models.PageSummary(paper_id=paper.id, page_number=number, level=level, status="pending"))
    db.commit()

    path = os.path.join(UPLOAD_DIR, f"{paper.id}.pdf")
    try:
        with open(path, "wb") as f:
            f.write(data)
    except OSError as exc:  # the text is already saved; only the original file is affected
        log.warning("file save failed paper=%s error=%s", paper.id, type(exc).__name__)
        try:
            os.remove(path)  # never leave a partial file behind
        except OSError:
            pass

    log.info(
        "upload ok paper=%s user=%s bytes=%d pages=%d text_pages=%d no_text=%d image_only=%d extract_failed=%d level=%s",
        paper.id, user.id[:8], size, page_count, text_pages, no_text, image_only, failed_extract, level,
    )
    if text_pages:
        tasks.enqueue_paper(paper.id, level)
        # The study kit (summary, flashcards, Q&A, highlights) starts right away,
        # in its own worker, alongside the page explanations
        study.ensure_kit(db, paper.id)
        tasks.enqueue_study(paper.id)

    return {
        "id": paper.id,
        "message": "Queued for processing." if text_pages else "No selectable text found; OCR is required.",
        "status": paper.status,
        "page_count": page_count,
        "text_pages": text_pages,
        "needs_ocr": text_pages == 0,
    }


@router.get("/{paper_id}/file")
def get_paper_file(paper_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    paper_id = _owned_paper(db, paper_id, user).id
    file_path = os.path.join(UPLOAD_DIR, f"{paper_id}.pdf")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path, media_type="application/pdf")


@router.get("/{paper_id}")
def get_paper(paper_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return _owned_paper(db, paper_id, user)


@router.patch("/{paper_id}")
def update_paper(paper_id: str, level: str = Form(...), db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Switch the explanation level. Pages already explained at that level are kept;
    the rest are queued."""
    paper = _owned_paper(db, paper_id, user)
    paper.level = _check_level(level)

    pages = db.query(models.PaperPage).filter(models.PaperPage.paper_id == paper_id, models.PaperPage.status == "ready").all()
    existing = {
        s.page_number
        for s in db.query(models.PageSummary).filter(models.PageSummary.paper_id == paper_id, models.PageSummary.level == level)
    }
    new_summaries = 0
    for page in pages:
        if page.page_number not in existing:
            db.add(models.PageSummary(paper_id=paper_id, page_number=page.page_number, level=level, status="pending"))
            new_summaries += 1
    db.commit()

    status = tasks.refresh_paper_status(db, paper)
    if status == "processing":
        tasks.enqueue_paper(paper.id, level)
    log.info("level change paper=%s level=%s queued_pages=%d", paper.id, level, new_summaries)
    return {"id": paper.id, "level": level, "status": "processing" if status == "processing" else "ready"}


@router.get("/{paper_id}/pages")
def get_paper_pages(paper_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    paper = _owned_paper(db, paper_id, user)
    summaries = db.query(models.PageSummary).filter(
        models.PageSummary.paper_id == paper_id,
        models.PageSummary.level == paper.level
    ).order_by(models.PageSummary.page_number).all()
    return {"pages": [{"page_number": s.page_number, "status": s.status} for s in summaries]}


@router.get("/{paper_id}/status")
def get_paper_status(paper_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Processing progress for the paper's current level."""
    paper = _owned_paper(db, paper_id, user)
    counts = {"pending": 0, "processing": 0, "ready": 0, "failed": 0}
    for (s,) in db.query(models.PageSummary.status).filter(
        models.PageSummary.paper_id == paper_id, models.PageSummary.level == paper.level
    ):
        counts[s] = counts.get(s, 0) + 1
    page_kinds = {"ready": 0, "no_text": 0, "extract_failed": 0}
    for (s,) in db.query(models.PaperPage.status).filter(models.PaperPage.paper_id == paper_id):
        page_kinds[s] = page_kinds.get(s, 0) + 1

    status = paper.status
    if status == "needs_ocr":
        message = "This PDF has no selectable text, so it looks scanned. Run OCR on it, then upload it again."
    elif status == "processing":
        message = "Explaining pages…"
    elif status == "failed":
        message = "None of the pages could be explained. Retry them."
    elif status == "partial":
        message = f"{counts['failed']} page(s) couldn't be explained. You can retry them."
    else:
        message = "All pages are explained."
    skipped = page_kinds["no_text"] + page_kinds["extract_failed"]
    if skipped and status != "needs_ocr":
        message += f" {skipped} page(s) had no readable text and were skipped."

    return {
        "paper_id": paper.id,
        "status": status,
        "level": paper.level,
        "page_count": paper.page_count,
        "text_pages": page_kinds["ready"],
        "skipped_pages": skipped,
        "total": sum(counts.values()),
        **counts,
        "message": message,
    }


@router.get("/{paper_id}/pages/{page_number}")
def get_paper_page(paper_id: str, page_number: int, level: str = "Medium", db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Reads a page explanation. Never calls the AI: processing happens in the worker."""
    _owned_paper(db, paper_id, user)
    summary = db.query(models.PageSummary).filter(
        models.PageSummary.paper_id == paper_id,
        models.PageSummary.page_number == page_number,
        models.PageSummary.level == level
    ).first()
    if not summary:
        raise HTTPException(status_code=404, detail="Summary not found")
    return summary


def _requeue(db: Session, paper: models.Paper, level: str, page_number: int | None = None) -> int:
    q = db.query(models.PageSummary).filter(models.PageSummary.paper_id == paper.id, models.PageSummary.level == level)
    q = q.filter(models.PageSummary.page_number == page_number) if page_number is not None else q.filter(models.PageSummary.status == "failed")
    count = q.filter(models.PageSummary.status.in_(("failed", "ready"))).update(
        {"status": "pending", "error": None}, synchronize_session=False
    )
    db.commit()
    if count:
        if paper.level == level:
            tasks.refresh_paper_status(db, paper)
        tasks.enqueue_paper(paper.id, level)
    return count


@router.post("/{paper_id}/pages/{page_number}/regenerate")
def regenerate_paper_page(paper_id: str, page_number: int, level: str = "Medium", db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Queue one page again (e.g. after a failure) without touching the others."""
    paper = _owned_paper(db, paper_id, user)
    _check_level(level)
    summary = db.query(models.PageSummary).filter(
        models.PageSummary.paper_id == paper_id,
        models.PageSummary.page_number == page_number,
        models.PageSummary.level == level
    ).first()
    if not summary:
        raise HTTPException(status_code=404, detail="Summary not found")
    if summary.status in ("pending", "processing"):
        return summary  # already on its way: never queued twice
    _requeue(db, paper, level, page_number)
    log.info("page requeued paper=%s page=%d level=%s", paper.id, page_number, level)
    db.refresh(summary)
    return summary


@router.post("/{paper_id}/retry-failed")
def retry_failed_pages(paper_id: str, level: str | None = None, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    paper = _owned_paper(db, paper_id, user)
    level = _check_level(level or paper.level)
    count = _requeue(db, paper, level)
    log.info("retry failed paper=%s level=%s pages=%d", paper.id, level, count)
    return {"paper_id": paper.id, "level": level, "requeued": count}


@router.get("/{paper_id}/progress")
async def get_paper_progress(paper_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    paper = _owned_paper(db, paper_id, user)
    level = paper.level

    async def event_generator():
        from app.database import SessionLocal
        while True:
            local_db = SessionLocal()
            try:
                summaries = local_db.query(models.PageSummary).filter(
                    models.PageSummary.paper_id == paper_id,
                    models.PageSummary.level == level
                ).all()
                total = len(summaries)
                done = sum(1 for s in summaries if s.status == "ready")
                failed = sum(1 for s in summaries if s.status == "failed")
                yield f"data: {json.dumps({'done': done, 'total': total, 'failed': failed, 'current_page': done + 1})}\n\n"
                if (done + failed) == total:
                    break
            finally:
                local_db.close()
            await asyncio.sleep(2)

    return StreamingResponse(event_generator(), media_type="text/event-stream")
