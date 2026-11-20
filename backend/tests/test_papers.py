"""Paper Study pipeline: real upload validation, real PyMuPDF extraction,
real database + worker logic. Only the Gemini call itself is replaced
(MOCKED GEMINI), so these tests prove the pipeline, not the AI output."""
import logging
import re

import fitz
import pytest
from fastapi import HTTPException

from app import models, papers, tasks
from app.database import SessionLocal
from conftest import bearer, register

# ───────── helpers ─────────

def text_pdf(n_pages: int, words="Spaced retrieval practice strengthens long-term memory traces") -> bytes:
    doc = fitz.open()
    for i in range(1, n_pages + 1):
        doc.new_page().insert_text((72, 72), f"Page {i}. {words} (section {i}).")
    return doc.tobytes()


def mixed_pdf(text_pages: int, image_pages: int) -> bytes:
    doc = fitz.open()
    for i in range(1, text_pages + 1):
        doc.new_page().insert_text((72, 72), f"Page {i}. Results show a clear effect of spacing on recall.")
    for _ in range(image_pages):
        pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 60, 60), False)
        pix.clear_with(180)
        doc.new_page().insert_image(fitz.Rect(72, 72, 400, 400), pixmap=pix)
    return doc.tobytes()


class FakeGemini:
    """Stands in for app.llm._call_gemini and records every prompt."""

    def __init__(self, fail_pages=(), fail_all: Exception | None = None):
        self.calls: list[tuple[str, str]] = []
        self.fail_pages = set(fail_pages)
        self.fail_all = fail_all

    def __call__(self, prompt, schema):
        self.calls.append((schema.__name__, prompt))
        if self.fail_all:
            raise self.fail_all
        if schema.__name__ == "OverviewModel":
            return schema(overview="An overview of the paper.")
        numbers = [int(n) for n in re.findall(r"--- PAGE (\d+) ---", prompt)]
        if schema.__name__ == "SingleAnalysis" and numbers and numbers[0] in self.fail_pages:
            raise HTTPException(status_code=503, detail="All Gemini models unavailable: internal-detail-xyz")
        return schema(pages=[
            {"page_number": n, "summary": f"Explanation of page {n}.", "key_points": [f"Point about page {n}"],
             "terms": {f"Term{n}": "a definition"}, "figures": {}}
            for n in numbers if n not in self.fail_pages
        ])

    def pages_sent(self):
        return [int(n) for _, p in self.calls for n in re.findall(r"--- PAGE (\d+) ---", p)]


@pytest.fixture
def user(client):
    return register(client, email="reader@example.com").json()["access_token"]


@pytest.fixture
def gemini(monkeypatch):
    fake = FakeGemini()
    monkeypatch.setattr(tasks, "_call_gemini", fake)
    return fake


def upload(client, token, data: bytes, name="paper.pdf", ctype="application/pdf", level="Medium", explain=True):
    """Upload, then (by default) ask for page explanations the way opening Page summaries does."""
    r = client.post("/papers", headers=bearer(token), files={"file": (name, data, ctype)}, data={"level": level})
    if explain and r.status_code == 200 and r.json().get("text_pages"):
        client.post(f"/papers/{r.json()['id']}/explain", headers=bearer(token))
    return r


# ───────── upload + extraction ─────────

def test_multi_page_pipeline_end_to_end(client, user, gemini):
    r = upload(client, user, text_pdf(5))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["page_count"] == 5 and body["text_pages"] == 5 and body["needs_ocr"] is False
    pid = body["id"]

    # Gemini received the extracted text of every page, with page numbers preserved
    prompts = " ".join(p for _, p in gemini.calls)
    for i in range(1, 6):
        assert f"Page {i}. Spaced retrieval practice" in prompts
    assert sorted(gemini.pages_sent()) == [1, 2, 3, 4, 5]

    status = client.get(f"/papers/{pid}/status", headers=bearer(user)).json()
    assert status["status"] == "ready" and status["ready"] == 5 and status["failed"] == 0
    page = client.get(f"/papers/{pid}/pages/3?level=Medium", headers=bearer(user)).json()
    assert page["status"] == "ready" and page["summary"] == "Explanation of page 3." and page["key_points"]
    assert client.get(f"/papers/{pid}", headers=bearer(user)).json()["status"] == "ready"
    assert client.get("/papers", headers=bearer(user)).json()[0]["status"] == "ready"


