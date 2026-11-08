import time
from datetime import datetime, timezone
from urllib.parse import urlparse
import httpx
from app.llm import classify_and_refine, create_research_plan, write_report, critique_report
from app.search import search_web
from app.models import ResearchSession
from app.database import SessionLocal

MAX_ROUNDS = 3
MIN_EVIDENCE = 2
MIN_WEIGHTED = 1.0
MIN_TOP_WEIGHT = 0.6
_tavily_cache: dict[str, list[dict]] = {}
_page_cache: dict[str, str | None] = {}

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


CAUSAL_WORDS = (
    "cause", "causes", "directly increases", "directly decreases",
    "primarily", "triggers", "primary mediator", "leads to", "drives",
)
PREPRINT_DOMAINS = ("medrxiv.org", "biorxiv.org", "arxiv.org")
NCBI_DOMAINS = ("pmc.ncbi.nlm.nih.gov", "pubmed.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov")
INSTITUTION_SUFFIXES = (".gov", ".edu")
INSTITUTION_DOMAINS = ("hub.jhu.edu", "clinicaltrials.gov", "nih.gov", "pmc.ncbi.nlm.nih.gov")


def _source_type(url: str) -> str:
    domain = urlparse(url if "://" in url else f"https://{url}").netloc.lower()
    if any(d in domain for d in PREPRINT_DOMAINS):
        return "preprint"
    if any(d in domain for d in NCBI_DOMAINS):
        return "journal"
    if any(d in domain for d in INSTITUTION_DOMAINS) or domain.endswith(INSTITUTION_SUFFIXES):
        return "institution"
    if any(d in domain for d in HIGH_DOMAINS):
        return "journal"
    if any(d in domain for d in MEDIUM_DOMAINS):
        return "news"
    return "blog"


def _verify_source_content(url: str, quote: str) -> tuple[str, str]:
    """
    Attempts to fetch the original source and verify the quote appears in the page body.
    Returns (verification_status, verification_detail).
    verification_status is one of:
      - 'verified': quote was located in the fetched page text
      - 'snippet_only': fetched page but quote wasn't in text (or dynamic JS rendered)
      - 'unverified': could not fetch source (timeout, HTTP error, block, paywall)
    """
    clean_quote = (quote or "").strip()
    if not clean_quote:
        return "unverified", "Neutral source without extracted quote."

    norm_quote = " ".join(clean_quote.split()).lower()
    if not norm_quote or not url or not url.startswith(("http://", "https://")):
        return "unverified", "Invalid source URL or empty quote."

    # Check cache for fetched page body
    page_text = _page_cache.get(url)
    if page_text is None:
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
            with httpx.Client(timeout=3.5, follow_redirects=True, verify=False) as client:
                resp = client.get(url, headers=headers)
                if resp.status_code == 200:
                    page_text = resp.text
                    _page_cache[url] = page_text
                else:
                    _page_cache[url] = ""
                    return "unverified", f"Source returned HTTP {resp.status_code}; verified in search snippet only."
        except Exception as exc:
            _page_cache[url] = ""
            return "unverified", f"Source fetch unavailable ({type(exc).__name__}); verified in search snippet only."

    if not page_text:
        return "unverified", "Unable to retrieve page body; verified in search snippet only."

    norm_page = " ".join(page_text.split()).lower()
    if norm_quote in norm_page:
        return "verified", "Quote verified in original source document."
    return "snippet_only", "Verified in search snippet, but not matched in fetched page body."



