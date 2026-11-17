"""Research runs, conversation threads and full research papers.

- POST /research/runs starts a run in the background and returns at once; the
  page polls GET /research/runs/{id} for the Working Flow (high-level stages
  only) and the result. The research itself is the existing engine
  (app.research.run_research), unchanged in what it does.
- Output modes change the work, not just the label:
    quick     1 search round, the engine's concise cited answer
    detailed  2 search rounds, an in-depth analysis audited by the engine's critique step
    full      3 search rounds, a concise summary in the chat plus a structured,
              editable research paper (research_documents)
- Threads: follow-up questions share a thread_id, so History can reopen the
  whole conversation. Old sessions without one are their own thread.
- Papers: every save adds a version (the generated original stays version 1).
  The PDF of a version is rendered on the server and kept in the private
  Supabase Storage bucket; it is only ever served to the owner.

What users never receive from these routes: hypotheses, search queries, the
engine's self-critique details, or any other internal reasoning.
"""
import datetime
import os
import re
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session, load_only

from app import models, research_paper, research_pdf, storage
from app.auth.deps import get_current_user
from app.database import SessionLocal, get_db
from app.log import get_logger

log = get_logger("research_api")
router = APIRouter(prefix="/research", tags=["research"])

MODES = ("quick", "detailed", "full")
ROUNDS = {"quick": 1, "detailed": 2, "full": 3}
STAGES = ("understanding", "discovering", "gathering", "evaluating", "comparing", "preparing")
STALE_AFTER = datetime.timedelta(minutes=30)  # a run with no progress for this long was interrupted (e.g. a restart)
DONE = ("ready", "review", "partial")

FRIENDLY_ERRORS = {
    400: None,  # the engine's own message (e.g. "Invalid research question: …") is shown as is
    429: "The AI service's daily limit has been reached. Please try again later.",
    503: "The AI service is unavailable right now. Please try again in a few minutes.",
}


def _now() -> datetime.datetime:
    return datetime.datetime.utcnow()


# ───────── background work ─────────

_executor = ThreadPoolExecutor(max_workers=int(os.getenv("RESEARCH_WORKERS", "2")), thread_name_prefix="research")


def _submit(fn, *args) -> None:
    if os.getenv("RESEARCH_WORKER") == "inline":  # tests: run synchronously
        fn(*args)
    else:
        _executor.submit(fn, *args)


def _initial_progress(mode: str) -> dict:
    return {"mode": mode, "stage": None, "stages": {s: "pending" for s in STAGES}, "detail": None,
            "started_at": _now().isoformat(), "updated_at": _now().isoformat(), "finished_at": None}


def _advance(progress: dict, stage: str | None, detail: str | None = None, finished: bool = False, failed: bool = False) -> dict:
    p = {**(progress or {}), "stages": dict((progress or {}).get("stages") or {s: "pending" for s in STAGES})}
    if stage in STAGES:
        reached = STAGES.index(stage)
        current = STAGES.index(p["stage"]) if p.get("stage") in STAGES else -1
        if reached >= current:  # stages only move forward
            for i, s in enumerate(STAGES):
                p["stages"][s] = "completed" if i < reached else ("in_progress" if i == reached else "pending")
            p["stage"] = stage
    if detail is not None or stage is not None:
        p["detail"] = detail
    if finished:
        p["stages"] = {s: "completed" for s in STAGES}
        p["finished_at"] = _now().isoformat()
        p["detail"] = None
    if failed:
        p["failed"] = True
        p["finished_at"] = _now().isoformat()
    p["updated_at"] = _now().isoformat()
    return p


def _set_progress(session_id: str, stage: str | None = None, detail: str | None = None) -> None:
    db = SessionLocal()
    try:
        s = db.get(models.ResearchSession, session_id)
        if s:
            s.progress = _advance(s.progress, stage, detail)
            db.commit()
    finally:
        db.close()


