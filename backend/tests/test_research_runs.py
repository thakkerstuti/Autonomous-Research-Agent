"""Research output modes, the Working Flow, threads (History) and full research papers.

The research engine runs for real (app.research.run_research); only its outside
calls are replaced: web search, the planner/classifier model calls, page
fetching, and the paper writer's model calls. No network, no AI credits.
"""
import datetime
import json
import unicodedata

import fitz
import pytest
from fastapi import HTTPException

from app import models, research, research_api, research_paper, research_pdf, storage
from app.database import SessionLocal
from app.schemas import ClassificationResult, HypothesisFollowup, HypothesisPlan, ResearchPlan, SourceClassification
from conftest import bearer, register

QUESTION = "Does spaced practice improve long-term memory in adults?"


# ───────── fakes for the engine's outside calls ─────────

class Engine:
    def __init__(self):
        self.searches: list[str] = []
        self.plan_questions: list[str] = []
        self.round = 0
        self.fail_plan: Exception | None = None

    def plan(self, question):
        self.plan_questions.append(question)
        if self.fail_plan:
            raise self.fail_plan
        return ResearchPlan(valid=True, reason="ok", hypotheses=[
            HypothesisPlan(statement="Spaced practice improves delayed recall in adults",
                           subquestions=["spaced practice recall adults trial", "spaced practice no effect recall"]),
            HypothesisPlan(statement="Benefits of spacing are smaller in children",
                           subquestions=["spacing children recall", "spacing children no effect"]),
        ])

    def search(self, query, max_results=4):
        self.searches.append(query)
        slug = "".join(c if c.isalnum() else "-" for c in query.lower())[:40]
        return [
            {"url": f"https://journal.example.org/{slug}", "title": f"Trial on {query}",
             "content": "In a randomised trial, spaced practice improves delayed recall in adults by a clear margin."},
            {"url": f"https://news.example.com/{slug}", "title": f"Report on {query}",
             "content": "A classroom study found no effect of spacing on recall in children."},
        ]

    def classify(self, hypotheses, sources, used_queries=None):
        self.round += 1
        items = []
        for s in sources:
            if "improves delayed recall" in s["content"]:
                items.append(SourceClassification(source_id=s["source_id"], stance="supports", confidence=0.9,
                                                  quote="spaced practice improves delayed recall in adults",
                                                  study=f"Trial {s['url'][-12:]}"))
            else:
                items.append(SourceClassification(source_id=s["source_id"], stance="refutes", confidence=0.7,
                                                  quote="found no effect of spacing on recall in children",
                                                  study=f"Classroom {s['url'][-12:]}"))
        followups = [HypothesisFollowup(hypothesis_id=h["id"], queries=[f"{h['id']} round {self.round + 1} query {i}" for i in (1, 2)])
                     for h in hypotheses]
        return ClassificationResult(items=items, followups=followups)


@pytest.fixture
def engine(monkeypatch):
    e = Engine()
    monkeypatch.setenv("RESEARCH_WORKER", "inline")
    monkeypatch.setattr(research, "create_research_plan", e.plan)
    monkeypatch.setattr(research, "search_web", e.search)
    monkeypatch.setattr(research, "classify_and_refine", e.classify)
    monkeypatch.setattr(research, "_verify_source_content", lambda url, quote: ("verified", "ok") if quote else ("unverified", "none"))
    monkeypatch.setattr(research, "_tavily_cache", {})
    monkeypatch.setattr(research, "_page_cache", {})
    return e