@pytest.mark.parametrize("name,ctype,data,code,needle", [
    ("notes.txt", "text/plain", b"%PDF-1.4 fake", 400, ".pdf"),
    ("paper.pdf", "image/png", b"%PDF-1.4 fake", 400, "PDF"),
    ("paper.pdf", "application/pdf", b"this is not a pdf at all", 400, "valid PDF"),
    ("paper.pdf", "application/pdf", b"%PDF-1.4\n garbage garbage", 400, "damaged"),
])
def test_invalid_uploads_are_rejected(client, user, gemini, name, ctype, data, code, needle):
    r = upload(client, user, data, name=name, ctype=ctype)
    assert r.status_code == code and needle in r.json()["detail"]
    assert client.get("/papers", headers=bearer(user)).json() == []
    assert gemini.calls == []


def test_size_and_page_limits(client, user, gemini, monkeypatch):
    monkeypatch.setattr(papers, "MAX_BYTES", 1000)
    r = upload(client, user, text_pdf(3))
    assert r.status_code == 413 and "larger than" in r.json()["detail"]
    monkeypatch.setattr(papers, "MAX_BYTES", 25 * 1024 * 1024)
    monkeypatch.setattr(papers, "MAX_PAGES", 2)
    r = upload(client, user, text_pdf(3))
    assert r.status_code == 400 and "limit is 2" in r.json()["detail"]


def test_default_limits_are_25mb_and_300_pages():
    assert papers.MAX_BYTES == 25 * 1024 * 1024 and papers.MAX_PAGES == 300


def test_invalid_level_rejected(client, user, gemini):
    assert upload(client, user, text_pdf(1), level="Expert").status_code == 400


def test_scanned_pdf_reports_ocr_needed(client, user, gemini):
    r = upload(client, user, mixed_pdf(0, 2))
    body = r.json()
    assert r.status_code == 200 and body["needs_ocr"] is True and body["text_pages"] == 0
    st = client.get(f"/papers/{body['id']}/status", headers=bearer(user)).json()
    assert st["status"] == "needs_ocr" and "OCR" in st["message"] and st["total"] == 0
    assert gemini.calls == []  # nothing sent to the AI, nothing pretended
    assert client.get("/papers", headers=bearer(user)).json()[0]["status"] == "failed"


def test_mixed_pdf_skips_image_pages_honestly(client, user, gemini):
    body = upload(client, user, mixed_pdf(2, 1)).json()
    st = client.get(f"/papers/{body['id']}/status", headers=bearer(user)).json()
    assert st["status"] == "ready" and st["ready"] == 2 and st["skipped_pages"] == 1 and "skipped" in st["message"]
    assert sorted(gemini.pages_sent()) == [1, 2]


# ───────── failures, retry, duplicates ─────────

def test_gemini_outage_marks_pages_failed_then_retry_recovers(client, user, monkeypatch):
    down = FakeGemini(fail_all=HTTPException(status_code=503, detail="All Gemini models unavailable: secret-internal"))
    monkeypatch.setattr(tasks, "_call_gemini", down)
    pid = upload(client, user, text_pdf(3)).json()["id"]
    st = client.get(f"/papers/{pid}/status", headers=bearer(user)).json()
    assert st["status"] == "failed" and st["failed"] == 3
    page = client.get(f"/papers/{pid}/pages/1?level=Medium", headers=bearer(user)).json()
    assert page["status"] == "failed" and "secret-internal" not in page["error"] and "Retry" in page["error"]

    up = FakeGemini()
    monkeypatch.setattr(tasks, "_call_gemini", up)
    r = client.post(f"/papers/{pid}/retry-failed", headers=bearer(user))
    assert r.json()["requeued"] == 3
    assert client.get(f"/papers/{pid}/status", headers=bearer(user)).json()["status"] == "ready"


