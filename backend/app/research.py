import time
from urllib.parse import urlparse
from app.llm import classify_and_refine, create_research_plan
from app.search import search_web

MAX_ROUNDS = 3
MIN_EVIDENCE = 2
MIN_WEIGHTED = 1.0
MIN_TOP_WEIGHT = 0.6
_tavily_cache: dict[str, list[dict]] = {}

HIGH_DOMAINS = (
    "nature.com", "bmj.com", "nih.gov", "pubmed", "pmc.ncbi.nlm.nih.gov",
    "thelancet.com", "springer.com", "sciencedirect.com", "mdpi.com",
    "plos.org", "jamanetwork.com", "clinicaltrials.gov", "doi.org",
    "frontiersin.org", "cell.com", "oup.com", "wiley.com", "tandfonline.com",
    "cochranelibrary.com", "sajhrm.co.za",
)
MEDIUM_DOMAINS = (
    "hub.jhu.edu", "healthline.com", "webmd.com", "medscape.com",
    "medrxiv.org", "biorxiv.org", "endocrine.org", "dzd-ev.de", "hcplive.com",
    "endocrinologyadvisor.com", "sleepfoundation.org", "mayoclinic.org",
    "clevelandclinic.org", "gallup.com", "arxiv.org", "timeshighereducation.com",
    "hrdive.com",
)


def source_weight(url: str) -> float:
    domain = urlparse(url if "://" in url else f"https://{url}").netloc.lower()
    if any(d in domain for d in MEDIUM_DOMAINS):
        return 0.6
    if any(d in domain for d in HIGH_DOMAINS) or domain.endswith((".gov", ".edu")):
        return 1.0
    return 0.3


def _compute_status(evidence: list[dict]) -> str:
    non_neutral = [e for e in evidence if e["stance"] in ("supports", "refutes")]
    if not non_neutral:
        return "untested"
    counted: list[dict] = []
    study_groups: dict[tuple[str, str], dict] = {}
    for e in non_neutral:
        study = (e.get("study") or "").strip()
        if not study:
            counted.append(e)
        else:
            key = (e.get("hypothesis_id", ""), study.lower())
            if key not in study_groups or (e["weight"] * e["confidence"]) > (study_groups[key]["weight"] * study_groups[key]["confidence"]):
                study_groups[key] = e
    counted.extend(study_groups.values())

    supports = sum(e["weight"] * e["confidence"] for e in counted if e["stance"] == "supports")
    refutes = sum(e["weight"] * e["confidence"] for e in counted if e["stance"] == "refutes")
    if (
        len(counted) < MIN_EVIDENCE
        or (supports + refutes) < MIN_WEIGHTED
        or not any(e["weight"] >= MIN_TOP_WEIGHT for e in counted)
    ):
        return "insufficient"
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
    seen_sources: set[tuple[str, str]] = set()
    evidence_log: list[dict] = []
    rounds_used = 0

    for r in range(1, MAX_ROUNDS + 1):
        rounds_used = r
        round_sources: list[dict] = []

        # Step 2: SEARCH (Tavily only, max_results=4)
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
                    raw_url = item.get("url") or ""
                    norm_url = raw_url.split("#")[0].rstrip("/").lower()
                    if norm_url and (h_id, norm_url) in seen_sources:
                        continue
                    if norm_url:
                        seen_sources.add((h_id, norm_url))
                    round_sources.append({
                        "source_id": f"S{len(round_sources) + 1}",
                        "hypothesis_id": h_id,
                        "query": query,
                        "url": raw_url,
                        "title": item.get("title") or "",
                        "content": item.get("content") or "",
                    })

        # Step 3: CLASSIFY + REFINE (1 Gemini call)
        classification = classify_and_refine(hypotheses, round_sources, used_queries)
        gemini_calls += 1

        src_map = {s["source_id"]: s for s in round_sources}
        for item in classification.items:
            src = src_map.get(item.source_id)
            if src:
                stance = item.stance
                quote = getattr(item, "quote", "") or ""
                study = getattr(item, "study", "") or ""
                if stance != "neutral":
                    norm_q = " ".join(quote.split()).lower()
                    norm_c = " ".join((src["content"] or "").split()).lower()
                    if not norm_q or norm_q not in norm_c:
                        stance = "neutral"
                evidence_log.append({
                    "hypothesis_id": src["hypothesis_id"],
                    "round": r,
                    "query": src["query"],
                    "source_url": src["url"],
                    "source_title": src["title"],
                    "snippet": src["content"][:300],
                    "stance": stance,
                    "confidence": item.confidence,
                    "quote": quote,
                    "study": study if stance != "neutral" else "",
                    "weight": source_weight(src["url"]),
                })

        # Step 4: STATUS (pure Python)
        for h in hypotheses:
            h["status"] = _compute_status(
                [e for e in evidence_log if e["hypothesis_id"] == h["id"]]
            )

        # Step 5: Check if refinement is needed for another round
        if r == MAX_ROUNDS:
            break

        if r >= 2 and not any(e["round"] == r and e["stance"] in ("supports", "refutes") for e in evidence_log):
            break

        followup_map = {f.hypothesis_id: f.queries for f in classification.followups}
        next_pending: dict[str, list[str]] = {}
        for h in hypotheses:
            if h["status"] in ("untested", "insufficient", "mixed") and h["id"] in followup_map:
                new_q = []
                for q in followup_map[h["id"]][:2]:
                    norm = q.strip().lower()
                    if norm and norm not in used_queries:
                        used_queries.add(norm)
                        new_q.append(q.strip())
                        h["subquestions"].append(q.strip())
                if new_q:
                    next_pending[h["id"]] = new_q

        if not next_pending:
            break
        pending_queries = next_pending

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