class Writer:
    """Stands in for the paper writer's model calls."""

    def __init__(self):
        self.calls: list[str] = []
        self.prompts: list[str] = []
        self.fail: Exception | None = None

    def __call__(self, prompt, schema):
        self.calls.append(schema.__name__)
        if self.fail:
            raise self.fail
        name = schema.__name__
        self.prompts.append(prompt)
        if name == "QuickAnswerModel":
            return schema(answer="Spaced practice improves delayed recall in adults [E1], although a classroom study in children found no effect [E2] [H1].",
                          evidence=["A randomised trial reported better delayed recall with spacing [E1]."],
                          caveats=["Evidence in children is limited and mixed [E2]."])
        if name == "DetailedAnalysisModel":
            para = "Adults showed better delayed recall with spaced practice than with massed practice in the trials reviewed [E1]. "
            heads = ["Introduction and Background", "Retention Gains in Adults", "Differences by Age Group", "Key Findings",
                     "Comparing Studies and Perspectives", "Evidence For and Against", "Contradictions and Possible Explanations",
                     "Implications", "Limitations", "Overall Synthesis"]
            return schema(sections=[{"heading": h, "level": 1, "body": (para * 4 + "\n\n") * 2 + "Children showed no effect [E2] [H1]."}
                                    for h in heads])
        if name == "PaperOutline":
            return schema(title="Spaced Practice and Long-Term Retention: An Evidence Review",
                          abstract="This review examines whether spaced practice improves retention [E1]. " * 8,
                          keywords=["spacing", "memory", "retention"], themes=["Retention gains in adults", "Differences by age group"])
        if name == "PaperPart":
            body = ("A randomised trial reported that spaced practice improves delayed recall in adults [E1][E3]. "
                    "In contrast, a classroom study found no effect in children [E2] (H2). "
                    "Spacing doubles recall in every population [E1]. "
                    "A further point cites a source that was never retrieved [E999]. ") * 2
            if '"Thematic Analysis"' in prompt:  # a parent heading with a one-line intro, then its themes
                return schema(sections=[{"heading": "Thematic Analysis", "level": 1, "body": "Two themes emerge."},
                                        {"heading": "Retention gains in adults", "level": 2, "body": body},
                                        {"heading": "Differences by age group", "level": 2, "body": body}])
            if '"Comparative Analysis"' in prompt:
                heads = [("Findings", 1), ("Comparative Analysis", 1)]
            elif '"Background and Literature Review"' in prompt:
                heads = [("Background and Literature Review", 1)]
            elif '"Introduction"' in prompt:
                heads = [("Introduction", 1), ("Methodology", 1)]
            else:
                heads = [("Contradictions and Conflicting Evidence", 1), ("Discussion", 1), ("Research Gaps and Future Directions", 1),
                         ("Limitations", 1), ("Conclusion", 1)]
            return schema(sections=[{"heading": h, "level": lv, "body": body} for h, lv in heads] + [{"heading": "Empty", "body": "tbd"}])
        if name == "PaperAudit":
            return schema(corrections=[{"original": "Spacing doubles recall in every population [E1].",
                                        "corrected": "Spacing improved recall in the adult trials reviewed [E1]."},
                                       {"original": "A sentence that is not in the draft at all.", "corrected": ""}])
        return schema()


@pytest.fixture
def writer(monkeypatch):
    w = Writer()
    monkeypatch.setattr(research_paper, "_call", w)
    return w


@pytest.fixture
def token(client):
    return register(client, email="researcher@example.com", name="Ada Lovelace").json()["access_token"]


def start(client, token, mode, question=QUESTION, thread_id=None):
    body = {"question": question, "output_format": mode}
    if thread_id:
        body["thread_id"] = thread_id
    return client.post("/research/runs", json=body, headers=bearer(token))


def run(client, token, mode, **kw):
    r = start(client, token, mode, **kw)
    assert r.status_code == 202, r.text
    got = client.get(f"/research/runs/{r.json()['session_id']}", headers=bearer(token))
    assert got.status_code == 200
    return got.json()


INTERNAL_KEYS = ("hypotheses", "critique", "evidence_summary", "subquestions")
INTERNAL_EVIDENCE_KEYS = ("hypothesis_id", "query", "round", "weight", "study", "verification_detail")


def assert_no_internals(payload):
    text = json.dumps(payload)
    for k in INTERNAL_KEYS:
        assert f'"{k}"' not in text, k
    for e in payload.get("evidence_log", []):
        for k in INTERNAL_EVIDENCE_KEYS:
            assert k not in e, k
    assert "[H1]" not in text and "(H2)" not in text
    # the engine's internal report vocabulary never reaches the reader
    for phrase in ("Core Verdict", "Findings by Hypothesis", "hypotheses", "Mock quick answer", "Quick Answer"):
        assert phrase.lower() not in text.lower(), phrase


def words(text):
    return len((text or "").split())


# ───────── modes ─────────

def test_quick_answer_is_direct_one_round_and_hides_internals(client, token, engine, writer):
    data = run(client, token, "quick")
    assert data["status"] in ("ready", "review", "partial")
    assert data["output_format"] == "quick"
    assert data["research_question"] == QUESTION
    report = data["report"]
    assert report.startswith("Spaced practice improves delayed recall")  # the direct answer first, no verdict heading
    assert "## Key evidence" in report and "## Caveats and uncertainty" in report and "[E1]" in report
    assert data["document"] is None and "summary" not in data
    assert len(engine.searches) == 4  # one round: the plan's subquestions only
    assert data["progress"]["stages"] == {s: "completed" for s in research_api.STAGES}
    assert data["evidence_log"] and data["evidence_log"][0]["source_url"].startswith("https://")
    assert_no_internals(data)
    assert writer.calls == ["QuickAnswerModel"]


