from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from app.research import run_research
from app.search import search_web

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ResearchRequest(BaseModel):
    question: str


@app.get("/")
def home():
    return {"message": "Autonomous Research Agent Backend is running!"}


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
