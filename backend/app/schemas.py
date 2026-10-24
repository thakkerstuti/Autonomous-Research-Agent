from typing import Literal
from pydantic import BaseModel, Field


class HypothesisPlan(BaseModel):
    statement: str
    subquestions: list[str] = Field(default_factory=list)


class ResearchPlan(BaseModel):
    valid: bool
    reason: str = ""
    hypotheses: list[HypothesisPlan] = Field(default_factory=list)


class SourceClassification(BaseModel):
    source_id: str
    stance: Literal["supports", "refutes", "neutral"]
    confidence: float
    quote: str = ""
    study: str = ""


class HypothesisFollowup(BaseModel):
    hypothesis_id: str
    queries: list[str] = Field(default_factory=list)


class ClassificationResult(BaseModel):
    items: list[SourceClassification] = Field(default_factory=list)
    followups: list[HypothesisFollowup] = Field(default_factory=list)


class CritiqueCheck(BaseModel):
    name: str
    passed: bool
    detail: str = ""


class CritiqueResult(BaseModel):
    passed: bool = True
    status: Literal["passed", "passed_with_revisions", "flagged_issues", "skipped_on_failure"] = "passed"
    checks: list[CritiqueCheck] = Field(default_factory=list)
    issues: list[str] = Field(default_factory=list)
    revised_report: str | None = None


class ResearchRequest(BaseModel):
    question: str
    output_format: str = "full"
    session_id: str | None = None