def _error_text(exc: Exception) -> str:
    status = getattr(exc, "status_code", None)
    if status in FRIENDLY_ERRORS:
        return FRIENDLY_ERRORS[status] or str(getattr(exc, "detail", "") or "The research couldn't be completed.")[:300]
    return "The research couldn't be completed. Please try again."


def _engine_question(db: Session, s: models.ResearchSession) -> str:
    """A follow-up is researched in the context of the thread's first question."""
    if not s.thread_id or s.thread_id == s.id:
        return s.question
    root = db.get(models.ResearchSession, s.thread_id)
    if not root or root.user_id != s.user_id:
        return s.question
    return f"{s.question} (follow-up to the research question: \"{root.question}\")"


def run_job(session_id: str) -> None:
    """The whole run for one question, in a background thread."""
    from app.research import run_research  # the existing engine
    from app.llm import critique_report  # the engine's own audit, reused for the Detailed Analysis

    db = SessionLocal()
    try:
        s = db.get(models.ResearchSession, session_id)
        if not s:
            return
        user_id, question, mode = s.user_id, s.question, s.output_format
        engine_question = _engine_question(db, s)
        user = db.get(models.User, user_id)
        author = (user.name or "").strip() if user else ""
        db.close()

        result = run_research(
            question=engine_question,
            output_format="quick",  # the concise, audited answer; longer outputs are written below
            session_id=session_id,
            user_id=user_id,
            on_stage=lambda stage: _set_progress(session_id, stage),
            max_rounds=ROUNDS[mode],
        )

        db = SessionLocal()
        s = db.get(models.ResearchSession, session_id)
        # Keep what the user asked and chose (the engine stores its own wording and format)
        s.question, s.title, s.output_format = question, question, mode
        s.hypotheses, s.evidence_log = result.get("hypotheses") or [], result.get("evidence_log") or []
        s.critique, s.stats = result.get("critique") or {}, result.get("stats") or {}
        s.status = result.get("status") or "ready"
        s.report = research_paper.strip_internal_labels(result.get("report") or "")
        progress = _advance(s.progress, "preparing", "writing" if mode != "quick" else None)
        s.progress = progress
        db.commit()

        if mode == "detailed":
            try:
                analysis = research_paper.write_detailed_analysis(question, result)
                audited, critique = critique_report(engine_question, result.get("hypotheses") or [],
                                                    result.get("evidence_log") or [], analysis)
                s.report = research_paper.strip_internal_labels(audited)
                s.critique = critique
                s.progress = {**s.progress, "summary": result.get("report")}
                if critique.get("needs_review"):
                    s.status = "review"
            except Exception as exc:
                log.warning("detailed analysis failed session=%s error=%s", session_id, type(exc).__name__)
                s.status = "partial"
                s.progress = {**s.progress, "note": "The detailed analysis couldn't be written, so the concise answer is shown."}
        elif mode == "full":
            s.progress = {**s.progress, "summary": s.report}
            db.commit()
            _write_paper(db, s, question, result, author)
        s.progress = _advance(s.progress, None, finished=True)
        db.commit()
    except Exception as exc:
        log.warning("research run failed session=%s error=%s", session_id, type(exc).__name__)
        try:
            db.rollback()
        except Exception:
            pass
        try:
            db.close()
        except Exception:
            pass
        db = SessionLocal()
        s = db.get(models.ResearchSession, session_id)
        if s:
            s.status = "failed"
            s.error = _error_text(exc)
            s.progress = _advance(s.progress, None, failed=True)
            db.commit()
    finally:
        db.close()


