"""Adding a chat answer to a research paper (POST /research/documents/{id}/append-chat)."""
import datetime
import unicodedata

import fitz
import pytest

from app import models, research_paper, storage
from app.database import SessionLocal
from conftest import bearer, register

URL_A = "https://journal-a.example.org/trial"      # in the paper as [1]
URL_B = "https://journal-b.example.org/review"     # in the paper as [2]
URL_C = "https://news.example.com/new-finding"     # found by chat web search: not in the paper
URL_D = "https://journal-d.example.org/cohort"     # a research source the paper never cited
T0 = datetime.datetime(2026, 11, 20, 9, 30, 0)


@pytest.fixture
def token(client):
    return register(client, email="appender@example.com", name="Ada").json()["access_token"]


def uid_of(client, token_):
    return client.get("/auth/me", headers=bearer(token_)).json()["id"]


PAPER = {
    "schema": 1, "title": "Spacing and Memory", "author": "Ada", "date": "2026-11-19", "question": "Does spacing help?",
    "abstract": "Abstract text.", "keywords": ["spacing"],
    "sections": [{"id": "s1", "level": 1, "heading": "Introduction", "body": "Spacing helps [1]."},
                 {"id": "s2", "level": 1, "heading": "Conclusion", "body": "It works [1, 2]."}],
    "references": [{"n": 1, "title": "Trial A", "site": "journal-a.example.org", "url": URL_A, "accessed": "2026-11-19", "evidence_ids": ["E1"]},
                   {"n": 2, "title": "Review B", "site": "journal-b.example.org", "url": URL_B, "accessed": "2026-11-19", "evidence_ids": ["E2"]}],
    "checks": {"removed_ids": []},
}

ANSWER = ("Older adults also benefit [1].\n\n## What is new\n\n1. A 2026 report found larger effects [2].\n"
          "2. Reviews agree [1, 3].\n\nA wrong number [9] is dropped.")
SOURCES = [
    {"n": 1, "title": "Trial A", "url": URL_A, "excerpt": "", "origin": "research"},
    {"n": 2, "title": "New finding", "url": URL_C, "excerpt": "", "origin": "web"},
    {"n": 3, "title": "Review B", "url": URL_B, "excerpt": "", "origin": "research"},
]


def setup_paper(uid, status="ready", with_doc=True):
    with SessionLocal() as db:
        s = models.ResearchSession(user_id=uid, question="Does spacing help?", title="x", output_format="full", status="ready",
                                   report="r", evidence_log=[{"id": "E4", "source_url": URL_D, "retrieved_at": "2026-11-18T10:00:00+00:00"}],
                                   critique={}, stats={}, progress={})
        db.add(s)
        db.flush()
        s.thread_id = s.id
        doc_id = None
        if with_doc:
            d = models.ResearchDocument(session_id=s.id, user_id=uid, title=PAPER["title"], status=status,
                                        current_version=1 if status == "ready" else 0, edited=False)
            db.add(d)
            db.flush()
            if status == "ready":
                db.add(models.ResearchDocumentVersion(document_id=d.id, version=1, source="generated", content=PAPER))
            doc_id = d.id
        db.commit()
        return s.id, doc_id


def add_pair(uid, sid, question, answer, sources, at, used_web=True):
    with SessionLocal() as db:
        q = models.ChatMessage(session_id=sid, user_id=uid, role="user", content=question, sources=[], used_web_search=False, created_at=at)
        a = models.ChatMessage(session_id=sid, user_id=uid, role="assistant", content=answer, sources=sources,
                               used_web_search=used_web, created_at=at + datetime.timedelta(microseconds=1))
        db.add_all([q, a])
        db.commit()
        return q.id, a.id


def append(client, token_, doc_id, message_id, base=1):
    return client.post(f"/research/documents/{doc_id}/append-chat", json={"message_id": message_id, "base_version": base},
                       headers=bearer(token_))


# ───────── the happy path ─────────

