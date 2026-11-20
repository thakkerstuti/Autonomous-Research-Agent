import os
import asyncio
import json
import threading
import time

import fitz  # PyMuPDF
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

import app.models as models
from app import page_roles, storage, study, tasks
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


# ───────── cancelling an upload ─────────
# The reader can cancel while the PDF is uploading or its pages are being extracted. The
# upload checks for a cancel at each step and, if there is one, keeps nothing: no paper,
# no pages, no stored file. (One server process, so this in-memory record is shared.)
CANCELLED_MESSAGE = "Upload cancelled. Nothing was saved."
_upload_lock = threading.Lock()
_cancelled: dict[str, float] = {}   # "user:upload" -> when it was cancelled
_finished: dict[str, str] = {}      # "user:upload" -> the paper it saved (a cancel arrived too late)
_KEEP_SECONDS = 30 * 60


def _upload_key(user: models.User, upload_id: str) -> str | None:
    upload_id = (upload_id or "").strip()
    return f"{user.id}:{upload_id[:64]}" if upload_id else None


def _prune(now: float) -> None:
    for key, at in list(_cancelled.items()):
        if now - at > _KEEP_SECONDS:
            _cancelled.pop(key, None)
            _finished.pop(key, None)


def _is_cancelled(key: str | None) -> bool:
    if not key:
        return False
    with _upload_lock:
        return key in _cancelled


def _check_cancelled(key: str | None, user: models.User) -> None:
    if _is_cancelled(key):
        log.info("upload cancelled user=%s", user.id[:8])
        raise HTTPException(status_code=409, detail=CANCELLED_MESSAGE)


def _reject(user: models.User, reason: str, status: int = 400, **facts) -> HTTPException:
    log.info("upload rejected user=%s reason=%s %s", user.id[:8], reason, " ".join(f"{k}={v}" for k, v in facts.items()))
    return HTTPException(status_code=status, detail=reason)


def _same_paper(db: Session, user: models.User, size: int, page_count: int,
                extracted: list[tuple[int, str, str]]) -> models.Paper | None:
    """This user's paper with the same file size, page count and page text, if any."""
    candidates = db.query(models.Paper).filter(
        models.Paper.user_id == user.id, models.Paper.file_size == size, models.Paper.page_count == page_count
    ).order_by(models.Paper.created_at.asc()).all()
    texts = {number: text for number, text, _ in extracted}
    for paper in candidates:
        stored = {p.page_number: p.text or "" for p in db.query(models.PaperPage).filter(models.PaperPage.paper_id == paper.id)}
        if stored == texts:
            return paper
    return None


def _drop_waiting(db: Session, paper_id: str, keep_level: str | None = None) -> int:
    """Take a paper's not-yet-started page notes off the queue (at every level but keep_level).
    Only rows still waiting are removed; written notes and the page being written stay."""
    q = db.query(models.PageSummary).filter(models.PageSummary.paper_id == paper_id, models.PageSummary.status == "pending")
    if keep_level:
        q = q.filter(models.PageSummary.level != keep_level)
    return q.delete(synchronize_session=False)


def _queue_pages(db: Session, paper: models.Paper, level: str) -> int:
    """Add the page explanations missing at this level: content pages are queued for the AI; front and
    back matter (title page, abstract, contents, references, acknowledgements) are recorded as skipped,
    with the reason in `summary`, and never reach the AI. Returns how many pages were queued. No commit."""
    pages = (db.query(models.PaperPage).filter(models.PaperPage.paper_id == paper.id, models.PaperPage.status == "ready")
             .order_by(models.PaperPage.page_number).all())
    existing = {
        s.page_number
        for s in db.query(models.PageSummary).filter(models.PageSummary.paper_id == paper.id, models.PageSummary.level == level)
    }
    role = page_roles.roles([(p.page_number, p.text or "") for p in pages])
    queued = 0
    for page in pages:
        if page.page_number in existing:
            continue
        r = role.get(page.page_number, page_roles.CONTENT)
        if r == page_roles.CONTENT:
            db.add(models.PageSummary(paper_id=paper.id, page_number=page.page_number, level=level, status="pending"))
            queued += 1
        else:
            db.add(models.PageSummary(paper_id=paper.id, page_number=page.page_number, level=level, status="skipped",
                                      summary=page_roles.REASONS[r]))
    return queued