def _write_paper(db: Session, s: models.ResearchSession, question: str, result: dict, author: str) -> models.ResearchDocument:
    doc = db.query(models.ResearchDocument).filter_by(session_id=s.id).first()
    if not doc:
        doc = models.ResearchDocument(session_id=s.id, user_id=s.user_id, status="generating", current_version=0, edited=False)
        db.add(doc)
    doc.status, doc.error = "generating", None
    db.commit()
    parts = {"outline": "outline", "front": "introduction", "analysis": "analysis", "closing": "conclusions", "audit": "checking"}
    try:
        content = research_paper.write_paper(
            question, result, author,
            on_part=lambda p: _set_progress(s.id, "preparing", f"paper:{parts.get(p, p)}"),
        )
        db.refresh(s)
        version = (doc.current_version or 0) + 1
        db.add(models.ResearchDocumentVersion(document_id=doc.id, version=version, source="generated", content=content))
        doc.current_version, doc.title, doc.status = version, content["title"], "ready"
        db.commit()
    except Exception as exc:
        db.rollback()
        log.warning("paper failed session=%s error=%s", s.id, type(exc).__name__)
        doc = db.query(models.ResearchDocument).filter_by(session_id=s.id).first()
        doc.status, doc.error = "failed", _error_text(exc) if getattr(exc, "status_code", None) else \
            "The research paper couldn't be written. You can try again from the conversation."
        db.commit()
    return doc


def paper_job(session_id: str) -> None:
    """Write (or retry) the paper for a finished session."""
    db = SessionLocal()
    try:
        s = db.get(models.ResearchSession, session_id)
        if not s:
            return
        user = db.get(models.User, s.user_id)
        result = {"hypotheses": s.hypotheses or [], "evidence_log": s.evidence_log or [], "stats": s.stats or {},
                  "rounds_used": max([e.get("round", 1) for e in (s.evidence_log or [])] or [1])}
        _write_paper(db, s, s.question, result, (user.name or "").strip() if user else "")
    except Exception as exc:
        log.warning("paper job failed session=%s error=%s", session_id, type(exc).__name__)
    finally:
        db.close()


# ───────── what the user sees ─────────

PUBLIC_EVIDENCE_FIELDS = ("id", "source_url", "source_title", "snippet", "quote", "stance", "confidence",
                          "verification_status", "source_type", "retrieved_at")


def _status(s: models.ResearchSession, db: Session | None = None) -> str:
    if s.status == "in_progress":
        updated = (s.progress or {}).get("updated_at")
        try:
            stale = updated and _now() - datetime.datetime.fromisoformat(updated) > STALE_AFTER
        except ValueError:
            stale = False
        if stale or (not updated and s.updated_at and _now() - s.updated_at > STALE_AFTER):
            if db is not None:  # record it, so the thread shows a clear failure from now on
                s.status, s.error = "failed", "This research was interrupted (the server restarted). Please ask again."
                s.progress = _advance(s.progress, None, failed=True)
                db.commit()
            return "failed"
    return s.status or "ready"


def _doc_summary(doc: models.ResearchDocument | None) -> dict | None:
    if not doc:
        return None
    return {
        "id": doc.id,
        "title": doc.title,
        "status": doc.status,
        "error": doc.error,
        "current_version": doc.current_version,
        "edited": bool(doc.edited),
        "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
    }


def public_session(s: models.ResearchSession, doc: models.ResearchDocument | None, db: Session | None = None) -> dict:
    status = _status(s, db)
    progress = s.progress or {}
    done = status in DONE
    return {
        "session_id": s.id,
        "thread_id": s.thread_id or s.id,
        "research_question": s.question,
        "output_format": s.output_format,
        "status": status,
        "progress": {
            "stage": progress.get("stage"),
            "stages": progress.get("stages") or ({x: "completed" for x in STAGES} if done else {}),
            "detail": progress.get("detail"),
            "started_at": progress.get("started_at"),
            "finished_at": progress.get("finished_at"),
        },
        "report": research_paper.strip_internal_labels(s.report) if done and s.report else None,
        "summary": progress.get("summary") if s.output_format == "full" else None,
        "note": progress.get("note"),
        "error": s.error if status == "failed" else None,
        "needs_review": bool((s.critique or {}).get("needs_review")) if done else False,
        "evidence_log": [{k: e.get(k) for k in PUBLIC_EVIDENCE_FIELDS} for e in (s.evidence_log or [])] if done else [],
        "stats": {"duration_seconds": (s.stats or {}).get("duration_seconds")} if done else {},
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        "document": _doc_summary(doc),
    }


