"""Think while you wait: the reflection routes, for a research run and for a Paper Study paper.

    GET  /research/sessions/{id}/reflection            and  /papers/{id}/reflection
    PUT  .../reflection/answers      {question_id, answer | skipped}
    POST .../reflection/pause        {reason: "busy" | "idle"}
    POST .../reflection/resume
    POST .../reflection/next-batch
    POST .../reflection/feedback

Owner only: anyone else gets 404, as for the run or paper itself. A research run's questions stop
when the run is over (DONE, failed or interrupted); a paper's when its study output is no longer
being written. What the page receives: the questions, the user's own answers, the status and the
feedback. Never hypotheses, search queries or other internal reasoning.
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models, reflection as rf, research_api, study
from app.auth.deps import get_current_user
from app.auth.security import limiter
from app.database import get_db
from app.log import get_logger
from app.papers import _owned_paper

log = get_logger("reflection_api")
router = APIRouter(tags=["reflection"])

# Short, friendly messages for the page (like research_api.FRIENDLY_ERRORS)
NO_REFLECTION = "There are no questions for this one."
UNKNOWN_QUESTION = "That question isn't part of this set."
TOO_LONG = f"Answers can be up to {rf.ANSWER_MAX:,} characters."
FEEDBACK_LOCKED = "Your feedback is already written, so answers can't change now."
RUN_OVER = "The answer is ready, so there are no more questions."
PAUSED = "Questions are paused. Resume them to keep going."
AT_LIMIT = "That's plenty of questions for this one."
NO_MORE = "There are no new questions for this one."
NOT_DONE = "Feedback is ready once the answer is."
NOTHING_ANSWERED = "Answer at least one question to get feedback."
NO_SUMMARY = "The paper's overview isn't available, so there's nothing to compare with yet."
SERVICE = {
    "quota": (429, research_api.FRIENDLY_ERRORS[429]),
    "unavailable": (503, research_api.FRIENDLY_ERRORS[503]),
}

# Per user, per 10 minutes
ANSWER_LIMIT, BATCH_LIMIT, FEEDBACK_LIMIT, WINDOW = 120, 20, 10, 600


class AnswerBody(BaseModel):
    question_id: str
    answer: str | None = None
    skipped: bool = False


class PauseBody(BaseModel):
    reason: Literal["busy", "idle"]


# ───────── loading, with the run's state ─────────

class Target:
    """A reflection and what it belongs to: a research session or a paper."""

    def __init__(self, r: models.Reflection, session: models.ResearchSession | None = None, paper: models.Paper | None = None):
        self.r, self.session, self.paper = r, session, paper

    def running(self, db: Session) -> bool:
        if self.session is not None:
            return research_api._status(self.session, db) == "in_progress"
        return study.kit_status(db, self.paper.id)["status"] == "processing"

    def done(self, db: Session) -> bool:
        """Ready to compare with: the research answer, or the paper's overview."""
        if self.session is not None:
            return research_api._status(self.session, db) in research_api.DONE
        art = db.query(models.StudyArtifact).filter_by(paper_id=self.paper.id, kind="summary").first()
        return bool(art and art.status == "ready") and not self.running(db)


def _sync(db: Session, t: Target) -> Target:
    """A run that is over stops its questions, even if the background job missed it."""
    if t.r.status in rf.OPEN and not t.running(db):
        t.r.status, t.r.generating_since = "finished", None
        db.commit()
    return t


def _session_target(db: Session, session_id: str, user: models.User) -> Target:
    s = research_api._owned_session(db, session_id, user)
    r = db.query(models.Reflection).filter_by(session_id=s.id, user_id=user.id).first()
    if not r:
        raise HTTPException(status_code=404, detail=NO_REFLECTION)
    return _sync(db, Target(r, session=s))


def _paper_target(db: Session, paper_id: str, user: models.User) -> Target:
    paper = _owned_paper(db, paper_id, user)
    r = (db.query(models.Reflection).filter_by(paper_id=paper.id, user_id=user.id)
         .order_by(models.Reflection.created_at.desc()).first())
    if not r:
        raise HTTPException(status_code=404, detail=NO_REFLECTION)
    return _sync(db, Target(r, paper=paper))


def payload(db: Session, t: Target) -> dict:
    r = t.r
    fb = r.feedback or None
    return {
        "id": r.id,
        "kind": "paper" if t.paper is not None else "research",
        "status": r.status,
        "pause_reason": r.pause_reason if r.status == "paused" else None,
        "questions": [{k: q.get(k) for k in ("id", "text", "kind", "batch", "answer", "skipped")} for q in (r.questions or [])],
        "generating": rf.is_generating(r) and r.status in rf.OPEN,
        "exhausted": bool(r.exhausted),
        "limit_reached": len(r.questions or []) >= rf.MAX_QUESTIONS,
        "run_done": t.done(db),
        "answered": len(rf.answered(r)),
        "feedback": {k: fb.get(k, []) for k in ("strengths", "gaps", "next_questions")} if fb else None,
        "feedback_current": bool(fb) and fb.get("answers_key") == rf.answers_key(r),
    }


# ───────── the actions (shared by both routes) ─────────

