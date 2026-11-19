"""Follow-up chat for a saved research session (quick, detailed or full paper).

GET  /research/sessions/{session_id}/messages   one research run's chat messages (owner only)
GET  /research/threads/{thread_id}/messages     every chat message of a conversation (all its runs)
POST /research/sessions/{session_id}/chat       body {"message": "..."}; answers as Server-Sent Events

One conversation is one research thread: its research runs and their chat messages form a single
timeline. A message is attached to the run it was asked after (the latest finished one), and the
model sees the whole conversation (the last messages in full, earlier questions as topics), so
follow-ups and topic changes work across runs.

The answer is produced by app.session_chat (context, one rewrite + search decision call, web
search only if needed, streamed answer with citation checks). Events, in order:

    event: status   data: {"stage": "thinking" | "searching" | "writing", "label": "..."}
    event: sources  data: {"sources": [{n, title, url, excerpt, origin}], "used_web_search": bool}
    event: delta    data: {"text": "..."}                       (repeated, already citation-checked)
    event: done     data: {"user_message": {...}, "assistant_message": {...}}
    event: error    data: {"message": "...", "status": 429 | 503 | 500}

Both messages are saved only after the answer is complete, so a failed or abandoned answer
leaves nothing half-saved in the history. Another user's session is "not found".
"""
import datetime
import json
from types import SimpleNamespace
from typing import Iterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app import models, session_chat
from app.auth.deps import get_current_user
from app.database import SessionLocal, get_db
from app.log import get_logger

log = get_logger("chat_api")
router = APIRouter(prefix="/research", tags=["research chat"])

MAX_MESSAGE = session_chat.MESSAGE_MAX
FINISHED = ("ready", "review", "partial")


def _utc(value: datetime.datetime | None) -> str | None:
    return f"{value.isoformat()}Z" if value else None


def _message_dict(m: models.ChatMessage) -> dict:
    return {
        "id": m.id,
        "role": m.role,
        "content": m.content,
        "sources": m.sources or [],
        "used_web_search": bool(m.used_web_search),
        "created_at": _utc(m.created_at),
    }


def _thread_ids(db: Session, thread_id: str, user: models.User) -> list[str]:
    """The research runs of one conversation (thread), owned by this user."""
    rows = (db.query(models.ResearchSession.id)
            .filter(models.ResearchSession.user_id == user.id,
                    or_(models.ResearchSession.thread_id == thread_id, models.ResearchSession.id == thread_id))
            .all())
    return [r[0] for r in rows]


def _conversation(db: Session, s: models.ResearchSession, user: models.User) -> tuple[list[SimpleNamespace], list[str]]:
    """The whole conversation this session belongs to, as one timeline: each research run (its question
    and answer) and every chat message, in time order. Returns the last messages for the model (the
    most recent are what follow-ups refer to) and the questions asked before them (earlier topics)."""
    from app.research_paper import clean_user_markdown
    thread = s.thread_id or s.id
    runs = (db.query(models.ResearchSession)
            .filter(models.ResearchSession.user_id == user.id,
                    or_(models.ResearchSession.thread_id == thread, models.ResearchSession.id == thread))
            .all())
    items: list[tuple[datetime.datetime, int, SimpleNamespace]] = []
    for r in runs:
        if not _is_finished(r):
            continue
        when = r.created_at or datetime.datetime.min
        answer = clean_user_markdown(r.report or "", engine_text=not (r.progress or {}).get("answer_written"))
        items.append((when, 0, SimpleNamespace(role="user", content=r.question or "")))
        if answer:
            items.append((when, 1, SimpleNamespace(role="assistant", content=answer)))
    run_ids = [r.id for r in runs]
    messages = (db.query(models.ChatMessage)
                .filter(models.ChatMessage.user_id == user.id, models.ChatMessage.session_id.in_(run_ids))
                .all()) if run_ids else []
    for m in messages:
        items.append((m.created_at or datetime.datetime.min, 0 if m.role == "user" else 1,
                      SimpleNamespace(role=m.role, content=m.content)))
    items.sort(key=lambda x: (x[0], x[1]))
    timeline = [x[2] for x in items]
    recent = timeline[-session_chat.HISTORY_TURNS:]
    earlier = [m.content for m in timeline[:-session_chat.HISTORY_TURNS] if m.role == "user"]
    return recent, earlier