def test_detailed_analysis_is_deeper_two_rounds_and_audited(client, token, engine, writer):
    quick = run(client, token, "quick")
    engine.searches.clear()
    research._tavily_cache.clear()  # the engine caches results per query for the life of the process
    data = run(client, token, "detailed")
    assert data["output_format"] == "detailed"
    assert 4 < len(engine.searches) <= 8  # a second round of targeted searches
    for heading in ("Introduction and Background", "Key Findings", "Comparing Studies and Perspectives",
                    "Contradictions and Possible Explanations", "Implications", "Limitations", "Overall Synthesis"):
        assert f"## {heading}" in data["report"], heading
    assert words(data["report"]) >= research_paper.DETAILED_MIN_WORDS
    assert words(data["report"]) > 5 * words(quick["report"])
    assert writer.calls == ["QuickAnswerModel", "DetailedAnalysisModel"]
    assert data["document"] is None
    assert_no_internals(data)


def test_a_short_detailed_draft_is_written_again_at_full_length(client, token, engine, writer, monkeypatch):
    drafts = iter([
        research_paper.DetailedAnalysisModel(sections=[{"heading": "Overview", "body": "Too short [E1]. " * 40}]),
        research_paper.DetailedAnalysisModel(sections=[{"heading": f"Part {i}", "body": "Spacing helps adults recall more [E1]. " * 40}
                                                       for i in range(8)]),
    ])
    monkeypatch.setattr(research_paper, "_call", lambda prompt, schema: next(drafts))
    text = research_paper.write_detailed_analysis(QUESTION, {"hypotheses": [], "evidence_log": [], "stats": {}})
    assert words(text) >= research_paper.DETAILED_MIN_WORDS


def test_full_research_paper_is_structured_cited_and_traceable(client, token, engine, writer):
    data = run(client, token, "full")
    assert data["output_format"] == "full"
    assert len(engine.searches) > 8  # three rounds
    assert data["report"] is None  # the result is the document: no short answer pasted in front of it
    doc = data["document"]
    assert doc["status"] == "ready" and doc["current_version"] == 1 and doc["edited"] is False
    assert writer.calls == ["PaperOutline"] + ["PaperPart"] * 5 + ["PaperAudit"]  # written section by section
    assert_no_internals(data)

    paper = client.get(f"/research/documents/{doc['id']}", headers=bearer(token)).json()
    c = paper["content"]
    assert c["title"] == "Spaced Practice and Long-Term Retention: An Evidence Review"
    assert c["author"] == "Ada Lovelace" and c["question"] == QUESTION
    assert "[E" not in c["abstract"]  # no citations in the abstract
    headings = [s["heading"] for s in c["sections"]]
    assert headings == ["Introduction", "Methodology", "Background and Literature Review",
                        "Thematic Analysis", "Retention gains in adults", "Differences by age group",
                        "Findings", "Comparative Analysis", "Contradictions and Conflicting Evidence", "Discussion",
                        "Research Gaps and Future Directions", "Limitations", "Conclusion"]
    # the parent heading is kept although its own text is one line; its themes are its subsections
    assert [s["level"] for s in c["sections"][3:6]] == [1, 2, 2]
    assert "Empty" not in headings  # placeholder sections are dropped
    body = " ".join(s["body"] for s in c["sections"])
    assert "[E" not in body and "H2" not in body  # internal labels never reach the reader
    assert "[1, 2]" in body or "[1]" in body
    assert "doubles recall" not in body and "adult trials reviewed" in body  # the audit's correction was applied
    assert c["checks"]["audit_corrections"] == 1
    assert c["checks"]["removed_ids"] == ["E999"]  # an invented citation is removed, not printed

    # Every reference is a real retrieved source, numbered in order of first citation
    urls = {e["source_url"] for e in data["evidence_log"]}
    assert c["references"] and all(r["url"] in urls for r in c["references"])
    assert [r["n"] for r in c["references"]] == list(range(1, len(c["references"]) + 1))
    cited = {int(n) for grp in __import__("re").findall(r"\[(\d+(?:, \d+)*)\]", body) for n in grp.split(", ")}
    assert cited == {r["n"] for r in c["references"]}
    assert [v["source"] for v in paper["versions"]] == ["generated"]


# ───────── editing, versions and the PDF ─────────

