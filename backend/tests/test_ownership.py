"""Protected APIs: anonymous callers get 401, and user B can never read or
change user A's papers or research (it looks like it doesn't exist: 404)."""
import fitz
import pytest

from app import main, models, tasks
from app.database import SessionLocal
from conftest import bearer, new_client, register

PROTECTED = [
    ("get", "/papers"), ("post", "/papers"), ("get", "/papers/x"), ("patch", "/papers/x"),
    ("get", "/papers/x/file"), ("get", "/papers/x/pages"), ("get", "/papers/x/pages/1"),
    ("post", "/papers/x/pages/1/regenerate"), ("get", "/papers/x/progress"),
    ("get", "/papers/x/status"), ("post", "/papers/x/retry-failed"),
    ("post", "/research"), ("get", "/research/sessions"), ("get", "/research/sessions/x"),
    ("get", "/research/latest-report"), ("get", "/search?query=test"), ("get", "/auth/me"),
]


@pytest.mark.parametrize("method,path", PROTECTED)
def test_endpoints_require_authentication(client, method, path):
    r = getattr(client, method)(path)
    assert r.status_code == 401, (path, r.status_code)


def test_public_endpoints_stay_public(client):
    assert client.get("/health").status_code == 200
    assert client.get("/").status_code == 200


def _pdf_bytes():
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Spaced repetition improves long-term recall.")
    return doc.tobytes()


@pytest.fixture
def two_users(client, monkeypatch):
    monkeypatch.setattr(tasks, "generate_summaries_job", lambda *a, **k: None)  # no Gemini calls
    a = register(client, email="a@example.com").json()["access_token"]
    b = register(new_client(), email="b@example.com").json()["access_token"]
    return a, b


def test_user_b_cannot_touch_user_a_papers(client, two_users):
    a, b = two_users
    up = client.post("/papers", headers=bearer(a), files={"file": ("study.pdf", _pdf_bytes(), "application/pdf")}, data={"level": "Medium"})
    assert up.status_code == 200, up.text
    pid = up.json()["id"]
    client.post(f"/papers/{pid}/explain", headers=bearer(a))  # explanations are requested from Page summaries

    db = SessionLocal()
    owner = db.query(models.User).filter(models.User.email == "a@example.com").one()
    assert db.get(models.Paper, pid).user_id == owner.id
    db.close()

    assert [p["id"] for p in client.get("/papers", headers=bearer(a)).json()] == [pid]
    assert client.get(f"/papers/{pid}", headers=bearer(a)).status_code == 200
    assert client.get(f"/papers/{pid}/pages", headers=bearer(a)).json()["pages"][0]["page_number"] == 1
    assert client.get(f"/papers/{pid}/file", headers=bearer(a)).status_code == 200

    assert client.get("/papers", headers=bearer(b)).json() == []
    for method, path in [
        ("get", f"/papers/{pid}"), ("get", f"/papers/{pid}/file"), ("get", f"/papers/{pid}/pages"),
        ("get", f"/papers/{pid}/pages/1"), ("post", f"/papers/{pid}/pages/1/regenerate"), ("get", f"/papers/{pid}/progress"),
        ("get", f"/papers/{pid}/outline"), ("get", f"/papers/{pid}/pages/1/text"), ("post", f"/papers/{pid}/explain"),
    ]:
        assert getattr(client, method)(path, headers=bearer(b)).status_code == 404, path
    assert client.patch(f"/papers/{pid}", headers=bearer(b), data={"level": "Easy"}).status_code == 404


def _add_session(user_email, question):
    db = SessionLocal()
    uid = db.query(models.User).filter(models.User.email == user_email).one().id
    s = models.ResearchSession(user_id=uid, title=question, question=question, report="# Report\nBody text.",
                               hypotheses=[], evidence_log=[], critique={}, stats={})
    db.add(s)
    db.commit()
    sid = s.id
    db.close()
    return sid


def test_user_b_cannot_touch_user_a_research(client, two_users, monkeypatch):
    a, b = two_users
    sid = _add_session("a@example.com", "Does spacing beat rereading?")

    assert [s["id"] for s in client.get("/research/sessions", headers=bearer(a)).json()] == [sid]
    assert client.get(f"/research/sessions/{sid}", headers=bearer(a)).status_code == 200
    assert client.get("/research/latest-report", headers=bearer(a)).json()["id"] == sid

    assert client.get("/research/sessions", headers=bearer(b)).json() == []
    assert client.get(f"/research/sessions/{sid}", headers=bearer(b)).status_code == 404
    assert client.get("/research/latest-report", headers=bearer(b)).json() is None

    called = []
    monkeypatch.setattr(main, "run_research", lambda **kw: called.append(kw) or {"session_id": "new"})
    r = client.post("/research", headers=bearer(b), json={"question": "Overwrite someone else's session?", "session_id": sid})
    assert r.status_code == 404 and not called


def test_research_is_saved_to_the_caller(client, two_users, monkeypatch):
    a, _ = two_users
    seen = {}

    def fake_run(**kw):
        seen.update(kw)
        return {"session_id": "s1", "report": "ok"}

    monkeypatch.setattr(main, "run_research", fake_run)
    r = client.post("/research", headers=bearer(a), json={"question": "Is the response contract unchanged?", "user_id": "spoofed"})
    assert r.status_code == 200 and r.json() == {"session_id": "s1", "report": "ok"}
    db = SessionLocal()
    assert seen["user_id"] == db.query(models.User).filter(models.User.email == "a@example.com").one().id
    db.close()