def test_one_failed_page_retried_alone(client, user, monkeypatch):
    flaky = FakeGemini(fail_pages={2})
    monkeypatch.setattr(tasks, "_call_gemini", flaky)
    pid = upload(client, user, text_pdf(4)).json()["id"]
    st = client.get(f"/papers/{pid}/status", headers=bearer(user)).json()
    assert st["status"] == "partial" and st["ready"] == 3 and st["failed"] == 1

    fixed = FakeGemini()
    monkeypatch.setattr(tasks, "_call_gemini", fixed)
    r = client.post(f"/papers/{pid}/pages/2/regenerate?level=Medium", headers=bearer(user))
    assert r.status_code == 200
    assert fixed.pages_sent() == [2]  # only page 2 went back to the AI
    assert client.get(f"/papers/{pid}/status", headers=bearer(user)).json()["status"] == "ready"


def test_pages_are_never_processed_twice(client, user, gemini):
    pid = upload(client, user, text_pdf(2)).json()["id"]
    sent_before = len(gemini.pages_sent())
    db = SessionLocal()
    s = db.query(models.PageSummary).filter_by(paper_id=pid, page_number=1).one()
    s.status = "processing"  # e.g. a worker is on it right now
    db.commit()
    db.close()
    tasks.generate_summaries_job(pid, "Medium")  # a second job for the same paper
    assert len(gemini.pages_sent()) == sent_before  # it claimed nothing
    # Asking to regenerate a page that's in progress doesn't queue it again
    client.post(f"/papers/{pid}/pages/1/regenerate?level=Medium", headers=bearer(user))
    assert len(gemini.pages_sent()) == sent_before


def test_claim_is_atomic():
    db = SessionLocal()
    user = models.User(email="claim@example.com")
    db.add(user)
    paper = models.Paper(user_id="u", title="t", page_count=1, level="Medium", status="processing")
    db.add(paper)
    db.flush()
    s = models.PageSummary(paper_id=paper.id, page_number=1, level="Medium", status="pending")
    db.add(s)
    db.commit()
    assert tasks._claim(db, [s.id]) == [s.id]
    assert tasks._claim(db, [s.id]) == []  # second claimer loses
    db.close()


def test_reading_a_pending_page_never_calls_the_ai(client, user, monkeypatch):
    monkeypatch.setattr(tasks, "enqueue_paper", lambda *a: None)  # nothing processed yet
    pid = upload(client, user, text_pdf(2)).json()["id"]
    called = []
    monkeypatch.setattr(tasks, "_call_gemini", lambda *a: called.append(1))
    page = client.get(f"/papers/{pid}/pages/1?level=Medium", headers=bearer(user)).json()
    assert page["status"] == "pending" and called == []


def test_unfinished_work_resumes_after_restart(client, user, gemini, monkeypatch):
    monkeypatch.setattr(tasks, "enqueue_paper", lambda *a: None)  # "server stops" before processing
    pid = upload(client, user, text_pdf(3)).json()["id"]
    db = SessionLocal()
    db.query(models.PageSummary).filter_by(paper_id=pid, page_number=1).update({"status": "processing"})
    db.commit()
    db.close()
    monkeypatch.undo()
    monkeypatch.setattr(tasks, "_call_gemini", gemini)
    assert tasks.resume_unfinished() == 1  # one paper/level queued (inline in tests)
    assert client.get(f"/papers/{pid}/status", headers=bearer(user)).json()["status"] == "ready"


