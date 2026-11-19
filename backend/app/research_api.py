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
from sqlalchemy.exc import IntegrityError
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
    """What the research engine investigates. A question asked later in a conversation ("give me a
    practical example", "what about its applications?") is first rewritten as a standalone question
    from the conversation, with the chat's planner; if that isn't possible, it is researched in the
    context of the conversation's first question, as before."""
    if not s.thread_id or s.thread_id == s.id:
        return s.question
    root = db.get(models.ResearchSession, s.thread_id)
    if not root or root.user_id != s.user_id or root.question.strip() == s.question.strip():
        return s.question
    fallback = f"{s.question} (follow-up to the research question: \"{root.question}\")"
    try:
        from app import session_chat
        from app.chat_api import _conversation
        user = db.get(models.User, s.user_id)
        history, earlier = _conversation(db, s, user)
        if not history:
            return fallback
        background = root if root.report else s
        ctx = session_chat.build_context(background, None, history, s.question, earlier_topics=earlier)
        plan = session_chat.plan_query(ctx)
        standalone = (plan.standalone_query or "").strip()
        if plan.new_topic or (standalone and standalone.lower() != s.question.strip().lower()):
            return standalone
    except Exception as exc:  # the research still runs, with the older wording
        log.warning("follow-up rewrite skipped session=%s error=%s", s.id, type(exc).__name__)
    return fallback


def _audited(write, question: str, engine_question: str, result: dict) -> tuple[str, dict]:
    """A user-facing answer, checked by the engine's own audit (citations, grounding, counter-evidence)."""
    from app.llm import critique_report
    text = write(question, result)
    audited, critique = critique_report(engine_question, result.get("hypotheses") or [], result.get("evidence_log") or [], text)
    return research_paper.clean_user_markdown(audited), critique


def run_job(session_id: str) -> None:
    """The whole run for one question, in a background thread. The session reads as in progress
    until every part (research, writing, and for a paper its document and PDF) is finished."""
    from app.research import run_research  # the existing engine

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
        # Keep what the user asked and chose (the engine stores its own wording, format and status)
        final_status = result.get("status") or "ready"
        s.question, s.title, s.output_format, s.status = question, question, mode, "in_progress"
        s.hypotheses, s.evidence_log = result.get("hypotheses") or [], result.get("evidence_log") or []
        s.critique, s.stats = result.get("critique") or {}, result.get("stats") or {}
        s.report = result.get("report") or ""  # the engine's own answer, kept for older views; replaced below
        s.progress = _advance(s.progress, "preparing", "writing")
        db.commit()

        if mode in ("quick", "detailed"):
            writer = research_paper.write_quick_answer if mode == "quick" else research_paper.write_detailed_analysis
            try:
                s.report, critique = _audited(writer, question, engine_question, result)
                s.progress = {**s.progress, "answer_written": True}
                s.critique = critique
                if critique.get("needs_review"):
                    final_status = "review"
            except Exception as exc:
                log.warning("%s answer failed session=%s error=%s", mode, session_id, type(exc).__name__)
                final_status = "partial"
                s.progress = {**s.progress, "note": (
                    "The detailed analysis couldn't be written, so a short answer is shown." if mode == "detailed"
                    else "The answer was written in a simpler form.")}
        else:
            db.commit()
            _write_paper(db, s, question, result, author)
            db.refresh(s)
        s.status = final_status
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
    parts = {"outline": "outline", "front": "introduction", "background": "background", "analysis": "analysis",
             "findings": "findings", "closing": "conclusions", "audit": "checking"}
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
        _set_progress(s.id, "preparing", "paper:pdf")
        _store_pdf(db, doc, version, content)  # the PDF of the generated original, kept in private storage
    except Exception as exc:
        db.rollback()
        log.warning("paper failed session=%s error=%s", s.id, type(exc).__name__)
        doc = db.query(models.ResearchDocument).filter_by(session_id=s.id).first()
        doc.status, doc.error = "failed", _error_text(exc) if getattr(exc, "status_code", None) else \
            "The research paper couldn't be written. You can try again from the conversation."
        db.commit()
    return doc


def _store_pdf(db: Session, doc: models.ResearchDocument, version: int, content: dict) -> bytes | None:
    """Render one version's PDF and keep it in the private bucket. Returns the bytes, or None if rendering failed.
    A storage failure is logged, not fatal: the paper's content is safe in PostgreSQL and the PDF can be made again."""
    try:
        data = research_pdf.render_pdf(content)
    except Exception as exc:
        log.warning("paper pdf render failed doc=%s error=%s", doc.id, type(exc).__name__)
        return None
    if storage.is_configured():
        path = _pdf_object_path(doc, version)
        try:
            storage.upload_pdf(path, data)
        except storage.StorageError as exc:
            if "409" not in str(exc) and "Duplicate" not in str(exc):  # already stored by an earlier request: fine
                log.warning("paper pdf store failed doc=%s error=%s", doc.id, exc)
                return data
        if version == doc.current_version:
            doc.pdf_path, doc.pdf_version = path, version
            db.commit()
    return data


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