def test_edit_save_versions_and_pdf(client, token, engine, writer, monkeypatch):
    doc_id = run(client, token, "full")["document"]["id"]
    paper = client.get(f"/research/documents/{doc_id}", headers=bearer(token)).json()
    content = paper["content"]
    edited = {**content, "title": "Spacing Effects on Retention: A Revised Review",
              "sections": [{**content["sections"][0], "body": content["sections"][0]["body"] + "\n\nA paragraph the author added."}]
              + content["sections"][1:],
              "references": [{"n": 1, "title": "Invented source", "url": "https://fake.example"}]}
    r = client.put(f"/research/documents/{doc_id}", json={"content": edited, "base_version": 1}, headers=bearer(token))
    assert r.status_code == 200, r.text
    saved = r.json()
    assert saved["current_version"] == 2 and saved["edited"] is True
    assert saved["content"]["title"] == "Spacing Effects on Retention: A Revised Review"
    assert saved["content"]["references"] == content["references"]  # references can't be replaced from the client
    assert [v["source"] for v in saved["versions"]] == ["generated", "edit"]

    # A stale editor can't overwrite a newer save
    r = client.put(f"/research/documents/{doc_id}", json={"content": edited, "base_version": 1}, headers=bearer(token))
    assert r.status_code == 409
    # Saving unchanged content adds no version
    r = client.put(f"/research/documents/{doc_id}", json={"content": saved["content"], "base_version": 2}, headers=bearer(token))
    assert r.json()["current_version"] == 2
    # Bad content is refused
    r = client.put(f"/research/documents/{doc_id}", json={"content": {"sections": "nope"}, "base_version": 2}, headers=bearer(token))
    assert r.status_code == 400

    # The generated original is still there
    v1 = client.get(f"/research/documents/{doc_id}?version=1", headers=bearer(token)).json()
    assert v1["content"]["title"] == content["title"]

    pdf = client.get(f"/research/documents/{doc_id}/pdf", headers=bearer(token))
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf"
    assert pdf.content.startswith(b"%PDF")
    assert "Spacing-Effects-on-Retention" in pdf.headers["content-disposition"]
    assert "no-store" in pdf.headers["cache-control"]
    doc = fitz.open(stream=pdf.content, filetype="pdf")
    assert doc.page_count >= 3  # cover, body, references
    # (typographic ligatures such as "ﬀ" are normalised, as PDF viewers do when searching)
    text = unicodedata.normalize("NFKC", " ".join(p.get_text() for p in doc)).replace("\n", " ")
    assert "Spacing Effects on Retention: A Revised Review" in text
    assert "A paragraph the author added." in text and "References" in text and "Abstract" in text
    assert "1. Introduction" in text and "Invented source" not in text
    assert doc.metadata["author"] == "Ada Lovelace"
    assert "1 of" in doc[1].get_text()  # page numbers after the cover
    assert doc[0].get_text().count(" of ") == 0  # the cover has none
    refs_page = doc[-1]
    links = {link.get("uri") for link in refs_page.get_links()}
    assert links and links <= {r["url"] for r in content["references"]}  # clickable, exact URLs
    assert content["references"][0]["url"] in refs_page.get_text().replace("\n", "")  # copies as the real URL

    old = client.get(f"/research/documents/{doc_id}/pdf?version=1", headers=bearer(token))
    old_text = unicodedata.normalize("NFKC", " ".join(p.get_text() for p in fitz.open(stream=old.content, filetype="pdf")))
    assert content["title"] in old_text.replace("\n", " ")


def test_pdf_is_kept_in_private_storage_and_served_again(client, token, engine, writer, monkeypatch):
    from test_storage import FakeBucket
    bucket = FakeBucket()
    monkeypatch.setenv("SUPABASE_URL", "https://example-project.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_TEST")
    monkeypatch.setenv("SUPABASE_STORAGE_BUCKET", "cognexa-papers")
    monkeypatch.setattr(storage, "_bucket", lambda: bucket)
    renders = []
    real_render = research_pdf.render_pdf
    monkeypatch.setattr(research_pdf, "render_pdf", lambda c: renders.append(1) or real_render(c))

    doc_id = run(client, token, "full")["document"]["id"]
    uid = client.get("/auth/me", headers=bearer(token)).json()["id"]
    first = client.get(f"/research/documents/{doc_id}/pdf", headers=bearer(token))
    second = client.get(f"/research/documents/{doc_id}/pdf", headers=bearer(token))
    assert first.status_code == second.status_code == 200
    assert first.content == second.content and len(renders) == 1  # the second download comes from storage
    assert list(bucket.objects) == [f"{uid}/research-papers/{doc_id}/v1.pdf"]
    with SessionLocal() as db:
        d = db.get(models.ResearchDocument, doc_id)
        assert d.pdf_path == f"{uid}/research-papers/{doc_id}/v1.pdf" and d.pdf_version == 1
    assert client.get(f"/research/documents/{doc_id}", headers=bearer(token)).json()["pdf"] == {"version": 1, "stored": True}


# ───────── threads and History ─────────

