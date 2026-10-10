from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from app.research import run_research
from app.search import search_web
from app.database import engine
from app import models
from app.papers import router as papers_router

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
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


class ResearchRequest(BaseModel):
    question: str


@app.get("/")
def home():
    return {"message": "Autonomous Research Agent Backend is running!"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/research")
def research(request: ResearchRequest):
    question = request.question.strip()

    if len(question) < 10:
        raise HTTPException(
            status_code=400,
            detail="Question must be at least 10 characters long.",
        )

    return run_research(question)


@app.get("/search")
def search(query: str):
    return search_web(query)