def _utc(value) -> str | None:
    """Timestamps go out as UTC with an explicit zone. The database stores naive UTC, which a browser
    would otherwise read as local time (in India that shifted every run by 5 h 30 min)."""
    if not value:
        return None
    if isinstance(value, datetime.datetime):
        value = value.isoformat()
    value = str(value)
    return value if value.endswith("Z") or re.search(r"[+-]\d\d:\d\d$", value) else f"{value}Z"


def _mode(s: models.ResearchSession) -> str:
    """The mode the user chose for this run (recorded when it started; the engine stores its own format)."""
    chosen = (s.progress or {}).get("mode")
    return chosen if chosen in MODES else (s.output_format if s.output_format in MODES else "full")


def _status(s: models.ResearchSession, db: Session | None = None) -> str:
    progress = s.progress or {}
    # A run with a working flow is finished only when the whole job says so: the engine saves its own
    # status before the answer for this mode (analysis, paper, PDF) has been written.
    running = s.status == "in_progress" or (
        bool(progress.get("started_at")) and not progress.get("finished_at") and s.status != "failed")
    if running:
        updated = progress.get("updated_at")
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
        return "in_progress"
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
        "pdf_stored": _pdf_is_current(doc),
        "updated_at": _utc(doc.updated_at),
    }


def _pdf_is_current(doc: models.ResearchDocument) -> bool:
    """A stored PDF counts only if it is of the latest version (each version has its own file)."""
    return bool(doc.pdf_path) and doc.pdf_version == doc.current_version


def _run_seconds(progress: dict) -> float | None:
    """Wall-clock time of the whole run, from its own start and finish (not the conversation's dates)."""
    try:
        start = datetime.datetime.fromisoformat(str(progress["started_at"]).removesuffix("Z"))
        end = datetime.datetime.fromisoformat(str(progress["finished_at"]).removesuffix("Z"))
    except (KeyError, TypeError, ValueError):
        return None
    seconds = (end - start).total_seconds()
    return round(seconds, 1) if 0 <= seconds < 6 * 3600 else None