def _answer(db: Session, t: Target, body: AnswerBody, user: models.User) -> dict:
    limiter.hit(f"reflection:answers:{user.id}", ANSWER_LIMIT, WINDOW)
    r = t.r
    if r.feedback:
        raise HTTPException(status_code=409, detail=FEEDBACK_LOCKED)
    text = (body.answer or "").strip()
    if len(text) > rf.ANSWER_MAX:
        raise HTTPException(status_code=400, detail=TOO_LONG)
    questions = [dict(q) for q in (r.questions or [])]
    match = next((q for q in questions if q.get("id") == body.question_id), None)
    if match is None:
        raise HTTPException(status_code=400, detail=UNKNOWN_QUESTION)
    if body.skipped and not text:
        match.update(answer=None, answered_at=None, skipped=True)
    elif text:
        match.update(answer=text, answered_at=rf._now().isoformat() + "Z", skipped=False)
    else:  # an empty answer counts as unanswered
        match.update(answer=None, answered_at=None, skipped=False)
    r.questions = questions  # a new list, so the JSON column is saved
    db.commit()
    return payload(db, t)


def _pause(db: Session, t: Target, body: PauseBody) -> dict:
    if t.r.status == "active":
        t.r.status, t.r.pause_reason = "paused", body.reason
        db.commit()
    return payload(db, t)


def _resume(db: Session, t: Target) -> dict:
    """Only while the run is still going; after that the finished state is returned (no error)."""
    if t.r.status == "paused" and t.running(db):
        t.r.status, t.r.pause_reason = "active", None
        db.commit()
    return payload(db, t)


def _next_batch(db: Session, t: Target, user: models.User) -> dict:
    limiter.hit(f"reflection:batch:{user.id}", BATCH_LIMIT, WINDOW)
    r = t.r
    if r.status == "paused":
        raise HTTPException(status_code=409, detail=PAUSED)
    if r.status != "active" or not t.running(db):
        raise HTTPException(status_code=409, detail=RUN_OVER)
    if len(r.questions or []) >= rf.MAX_QUESTIONS:
        raise HTTPException(status_code=409, detail=AT_LIMIT)
    if r.exhausted:
        raise HTTPException(status_code=409, detail=NO_MORE)
    if rf.claim_batch(db, r.id):  # only one batch at a time: a second quick call just gets the state
        rf.submit(rf.generate_job, r.id)
    db.refresh(r)
    return payload(db, t)


def _feedback(db: Session, t: Target, user: models.User) -> dict:
    r = t.r
    if not t.done(db):
        if t.paper is not None and not t.running(db):
            raise HTTPException(status_code=409, detail=NO_SUMMARY)
        raise HTTPException(status_code=409, detail=NOT_DONE)
    qa = rf.answered(r)
    if not qa:
        raise HTTPException(status_code=400, detail=NOTHING_ANSWERED)
    key = rf.answers_key(r)
    if r.feedback and r.feedback.get("answers_key") == key:
        return payload(db, t)  # already written for these answers
    limiter.hit(f"reflection:feedback:{user.id}", FEEDBACK_LIMIT, WINDOW)
    try:
        if t.session is not None:
            findings, ids = rf.research_findings(t.session, research_api.PUBLIC_EVIDENCE_FIELDS)
            out = rf.write_feedback(t.session.question, qa, findings, paper=False, valid_evidence=ids)
        else:
            findings, pages = rf.paper_findings(db, t.paper)
            out = rf.write_feedback((t.paper.title or "").removesuffix(".pdf"), qa, findings, paper=True, valid_pages=pages)
    except rf.ReflectionError as exc:
        code, message = SERVICE.get(exc.kind, SERVICE["unavailable"])
        log.warning("reflection feedback failed reflection=%s kind=%s", r.id, exc.kind)
        raise HTTPException(status_code=code, detail=message)  # nothing is stored
    r.feedback = {**out, "answers_key": key, "created_at": rf._now().isoformat() + "Z"}
    db.commit()
    log.info("reflection feedback written reflection=%s answered=%d", r.id, len(qa))
    return payload(db, t)


# ───────── research runs ─────────

@router.get("/research/sessions/{session_id}/reflection")
def get_session_reflection(session_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return payload(db, _session_target(db, session_id, user))


@router.put("/research/sessions/{session_id}/reflection/answers")
def answer_session(session_id: str, body: AnswerBody, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return _answer(db, _session_target(db, session_id, user), body, user)


@router.post("/research/sessions/{session_id}/reflection/pause")
def pause_session(session_id: str, body: PauseBody, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return _pause(db, _session_target(db, session_id, user), body)


@router.post("/research/sessions/{session_id}/reflection/resume")
def resume_session(session_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return _resume(db, _session_target(db, session_id, user))


@router.post("/research/sessions/{session_id}/reflection/next-batch")
def next_batch_session(session_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return _next_batch(db, _session_target(db, session_id, user), user)


@router.post("/research/sessions/{session_id}/reflection/feedback")
def feedback_session(session_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return _feedback(db, _session_target(db, session_id, user), user)


# ───────── Paper Study ─────────

@router.get("/papers/{paper_id}/reflection")
def get_paper_reflection(paper_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return payload(db, _paper_target(db, paper_id, user))


@router.put("/papers/{paper_id}/reflection/answers")
def answer_paper(paper_id: str, body: AnswerBody, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return _answer(db, _paper_target(db, paper_id, user), body, user)


@router.post("/papers/{paper_id}/reflection/pause")
def pause_paper(paper_id: str, body: PauseBody, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return _pause(db, _paper_target(db, paper_id, user), body)


@router.post("/papers/{paper_id}/reflection/resume")
def resume_paper(paper_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return _resume(db, _paper_target(db, paper_id, user))


@router.post("/papers/{paper_id}/reflection/next-batch")
def next_batch_paper(paper_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return _next_batch(db, _paper_target(db, paper_id, user), user)


@router.post("/papers/{paper_id}/reflection/feedback")
def feedback_paper(paper_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return _feedback(db, _paper_target(db, paper_id, user), user)