def test_difficulty_change_queues_processing(client, user, gemini):
    pid = upload(client, user, text_pdf(2)).json()["id"]
    r = client.patch(f"/papers/{pid}", headers=bearer(user), data={"level": "Pro"})
    assert r.status_code == 200
    assert any("Level: Pro" in p for _, p in gemini.calls)
    pages = client.get(f"/papers/{pid}/pages", headers=bearer(user)).json()["pages"]
    assert [p["status"] for p in pages] == ["ready", "ready"]
    assert client.get(f"/papers/{pid}/pages/1?level=Pro", headers=bearer(user)).json()["status"] == "ready"
    # Switching back reuses the explanations that already exist
    before = len(gemini.calls)
    client.patch(f"/papers/{pid}", headers=bearer(user), data={"level": "Medium"})
    assert len(gemini.calls) == before


def test_logs_never_contain_pdf_text_or_tokens(client, user, gemini):
    records = []
    handler = logging.Handler()
    handler.emit = lambda rec: records.append(rec.getMessage())
    logging.getLogger("cognexa").addHandler(handler)
    try:
        upload(client, user, text_pdf(2, words="CONFIDENTIAL-SENTENCE-123 in the study"))
        upload(client, user, b"not a pdf", name="x.pdf")
    finally:
        logging.getLogger("cognexa").removeHandler(handler)
    joined = "\n".join(records)
    assert "upload ok" in joined and "upload rejected" in joined
    assert "CONFIDENTIAL-SENTENCE-123" not in joined and user not in joined and "Bearer" not in joined


# ───────── review fixes ─────────

@pytest.mark.parametrize("stored,shown", [
    ("ready", "ready"), ("partial", "ready"), ("processing", "processing"),
    ("failed", "failed"), ("needs_ocr", "failed"), ("queued", "processing"), (None, "processing"),
])
def test_list_only_returns_statuses_the_frontend_knows(client, user, stored, shown):
    db = SessionLocal()
    uid = db.query(models.User).filter_by(email="reader@example.com").one().id
    db.add(models.Paper(user_id=uid, title="p.pdf", page_count=1, level="Medium", status=stored))
    db.commit()
    db.close()
    assert client.get("/papers", headers=bearer(user)).json()[0]["status"] == shown


def test_rejected_uploads_leave_no_records_or_files(client, user, gemini, monkeypatch):
    import os
    before = set(os.listdir(papers.UPLOAD_DIR))
    monkeypatch.setattr(papers, "MAX_PAGES", 2)
    assert upload(client, user, text_pdf(3)).status_code == 400  # rejected after the PDF was opened
    assert upload(client, user, b"%PDF-1.4 broken", name="b.pdf").status_code == 400
    db = SessionLocal()
    assert db.query(models.Paper).count() == 0 and db.query(models.PaperPage).count() == 0
    db.close()
    assert set(os.listdir(papers.UPLOAD_DIR)) == before


def test_shutdown_releases_in_flight_pages(client, user, gemini, monkeypatch):
    monkeypatch.setattr(tasks, "enqueue_paper", lambda *a: None)
    pid = upload(client, user, text_pdf(2)).json()["id"]
    db = SessionLocal()
    db.query(models.PageSummary).filter_by(paper_id=pid).update({"status": "processing"})
    db.commit()
    db.close()
    tasks.shutdown_worker(wait_seconds=0)
    db = SessionLocal()
    assert {s.status for s in db.query(models.PageSummary).filter_by(paper_id=pid)} == {"pending"}
    db.close()
    # A stopped worker takes no new work; the next start resumes it
    monkeypatch.undo()
    monkeypatch.setattr(tasks, "_call_gemini", gemini)
    tasks.generate_summaries_job(pid, "Medium")
    assert client.get(f"/papers/{pid}/status", headers=bearer(user)).json()["ready"] == 0
    assert tasks.resume_unfinished() == 1
    assert client.get(f"/papers/{pid}/status", headers=bearer(user)).json()["status"] == "ready"


