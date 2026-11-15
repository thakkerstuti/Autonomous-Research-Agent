"""Study-kit endpoints. Reading never calls the model; only start, retry,
regenerate and ask do, and each of those is an explicit user action."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import app.models as models
from app import study, tasks
from app.auth.deps import get_current_user
from app.auth.security import limiter
from app.database import get_db
from app.log import get_logger
from app.papers import _owned_paper

log = get_logger("papers.study")
router = APIRouter(prefix="/papers", tags=["study"])


class ProgressBody(BaseModel):
    card_id: str = Field(max_length=64)
    state: Literal["known", "review"] | None = None


class AskBody(BaseModel):
    question: str = Field(default="", max_length=500)
    action: Literal["ask", "explain_page", "summarize_pages", "compare_pages", "explain_selection"] = "ask"
    pages: list[int] = Field(default_factory=list, max_length=5)
    selection: str | None = Field(default=None, max_length=2000)


def _require_text(db: Session, paper: models.Paper) -> None:
    if not study.text_pages(db, paper.id):
        raise HTTPException(status_code=400, detail="This PDF has no selectable text, so a study kit can't be made. Run OCR on it first.")


@router.get("/{paper_id}/study")
def get_study_status(paper_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    paper = _owned_paper(db, paper_id, user)
    return study.kit_status(db, paper.id)


@router.post("/{paper_id}/study")
def start_study_kit(paper_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Builds whatever isn't built yet. Already generated outputs are reused, never redone."""
    paper = _owned_paper(db, paper_id, user)
    _require_text(db, paper)
    limiter.hit(f"study:user:{user.id}", 30, 3600)
    study.ensure_kit(db, paper.id)
    status = study.kit_status(db, paper.id)
    if status["status"] == "processing":
        tasks.enqueue_study(paper.id)
        log.info("study queued paper=%s chunks=%d", paper.id, status["chunks"]["total"])
    return study.kit_status(db, paper.id)


@router.post("/{paper_id}/study/{kind}/generate")
def generate_study_output(paper_id: str, kind: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Generate one section when the reader first opens it. Idempotent: a section
    that is queued, running or finished is never generated again by this call."""
    paper = _owned_paper(db, paper_id, user)
    if kind not in study.OUTPUTS:
        raise HTTPException(status_code=404, detail="Unknown study section")
    _require_text(db, paper)
    created = study.ensure_kit(db, paper.id, (kind,))
    status = study.kit_status(db, paper.id)
    if created or status["status"] == "processing":
        limiter.hit(f"study:user:{user.id}", 30, 3600)
        tasks.enqueue_study(paper.id)
        log.info("study section requested paper=%s kind=%s new=%s", paper.id, kind, bool(created))
    return study.kit_status(db, paper.id)


@router.post("/{paper_id}/study/retry")
def retry_study_kit(paper_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    paper = _owned_paper(db, paper_id, user)
    limiter.hit(f"study:user:{user.id}", 30, 3600)
    count = study.retry_failed(db, paper.id)
    if count:
        tasks.enqueue_study(paper.id)
    log.info("study retry paper=%s requeued=%d", paper.id, count)
    return study.kit_status(db, paper.id)


@router.put("/{paper_id}/study/flashcards/progress")
def set_flashcard_progress(paper_id: str, body: ProgressBody, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    paper = _owned_paper(db, paper_id, user)
    cards = study.get_artifact(db, paper.id, "flashcards")
    if not cards or not (cards.content or {}).get("cards"):
        raise HTTPException(status_code=404, detail="These flashcards aren't ready yet.")
    ids = {c["id"] for c in cards.content["cards"]}
    if body.card_id not in ids:
        raise HTTPException(status_code=404, detail="This flashcard no longer exists. Reload the deck.")
    progress = study.get_artifact(db, paper.id, "flashcard_progress")
    if not progress:
        progress = models.StudyArtifact(paper_id=paper.id, kind="flashcard_progress", status="ready", content={"states": {}})
        db.add(progress)
    states = dict((progress.content or {}).get("states", {}))
    if body.state is None:
        states.pop(body.card_id, None)
    else:
        states[body.card_id] = body.state
    progress.content = {"states": states}
    db.commit()
    return {"states": states}


@router.get("/{paper_id}/study/{kind}")
def get_study_output(paper_id: str, kind: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    paper = _owned_paper(db, paper_id, user)
    if kind not in study.OUTPUTS:
        raise HTTPException(status_code=404, detail="Unknown study section")
    artifact = study.get_artifact(db, paper.id, kind)
    if not artifact:
        raise HTTPException(status_code=404, detail="Not generated yet")
    out = {"kind": kind, "status": artifact.status, "error": artifact.error, "content": artifact.content if artifact.status == "ready" else None}
    if kind == "flashcards":
        progress = study.get_artifact(db, paper.id, "flashcard_progress")
        out["progress"] = (progress.content or {}).get("states", {}) if progress else {}
    return out


@router.post("/{paper_id}/study/{kind}/regenerate")
def regenerate_study_output(paper_id: str, kind: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    paper = _owned_paper(db, paper_id, user)
    if kind not in study.OUTPUTS:
        raise HTTPException(status_code=404, detail="Unknown study section")
    limiter.hit(f"study:user:{user.id}", 30, 3600)
    if study.regenerate(db, paper.id, kind):
        tasks.enqueue_study(paper.id)
        log.info("study regenerate paper=%s kind=%s", paper.id, kind)
    return study.kit_status(db, paper.id)


@router.get("/{paper_id}/asks")
def list_asks(paper_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    paper = _owned_paper(db, paper_id, user)
    history = study.get_artifact(db, paper.id, "asks")
    return {"items": (history.content or {}).get("items", []) if history else []}


@router.post("/{paper_id}/ask")
def ask_paper(paper_id: str, body: AskBody, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    paper = _owned_paper(db, paper_id, user)
    _require_text(db, paper)
    question = " ".join(body.question.split())
    pages = sorted(set(body.pages))
    if body.action == "ask" and len(question) < 3:
        raise HTTPException(status_code=422, detail="Ask a question of at least 3 characters.")
    if body.action == "explain_page" and len(pages) != 1:
        raise HTTPException(status_code=422, detail="Choose one page to explain.")
    if body.action == "summarize_pages" and not pages:
        raise HTTPException(status_code=422, detail="Choose at least one page to summarise.")
    if body.action == "compare_pages" and len(pages) < 2:
        raise HTTPException(status_code=422, detail="Choose at least two pages to compare.")
    if body.action == "explain_selection" and (not body.selection or len(body.selection.strip()) < 3 or len(pages) != 1):
        raise HTTPException(status_code=422, detail="Select some text on one page to explain.")
    if any(p < 1 or (paper.page_count and p > paper.page_count) for p in pages):
        raise HTTPException(status_code=422, detail="That page isn't in this paper.")
    limiter.hit(f"ask:user:{user.id}", 20, 600)
    try:
        entry = study.answer_question(db, paper, question, body.action, pages, (body.selection or "").strip() or None)
    except Exception as exc:  # includes the model wrapper's own HTTPException: never pass its detail through
        db.rollback()
        log.warning("ask failed paper=%s error=%s", paper.id, type(exc).__name__)
        raise HTTPException(status_code=503, detail=study._public_error(exc))
    log.info("ask paper=%s pages=%s found=%s grounded=%s", paper.id, entry["pages_considered"], entry["found"], entry["grounded"])
    return entry