def test_follow_up_joins_the_thread_and_history_restores_it(client, token, engine, writer):
    first = run(client, token, "full")
    tid = first["thread_id"]
    assert tid == first["session_id"]
    follow = run(client, token, "quick", question="What about the effect in older adults?", thread_id=tid)
    assert follow["thread_id"] == tid
    assert follow["research_question"] == "What about the effect in older adults?"
    assert QUESTION in engine.plan_questions[-1]  # researched in the context of the first question

    threads = client.get("/research/threads", headers=bearer(token)).json()
    assert len(threads) == 1
    t = threads[0]
    assert t["thread_id"] == tid and t["title"] == QUESTION and t["turns"] == 2
    assert t["output_format"] == "full" and t["modes"] == ["full", "quick"]
    assert t["has_paper"] is True and t["paper_edited"] is False and t["document_id"] == first["document"]["id"]

    doc_id = first["document"]["id"]
    content = client.get(f"/research/documents/{doc_id}", headers=bearer(token)).json()["content"]
    client.put(f"/research/documents/{doc_id}", json={"content": {**content, "title": "Edited"}, "base_version": 1}, headers=bearer(token))
    assert client.get("/research/threads", headers=bearer(token)).json()[0]["paper_edited"] is True

    thread = client.get(f"/research/threads/{tid}", headers=bearer(token)).json()
    assert [x["research_question"] for x in thread["turns"]] == [QUESTION, "What about the effect in older adults?"]
    assert thread["turns"][0]["document"]["edited"] is True
    assert_no_internals(thread)

    sessions = client.get("/research/sessions", headers=bearer(token)).json()
    assert {s["thread_id"] for s in sessions} == {tid}
    assert any(s["has_paper"] and s["paper_edited"] for s in sessions)


def test_older_sessions_without_a_thread_still_open(client, token):
    uid = client.get("/auth/me", headers=bearer(token)).json()["id"]
    with SessionLocal() as db:
        s = models.ResearchSession(user_id=uid, question="An older question from before threads", title="x",
                                   output_format="full", status="ready", report="## Old report\nText [E1].",
                                   hypotheses=[{"id": "H1"}], evidence_log=[], critique={}, stats={})
        db.add(s)
        db.commit()
        sid = s.id
    threads = client.get("/research/threads", headers=bearer(token)).json()
    assert [t["thread_id"] for t in threads] == [sid]
    turn = client.get(f"/research/threads/{sid}", headers=bearer(token)).json()["turns"][0]
    assert turn["report"].startswith("## Old report") and turn["progress"]["stages"]["preparing"] == "completed"
    assert_no_internals(turn)


# ───────── ownership ─────────

def test_other_users_get_nothing(client, token, engine, writer):
    data = run(client, token, "full")
    doc_id, sid, tid = data["document"]["id"], data["session_id"], data["thread_id"]
    other = register(client, email="other@example.com").json()["access_token"]
    for path in (f"/research/runs/{sid}", f"/research/threads/{tid}", f"/research/documents/{doc_id}",
                 f"/research/documents/{doc_id}/pdf"):
        assert client.get(path, headers=bearer(other)).status_code == 404, path
    assert client.put(f"/research/documents/{doc_id}", json={"content": {}, "base_version": 1}, headers=bearer(other)).status_code == 404
    assert client.post(f"/research/sessions/{sid}/paper", headers=bearer(other)).status_code == 404
    assert start(client, other, "quick", thread_id=tid).status_code == 404  # can't post into someone else's thread
    assert client.get("/research/threads", headers=bearer(other)).json() == []
    assert client.get(f"/research/documents/{doc_id}").status_code == 401


# ───────── failures ─────────

def test_invalid_question_fails_clearly(client, token, engine, writer):
    engine.fail_plan = HTTPException(status_code=400, detail="Invalid research question: too vague")
    data = run(client, token, "full")
    assert data["status"] == "failed"
    assert data["error"] == "Invalid research question: too vague"
    assert data["progress"]["stages"]["understanding"] == "in_progress" and data["document"] is None
    assert client.post("/research/runs", json={"question": "short", "output_format": "quick"}, headers=bearer(token)).status_code == 400
    assert client.post("/research/runs", json={"question": QUESTION, "output_format": "pdf"}, headers=bearer(token)).status_code == 400


def test_paper_failure_keeps_the_answer_and_can_be_retried(client, token, engine, writer):
    writer.fail = RuntimeError("model down")
    data = run(client, token, "full")
    assert data["status"] in ("ready", "review", "partial") and data["evidence_log"]  # the research itself is kept
    assert data["document"]["status"] == "failed" and data["document"]["error"]
    writer.fail = None
    r = client.post(f"/research/sessions/{data['session_id']}/paper", headers=bearer(token))
    assert r.status_code == 202 and r.json()["status"] == "ready"
    # A ready paper is never overwritten by another request
    again = client.post(f"/research/sessions/{data['session_id']}/paper", headers=bearer(token)).json()
    assert again["id"] == r.json()["id"] and again["current_version"] == 1