def _owned_session(db: Session, session_id: str, user: models.User) -> models.ResearchSession:
    s = db.query(models.ResearchSession).filter(
        models.ResearchSession.id == session_id, models.ResearchSession.user_id == user.id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Research session not found")
    return s


def _owned_document(db: Session, document_id: str, user: models.User) -> models.ResearchDocument:
    doc = db.query(models.ResearchDocument).filter(
        models.ResearchDocument.id == document_id, models.ResearchDocument.user_id == user.id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Research paper not found")
    return doc


def _thread_sessions(db: Session, thread_id: str, user: models.User) -> list[models.ResearchSession]:
    return (db.query(models.ResearchSession)
            .filter(models.ResearchSession.user_id == user.id,
                    or_(models.ResearchSession.thread_id == thread_id, models.ResearchSession.id == thread_id))
            .order_by(models.ResearchSession.created_at.asc())
            .all())


def _docs_for(db: Session, session_ids: list[str], user: models.User) -> dict[str, models.ResearchDocument]:
    if not session_ids:
        return {}
    docs = db.query(models.ResearchDocument).filter(
        models.ResearchDocument.user_id == user.id, models.ResearchDocument.session_id.in_(session_ids)).all()
    return {d.session_id: d for d in docs}


# ───────── routes: runs and threads ─────────

class RunRequest(BaseModel):
    question: str
    output_format: str = "quick"
    thread_id: str | None = None


@router.post("/runs", status_code=202)
def start_run(body: RunRequest, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    question = (body.question or "").strip()
    if len(question) < 10:
        raise HTTPException(status_code=400, detail="Question must be at least 10 characters long.")
    if len(question) > 2000:
        raise HTTPException(status_code=400, detail="Question must be at most 2,000 characters long.")
    mode = (body.output_format or "").strip().lower()
    if mode not in MODES:
        raise HTTPException(status_code=400, detail="Choose Quick Answer, Detailed Analysis or Full Research Paper.")
    thread_id = None
    if body.thread_id:
        if not _thread_sessions(db, body.thread_id, user):
            raise HTTPException(status_code=404, detail="Research conversation not found")
        thread_id = body.thread_id

    s = models.ResearchSession(
        user_id=user.id, question=question, title=question, output_format=mode, status="in_progress",
        hypotheses=[], evidence_log=[], critique={}, stats={}, progress=_initial_progress(mode),
    )
    db.add(s)
    db.flush()
    s.thread_id = thread_id or s.id
    db.commit()
    db.refresh(s)
    log.info("research run queued session=%s user=%s mode=%s follow_up=%s", s.id, user.id[:8], mode, bool(thread_id))
    _submit(run_job, s.id)
    db.refresh(s)
    return public_session(s, None, db)


@router.get("/runs/{session_id}")
def get_run(session_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    s = _owned_session(db, session_id, user)
    return public_session(s, _docs_for(db, [s.id], user).get(s.id), db)


@router.get("/threads")
def list_threads(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    rows = (db.query(models.ResearchSession)
            .options(load_only(models.ResearchSession.id, models.ResearchSession.thread_id, models.ResearchSession.question,
                               models.ResearchSession.output_format, models.ResearchSession.status,
                               models.ResearchSession.progress, models.ResearchSession.created_at,
                               models.ResearchSession.updated_at, models.ResearchSession.user_id))
            .filter(models.ResearchSession.user_id == user.id)
            .order_by(models.ResearchSession.created_at.asc())
            .all())
    docs = _docs_for(db, [r.id for r in rows], user)
    threads: dict[str, dict] = {}
    for r in rows:
        key = r.thread_id or r.id
        t = threads.get(key)
        updated = r.updated_at or r.created_at
        doc = docs.get(r.id)
        if not t:
            t = threads[key] = {
                "thread_id": key, "title": r.question, "output_format": r.output_format,
                "created_at": r.created_at, "updated_at": updated, "turns": 0, "status": None,
                "modes": [], "has_paper": False, "paper_status": None, "paper_edited": False,
                "paper_saved_at": None, "document_id": None,
            }
        t["turns"] += 1
        t["status"] = _status(r)
        if r.output_format not in t["modes"]:
            t["modes"].append(r.output_format)
        if updated and (not t["updated_at"] or updated > t["updated_at"]):
            t["updated_at"] = updated
        if doc:
            t["has_paper"] = t["has_paper"] or doc.status == "ready"
            t["paper_status"], t["document_id"] = doc.status, doc.id
            t["paper_edited"] = t["paper_edited"] or bool(doc.edited)
            if doc.updated_at and (not t["paper_saved_at"] or doc.updated_at > t["paper_saved_at"]):
                t["paper_saved_at"] = doc.updated_at
            if doc.updated_at and doc.updated_at > t["updated_at"]:
                t["updated_at"] = doc.updated_at
    out = sorted(threads.values(), key=lambda t: t["updated_at"] or datetime.datetime.min, reverse=True)
    for t in out:
        for k in ("created_at", "updated_at", "paper_saved_at"):
            t[k] = t[k].isoformat() if t[k] else None
    return out


@router.get("/threads/{thread_id}")
def get_thread(thread_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    sessions = _thread_sessions(db, thread_id, user)
    if not sessions:
        raise HTTPException(status_code=404, detail="Research conversation not found")
    docs = _docs_for(db, [s.id for s in sessions], user)
    return {
        "thread_id": thread_id,
        "title": sessions[0].question,
        "turns": [public_session(s, docs.get(s.id), db) for s in sessions],
    }


@router.post("/sessions/{session_id}/paper", status_code=202)
def create_paper(session_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Write the full paper for a finished Detailed or Full session (or retry a failed one)."""
    s = _owned_session(db, session_id, user)
    if _status(s, db) not in DONE:
        raise HTTPException(status_code=409, detail="The research hasn't finished yet.")
    if s.output_format not in ("detailed", "full"):
        raise HTTPException(status_code=400, detail="Full papers are written from Detailed or Full research.")
    if not any(e.get("stance") in ("supports", "refutes") for e in (s.evidence_log or [])):
        raise HTTPException(status_code=409, detail="This research found too little evidence for a full paper.")
    doc = _docs_for(db, [s.id], user).get(s.id)
    if doc and doc.status in ("ready", "generating"):
        return _doc_summary(doc)  # never overwrite an existing paper
    if not doc:
        doc = models.ResearchDocument(session_id=s.id, user_id=user.id, status="generating", current_version=0, edited=False)
        db.add(doc)
    doc.status, doc.error = "generating", None
    db.commit()
    _submit(paper_job, s.id)
    db.refresh(doc)
    return _doc_summary(doc)


# ───────── routes: papers ─────────

def _document_payload(db: Session, doc: models.ResearchDocument, version: int | None = None) -> dict:
    versions = (db.query(models.ResearchDocumentVersion)
                .options(load_only(models.ResearchDocumentVersion.version, models.ResearchDocumentVersion.source,
                                   models.ResearchDocumentVersion.created_at))
                .filter_by(document_id=doc.id).order_by(models.ResearchDocumentVersion.version.asc()).all())
    wanted = version or doc.current_version
    row = (db.query(models.ResearchDocumentVersion).filter_by(document_id=doc.id, version=wanted).first()
           if wanted else None)
    if version and not row:
        raise HTTPException(status_code=404, detail="That version of the paper doesn't exist.")
    session = db.get(models.ResearchSession, doc.session_id)
    return {
        **_doc_summary(doc),
        "session_id": doc.session_id,
        "thread_id": (session.thread_id or session.id) if session else None,
        "version": row.version if row else None,
        "content": row.content if row else None,
        "pdf": {"version": doc.pdf_version, "stored": bool(doc.pdf_path)},
        "versions": [{"version": v.version, "source": v.source,
                      "created_at": v.created_at.isoformat() if v.created_at else None} for v in versions],
    }


@router.get("/documents/{document_id}")
def get_document(document_id: str, version: int | None = None, db: Session = Depends(get_db),
                 user: models.User = Depends(get_current_user)):
    return _document_payload(db, _owned_document(db, document_id, user), version)


class SaveRequest(BaseModel):
    content: dict
    base_version: int


@router.put("/documents/{document_id}")
def save_document(document_id: str, body: SaveRequest, db: Session = Depends(get_db),
                  user: models.User = Depends(get_current_user)):
    doc = _owned_document(db, document_id, user)
    if doc.status != "ready" or not doc.current_version:
        raise HTTPException(status_code=409, detail="This paper isn't ready to edit yet.")
    if body.base_version != doc.current_version:
        raise HTTPException(status_code=409, detail="This paper was saved somewhere else since you opened it. Reload to see the latest version.")
    current = db.query(models.ResearchDocumentVersion).filter_by(document_id=doc.id, version=doc.current_version).first()
    try:
        content = research_paper.clean_content(body.content, current.content if current else {})
    except research_paper.ContentError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if current and content == current.content:
        return _document_payload(db, doc)  # nothing changed: no new version
    version = doc.current_version + 1
    db.add(models.ResearchDocumentVersion(document_id=doc.id, version=version, source="edit", content=content))
    doc.current_version, doc.edited, doc.title = version, True, content["title"]
    db.commit()
    log.info("paper saved doc=%s version=%d", doc.id, version)
    return _document_payload(db, doc)


def _pdf_object_path(doc: models.ResearchDocument, version: int) -> str:
    """Built on the server from ids the database owns; never from request input."""
    return f"{doc.user_id}/research-papers/{doc.id}/v{version}.pdf"


@router.get("/documents/{document_id}/pdf")
def download_pdf(document_id: str, version: int | None = None, db: Session = Depends(get_db),
                 user: models.User = Depends(get_current_user)):
    """The PDF of the latest saved version (or a given one), from private storage; rendered and stored on first request."""
    doc = _owned_document(db, document_id, user)
    wanted = version or doc.current_version
    row = db.query(models.ResearchDocumentVersion).filter_by(document_id=doc.id, version=wanted).first() if wanted else None
    if not row:
        raise HTTPException(status_code=404, detail="This paper has no saved content yet.")
    headers = {"Content-Disposition": f'attachment; filename="{research_pdf.filename_for(row.content)}"',
               "Cache-Control": "private, no-store"}
    path = _pdf_object_path(doc, wanted)

    if storage.is_configured():
        try:
            data = storage.download_pdf(path)
            return Response(data, media_type="application/pdf", headers=headers)
        except storage.StorageNotFound:
            pass
        except storage.StorageError as exc:
            log.warning("paper pdf load failed doc=%s error=%s", doc.id, exc)

    data = research_pdf.render_pdf(row.content)
    if storage.is_configured():
        try:
            storage.upload_pdf(path, data)
        except storage.StorageError as exc:
            if "409" not in str(exc) and "Duplicate" not in str(exc):  # already stored by an earlier request: fine
                log.warning("paper pdf store failed doc=%s error=%s", doc.id, exc)
                return Response(data, media_type="application/pdf", headers=headers)
        if wanted == doc.current_version:
            doc.pdf_path, doc.pdf_version = path, wanted
            db.commit()
    return Response(data, media_type="application/pdf", headers=headers)