def test_regenerated_page_gets_new_text_not_old(client, user, monkeypatch):
    first = FakeGemini()
    monkeypatch.setattr(tasks, "_call_gemini", first)
    pid = upload(client, user, text_pdf(2)).json()["id"]

    class Second(FakeGemini):
        def __call__(self, prompt, schema):
            out = super().__call__(prompt, schema)
            for p in getattr(out, "pages", []):
                p.summary = f"Second pass for page {p.page_number}."
            return out

    monkeypatch.setattr(tasks, "_call_gemini", Second())
    client.post(f"/papers/{pid}/pages/1/regenerate?level=Medium", headers=bearer(user))
    page = client.get(f"/papers/{pid}/pages/1?level=Medium", headers=bearer(user)).json()
    assert page["status"] == "ready" and page["summary"] == "Second pass for page 1."
    other = client.get(f"/papers/{pid}/pages/2?level=Medium", headers=bearer(user)).json()
    assert other["summary"] == "Explanation of page 2."  # untouched


def test_same_job_queued_twice_runs_once(monkeypatch):
    class LiveWorker:
        def is_alive(self):
            return True

    monkeypatch.delenv("PAPER_WORKER", raising=False)  # use the real queue path
    monkeypatch.setattr(tasks, "_worker", LiveWorker())  # so no thread is started
    monkeypatch.setattr(tasks, "_queued", set())
    monkeypatch.setattr(tasks, "_queue", tasks.queue.Queue())
    tasks.enqueue_paper("p1", "Medium")
    tasks.enqueue_paper("p1", "Medium")
    tasks.enqueue_paper("p1", "Pro")
    assert tasks._queue.qsize() == 2  # (p1, Medium) once, (p1, Pro) once



# ───────── page explanations on demand ─────────

def test_upload_does_not_explain_pages_until_asked(client, user, gemini):
    pid = upload(client, user, text_pdf(3), explain=False).json()["id"]
    assert gemini.pages_sent() == []  # extraction only
    db = SessionLocal()
    assert db.query(models.PageSummary).filter_by(paper_id=pid).count() == 0
    db.close()
    outline = client.get(f"/papers/{pid}/outline", headers=bearer(user)).json()
    assert [(p["page_number"], p["has_text"], p["explanation"]) for p in outline["pages"]] == [(1, True, None), (2, True, None), (3, True, None)]
    assert client.get(f"/papers/{pid}", headers=bearer(user)).json()["status"] == "ready"

    r = client.post(f"/papers/{pid}/explain", headers=bearer(user)).json()
    assert r["requested"] == 3 and sorted(gemini.pages_sent()) == [1, 2, 3]
    outline = client.get(f"/papers/{pid}/outline", headers=bearer(user)).json()
    assert [p["explanation"] for p in outline["pages"]] == ["ready", "ready", "ready"]
    # asking again never re-explains
    again = client.post(f"/papers/{pid}/explain", headers=bearer(user)).json()
    assert again["requested"] == 0 and sorted(gemini.pages_sent()) == [1, 2, 3]


def test_page_text_endpoint_returns_extracted_text(client, user, gemini):
    pid = upload(client, user, text_pdf(2), explain=False).json()["id"]
    page = client.get(f"/papers/{pid}/pages/2/text", headers=bearer(user)).json()
    assert page["page_number"] == 2 and page["status"] == "ready" and "Page 2." in page["text"]
    assert client.get(f"/papers/{pid}/pages/9/text", headers=bearer(user)).status_code == 404
    assert gemini.calls == []


def test_explain_refuses_scanned_pdf(client, user, gemini):
    pid = upload(client, user, mixed_pdf(0, 1), explain=False).json()["id"]
    assert client.post(f"/papers/{pid}/explain", headers=bearer(user)).status_code == 400


# ───────── the same paper twice, stopping and switching levels ─────────

def _paper_count(user_token, client):
    return len(client.get("/papers", headers=bearer(user_token)).json())