def _compute_status(evidence: list[dict], statement: str = "") -> str:
    valid_non_neutral = []
    for e in evidence:
        if e.get("stance") not in ("supports", "refutes"):
            continue
        quote = (e.get("quote") or "").strip()
        snippet = e.get("snippet") or ""
        if not quote:
            continue
        norm_q = " ".join(quote.split()).lower()
        norm_s = " ".join(snippet.split()).lower()
        if norm_q not in norm_s:
            continue
        valid_non_neutral.append(e)

    if not valid_non_neutral:
        return "untested"

    study_groups: dict[tuple[str, str], dict] = {}
    for e in valid_non_neutral:
        study = (e.get("study") or "").strip().lower()
        if not study:
            study = (e.get("source_title") or e.get("source_url") or "").strip().lower()
        key = (e.get("hypothesis_id", ""), study)
        if key not in study_groups or (e["weight"] * e["confidence"]) > (study_groups[key]["weight"] * study_groups[key]["confidence"]):
            study_groups[key] = e
    counted = list(study_groups.values())

    supports = sum(e["weight"] * e["confidence"] for e in counted if e["stance"] == "supports")
    refutes = sum(e["weight"] * e["confidence"] for e in counted if e["stance"] == "refutes")
    if (
        len(counted) < MIN_EVIDENCE
        or (supports + refutes) < MIN_WEIGHTED
    ):
        return "insufficient"
    if supports > 2 * refutes:
        status = "supported"
    elif refutes > 2 * supports:
        status = "refuted"
    else:
        status = "mixed"

    stmt_lower = statement.lower()
    if (
        any(w in stmt_lower for w in CAUSAL_WORDS)
        and not any(e["weight"] >= MIN_TOP_WEIGHT for e in counted)
        and status in ("supported", "refuted")
    ):
        return "insufficient"

    return status


