"""Regression: every response_schema we send to Gemini must work with the
Gemini Developer API (GEMINI_API_KEY), which rejects `additionalProperties`.

Production failed with: "additionalProperties is only supported in Gemini
Enterprise Agent Platform mode, not in Gemini Developer API mode." That error
is raised by the google-genai SDK while converting the schema, before any
request is sent, so these tests run the SDK's own conversion offline."""
import pytest
from fastapi import HTTPException
from google.genai import _transformers as sdk_transformers
from pydantic import ValidationError

from app import llm, models, study, tasks
from app.llm import LLMCritiqueResponse
from app.schemas import ClassificationResult, CritiqueResult, ResearchPlan

GEMINI_SCHEMAS = [
    tasks.BatchAnalysis, tasks.SingleAnalysis, tasks.OverviewModel,  # Paper Study
    ResearchPlan, ClassificationResult, CritiqueResult, LLMCritiqueResponse,  # Research Mode
    *study.GEMINI_SCHEMAS,  # Study kit: chunk notes, summary, flashcards, questions, highlights, ask
]


class DeveloperApiClient:
    """What the SDK checks: not Vertex AI / Enterprise mode."""
    vertexai = False


def _paths_with(schema, key, path="$"):
    found = []
    if isinstance(schema, dict):
        for k, v in schema.items():
            if k == key:
                found.append(path)
            found += _paths_with(v, key, f"{path}.{k}")
    elif isinstance(schema, list):
        for i, v in enumerate(schema):
            found += _paths_with(v, key, f"{path}[{i}]")
    return found


@pytest.mark.parametrize("schema", GEMINI_SCHEMAS, ids=lambda m: m.__name__)
def test_schema_has_no_additional_properties(schema):
    assert _paths_with(schema.model_json_schema(), "additionalProperties") == []


@pytest.mark.parametrize("schema", GEMINI_SCHEMAS, ids=lambda m: m.__name__)
def test_sdk_accepts_schema_in_developer_api_mode(schema):
    converted = sdk_transformers.t_schema(DeveloperApiClient(), schema)
    assert converted is not None
    assert _paths_with(converted.model_dump(exclude_none=True), "additionalProperties") == []
    assert _paths_with(converted.model_dump(exclude_none=True), "additional_properties") == []


def test_the_old_dict_schema_really_was_the_cause():
    from pydantic import BaseModel

    class OldPage(BaseModel):
        terms: dict[str, str]

    with pytest.raises(ValueError, match="additionalProperties"):
        sdk_transformers.t_schema(DeveloperApiClient(), OldPage)


# ───────── the structure and validation are preserved ─────────

def test_validation_still_strict():
    ok = tasks.BatchAnalysis.model_validate({"pages": [{
        "page_number": 3, "summary": "Explains spacing.", "key_points": ["a", "b"],
        "terms": [{"name": "Spacing", "explanation": "Gaps between study sessions"}],
        "figures": [{"name": "Figure 2", "explanation": "Recall over time"}],
    }]})
    page = ok.pages[0]
    assert tasks.PageAnalysis.as_mapping(page.terms) == {"Spacing": "Gaps between study sessions"}
    with pytest.raises(ValidationError):
        tasks.BatchAnalysis.model_validate({"pages": [{"page_number": 1}]})  # summary missing
    with pytest.raises(ValidationError):
        tasks.BatchAnalysis.model_validate({"pages": [{"page_number": 1, "summary": "s", "terms": [{"name": "x"}]}]})


def test_older_mapping_form_is_still_accepted():
    page = tasks.PageAnalysis.model_validate({"page_number": 1, "summary": "s", "terms": {"A": "alpha"}, "figures": {}})
    assert tasks.PageAnalysis.as_mapping(page.terms) == {"A": "alpha"}


def test_saved_page_keeps_the_api_shape():
    summary = models.PageSummary(paper_id="p", page_number=1, level="Medium", status="processing")
    tasks._apply(summary, tasks.PageAnalysis.model_validate({
        "page_number": 1, "summary": "s", "key_points": ["k"],
        "terms": [{"name": " Term ", "explanation": " def "}, {"name": " ", "explanation": "dropped"}],
        "figures": [{"name": "Eq. 1", "explanation": "the update rule"}],
    }))
    assert summary.terms == {"Term": "def"}  # same {name: explanation} mapping the frontend reads
    assert summary.figures == {"Eq. 1": "the update rule"}
    assert summary.status == "ready"


def test_every_fallback_model_gets_the_same_compatible_schema(monkeypatch):
    sent = []

    class FakeModels:
        def generate_content(self, model, contents, config):
            sent.append((model, config.response_schema))
            raise RuntimeError("simulated failure so the next fallback is tried")

    class FakeClient:
        models = FakeModels()

    monkeypatch.delenv("LLM_MOCK", raising=False)
    monkeypatch.setattr(llm, "client", FakeClient())
    with pytest.raises(HTTPException):
        llm._call_gemini("prompt", tasks.BatchAnalysis)
    assert [m for m, _ in sent] == llm.MODELS
    assert all(schema is tasks.BatchAnalysis for _, schema in sent)
    sdk_transformers.t_schema(DeveloperApiClient(), sent[0][1])  # and that schema converts cleanly
