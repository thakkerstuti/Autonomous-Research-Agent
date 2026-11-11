from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from app.research import run_research
from app.search import search_web
from app.database import engine, get_db
from app import models
from app.schemas import ResearchRequest
from app.papers import router as papers_router
from urllib.parse import urlparse
import urllib.parse
import re

def build_text_fragment_url(url: str, quote: str = "", snippet: str = "") -> str:
    if not url:
        return ""
    text = (quote or "").strip()
    if not text and snippet:
        parts = re.split(r'[.!?]\s+', snippet.strip())
        text = parts[0].strip() if parts else snippet.strip()
    cleaned = re.sub(r'[*_~`"\'“”‘’\[\]\(\)]+', ' ', text)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    if not cleaned:
        return url
    words = cleaned.split()
    if not words:
        return url
    def enc(s: str) -> str:
        return urllib.parse.quote(s).replace("-", "%2D")
    if len(words) <= 7:
        directive = enc(" ".join(words))
    else:
        start = re.sub(r'[.,;:!?]+$', '', " ".join(words[:4]))
        end = re.sub(r'^[.,;:!?]+|[.,;:!?]+$', '', " ".join(words[-4:]))
        directive = f"{enc(start)},{enc(end)}"
    base = url.split(":~:text=")[0].rstrip("#&")
    sep = ":~:text=" if "#" in base else "#:~:text="
    return f"{base}{sep}{directive}"

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables if they don't exist yet (e.g. fresh SQLite DB on new deploy)
    models.Base.metadata.create_all(bind=engine)

    # Reset stale processing pages on startup
    from app.database import SessionLocal
    from app.models import PageSummary
    db = SessionLocal()
    try:
        stale = db.query(PageSummary).filter(PageSummary.status == "processing").all()
        for s in stale:
            s.status = "pending"
        db.commit()
    except Exception as e:
        print(f"Error resetting stale pages: {e}")
    finally:
        db.close()
    yield

app = FastAPI(lifespan=lifespan)

app.include_router(papers_router)

import os

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def home():
    return {"message": "Autonomous Research Agent Backend is running!"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/research")
def research(request: ResearchRequest, db: Session = Depends(get_db)):
    question = request.question.strip()

    if len(question) < 10:
        raise HTTPException(
            status_code=400,
            detail="Question must be at least 10 characters long.",
        )

    import traceback
    try:
        return run_research(
            question=question,
            output_format=request.output_format,
            session_id=request.session_id,
            db=db,
        )
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)[:300]}")


@app.get("/research/sessions")
def get_research_sessions(db: Session = Depends(get_db)):
    sessions = (
        db.query(models.ResearchSession)
        .order_by(models.ResearchSession.updated_at.desc())
        .all()
    )
    result = []
    for s in sessions:
        created_display = s.created_at.strftime("%b %d, %Y") if s.created_at else "Recently"
        result.append({
            "id": s.id,
            "title": s.title or s.question,
            "mode": "research",
            "status": s.status if s.status in ("ready", "in_progress", "review") else "ready",
            "updated": created_display,
            "output_format": s.output_format,
        })
    return result


@app.get("/research/sessions/{session_id}")
def get_research_session(session_id: str, db: Session = Depends(get_db)):
    s = db.query(models.ResearchSession).filter(models.ResearchSession.id == session_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Research session not found")
    return {
        "session_id": s.id,
        "research_question": s.question,
        "output_format": s.output_format,
        "status": s.status,
        "hypotheses": s.hypotheses or [],
        "evidence_log": s.evidence_log or [],
        "report": s.report,
        "critique": s.critique or {},
        "stats": s.stats or {},
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


@app.get("/research/latest-report")
def get_latest_report(db: Session = Depends(get_db)):
    # Prefer most recent session with real evidence and report
    s = (
        db.query(models.ResearchSession)
        .filter(models.ResearchSession.report.isnot(None))
        .filter(models.ResearchSession.evidence_log.isnot(None))
        .filter(models.ResearchSession.evidence_log != "[]")
        .order_by(models.ResearchSession.updated_at.desc())
        .first()
    )
    if not s:
        s = (
            db.query(models.ResearchSession)
            .filter(models.ResearchSession.report.isnot(None))
            .order_by(models.ResearchSession.updated_at.desc())
            .first()
        )
    if not s:
        return None

    # Transform into ResearchReport structure for the report page
    evidence_log = s.evidence_log or []
    hypotheses = s.hypotheses or []

    findings = []
    for h in hypotheses:
        h_id = h.get("id", "")
        stmt = h.get("statement", "")
        status = h.get("status", "untested")
        status_weight = 85 if status == "supported" else 75 if status == "refuted" else 50
        citation_ids = [e["id"] for e in evidence_log if e.get("hypothesis_id") == h_id and e.get("stance") != "neutral"]
        findings.append({
            "id": f"f_{h_id}",
            "text": f"[{status.upper()}] {stmt}",
            "confidence": status_weight,
            "citationIds": citation_ids,
        })

    sources_map = {}
    for ev in evidence_log:
        url = ev.get("source_url", "")
        domain = urlparse(url if "://" in url else f"https://{url}").netloc.lower() or "source"
        if domain not in sources_map:
            sources_map[domain] = {
                "name": ev.get("source_title") or domain,
                "domain": domain,
                "confidence": int((ev.get("confidence") or 0.8) * 100),
                "color": "#4C6EF5",
            }

    citations = []
    for ev in evidence_log:
        if ev.get("stance") != "neutral":
            url = ev.get("source_url", "")
            domain = urlparse(url if "://" in url else f"https://{url}").netloc.lower() or "source"
            v_tag = f"Verified in source" if ev.get("verification_status") == "verified" else "Search snippet"
            highlighted_url = build_text_fragment_url(url, ev.get("quote", ""), ev.get("snippet", ""))
            citations.append({
                "id": ev["id"],
                "title": ev.get("source_title") or domain,
                "domain": domain,
                "url": highlighted_url,
                "note": f"{ev.get('stance', '').upper()} · {v_tag} · {ev.get('quote', '')[:100]}",
            })

    updated_str = s.updated_at.strftime("%b %d, %Y") if s.updated_at else "Recently"

    # Extract clean summary from report
    summary = ""
    if s.report:
        lines = s.report.split("\n")
        body_lines = [l for l in lines if l.strip() and not l.startswith("#") and not l.startswith(">")]
        summary = " ".join(body_lines[:3])[:300] if body_lines else s.report[:200]

    return {
        "id": s.id,
        "question": s.question,
        "summary": summary,
        "updated": updated_str,
        "findings": findings,
        "sources": list(sources_map.values()),
        "citations": citations,
    }


@app.get("/search")
def search(query: str):
    return search_web(query)
