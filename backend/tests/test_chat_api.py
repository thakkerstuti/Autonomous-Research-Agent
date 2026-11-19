"""Session chat endpoints: history (owner only) and the streamed answer (SSE), with saving after the
answer completes. Gemini and Tavily are fakes; no API key, no network."""
import json
from types import SimpleNamespace

import pytest

from app import models, session_chat
from app.database import SessionLocal
from conftest import bearer, register
from test_session_chat import FakeModels, api_error, plan_response

QUESTION = "Does spaced practice improve long-term memory in adults?"


# ───────── helpers ─────────

def parse_sse(body: str) -> list[tuple[str, dict]]:
    events = []
    for block in body.strip().split("\n\n"):
        name, data = None, None
        for line in block.split("\n"):
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
        if name:
            events.append((name, data))
    return events


class Fakes:
    def __init__(self, monkeypatch):
        self.models = FakeModels(
            plans={"m1": plan_response(standalone_query="Does spacing help adults remember?", needs_web_search=False)},
            streams={"m1": ["Spacing improves ", "delayed recall [1]", ". A bogus citation [99]."]},
        )
        self.searches = []
        self.search_results = [{"title": "Older adults trial", "url": "https://news.example.com/older", "content": "Spacing helped adults over 65."}]
        monkeypatch.setenv("LLM_MOCK", "0")
        monkeypatch.setattr(session_chat, "_client", lambda client=None: SimpleNamespace(models=self.models))
        monkeypatch.setattr(session_chat, "_models", lambda models=None: ["m1", "m2"])
        monkeypatch.setattr(session_chat, "_sleep", lambda s: None)
        import app.search
        monkeypatch.setattr(app.search, "search_web", self.search)

    def search(self, query, max_results=5):
        self.searches.append(query)
        return self.search_results

    def plan(self, **fields):
        self.models.plans["m1"] = plan_response(**fields)


@pytest.fixture
def fakes(monkeypatch):
    return Fakes(monkeypatch)


@pytest.fixture
def token(client):
    return register(client, email="chatter@example.com").json()["access_token"]


def user_id(client, token_):
    return client.get("/auth/me", headers=bearer(token_)).json()["id"]


def make_session(uid, status="ready", with_paper=False, progress=None):
    with SessionLocal() as db:
        s = models.ResearchSession(
            user_id=uid, question=QUESTION, title=QUESTION, output_format="full" if with_paper else "quick", status=status,
            report="Spacing improves delayed recall in adults [E1].",
            evidence_log=[{"id": "E1", "source_url": "https://journal1.example.org/study", "source_title": "Trial of spacing",
                           "quote": "spaced practice improved delayed recall", "snippet": "spaced practice improved delayed recall",
                           "stance": "supports", "weight": 1.0}],
            hypotheses=[{"id": "H1", "statement": "SECRET-HYPOTHESIS"}], critique={}, stats={},
            progress=progress or {"answer_written": True},
        )
        db.add(s)
        db.flush()
        s.thread_id = s.id
        if with_paper:
            d = models.ResearchDocument(session_id=s.id, user_id=uid, title="Spacing review", status="ready", current_version=1, edited=False)
            db.add(d)
            db.flush()
            db.add(models.ResearchDocumentVersion(document_id=d.id, version=1, source="generated", content={
                "title": "Spacing review", "abstract": "PAPER-ABSTRACT-MARKER: spacing improves recall [1].",
                "sections": [{"id": "a", "level": 1, "heading": "Findings", "body": "Recall improved [1]."}],
                "references": [{"n": 1, "title": "Trial of spacing", "url": "https://journal1.example.org/study"}]}))
        db.commit()
        return s.id


def chat(client, token_, sid, message="What about older adults?"):
    r = client.post(f"/research/sessions/{sid}/chat", json={"message": message}, headers=bearer(token_))
    return r, parse_sse(r.text) if r.status_code == 200 else []


# ───────── history ─────────

def test_history_is_empty_then_owner_only(client, token):
    sid = make_session(user_id(client, token))
    assert client.get(f"/research/sessions/{sid}/messages", headers=bearer(token)).json() == []
    other = register(client, email="other@example.com").json()["access_token"]
    assert client.get(f"/research/sessions/{sid}/messages", headers=bearer(other)).status_code == 404
    assert client.get(f"/research/sessions/{sid}/messages").status_code == 401


# ───────── the streamed answer ─────────