def test_quick_sessions_get_no_artificial_paper(client, token, engine, writer):
    sid = run(client, token, "quick")["session_id"]
    assert client.post(f"/research/sessions/{sid}/paper", headers=bearer(token)).status_code == 400


def test_interrupted_run_is_reported_not_left_spinning(client, token):
    uid = client.get("/auth/me", headers=bearer(token)).json()["id"]
    old = (datetime.datetime.utcnow() - datetime.timedelta(hours=2)).isoformat()
    with SessionLocal() as db:
        s = models.ResearchSession(user_id=uid, question=QUESTION, title=QUESTION, output_format="quick", status="in_progress",
                                   progress={**research_api._initial_progress("quick"), "updated_at": old})
        db.add(s)
        db.commit()
        sid = s.id
    data = client.get(f"/research/runs/{sid}", headers=bearer(token)).json()
    assert data["status"] == "failed" and "interrupted" in data["error"]


# ───────── the engine hooks (defaults unchanged) ─────────

def test_engine_reports_stages_in_order_and_respects_round_limit(engine):
    seen = []
    result = research.run_research(QUESTION, output_format="quick", on_stage=seen.append, max_rounds=1, db=SessionLocal())
    assert result["rounds_used"] == 1
    order = [s for i, s in enumerate(seen) if i == 0 or seen[i - 1] != s]
    assert order == ["understanding", "discovering", "gathering", "evaluating", "comparing", "preparing"]

    engine.searches.clear()
    engine.round = 0
    result = research.run_research(QUESTION + " again", output_format="quick", db=SessionLocal())
    assert result["rounds_used"] == research.MAX_ROUNDS  # without the new arguments: the same 3 rounds as before


def test_a_failing_progress_callback_never_breaks_research(engine):
    def boom(stage):
        raise RuntimeError("progress store down")
    assert research.run_research(QUESTION, output_format="quick", on_stage=boom, max_rounds=1, db=SessionLocal())["report"]


# ───────── pure helpers ─────────

def test_citation_numbering_and_merging():
    ev = [{"id": "E1", "source_url": "https://a.org/x", "source_title": "A"},
          {"id": "E2", "source_url": "https://a.org/x#frag", "source_title": "A again"},
          {"id": "E3", "source_url": "https://b.org/y", "source_title": "B"}]
    sections, refs, check = research_paper.finalize_citations(
        [{"heading": "H", "level": 1, "body": "One [E3]. Two [E1][E2]. Three [E1, E3] and [E3], [E1]. Bad [E9]."}], ev)
    assert sections[0]["body"] == "One [1]. Two [2]. Three [1, 2] and [1, 2]. Bad."
    assert [(r["n"], r["url"]) for r in refs] == [(1, "https://b.org/y"), (2, "https://a.org/x")]
    assert refs[1]["evidence_ids"] == ["E1", "E2"] and check["removed_ids"] == ["E9"]


def test_new_gemini_schemas_work_with_the_developer_api():
    from google.genai import _transformers as sdk_transformers
    from test_gemini_schemas import DeveloperApiClient, _paths_with
    for schema in research_paper.GEMINI_SCHEMAS:
        assert _paths_with(schema.model_json_schema(), "additionalProperties") == []
        converted = sdk_transformers.t_schema(DeveloperApiClient(), schema)
        assert _paths_with(converted.model_dump(exclude_none=True), "additional_properties") == []


def test_pdf_renders_unicode_titles_and_long_urls():
    content = {"title": "Ünïcödé — “quoted” ≥ 5 % title", "author": "", "date": "2026-11-17", "question": "Q?",
               "abstract": "Abstract text.", "keywords": [], "sections": [
                   {"id": "a", "level": 1, "heading": "Intro", "body": "Para **bold** and *italic*.\n\n- item one\n- item two"}],
               "references": [{"n": 1, "title": "T", "site": "x.org", "url": "https://x.org/" + "very-long-path/" * 12, "accessed": "2026-11-17"}]}
    doc = fitz.open(stream=research_pdf.render_pdf(content), filetype="pdf")
    text = "".join(p.get_text() for p in doc)
    assert "Ünïcödé" in text and "≥" in text and "item two" in text
    for page in doc:  # nothing runs off the page
        for b in page.get_text("blocks"):
            assert b[2] <= page.rect.width - 40


# ───────── regressions: mode actions, propagation, History, timing, internal vocabulary ─────────