def _switch_level(db: Session, paper: models.Paper, level: str) -> str:
    """Switch a paper's explanation level. Notes still waiting at the old level stop, so the
    new level starts straight away. If notes had been asked for, the new level's are queued
    (pages already written at that level are kept); otherwise only the choice is saved."""
    requested = db.query(models.PageSummary.id).filter(models.PageSummary.paper_id == paper.id).first() is not None
    previous = paper.level
    paper.level = level
    stopped = _drop_waiting(db, paper.id, keep_level=level)
    queued = 0
    if requested:
        queued = _queue_pages(db, paper, level)
    db.commit()
    status = tasks.refresh_paper_status(db, paper)
    if status == "processing":
        tasks.enqueue_paper(paper.id, level)
    log.info("level change paper=%s from=%s to=%s queued_pages=%d stopped_pages=%d", paper.id, previous, level, queued, stopped)
    return status


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


def _start_reflection(db: Session, paper: models.Paper) -> None:
    """Questions while the paper's study output is written. Never affects the upload or the kit."""
    from app import reflection
    try:
        reflection.start_for_paper(db, paper)
    except Exception as exc:
        db.rollback()
        log.warning("reflection start failed paper=%s error=%s", paper.id, type(exc).__name__)


@router.post("/uploads/{upload_id}/cancel")
def cancel_upload(upload_id: str, user: models.User = Depends(get_current_user)):
    """Cancel an upload that is still running. If it had already been saved, say which paper."""
    key = _upload_key(user, upload_id)
    if not key:
        raise HTTPException(status_code=400, detail="Unknown upload.")
    now = time.time()
    with _upload_lock:
        _prune(now)
        _cancelled[key] = now
        saved = _finished.get(key)
    return {"cancelled": saved is None, "paper_id": saved}