def test_answer_is_appended_as_a_new_version_with_citations_mapped_to_the_references(client, token):
    uid = uid_of(client, token)
    sid, doc = setup_paper(uid)
    _, aid = add_pair(uid, sid, "What about older adults?", ANSWER, SOURCES, T0)
    r = append(client, token, doc, aid)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["already_added"] is False and out["current_version"] == 2 and out["edited"] is True
    assert [(v["version"], v["source"]) for v in out["versions"]] == [(1, "generated"), (2, "chat")]

    c = out["content"]
    assert c["sections"][:2] == PAPER["sections"]  # existing content untouched
    new = c["sections"][-1]
    assert new["heading"] == "Follow-up: What about older adults?" and new["level"] == 1
    # [1] -> existing ref 1, [3] (Review B) -> existing ref 2, [2] (web) -> new ref 3, [9] removed
    assert "Older adults also benefit [1]." in new["body"]
    assert "- A 2026 report found larger effects [3]." in new["body"]
    assert "- Reviews agree [1, 2]." in new["body"]
    assert "A wrong number is dropped." in new["body"] and "[9]" not in new["body"]
    assert "**What is new**" in new["body"] and "##" not in new["body"]  # Markdown heading -> the paper's bold line

    refs = c["references"]
    assert [r["n"] for r in refs] == [1, 2, 3] and refs[:2] == PAPER["references"]  # reused, not duplicated
    web = refs[2]
    assert web == {"n": 3, "title": "New finding", "site": "news.example.com", "url": URL_C, "accessed": "2026-11-20",
                   "source_type": "web", "evidence_ids": [], "added_from": "chat"}
    assert out["appended"] == {"references_reused": [1, 2], "references_added": [3]}
    assert c["chat_appends"] == [aid]

    # the stored version is the source of truth, and version 1 is unchanged
    v1 = client.get(f"/research/documents/{doc}?version=1", headers=bearer(token)).json()["content"]
    assert v1 == PAPER


def test_the_question_is_the_one_directly_before_the_answer(client, token):
    uid = uid_of(client, token)
    sid, doc = setup_paper(uid)
    add_pair(uid, sid, "First question?", "First answer [1].", SOURCES, T0)
    _, second = add_pair(uid, sid, "Second question?", "Second answer [1].", SOURCES, T0 + datetime.timedelta(minutes=5))
    c = append(client, token, doc, second).json()["content"]
    assert c["sections"][-1]["heading"] == "Follow-up: Second question?"
    assert c["sections"][-1]["body"] == "Second answer [1]."


def test_a_research_source_new_to_the_paper_keeps_its_research_retrieval_date(client, token):
    uid = uid_of(client, token)
    sid, doc = setup_paper(uid)
    _, aid = add_pair(uid, sid, "And cohort studies?", "A cohort agrees [1].",
                      [{"n": 1, "title": "Cohort D", "url": URL_D, "excerpt": "", "origin": "research"}], T0)
    ref = append(client, token, doc, aid).json()["content"]["references"][-1]
    assert ref["url"] == URL_D and ref["accessed"] == "2026-11-18" and ref["added_from"] == "chat" and ref["source_type"] == ""


# ───────── safety: ownership, pairing, versions, retries ─────────

def test_inaccessible_documents_and_messages_are_not_found(client, token):
    uid = uid_of(client, token)
    sid, doc = setup_paper(uid)
    qid, aid = add_pair(uid, sid, "Q?", "A [1].", SOURCES, T0)
    assert append(client, token, doc, qid).status_code == 404  # a question is not an answer
    assert append(client, token, doc, "no-such-message").status_code == 404
    other_sid, other_doc = setup_paper(uid)  # another paper of the same user
    _, other_aid = add_pair(uid, other_sid, "Q2?", "A2 [1].", SOURCES, T0)
    assert append(client, token, doc, other_aid).status_code == 404  # an answer from another session

    intruder = register(client, email="intruder@example.com").json()["access_token"]
    assert append(client, intruder, doc, aid).status_code == 404
    iuid = uid_of(client, intruder)
    isid, idoc = setup_paper(iuid)
    assert append(client, token, idoc, aid).status_code == 404  # someone else's paper
    assert client.post(f"/research/documents/{doc}/append-chat", json={"message_id": aid, "base_version": 1}).status_code == 401