def _owned_session(db: Session, session_id: str, user: models.User) -> models.ResearchSession:
    s = db.query(models.ResearchSession).filter(
        models.ResearchSession.id == session_id, models.ResearchSession.user_id == user.id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Research session not found")
    return s


def _is_finished(s: models.ResearchSession) -> bool:
    """Finished as far as the reader is concerned (the run's own completion, as the research API reports it)."""
    from app.research_api import _status
    return _status(s) in FINISHED


@router.get("/sessions/{session_id}/messages")
def list_messages(session_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    s = _owned_session(db, session_id, user)
    rows = (db.query(models.ChatMessage)
            .filter(models.ChatMessage.session_id == s.id, models.ChatMessage.user_id == user.id)
            .order_by(models.ChatMessage.created_at.asc(), models.ChatMessage.role.desc())
            .all())
    return [_message_dict(m) for m in rows]


@router.get("/threads/{thread_id}/messages")
def list_thread_messages(thread_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Every chat message of a conversation (all its research runs), oldest first, each with its session_id."""
    ids = _thread_ids(db, thread_id, user)
    if not ids:
        raise HTTPException(status_code=404, detail="Research conversation not found")
    rows = (db.query(models.ChatMessage)
            .filter(models.ChatMessage.user_id == user.id, models.ChatMessage.session_id.in_(ids))
            .order_by(models.ChatMessage.created_at.asc(), models.ChatMessage.role.desc())
            .all())
    return [{**_message_dict(m), "session_id": m.session_id} for m in rows]


class ChatRequest(BaseModel):
    message: str


def _event(name: str, data: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/sessions/{session_id}/chat")
def chat(session_id: str, body: ChatRequest, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    message = (body.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Write a message first.")
    if len(message) > MAX_MESSAGE:
        raise HTTPException(status_code=400, detail=f"Messages can be at most {MAX_MESSAGE:,} characters.")
    s = _owned_session(db, session_id, user)
    if not _is_finished(s):
        raise HTTPException(status_code=409, detail="This research hasn't finished yet, so it can't be discussed.")

    # Everything the answer needs is read now: the request's database session is closed before the stream runs.
    paper_content = None
    doc = db.query(models.ResearchDocument).filter_by(session_id=s.id, user_id=user.id).first()
    if doc and doc.status == "ready" and doc.current_version:
        row = db.query(models.ResearchDocumentVersion).filter_by(document_id=doc.id, version=doc.current_version).first()
        paper_content = row.content if row else None
    # The whole conversation, not just this research run: follow-ups and topic changes span it
    history, earlier = _conversation(db, s, user)
    snapshot = SimpleNamespace(question=s.question, report=s.report, evidence_log=list(s.evidence_log or []),
                               progress=dict(s.progress or {}))
    user_id, sid = user.id, s.id

    def events() -> Iterator[str]:
        try:
            yield _event("status", {"stage": "thinking", "label": "Understanding your question"})
            ctx = session_chat.build_context(snapshot, paper_content, history, message, earlier_topics=earlier)
            plan = session_chat.plan_query(ctx)
            if plan.needs_web_search:
                yield _event("status", {"stage": "searching", "label": "Searching the web"})
            sources = session_chat.answer_sources(ctx, plan)
            used_web = any(src.origin == "web" for src in sources)
            yield _event("sources", {"sources": [src.to_dict() for src in sources], "used_web_search": used_web})
            yield _event("status", {"stage": "writing", "label": "Writing the answer"})

            parts: list[str] = []
            for text in session_chat.stream_answer(session_chat.build_answer_prompt(ctx, plan, sources),
                                                   {src.n for src in sources}):
                parts.append(text)
                yield _event("delta", {"text": text})
            answer, cited = session_chat.finalize_answer("".join(parts), sources)
            if not answer:
                raise session_chat.ChatError("The answer came back empty. Please ask again.", 503)

            saved = _save(sid, user_id, message, answer, cited, used_web)
            log.info("chat answered session=%s user=%s web=%s cited=%d", sid, user_id[:8], used_web, len(cited))
            yield _event("done", saved)
        except session_chat.ChatError as exc:
            yield _event("error", {"message": str(exc), "status": exc.status_code})
        except Exception as exc:  # never leak internals into the stream
            log.error("chat failed session=%s error=%s", sid, type(exc).__name__)
            yield _event("error", {"message": "Something went wrong while answering. Please try again.", "status": 500})

    # no-transform: proxies and dev servers must not compress or buffer the stream (the Next.js dev
    # proxy otherwise delivered every piece at the end); X-Accel-Buffering does the same for nginx.
    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-store, no-transform", "X-Accel-Buffering": "no"})


def _save(session_id: str, user_id: str, question: str, answer: str, sources: list[dict], used_web: bool) -> dict:
    """Both messages together, once the answer is complete (its own database session: the request's is closed)."""
    db = SessionLocal()
    try:
        now = datetime.datetime.utcnow()
        asked = models.ChatMessage(session_id=session_id, user_id=user_id, role="user", content=question,
                                   sources=[], used_web_search=False, created_at=now)
        answered = models.ChatMessage(session_id=session_id, user_id=user_id, role="assistant", content=answer,
                                      sources=sources, used_web_search=used_web,
                                      created_at=now + datetime.timedelta(microseconds=1))
        db.add_all([asked, answered])
        db.commit()
        return {"user_message": _message_dict(asked), "assistant_message": _message_dict(answered)}
    finally:
        db.close()