@router.post("")
def upload_paper(
    level: str = Form("Medium"),
    file: UploadFile = File(...),
    upload_id: str = Form(""),
    ask_questions: bool = Form(True),  # "Think while you wait" while the overview is written
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    level = _check_level(level)
    cancel_key = _upload_key(user, upload_id)
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
    _check_cancelled(cancel_key, user)

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

    # The same PDF uploaded again opens the paper already there: nothing is stored or
    # counted twice. Only the explanation level changes, when a different one was picked.
    _check_cancelled(cancel_key, user)
    same = _same_paper(db, user, size, page_count, extracted)
    if same:
        if same.level != level:
            _switch_level(db, same, level)
        log.info("upload matched existing paper=%s user=%s level=%s", same.id, user.id[:8], level)
        return {
            "id": same.id,
            "message": "You've already uploaded this paper, so it was opened instead.",
            "status": same.status,
            "page_count": same.page_count,
            "text_pages": text_pages,
            "needs_ocr": text_pages == 0,
            "duplicate": True,
        }

    # The original PDF goes to Supabase Storage BEFORE the paper is recorded, so a
    # failed upload never leaves a paper whose file is missing. Production never
    # falls back to the server's own disk, which is wiped on restart.
    paper_id = models.generate_uuid()
    storage_path = None
    if storage.is_configured():
        storage_path = storage.object_path(user.id, paper_id)
        try:
            storage.upload_pdf(storage_path, data)
        except storage.StorageError as exc:
            log.warning("file store failed user=%s bytes=%d error=%s", user.id[:8], size, exc)
            raise HTTPException(status_code=503, detail="The PDF couldn't be stored right now, so nothing was saved. Please try again.")
        if _is_cancelled(cancel_key):
            # Only the object this request just created (uploads never overwrite)
            try:
                storage.remove_object(storage_path)
            except storage.StorageError as cleanup:
                log.error("orphan file left paper=%s cleanup_error=%s", paper_id, cleanup)
            _check_cancelled(cancel_key, user)
    elif not storage.local_files_allowed():
        log.error("upload refused: file storage is not configured in production")
        raise HTTPException(status_code=503, detail="File storage isn't configured on the server, so uploads are paused.")

    # One short write: the paper, its pages and the pending explanations together
    paper = models.Paper(
        id=paper_id,
        user_id=user.id,
        title=name[:255],
        page_count=page_count,
        file_size=size,
        level=level,
        status="ready" if text_pages else "needs_ocr",
        storage_path=storage_path,
    )
    try:
        db.add(paper)
        db.flush()
        for number, text, st in extracted:
            db.add(models.PaperPage(paper_id=paper.id, page_number=number, text=text, status=st))
        # Saving and the cancel check happen together, so a cancel either keeps everything
        # out or arrives after the save and is told which paper was saved.
        with _upload_lock:
            cancelled = bool(cancel_key) and cancel_key in _cancelled
            if not cancelled:
                db.commit()
                if cancel_key:
                    _finished[cancel_key] = paper.id
        if cancelled:
            db.rollback()
            if storage_path:
                try:
                    storage.remove_object(storage_path)
                except storage.StorageError as cleanup:
                    log.error("orphan file left paper=%s cleanup_error=%s", paper_id, cleanup)
            raise HTTPException(status_code=409, detail=CANCELLED_MESSAGE)
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        if storage_path:
            # Only the object this request just created (uploads never overwrite)
            try:
                storage.remove_object(storage_path)
            except storage.StorageError as cleanup:
                log.error("orphan file left paper=%s cleanup_error=%s", paper_id, cleanup)
        log.error("upload not saved user=%s error=%s", user.id[:8], type(exc).__name__)
        raise HTTPException(status_code=500, detail="The paper couldn't be saved, so nothing was kept. Please try again.")

    if storage_path is None:  # development without Storage configured: the local folder, as before
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
        # Only the paper summary starts on its own. Page explanations, flashcards,
        # questions and insights are generated when the reader asks for them.
        study.ensure_kit(db, paper.id, study.AUTO_OUTPUTS)
        if ask_questions:
            _start_reflection(db, paper)
        # Page-wise explanations start straight away, at the chosen level (front and back matter skipped)
        queued = _queue_pages(db, paper, paper.level)
        db.commit()
        tasks.refresh_paper_status(db, paper)
        tasks.enqueue_study(paper.id)
        if queued:
            tasks.enqueue_paper(paper.id, paper.level)

    return {
        "id": paper.id,
        "message": "Text extracted; the summary is being written." if text_pages else "No selectable text found; OCR is required.",
        "status": paper.status,
        "page_count": page_count,
        "text_pages": text_pages,
        "needs_ocr": text_pages == 0,
    }


NOT_STORED = "The original PDF for this paper isn't stored anymore. Upload it again to see its pages; its text and study material are still here."


def _pdf_response(data: bytes, range_header: str | None) -> Response:
    """The PDF, whole or one requested byte range (HTTP Range, single range)."""
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "private, no-store"}
    total = len(data)
    if range_header and range_header.startswith("bytes=") and "," not in range_header:
        start_s, _, end_s = range_header[6:].strip().partition("-")
        try:
            if start_s:
                start = int(start_s)
                end = min(int(end_s), total - 1) if end_s else total - 1
            else:  # suffix range: the last N bytes
                start, end = max(total - int(end_s), 0), total - 1
        except ValueError:
            start, end = -1, -1
        if start < 0 or start > end or start >= total:
            return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{total}"})
        headers["Content-Range"] = f"bytes {start}-{end}/{total}"
        return Response(data[start:end + 1], status_code=206, media_type="application/pdf", headers=headers)
    return Response(data, media_type="application/pdf", headers=headers)


@router.get("/{paper_id}/file")
def get_paper_file(paper_id: str, request: Request, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    paper = _owned_paper(db, paper_id, user)  # ownership first: someone else's paper is "not found"
    if paper.storage_path:
        try:
            data = storage.download_pdf(paper.storage_path)
        except storage.StorageNotFound:
            log.warning("stored file missing paper=%s", paper.id)
            raise HTTPException(status_code=404, detail=NOT_STORED)
        except storage.StorageError as exc:
            log.warning("file load failed paper=%s error=%s", paper.id, exc)
            raise HTTPException(status_code=502, detail="The PDF couldn't be loaded from storage right now. Please try again.")
        return _pdf_response(data, request.headers.get("range"))

    # Papers from before Storage: the local file, if this server still has it
    file_path = os.path.join(UPLOAD_DIR, f"{paper.id}.pdf")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=NOT_STORED)
    return FileResponse(file_path, media_type="application/pdf")