def test_an_answer_without_its_question_cannot_be_added(client, token):
    uid = uid_of(client, token)
    sid, doc = setup_paper(uid)
    with SessionLocal() as db:
        a = models.ChatMessage(session_id=sid, user_id=uid, role="assistant", content="Orphan [1].", sources=SOURCES,
                               used_web_search=False, created_at=T0)
        db.add(a)
        db.commit()
        orphan = a.id
    assert append(client, token, doc, orphan).status_code == 409


def test_papers_that_are_not_ready_are_refused(client, token):
    uid = uid_of(client, token)
    sid, doc = setup_paper(uid, status="generating")
    _, aid = add_pair(uid, sid, "Q?", "A.", [], T0)
    assert append(client, token, doc, aid, base=0).status_code == 409


def test_a_stale_version_is_refused(client, token):
    uid = uid_of(client, token)
    sid, doc = setup_paper(uid)
    _, aid = add_pair(uid, sid, "Q?", "A [1].", SOURCES, T0)
    edited = {**PAPER, "title": "Edited title"}
    assert client.put(f"/research/documents/{doc}", json={"content": edited, "base_version": 1}, headers=bearer(token)).status_code == 200
    r = append(client, token, doc, aid, base=1)
    assert r.status_code == 409 and "changed" in r.json()["detail"]
    assert append(client, token, doc, aid, base=2).json()["current_version"] == 3


def test_adding_the_same_answer_again_never_appends_twice(client, token):
    uid = uid_of(client, token)
    sid, doc = setup_paper(uid)
    _, aid = add_pair(uid, sid, "Q?", "A [1].", SOURCES, T0)
    assert append(client, token, doc, aid).json()["current_version"] == 2
    again = append(client, token, doc, aid, base=1)  # a retry with the old base version
    assert again.status_code == 200 and again.json()["already_added"] is True and again.json()["current_version"] == 2
    assert sum(1 for s in again.json()["content"]["sections"] if s["heading"].startswith("Follow-up")) == 1

    # still recognised after the user edits and saves the paper
    content = again.json()["content"]
    saved = client.put(f"/research/documents/{doc}", json={"content": {**content, "title": "Renamed"}, "base_version": 2},
                       headers=bearer(token)).json()
    assert saved["content"]["chat_appends"] == [aid]
    assert append(client, token, doc, aid, base=3).json()["already_added"] is True


# ───────── the PDF follows the new version ─────────

def test_the_pdf_is_of_the_new_version_not_an_older_stored_one(client, token, monkeypatch):
    from test_storage import FakeBucket
    bucket = FakeBucket()
    monkeypatch.setenv("SUPABASE_URL", "https://example-project.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_TEST")
    monkeypatch.setenv("SUPABASE_STORAGE_BUCKET", "cognexa-papers")
    monkeypatch.setattr(storage, "_bucket", lambda: bucket)
    uid = uid_of(client, token)
    sid, doc = setup_paper(uid)
    assert client.get(f"/research/documents/{doc}/pdf", headers=bearer(token)).status_code == 200  # v1's PDF is stored
    assert client.get(f"/research/documents/{doc}", headers=bearer(token)).json()["pdf_stored"] is True

    _, aid = add_pair(uid, sid, "What about older adults?", ANSWER, SOURCES, T0)
    out = append(client, token, doc, aid).json()
    assert out["pdf"]["stored"] is False and out["pdf_stored"] is False  # v1's PDF no longer counts as the paper's

    pdf = client.get(f"/research/documents/{doc}/pdf", headers=bearer(token))
    text = unicodedata.normalize("NFKC", " ".join(p.get_text() for p in fitz.open(stream=pdf.content, filetype="pdf")))
    assert "Follow-up: What about older adults?" in text.replace("\n", " ") and URL_C in text.replace("\n", "")
    assert f"{uid}/research-papers/{doc}/v2.pdf" in bucket.objects
    assert client.get(f"/research/documents/{doc}", headers=bearer(token)).json()["pdf"] == {"version": 2, "stored": True}


# ───────── the content conversion on its own ─────────

def test_chat_markdown_becomes_the_paper_body_format():
    body = research_paper._chat_markdown_to_body(
        "Intro **bold**.\n\n### Details\n* one\n+ two\n3) three\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```python\nx = 1\n```")
    assert body == "Intro **bold**.\n\n**Details**\n\n- one\n- two\n- three\n\n- A · B\n- 1 · 2\n\nx = 1"