def public_session(s: models.ResearchSession, doc: models.ResearchDocument | None, db: Session | None = None) -> dict:
    status = _status(s, db)
    progress = s.progress or {}
    done = status in DONE
    mode = _mode(s)
    paper_turn = mode == "full" and doc is not None
    return {
        "session_id": s.id,
        "thread_id": s.thread_id or s.id,
        "research_question": s.question,
        "output_format": mode,
        "based_on": progress.get("based_on"),
        "status": status,
        "progress": {
            "stage": progress.get("stage"),
            "stages": progress.get("stages") or ({x: "completed" for x in STAGES} if done else {}),
            "detail": progress.get("detail"),
            "started_at": _utc(progress.get("started_at")),
            "finished_at": _utc(progress.get("finished_at")) if status != "in_progress" else None,
        },
        # A paper turn's result is the document itself, so no short answer is put in front of it
        "report": research_paper.clean_user_markdown(s.report, engine_text=not progress.get("answer_written"))
        if done and s.report and not paper_turn else None,
        "note": progress.get("note"),
        "error": s.error if status == "failed" else None,
        "needs_review": bool((s.critique or {}).get("needs_review")) if done else False,
        "evidence_log": [{k: e.get(k) for k in PUBLIC_EVIDENCE_FIELDS} for e in (s.evidence_log or [])] if done else [],
        "stats": {"duration_seconds": _run_seconds(progress) if progress.get("started_at")
                  else (s.stats or {}).get("duration_seconds")} if done else {},
        "created_at": _utc(s.created_at),
        "updated_at": _utc(s.updated_at),
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
    question: str = ""
    output_format: str = "quick"
    thread_id: str | None = None
    # Re-run an earlier question of the conversation in another mode ("Detailed analysis", "Research paper"):
    # the question is taken from that session on the server, never from a typed instruction.
    based_on: str | None = None


@router.post("/runs", status_code=202)
def start_run(body: RunRequest, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    mode = (body.output_format or "").strip().lower()
    if mode not in MODES:
        raise HTTPException(status_code=400, detail="Choose Quick Answer, Detailed Analysis or Full Research Paper.")
    based_on = None
    if body.based_on:
        based_on = _owned_session(db, body.based_on, user)
        question = based_on.question.strip()
        thread_id = based_on.thread_id or based_on.id
    else:
        question = (body.question or "").strip()
        thread_id = None
        if body.thread_id:
            if not _thread_sessions(db, body.thread_id, user):
                raise HTTPException(status_code=404, detail="Research conversation not found")
            thread_id = body.thread_id
    if len(question) < 10:
        raise HTTPException(status_code=400, detail="Question must be at least 10 characters long.")
    if len(question) > 2000:
        raise HTTPException(status_code=400, detail="Question must be at most 2,000 characters long.")

    progress = _initial_progress(mode)
    if based_on is not None:
        progress["based_on"] = based_on.id
    s = models.ResearchSession(
        user_id=user.id, question=question, title=question, output_format=mode, status="in_progress",
        hypotheses=[], evidence_log=[], critique={}, stats={}, progress=progress,
    )
    db.add(s)
    db.flush()
    s.thread_id = thread_id or s.id
    db.commit()
    db.refresh(s)
    log.info("research run queued session=%s user=%s mode=%s follow_up=%s based_on=%s",
             s.id, user.id[:8], mode, bool(thread_id), bool(based_on))
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
        mode = _mode(r)
        if not t:
            t = threads[key] = {
                "thread_id": key, "title": r.question, "output_format": mode,
                "created_at": r.created_at, "updated_at": updated, "turns": 0, "status": None,
                "modes": [], "latest_mode": mode, "has_paper": False, "paper_status": None, "paper_edited": False,
                "paper_saved_at": None, "document_id": None,
            }
        t["turns"] += 1
        t["status"] = _status(r)
        t["latest_mode"] = mode
        if mode not in t["modes"]:
            t["modes"].append(mode)
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
            t[k] = _utc(t[k])
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
    """Retry the paper of a finished Full Research Paper run whose writing failed. (A paper from a Quick or
    Detailed answer is a new, complete investigation: POST /research/runs with based_on and output_format=full.)"""
    s = _owned_session(db, session_id, user)
    if _status(s, db) not in DONE:
        raise HTTPException(status_code=409, detail="The research hasn't finished yet.")
    if _mode(s) != "full":
        raise HTTPException(status_code=400, detail="Choose Research paper to run a full investigation for this question.")
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
        "pdf": {"version": doc.pdf_version, "stored": _pdf_is_current(doc)},
        "versions": [{"version": v.version, "source": v.source,
                      "created_at": _utc(v.created_at)} for v in versions],
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


class AppendChatRequest(BaseModel):
    message_id: str  # the assistant answer to add; its question and sources are read from the database
    base_version: int


@router.post("/documents/{document_id}/append-chat")
def append_chat(document_id: str, body: AppendChatRequest, db: Session = Depends(get_db),
                user: models.User = Depends(get_current_user)):
    """Add a chat answer (and the question it answers) to the paper as a new last section, as a new version.

    Everything comes from the database: the answer must be this user's, from this paper's research
    session, and directly answer the question before it. Adding the same answer again returns the
    paper unchanged (already_added), so a retried request never appends twice.
    """
    doc = _owned_document(db, document_id, user)
    session = db.get(models.ResearchSession, doc.session_id)
    if not session or session.user_id != user.id:
        raise HTTPException(status_code=404, detail="Research paper not found")
    if doc.status != "ready" or not doc.current_version:
        raise HTTPException(status_code=409, detail="This paper isn't ready yet.")

    answer = db.query(models.ChatMessage).filter(
        models.ChatMessage.id == body.message_id, models.ChatMessage.user_id == user.id,
        models.ChatMessage.session_id == session.id, models.ChatMessage.role == "assistant").first()
    if not answer:
        raise HTTPException(status_code=404, detail="That answer isn't part of this paper's conversation.")
    previous = (db.query(models.ChatMessage)
                .filter(models.ChatMessage.session_id == session.id, models.ChatMessage.user_id == user.id,
                        models.ChatMessage.created_at < answer.created_at)
                .order_by(models.ChatMessage.created_at.desc())
                .first())
    if not previous or previous.role != "user":
        raise HTTPException(status_code=409, detail="This answer has no matching question, so it can't be added.")

    current = db.query(models.ResearchDocumentVersion).filter_by(document_id=doc.id, version=doc.current_version).first()
    content = current.content if current else {}
    if answer.id in (content.get("chat_appends") or []):
        return {**_document_payload(db, doc), "already_added": True}  # a retry after success: nothing appended twice
    if body.base_version != doc.current_version:
        raise HTTPException(status_code=409, detail="This paper was changed since you opened it. Reload it, then add the answer again.")

    new_content, change = research_paper.append_chat_section(
        content, previous.content, answer.content, answer.sources or [],
        answered_at=answer.created_at.isoformat() if answer.created_at else "", message_id=answer.id,
        evidence=session.evidence_log or [])
    version = doc.current_version + 1
    db.add(models.ResearchDocumentVersion(document_id=doc.id, version=version, source="chat", content=new_content))
    doc.current_version, doc.edited = version, True  # the latest version has no PDF yet: made on the next download
    try:
        db.commit()
    except IntegrityError:  # another request created this version at the same moment
        db.rollback()
        raise HTTPException(status_code=409, detail="This paper was changed at the same time. Reload it, then try again.")
    log.info("chat answer added to paper doc=%s version=%d refs_added=%d", doc.id, version, len(change["references_added"]))
    return {**_document_payload(db, doc), "already_added": False, "appended": change}


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

    data = _store_pdf(db, doc, wanted, row.content)  # first request for this version (e.g. after an edit)
    if data is None:
        raise HTTPException(status_code=500, detail="The PDF couldn't be made. Please try again.")
    return Response(data, media_type="application/pdf", headers=headers)