def test_answer_streams_as_sse_and_both_messages_are_saved(client, token, fakes):
    sid = make_session(user_id(client, token))
    r, events = chat(client, token, sid)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    assert "no-cache" in r.headers["cache-control"]
    names = [n for n, _ in events]
    assert names[0] == "status" and names[-1] == "done"
    assert names.index("sources") < names.index("delta") < names.index("done")
    assert [d["stage"] for n, d in events if n == "status"] == ["thinking", "writing"]  # no web search needed
    streamed = "".join(d["text"] for n, d in events if n == "delta")
    assert "[99]" not in streamed and "[1]" in streamed

    done = events[-1][1]
    assert done["user_message"]["role"] == "user" and done["user_message"]["content"] == "What about older adults?"
    answer = done["assistant_message"]
    assert answer["role"] == "assistant" and answer["content"] == "Spacing improves delayed recall [1]. A bogus citation."
    assert [s["n"] for s in answer["sources"]] == [1] and answer["sources"][0]["url"] == "https://journal1.example.org/study"
    assert answer["used_web_search"] is False and fakes.searches == []

    history = client.get(f"/research/sessions/{sid}/messages", headers=bearer(token)).json()
    assert [(m["role"], m["content"]) for m in history] == [("user", "What about older adults?"), ("assistant", answer["content"])]
    assert history[0]["created_at"].endswith("Z")


def test_web_search_when_the_session_is_not_enough(client, token, fakes):
    sid = make_session(user_id(client, token))
    fakes.plan(standalone_query="Does spacing help adults over 65?", needs_web_search=True, search_query="spacing older adults")
    fakes.models.streams["m1"] = ["Older adults benefit too [2], as in the original research [1]."]
    r, events = chat(client, token, sid)
    assert [d["stage"] for n, d in events if n == "status"] == ["thinking", "searching", "writing"]
    assert fakes.searches == ["spacing older adults"]
    sources = next(d for n, d in events if n == "sources")
    assert sources["used_web_search"] is True
    assert [(s["n"], s["origin"]) for s in sources["sources"]] == [(1, "research"), (2, "web")]
    saved = events[-1][1]["assistant_message"]
    assert saved["used_web_search"] is True and [s["origin"] for s in saved["sources"]] == ["research", "web"]


def test_context_sent_to_gemini_includes_history_and_paper_but_no_internals(client, token, monkeypatch, fakes):
    prompts = []
    real = session_chat.build_answer_prompt
    monkeypatch.setattr(session_chat, "build_answer_prompt", lambda ctx, plan, sources: prompts.append(real(ctx, plan, sources)) or prompts[-1])
    sid = make_session(user_id(client, token), with_paper=True)
    chat(client, token, sid, "First question about spacing")
    chat(client, token, sid, "And does it last?")
    last = prompts[-1]
    # earlier answers appear without their own citation numbers (each answer numbers its sources afresh)
    assert "User: First question about spacing" in last and "Assistant: Spacing improves delayed recall. A bogus citation." in last
    assert "PAPER-ABSTRACT-MARKER" in last and f"Research question: {QUESTION}" in last
    assert "SECRET-HYPOTHESIS" not in last
    assert len(fakes.models.plan_calls) == 2  # one rewrite + search decision call per message
    history = client.get(f"/research/sessions/{sid}/messages", headers=bearer(token)).json()
    assert [m["content"] for m in history if m["role"] == "user"] == ["First question about spacing", "And does it last?"]


def test_recent_messages_go_in_full_and_earlier_questions_as_topics(client, token, monkeypatch, fakes):
    uid = user_id(client, token)
    sid = make_session(uid)
    import datetime
    base = datetime.datetime.utcnow() + datetime.timedelta(minutes=1)  # after the research run itself
    with SessionLocal() as db:
        for i in range(14):
            db.add(models.ChatMessage(session_id=sid, user_id=uid, role="user" if i % 2 == 0 else "assistant",
                                      content=f"old message {i:02d}", sources=[], used_web_search=False,
                                      created_at=base + datetime.timedelta(minutes=i)))
        db.commit()
    seen = []
    real = session_chat.build_context
    monkeypatch.setattr(session_chat, "build_context",
                        lambda *a, **k: seen.append((list(a[2]), list(k.get("earlier_topics", [])))) or real(*a, **k))
    chat(client, token, sid)
    recent, earlier = seen[0]
    assert [m.content for m in recent] == [f"old message {i:02d}" for i in range(4, 14)]
    # what came before: the research question that started the conversation, then the older questions
    assert earlier == [QUESTION, "old message 00", "old message 02"]