def test_same_pdf_uploaded_again_opens_the_existing_paper(client, user, gemini):
    data = text_pdf(3)
    first = upload(client, user, data, name="study.pdf").json()
    again = client.post("/papers", headers=bearer(user), files={"file": ("study.pdf", data, "application/pdf")}, data={"level": "Medium"}).json()
    assert again["id"] == first["id"] and again["duplicate"] is True
    # renamed on disk, same document: still the same paper
    renamed = client.post("/papers", headers=bearer(user), files={"file": ("copy of study.pdf", data, "application/pdf")}, data={"level": "Medium"}).json()
    assert renamed["id"] == first["id"]
    assert _paper_count(user, client) == 1
    # a different PDF is a new paper
    other = upload(client, user, text_pdf(3, words="A different paper about attention in transformers")).json()
    assert other["id"] != first["id"] and _paper_count(user, client) == 2


def test_same_pdf_with_another_level_switches_the_level_only(client, user, gemini):
    data = text_pdf(2)
    pid = upload(client, user, data, level="Beginner").json()["id"]
    again = client.post("/papers", headers=bearer(user), files={"file": ("paper.pdf", data, "application/pdf")}, data={"level": "Pro"}).json()
    assert again["id"] == pid and _paper_count(user, client) == 1
    assert client.get(f"/papers/{pid}", headers=bearer(user)).json()["level"] == "Pro"


def test_another_users_identical_pdf_is_their_own_paper(client, user, gemini):
    data = text_pdf(2)
    mine = upload(client, user, data).json()["id"]
    other = register(client, email="other-reader@example.com").json()["access_token"]
    theirs = upload(client, other, data).json()["id"]
    assert theirs != mine


def test_stop_takes_waiting_pages_off_the_queue_and_keeps_written_ones(client, user, gemini, monkeypatch):
    monkeypatch.setattr(tasks, "enqueue_paper", lambda *a: None)  # notes requested, nothing written yet
    pid = upload(client, user, text_pdf(4), level="Beginner").json()["id"]
    db = SessionLocal()
    db.query(models.PageSummary).filter_by(paper_id=pid, page_number=1).update({"status": "ready", "summary": "Written."})
    db.commit()
    db.close()
    r = client.post(f"/papers/{pid}/stop", headers=bearer(user)).json()
    assert r["stopped"] == 3
    db = SessionLocal()
    left = {s.page_number: s.status for s in db.query(models.PageSummary).filter_by(paper_id=pid)}
    db.close()
    assert left == {1: "ready"}
    assert client.get(f"/papers/{pid}/status", headers=bearer(user)).json()["status"] != "processing"
    # nothing new is counted anywhere: still one paper
    assert _paper_count(user, client) == 1
    # continuing later picks up only the pages that were stopped
    monkeypatch.undo()
    monkeypatch.setattr(tasks, "_call_gemini", gemini)
    client.post(f"/papers/{pid}/explain", headers=bearer(user))
    assert sorted(set(gemini.pages_sent())) == [2, 3, 4]


def test_switching_level_mid_way_stops_the_old_level(client, user, gemini, monkeypatch):
    queued = []
    monkeypatch.setattr(tasks, "enqueue_paper", lambda pid, level: queued.append(level))
    pid = upload(client, user, text_pdf(3), level="Beginner").json()["id"]
    client.patch(f"/papers/{pid}", headers=bearer(user), data={"level": "Pro"})
    db = SessionLocal()
    rows = [(s.level, s.status) for s in db.query(models.PageSummary).filter_by(paper_id=pid)]
    db.close()
    assert ("Beginner", "pending") not in rows  # the old level's waiting pages stopped
    assert sorted(rows) == [("Pro", "pending")] * 3
    assert queued[-1] == "Pro" and _paper_count(user, client) == 1


def test_choosing_a_level_before_asking_for_notes_starts_nothing(client, user, gemini):
    pid = upload(client, user, text_pdf(2), explain=False).json()["id"]
    client.patch(f"/papers/{pid}", headers=bearer(user), data={"level": "Beginner"})
    assert client.get(f"/papers/{pid}", headers=bearer(user)).json()["level"] == "Beginner"
    db = SessionLocal()
    assert db.query(models.PageSummary).filter_by(paper_id=pid).count() == 0
    db.close()
    assert gemini.pages_sent() == []