def run_research(
    question: str,
    output_format: str = "full",
    session_id: str | None = None,
    db=None,
) -> dict:
    start_time = time.time()
    gemini_calls = 0
    tavily_calls = 0
    partial_errors: list[str] = []

    plan = create_research_plan(question)
    gemini_calls += 1

    hypotheses = [
        {
            "id": f"H{i + 1}",
            "statement": h.statement,
            "subquestions": list(h.subquestions),
            "status": "untested",
            "evidence_summary": {
                "supporting": [],
                "refuting": [],
                "neutral": [],
                "has_contradiction": False,
                "contradiction_note": None,
            },
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
                    except Exception as s_err:
                        partial_errors.append(f"Search error for query '{query}': {str(s_err)[:100]}")
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
        try:
            classification = classify_and_refine(hypotheses, round_sources, used_queries)
            gemini_calls += 1
        except Exception as c_err:
            partial_errors.append(f"Classification error in round {r}: {str(c_err)[:100]}")
            break

        src_map = {s["source_id"]: s for s in round_sources}
        for item in classification.items:
            src = src_map.get(item.source_id)
            if src:
                stance = item.stance
                quote = (getattr(item, "quote", "") or "").strip()
                study = (getattr(item, "study", "") or "").strip()
                snippet = src.get("content") or ""
                if stance != "neutral":
                    norm_q = " ".join(quote.split()).lower()
                    norm_s = " ".join(snippet.split()).lower()
                    if not quote or not norm_q or norm_q not in norm_s:
                        stance = "neutral"
                        quote = ""
                        study = ""
                else:
                    quote = ""
                    study = ""
                evidence_log.append({
                    "hypothesis_id": src["hypothesis_id"],
                    "round": r,
                    "query": src["query"],
                    "source_url": src["url"],
                    "source_title": src["title"],
                    "snippet": snippet,
                    "stance": stance,
                    "confidence": item.confidence,
                    "quote": quote,
                    "study": study,
                    "weight": source_weight(src["url"]),
                })

        # Step 4: STATUS (pure Python)
        for h in hypotheses:
            h["status"] = _compute_status(
                [e for e in evidence_log if e["hypothesis_id"] == h["id"]],
                h.get("statement", ""),
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

    # Assign evidence IDs, timestamps, source types, and verification
    retrieved_at = datetime.now(timezone.utc).isoformat()
    for i, ev in enumerate(evidence_log):
        ev["id"] = f"E{i + 1}"
        ev["retrieved_at"] = retrieved_at
        ev["source_type"] = _source_type(ev["source_url"])

        # Fetch original source and verify quoted passage (Priority 2)
        v_status, v_detail = _verify_source_content(ev["source_url"], ev.get("quote", ""))
        ev["verification_status"] = v_status
        ev["verification_detail"] = v_detail

    # Recompute hypothesis statuses and make contradiction handling visible (Priority 3)
    for h in hypotheses:
        h["status"] = _compute_status(
            [e for e in evidence_log if e["hypothesis_id"] == h["id"]],
            h.get("statement", ""),
        )
        h_evs = [e for e in evidence_log if e["hypothesis_id"] == h["id"]]
        supporting = [e["id"] for e in h_evs if e["stance"] == "supports"]
        refuting = [e["id"] for e in h_evs if e["stance"] == "refutes"]
        neutral = [e["id"] for e in h_evs if e["stance"] == "neutral"]
        has_contradiction = bool(supporting and refuting)
        h["evidence_summary"] = {
            "supporting": supporting,
            "refuting": refuting,
            "neutral": neutral,
            "has_contradiction": has_contradiction,
            "contradiction_note": (
                f"Conflicting evidence detected: {len(supporting)} supporting ({', '.join(supporting)}) vs {len(refuting)} refuting ({', '.join(refuting)})"
                if has_contradiction else None
            ),
        }

    # Write report with requested format (Priority 4)
    report, invalid_citations, report_error = write_report(
        question, hypotheses, evidence_log, output_format=output_format
    )
    gemini_calls += 1

    # If write_report failed, preserve usable partial findings (Priority 6)
    if not report:
        partial_errors.append(report_error or "Report generation failed")
        fallback_blocks = [
            f"## Direct Summary (Partial Finding)\n\n> ⚠️ Automated report generation encountered an issue: {report_error}\n",
            "### Hypotheses Evaluated\n",
        ]
        for h in hypotheses:
            c_tag = f" — ⚠️ **Contradiction:** {h['evidence_summary']['contradiction_note']}" if h['evidence_summary']['has_contradiction'] else ""
            fallback_blocks.append(f"- **[{h['id']}]** ({h['status'].upper()}): {h['statement']}{c_tag}")
        report = "\n".join(fallback_blocks)

    # Self-critique step (Priority 1)
    try:
        report, critique_outcome = critique_report(
            question, hypotheses, evidence_log, report
        )
        gemini_calls += 1
    except Exception as crit_err:
        critique_outcome = {
            "passed": False,
            "status": "skipped_on_failure",
            "checks": [],
            "issues": [f"Critique step could not execute: {str(crit_err)[:120]}"],
        }
        partial_errors.append(f"Critique error: {str(crit_err)[:100]}")

    result_status = "ready" if not partial_errors else "partial"
    duration = round(time.time() - start_time, 2)
    stats_dict = {
        "gemini_calls": gemini_calls,
        "tavily_calls": tavily_calls,
        "duration_seconds": duration,
    }

    # Persist research session (Priority 5)
    persisted_id = session_id or ""
    try:
        close_db_here = False
        if db is None:
            db = SessionLocal()
            close_db_here = True

        sess = None
        if session_id:
            sess = db.query(ResearchSession).filter(ResearchSession.id == session_id).first()

        if not sess:
            sess = ResearchSession(
                id=session_id or None,
                question=question,
                title=question,
                output_format=output_format,
                status=result_status,
                hypotheses=hypotheses,
                evidence_log=evidence_log,
                critique=critique_outcome,
                report=report,
                error="; ".join(partial_errors) if partial_errors else None,
                stats=stats_dict,
            )
            db.add(sess)
        else:
            sess.question = question
            sess.title = question
            sess.output_format = output_format
            sess.status = result_status
            sess.hypotheses = hypotheses
            sess.evidence_log = evidence_log
            sess.critique = critique_outcome
            sess.report = report
            sess.error = "; ".join(partial_errors) if partial_errors else None
            sess.stats = stats_dict

        db.commit()
        db.refresh(sess)
        persisted_id = sess.id
        if close_db_here:
            db.close()
    except Exception as db_err:
        print(f"Warning: Failed to persist research session: {db_err}")

    result = {
        "session_id": persisted_id,
        "research_question": question,
        "output_format": output_format,
        "status": result_status,
        "hypotheses": hypotheses,
        "evidence_log": evidence_log,
        "rounds_used": rounds_used,
        "report": report,
        "critique": critique_outcome,
        "invalid_citations": invalid_citations,
        "stats": stats_dict,
    }
    if partial_errors:
        result["partial_errors"] = partial_errors
        result["report_error"] = "; ".join(partial_errors)

    return result