def test_one_conversation_spans_its_research_runs(client, token, monkeypatch, fakes):
    """A conversation (thread) can hold several research runs; chat on the latest still sees everything said."""
    uid = user_id(client, token)
    first = make_session(uid)
    chat(client, token, first, "Explain multi-agent AI systems.")
    second = make_session(uid)
    with SessionLocal() as db:  # a later research run in the same conversation (e.g. a research paper)
        db.get(models.ResearchSession, second).thread_id = first
        db.commit()
    seen = []
    real = session_chat.build_context
    monkeypatch.setattr(session_chat, "build_context", lambda *a, **k: seen.append(list(a[2])) or real(*a, **k))
    chat(client, token, second, "How is this different from autonomous AI?")
    contents = [m.content for m in seen[0]]
    assert "Explain multi-agent AI systems." in contents  # asked after the first run, visible after the second

    msgs = client.get(f"/research/threads/{first}/messages", headers=bearer(token)).json()
    assert [(m["role"], m["session_id"]) for m in msgs] == [("user", first), ("assistant", first), ("user", second), ("assistant", second)]
    assert msgs[2]["content"] == "How is this different from autonomous AI?"
    other = register(client, email="nosy@example.com").json()["access_token"]
    assert client.get(f"/research/threads/{first}/messages", headers=bearer(other)).status_code == 404


def test_a_topic_change_searches_the_web_and_leaves_the_research_aside(client, token, monkeypatch, fakes):
    sid = make_session(user_id(client, token))
    fakes.plan(relation="new_topic", standalone_query="Explain quantum computing.", needs_web_search=True,
               search_query="quantum computing explained")
    fakes.search_results = [{"title": "Quantum computing basics", "url": "https://physics.example.org/qc", "content": "Qubits."}]
    fakes.models.streams["m1"] = ["Quantum computers use qubits [1]."]
    prompts = []
    real = session_chat.build_answer_prompt
    monkeypatch.setattr(session_chat, "build_answer_prompt", lambda ctx, plan, sources: prompts.append(real(ctx, plan, sources)) or prompts[-1])
    r, events = chat(client, token, sid, "Okay, let's change the topic. Explain quantum computing.")
    sources = next(d for n, d in events if n == "sources")["sources"]
    assert [(s["n"], s["origin"]) for s in sources] == [(1, "web")] and fakes.searches == ["quantum computing explained"]
    assert "Spacing improves delayed recall" not in prompts[0].split("RECENT CONVERSATION")[0]
    assert "Research answer:" not in prompts[0]
    saved = events[-1][1]["assistant_message"]
    assert saved["content"] == "Quantum computers use qubits [1]." and saved["sources"][0]["url"] == "https://physics.example.org/qc"


# ───────── failures and validation ─────────

def test_a_failed_answer_reports_an_error_and_saves_nothing(client, token, fakes):
    sid = make_session(user_id(client, token))
    fakes.models.streams = {"m1": api_error(503), "m2": api_error(503)}
    r, events = chat(client, token, sid)
    assert r.status_code == 200 and events[-1][0] == "error"
    assert events[-1][1]["status"] == 503 and "isn't responding" in events[-1][1]["message"]
    assert "done" not in [n for n, _ in events]
    assert client.get(f"/research/sessions/{sid}/messages", headers=bearer(token)).json() == []


def test_unexpected_errors_do_not_leak_internals(client, token, monkeypatch, fakes):
    sid = make_session(user_id(client, token))
    monkeypatch.setattr(session_chat, "build_context", lambda *a: (_ for _ in ()).throw(RuntimeError("SECRET internal detail")))
    r, events = chat(client, token, sid)
    assert events[-1] == ("error", {"message": "Something went wrong while answering. Please try again.", "status": 500})
    assert "SECRET" not in r.text


def test_message_validation_ownership_and_unfinished_runs(client, token, fakes):
    uid = user_id(client, token)
    sid = make_session(uid)
    assert client.post(f"/research/sessions/{sid}/chat", json={"message": "   "}, headers=bearer(token)).status_code == 400
    assert client.post(f"/research/sessions/{sid}/chat", json={"message": "x" * 4001}, headers=bearer(token)).status_code == 400
    other = register(client, email="intruder@example.com").json()["access_token"]
    assert client.post(f"/research/sessions/{sid}/chat", json={"message": "hi there"}, headers=bearer(other)).status_code == 404
    assert client.post(f"/research/sessions/{sid}/chat", json={"message": "hi there"}).status_code == 401
    running = make_session(uid, status="in_progress", progress={"started_at": "2099-01-01T00:00:00", "updated_at": "2099-01-01T00:00:00"})
    assert client.post(f"/research/sessions/{running}/chat", json={"message": "hi there"}, headers=bearer(token)).status_code == 409
    assert fakes.models.plan_calls == []  # nothing reached the model


def test_deleting_a_session_removes_its_chat(client, token, fakes):
    """Messages belong to their session (ON DELETE CASCADE in PostgreSQL; checked here through the model's foreign key)."""
    table = models.ChatMessage.__table__
    fk = next(iter(table.c.session_id.foreign_keys))
    assert fk.column.table.name == "research_sessions" and fk.ondelete == "CASCADE"
