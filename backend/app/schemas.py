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


class HypothesisFollowup(BaseModel):
    hypothesis_id: str
    queries: list[str] = Field(default_factory=list)


class ClassificationResult(BaseModel):
    items: list[SourceClassification] = Field(default_factory=list)
    followups: list[HypothesisFollowup] = Field(default_factory=list)
