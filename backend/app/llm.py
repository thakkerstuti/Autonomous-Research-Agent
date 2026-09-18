import os
import time
from dotenv import load_dotenv
from fastapi import HTTPException
from google import genai
from google.genai import errors, types
from app.schemas import ClassificationResult, ResearchPlan

load_dotenv()

MODEL = "gemini-flash-lite-latest"
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))


def _call_gemini(prompt: str, schema):
    for attempt in range(2):
        try:
            response = client.models.generate_content(
                model=MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=schema,
                ),
            )
            return response.parsed
        except errors.APIError as e:
            is_429 = getattr(e, "code", None) == 429 or "RESOURCE_EXHAUSTED" in str(e).upper()
            if is_429 and attempt == 0:
                time.sleep(2)
                continue
            if is_429:
                raise HTTPException(
                    status_code=503,
                    detail="Gemini quota or rate limit exceeded. Please try again later.",
                )
            raise HTTPException(
                status_code=503,
                detail="Gemini API error. Please try again later.",
            )
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(
                status_code=503,
                detail="Error communicating with Gemini API.",
            )


def create_research_plan(question: str) -> ResearchPlan:
    prompt = f"""You are a research planning assistant.
Evaluate this topic: "{question}"
If invalid (nonsense, gibberish, too vague, or not a research question), set valid=false and provide a reason.
If valid:
1. Set valid=true and reason to a brief description.
2. Generate 3 to 5 distinct, falsifiable hypotheses.
3. For each hypothesis, generate exactly 2 search-friendly subquestions: one to confirm it, one to refute or find limits."""

    plan: ResearchPlan = _call_gemini(prompt, ResearchPlan)
    if not plan.valid:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid research question: {plan.reason}",
        )
    return plan
