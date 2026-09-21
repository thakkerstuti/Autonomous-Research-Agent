import time
from app.llm import classify_and_refine, create_research_plan
from app.search import search_web

MAX_ROUNDS = 3
_tavily_cache: dict[str, list[dict]] = {}


def _compute_status(evidence: list[dict]) -> str:
    non_neutral = [e for e in evidence if e["stance"] in ("supports", "refutes")]
    if not non_neutral:
        return "untested"
    supports = sum(e["confidence"] for e in non_neutral if e["stance"] == "supports")
    refutes = sum(e["confidence"] for e in non_neutral if e["stance"] == "refutes")
    if supports > 2 * refutes:
        return "supported"
    if refutes > 2 * supports:
        return "refuted"
    return "mixed"


def run_research(question: str) -> dict:
    start_time = time.time()
    gemini_calls = 0
    tavily_calls = 0

    plan = create_research_plan(question)
    gemini_calls += 1

    hypotheses = [
        {
            "id": f"H{i + 1}",
            "statement": h.statement,
            "subquestions": list(h.subquestions),
            "status": "untested",
        }
        for i, h in enumerate(plan.hypotheses)
    ]

    pending_queries = {h["id"]: list(h["subquestions"]) for h in hypotheses}
    used_queries = {q.strip().lower() for h in hypotheses for q in h["subquestions"]}
    evidence_log: list[dict] = []
    rounds_used = 0

    for r in range(1, MAX_ROUNDS + 1):
        rounds_used = r
        round_sources: list[dict] = []

        for h_id, queries in pending_queries.items():
            for query in queries:
                key = query.strip().lower()
                if key in _tavily_cache:
                    results = _tavily_cache[key]
                else:
                    tavily_calls += 1
                    try:
                        results = search_web(query, max_results=4)
                        _tavily_cache[key] = results
                    except Exception:
                        results = []

                for item in results:
                    round_sources.append({
                        "source_id": f"S{len(round_sources) + 1}",
                        "hypothesis_id": h_id,
                        "query": query,
                        "url": item.get("url") or "",
                        "title": item.get("title") or "",
                        "content": item.get("content") or "",
                    })

        classification = classify_and_refine(hypotheses, round_sources, used_queries)
        gemini_calls += 1

        src_map = {s["source_id"]: s for s in round_sources}
        for item in classification.items:
            src = src_map.get(item.source_id)
            if src:
                evidence_log.append({
                    "hypothesis_id": src["hypothesis_id"],
                    "round": r,
                    "query": src["query"],
                    "source_url": src["url"],
                    "source_title": src["title"],
                    "snippet": src["content"][:300],
                    "stance": item.stance,
                    "confidence": item.confidence,
                })

        for h in hypotheses:
            h["status"] = _compute_status(
                [e for e in evidence_log if e["hypothesis_id"] == h["id"]]
            )

        if r == MAX_ROUNDS:
            break

    return {
        "research_question": question,
        "hypotheses": hypotheses,
        "evidence_log": evidence_log,
        "rounds_used": rounds_used,
        "stats": {
            "gemini_calls": gemini_calls,
            "tavily_calls": tavily_calls,
            "duration_seconds": round(time.time() - start_time, 2),
        },
    }