@router.get("/{paper_id}")
def get_paper(paper_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return _owned_paper(db, paper_id, user)


@router.patch("/{paper_id}")
def update_paper(paper_id: str, level: str = Form(...), db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Switch the explanation level. Pages already explained at that level are kept;
    the rest are queued."""
    paper = _owned_paper(db, paper_id, user)
    status = _switch_level(db, paper, _check_level(level))
    return {"id": paper.id, "level": paper.level, "status": "processing" if status == "processing" else "ready"}


@router.post("/{paper_id}/stop")
def stop_explaining(paper_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Stop writing page notes. Notes already written are kept; the pages still waiting
    are taken off the queue, and the reader can continue later at any level."""
    paper = _owned_paper(db, paper_id, user)
    stopped = _drop_waiting(db, paper.id)
    db.commit()
    status = tasks.refresh_paper_status(db, paper)
    log.info("explanations stopped paper=%s pages=%d", paper.id, stopped)
    return {"paper_id": paper.id, "level": paper.level, "stopped": stopped, "status": status}


@router.get("/{paper_id}/pages")
def get_paper_pages(paper_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    paper = _owned_paper(db, paper_id, user)
    summaries = db.query(models.PageSummary).filter(
        models.PageSummary.paper_id == paper_id,
        models.PageSummary.level == paper.level
    ).order_by(models.PageSummary.page_number).all()
    return {"pages": [{"page_number": s.page_number, "status": s.status} for s in summaries]}


@router.get("/{paper_id}/outline")
def get_paper_outline(paper_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Every page of the PDF with whether it has text and its explanation state
    (at the paper's level). Read-only: never starts any processing."""
    paper = _owned_paper(db, paper_id, user)
    explained = {
        s.page_number: s.status
        for s in db.query(models.PageSummary).filter(
            models.PageSummary.paper_id == paper_id, models.PageSummary.level == paper.level
        )
    }
    pages = db.query(models.PaperPage).filter(models.PaperPage.paper_id == paper_id).order_by(models.PaperPage.page_number)
    return {
        "paper_id": paper.id,
        "level": paper.level,
        "pages": [
            {
                "page_number": p.page_number,
                "has_text": p.status == "ready",
                "explanation": explained.get(p.page_number) if p.status == "ready" else None,
            }
            for p in pages
        ],
    }


@router.get("/{paper_id}/pages/{page_number}/text")
def get_page_text(paper_id: str, page_number: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """The text extracted from one page (shown when the original PDF file isn't available)."""
    _owned_paper(db, paper_id, user)
    page = db.query(models.PaperPage).filter(
        models.PaperPage.paper_id == paper_id, models.PaperPage.page_number == page_number
    ).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    return {"page_number": page.page_number, "status": page.status, "text": page.text or ""}


@router.get("/{paper_id}/explanations")
def get_explanations(paper_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Every page's explanation at the paper's level, in page order: the content, or its state
    (pending, processing, failed, skipped with the reason). Read-only: never starts any processing."""
    paper = _owned_paper(db, paper_id, user)
    rows = {
        s.page_number: s
        for s in db.query(models.PageSummary).filter(models.PageSummary.paper_id == paper_id, models.PageSummary.level == paper.level)
    }
    pages = db.query(models.PaperPage).filter(models.PaperPage.paper_id == paper_id).order_by(models.PaperPage.page_number)
    out = []
    for p in pages:
        s = rows.get(p.page_number)
        status = s.status if s else ("no_text" if p.status != "ready" else None)
        out.append({
            "page_number": p.page_number,
            "status": status,
            "reason": s.summary if s and s.status == "skipped" else None,
            "summary": s.summary if s and s.status == "ready" else None,
            "key_points": (s.key_points or []) if s and s.status == "ready" else [],
            "terms": (s.terms or {}) if s and s.status == "ready" else {},
            "figures": (s.figures or {}) if s and s.status == "ready" else {},
            "error": s.error if s and s.status == "failed" else None,
        })
    return {"paper_id": paper.id, "level": paper.level, "pages": out}


@router.post("/{paper_id}/explain")
def explain_pages(paper_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Start page-by-page explanations at the paper's level, when the reader opens
    them. Idempotent: pages already queued, running or explained are untouched."""
    paper = _owned_paper(db, paper_id, user)
    if not db.query(models.PaperPage.id).filter(models.PaperPage.paper_id == paper_id, models.PaperPage.status == "ready").first():
        raise HTTPException(status_code=400, detail="This PDF has no selectable text, so there is nothing to explain.")
    added = _queue_pages(db, paper, paper.level)
    db.commit()
    status = tasks.refresh_paper_status(db, paper)
    if added:
        tasks.enqueue_paper(paper.id, paper.level)
        log.info("explanations requested paper=%s level=%s pages=%d", paper.id, paper.level, added)
    return {"paper_id": paper.id, "level": paper.level, "requested": added, "status": status}


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