def act(client, token, based_on, mode):
    """The answer's mode buttons: structured request data, not a typed instruction."""
    r = client.post("/research/runs", json={"based_on": based_on, "output_format": mode}, headers=bearer(token))
    assert r.status_code == 202, r.text
    return client.get(f"/research/runs/{r.json()['session_id']}", headers=bearer(token)).json()


def test_detailed_analysis_selected_from_a_quick_answer(client, token, engine, writer):
    quick = run(client, token, "quick")
    detailed = act(client, token, quick["session_id"], "detailed")
    # the same question, researched again in depth, in the same conversation
    assert detailed["output_format"] == "detailed" and detailed["research_question"] == QUESTION
    assert detailed["thread_id"] == quick["thread_id"] and detailed["based_on"] == quick["session_id"]
    assert engine.plan_questions[-1] == QUESTION  # the engine got the question, not "give detailed analysis"
    assert "## Key Findings" in detailed["report"] and words(detailed["report"]) >= research_paper.DETAILED_MIN_WORDS
    with SessionLocal() as db:
        row = db.get(models.ResearchSession, detailed["session_id"])
        assert row.output_format == "detailed" and row.progress["mode"] == "detailed"  # persisted on that session
    thread = client.get(f"/research/threads/{quick['thread_id']}", headers=bearer(token)).json()
    assert [t["output_format"] for t in thread["turns"]] == ["quick", "detailed"]  # not labelled Quick Answer
    assert_no_internals(thread)


def test_research_paper_selected_from_an_existing_investigation(client, token, engine, writer, monkeypatch):
    from test_storage import FakeBucket
    bucket = FakeBucket()
    monkeypatch.setenv("SUPABASE_URL", "https://example-project.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_TEST")
    monkeypatch.setenv("SUPABASE_STORAGE_BUCKET", "cognexa-papers")
    monkeypatch.setattr(storage, "_bucket", lambda: bucket)
    uid = client.get("/auth/me", headers=bearer(token)).json()["id"]

    detailed = run(client, token, "detailed")
    writer.prompts.clear()
    paper_run = act(client, token, detailed["session_id"], "full")
    assert paper_run["output_format"] == "full" and paper_run["research_question"] == QUESTION
    assert paper_run["report"] is None  # no short answer in front of the paper
    doc = paper_run["document"]
    assert doc["status"] == "ready" and doc["current_version"] == 1 and doc["pdf_stored"] is True
    # the generated original's PDF is rendered and kept in private storage when the paper is written
    assert list(bucket.objects) == [f"{uid}/research-papers/{doc['id']}/v1.pdf"]
    assert bucket.objects[f"{uid}/research-papers/{doc['id']}/v1.pdf"].startswith(b"%PDF")
    with SessionLocal() as db:
        d = db.get(models.ResearchDocument, doc["id"])
        assert (d.pdf_version, d.current_version) == (1, 1)
        versions = db.query(models.ResearchDocumentVersion).filter_by(document_id=doc["id"]).all()
        assert [(v.version, v.source) for v in versions] == [(1, "generated")]
    assert all(f"RESEARCH QUESTION: {QUESTION}\n" in p for p in writer.prompts[:6])  # the paper is about the question itself

    # reopened and edited like any paper; the edit gets its own PDF
    paper = client.get(f"/research/documents/{doc['id']}", headers=bearer(token)).json()
    assert paper["content"]["question"] == QUESTION
    edited = {**paper["content"], "title": "An Edited Title"}
    saved = client.put(f"/research/documents/{doc['id']}", json={"content": edited, "base_version": 1}, headers=bearer(token)).json()
    assert saved["current_version"] == 2 and saved["edited"] is True
    assert client.get(f"/research/documents/{doc['id']}/pdf", headers=bearer(token)).status_code == 200
    assert f"{uid}/research-papers/{doc['id']}/v2.pdf" in bucket.objects

    threads = client.get("/research/threads", headers=bearer(token)).json()
    t = next(x for x in threads if x["thread_id"] == detailed["thread_id"])
    assert t["modes"] == ["detailed", "full"] and t["latest_mode"] == "full" and t["has_paper"] and t["paper_edited"]


def test_output_format_reaches_the_backend_as_request_data(client, token, engine, writer):
    for mode in ("quick", "detailed", "full"):
        data = run(client, token, mode, question=f"{QUESTION} ({mode})")
        with SessionLocal() as db:
            assert db.get(models.ResearchSession, data["session_id"]).output_format == mode
        assert data["output_format"] == mode
    sessions = client.get("/research/sessions", headers=bearer(token)).json()
    assert sorted(s["output_format"] for s in sessions) == ["detailed", "full", "quick"]
    threads = client.get("/research/threads", headers=bearer(token)).json()
    assert sorted(t["output_format"] for t in threads) == ["detailed", "full", "quick"]
    # a mode action only accepts the user's own sessions
    other = register(client, email="someone@example.com").json()["access_token"]
    assert client.post("/research/runs", json={"based_on": sessions[0]["id"], "output_format": "full"},
                       headers=bearer(other)).status_code == 404


def test_a_run_reads_as_in_progress_until_its_answer_is_written(client, token, engine, writer, monkeypatch):
    """The engine saves its own status and short answer first; nobody may see that as the result."""
    seen = []
    real = research_paper.write_detailed_analysis

    def spy(question, result):
        with SessionLocal() as db:
            row = db.query(models.ResearchSession).order_by(models.ResearchSession.created_at.desc()).first()
            seen.append(research_api.public_session(row, None))
        return real(question, result)

    monkeypatch.setattr(research_paper, "write_detailed_analysis", spy)
    data = run(client, token, "detailed")
    mid = seen[0]
    assert mid["status"] == "in_progress" and mid["report"] is None and mid["output_format"] == "detailed"
    assert mid["progress"]["finished_at"] is None
    assert data["status"] != "in_progress" and data["progress"]["finished_at"]


def test_working_flow_duration_comes_from_the_run_itself(client, token, engine, writer):
    before = datetime.datetime.now(datetime.timezone.utc)
    data = run(client, token, "quick")
    after = datetime.datetime.now(datetime.timezone.utc)
    p = data["progress"]
    assert p["started_at"].endswith("Z") and p["finished_at"].endswith("Z")  # explicit UTC: no local-time shift
    start = datetime.datetime.fromisoformat(p["started_at"].replace("Z", "+00:00"))
    end = datetime.datetime.fromisoformat(p["finished_at"].replace("Z", "+00:00"))
    assert before - datetime.timedelta(seconds=1) <= start <= end <= after + datetime.timedelta(seconds=1)
    assert data["stats"]["duration_seconds"] == pytest.approx((end - start).total_seconds(), abs=0.2)
    assert data["created_at"].endswith("Z") and data["updated_at"].endswith("Z")
    # an old conversation date does not change a run's duration
    with SessionLocal() as db:
        row = db.get(models.ResearchSession, data["session_id"])
        row.created_at = row.created_at - datetime.timedelta(days=3)
        db.commit()
    again = client.get(f"/research/runs/{data['session_id']}", headers=bearer(token)).json()
    assert again["stats"]["duration_seconds"] == data["stats"]["duration_seconds"]
    # a run without its own finish time shows no duration rather than a misleading one
    assert research_api._run_seconds({"started_at": p["started_at"]}) is None


ENGINE_STYLE_REPORT = """### Direct Answer
Yes, evidence points to a replication crisis [E1][E3].

### Core Verdict
The evidence strongly supports the existence of a replication crisis. No counter-evidence was found for several hypotheses.

### Findings by Hypothesis
- **[H1] (insufficient) Studies suffer from low replication rates.** This hypothesis is supported by sources [E2].
- **[H2] (untested) Methods improved.** Untested.

### Limitations
Several sources have lower weights (0.3). Large surveys may overstate the problem [E4]."""


def test_saved_engine_style_answers_are_shown_without_internal_terms(client, token):
    uid = client.get("/auth/me", headers=bearer(token)).json()["id"]
    with SessionLocal() as db:
        s = models.ResearchSession(user_id=uid, question="Is there a replication crisis in psychology?", title="x",
                                   output_format="quick", status="ready", report=ENGINE_STYLE_REPORT,
                                   hypotheses=[], evidence_log=[], critique={}, stats={})
        db.add(s)
        db.commit()
        sid = s.id
    report = client.get(f"/research/runs/{sid}", headers=bearer(token)).json()["report"]
    assert report.startswith("### Answer\nYes, evidence points to a replication crisis [E1][E3].")
    assert "Large surveys may overstate the problem [E4]." in report  # real content stays
    for phrase in ("Core Verdict", "Findings by Hypothesis", "hypothes", "insufficient", "untested", "[H1]", "weights"):
        assert phrase.lower() not in report.lower(), phrase


def test_answers_written_for_the_reader_keep_topic_words(client, token, engine, writer, monkeypatch):
    monkeypatch.setattr(research_paper, "write_quick_answer",
                        lambda q, r: "The amyloid hypothesis remains contested [E1].\n\n## Key evidence\n- A trial found no benefit [E2].")
    data = run(client, token, "quick")
    assert "The amyloid hypothesis remains contested [E1]." in data["report"]  # a topic, not an internal label
