"""Study kit: real chunking, storage, worker, validation and API. Only the
Gemini call is replaced (MOCKED GEMINI); its answers are built from the
prompts it receives so page references come from the real page numbers."""
import re

import fitz
import pytest
from fastapi import HTTPException

from app import models, study, tasks
from app.database import SessionLocal
from conftest import bearer, new_client, register


def text_pdf(n_pages: int) -> bytes:
    doc = fitz.open()
    for i in range(1, n_pages + 1):
        doc.new_page().insert_text(
            (72, 72), f"Page {i}. Retrieval practice with spacing improves recall; topic{i} discussed here."
        )
    return doc.tobytes()


def scanned_pdf() -> bytes:
    doc = fitz.open()
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 40, 40), False)
    pix.clear_with(200)
    doc.new_page().insert_image(fitz.Rect(72, 72, 300, 300), pixmap=pix)
    return doc.tobytes()


class FakeStudyGemini:
    def __init__(self, fail_chunk_pages=(), fail_kinds=()):
        self.calls: list[tuple[str, str]] = []
        self.fail_chunk_pages = set(fail_chunk_pages)
        self.fail_kinds = set(fail_kinds)

    def count(self, name):
        return sum(1 for n, _ in self.calls if n == name)

    def __call__(self, prompt, schema):
        name = schema.__name__
        self.calls.append((name, prompt))
        pages = [int(n) for n in re.findall(r"--- PAGE (\d+) ---", prompt)]
        refs = sorted({int(p) for group in re.findall(r"\[p\.([\d,]+)\]", prompt) for p in group.split(",") if p})
        if name == "ChunkNotes":
            if self.fail_chunk_pages & set(pages):
                raise HTTPException(status_code=503, detail="All Gemini models unavailable: internal-xyz")
            cats = ["objective", "methodology", "results", "limitations"]
            return schema(
                notes=[{"category": cats[n % 4], "text": f"Point from page {n}.", "pages": [n, 9999]} for n in pages],
                terms=[{"name": f"Term{n}", "definition": f"Defined on page {n}.", "page": n} for n in pages],
                formulas=[{"expression": "R = s / t", "meaning": "recall rate", "page": pages[0]}],
                statistics=[{"statement": f"Recall rose 1{n}%.", "page": n} for n in pages[:1]],
            )
        kind = {"PaperSummary": "summary", "FlashcardSet": "flashcards", "QuestionBank": "questions", "HighlightSet": "highlights"}.get(name)
        if kind in self.fail_kinds:
            raise HTTPException(status_code=429, detail="RESOURCE_EXHAUSTED quota")
        first, last = (refs[0], refs[-1]) if refs else (1, 1)
        if name == "PaperSummary":
            return schema(overview="An overview grounded in the notes.", sections=[
                {"key": "objective", "specified": True, "body": "Studies **retrieval practice**.", "pages": [first, 9999]},
                {"key": "methodology", "specified": True, "body": "- Spaced trials\n- Recall tests", "pages": [last]},
                {"key": "results", "specified": True, "body": "Recall improved.", "pages": [first, last]},
                {"key": "limitations", "specified": False, "body": "Not specified in the paper.", "pages": []},
            ])
        if name == "FlashcardSet":
            return schema(cards=[
                {"category": "term", "question": "What is retrieval practice?", "answer": "Recalling information from memory.", "pages": [first]},
                {"category": "term", "question": "What is retrieval practice ?", "answer": "Duplicate card.", "pages": [first]},
                {"category": "finding", "question": "What effect did spacing have on recall?", "answer": "Recall improved with spacing.", "pages": [last, 9999]},
                {"category": "concept", "question": "Title?", "answer": "Trivial.", "pages": []},
            ])
        if name == "QuestionBank":
            return schema(questions=[
                {"category": c, "question": f"A {c} question about spacing and recall?", "answer": f"A grounded {c} answer.", "pages": [first]}
                for c in ["findings", "basic", "conceptual", "technical", "methodology", "analytical"]
            ] + [{"category": "basic", "question": "A basic question about spacing and recall?", "answer": "dup", "pages": []}])
        if name == "HighlightSet":
            return schema(highlights=[
                {"category": "statistic", "text": "Recall rose by a measurable margin.", "why": "Key result.", "pages": [first, 9999]},
                {"category": "limitation", "text": "Small sample.", "why": "Limits generality.", "pages": [last]},
            ])
        if name == "AskAnswer":
            page_text = re.search(rf"--- PAGE {pages[0]} ---\n(.+?)\n", prompt).group(1) if pages else ""
            return schema(found=True, answer="Spacing improves recall.", citations=[
                {"page": pages[0], "quote": " ".join(page_text.split()[:6])},      # real quote
                {"page": pages[0], "quote": "a sentence the paper never contains"},  # unverifiable
                {"page": 9999, "quote": "outside the provided pages"},                # dropped
            ])
        raise AssertionError(f"unexpected schema {name}")


@pytest.fixture
def user(client):
    return register(client, email="student@example.com").json()["access_token"]


@pytest.fixture
def ai(monkeypatch):
    fake = FakeStudyGemini()
    monkeypatch.setattr(study, "_call_gemini", fake)
    monkeypatch.setattr(tasks, "enqueue_paper", lambda *a: None)  # page explanations aren't under test here
    return fake


def upload(client, token, data, name="paper.pdf"):
    r = client.post("/papers", headers=bearer(token), files={"file": (name, data, "application/pdf")}, data={"level": "Medium"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def output(client, token, pid, kind):
    return client.get(f"/papers/{pid}/study/{kind}", headers=bearer(token)).json()


# ───────── chunking ─────────

def test_chunking_keeps_page_numbers_and_size_limits():
    pages = [(n, "x" * 4_000) for n in range(1, 145)]  # a 144-page paper
    chunks = study.build_chunks(pages)
    assert len(chunks) > 1
    assert [p for c in chunks for p in c] == list(range(1, 145))  # every page once, in order
    assert all(len(c) <= study.MAX_CHUNK_PAGES and len(c) * 4_000 <= study.CHUNK_CHARS for c in chunks)
    long_pages = [(1, "y" * 50_000), (2, "z" * 50_000), (3, "w" * 50_000)]
    assert study.build_chunks(long_pages) == [[1, 2], [3]]  # oversized pages are capped at PAGE_CHARS each


def test_large_paper_is_map_reduced_not_sent_whole(client, user, ai, monkeypatch):
    monkeypatch.setattr(study, "MAX_CHUNK_PAGES", 4)
    pid = upload(client, user, text_pdf(14))
    r = client.post(f"/papers/{pid}/study", headers=bearer(user))
    assert r.status_code == 200 and r.json()["status"] == "ready"
    chunk_prompts = [p for n, p in ai.calls if n == "ChunkNotes"]
    assert len(chunk_prompts) == 4  # 14 pages / 4 per chunk
    for prompt in chunk_prompts:
        assert len(re.findall(r"--- PAGE \d+ ---", prompt)) <= 4
    assert sorted(int(n) for p in chunk_prompts for n in re.findall(r"--- PAGE (\d+) ---", p)) == list(range(1, 15))
    # reduce prompts carry page-tagged notes, never the raw pages
    reduce_prompts = [p for n, p in ai.calls if n != "ChunkNotes"]
    assert len(reduce_prompts) == 4 and all("--- PAGE" not in p and "[p.1]" in p for p in reduce_prompts)


# ───────── outputs ─────────

def test_summary_is_structured_with_valid_page_references(client, user, ai):
    pid = upload(client, user, text_pdf(6))
    client.post(f"/papers/{pid}/study", headers=bearer(user))
    summary = output(client, user, pid, "summary")
    assert summary["status"] == "ready"
    content = summary["content"]
    assert content["overview"]
    assert [s["key"] for s in content["sections"]] == [k for k, _ in study.SECTIONS]  # all 10, in order
    by_key = {s["key"]: s for s in content["sections"]}
    assert by_key["objective"]["specified"] and by_key["objective"]["pages"] == [1]  # 9999 removed
    assert by_key["limitations"]["specified"] is False and by_key["limitations"]["body"] == study.NOT_SPECIFIED
    assert by_key["data_setup"]["specified"] is False  # not returned by the model -> not specified, not invented
    assert content["coverage"] == {"chunks_used": 1, "chunks_total": 1, "pages_covered": 6, "text_pages": 6}


def test_flashcards_dedupe_drop_trivial_and_track_progress(client, user, ai):
    pid = upload(client, user, text_pdf(4))
    client.post(f"/papers/{pid}/study", headers=bearer(user))
    fc = output(client, user, pid, "flashcards")
    cards = fc["content"]["cards"]
    assert [c["question"] for c in cards] == ["What is retrieval practice?", "What effect did spacing have on recall?"]
    assert all(c["id"].startswith("fc-") for c in cards) and len({c["id"] for c in cards}) == 2
    assert all(9999 not in c["pages"] for c in cards)
    assert fc["progress"] == {}

    first, second = cards[0]["id"], cards[1]["id"]
    assert client.put(f"/papers/{pid}/study/flashcards/progress", headers=bearer(user), json={"card_id": first, "state": "known"}).status_code == 200
    client.put(f"/papers/{pid}/study/flashcards/progress", headers=bearer(user), json={"card_id": second, "state": "review"})
    assert output(client, user, pid, "flashcards")["progress"] == {first: "known", second: "review"}
    assert client.put(f"/papers/{pid}/study/flashcards/progress", headers=bearer(user), json={"card_id": "fc-nope", "state": "known"}).status_code == 404

    # Regenerate: only flashcards are rebuilt; marks survive for cards that are unchanged
    before = len(ai.calls)
    client.post(f"/papers/{pid}/study/flashcards/regenerate", headers=bearer(user))
    assert [n for n, _ in ai.calls[before:]] == ["FlashcardSet"]
    assert output(client, user, pid, "flashcards")["progress"] == {first: "known", second: "review"}


def test_question_bank_is_categorised_and_grounded(client, user, ai):
    pid = upload(client, user, text_pdf(3))
    client.post(f"/papers/{pid}/study", headers=bearer(user))
    qs = output(client, user, pid, "questions")["content"]["questions"]
    assert [q["category"] for q in qs] == ["basic", "conceptual", "technical", "methodology", "analytical", "findings"]
    assert all(q["answer"] and q["pages"] == [1] for q in qs)


def test_highlights_have_page_references(client, user, ai):
    pid = upload(client, user, text_pdf(5))
    client.post(f"/papers/{pid}/study", headers=bearer(user))
    hs = output(client, user, pid, "highlights")["content"]["highlights"]
    assert [h["category"] for h in hs] == ["statistic", "limitation"]
    assert hs[0]["pages"] == [1] and hs[1]["pages"] == [5] and all(h["why"] for h in hs)


# ───────── caching, status, failures ─────────

def test_generated_once_then_only_read(client, user, ai):
    pid = upload(client, user, text_pdf(4))
    client.post(f"/papers/{pid}/study", headers=bearer(user))
    made = len(ai.calls)
    assert made == 1 + 4  # one chunk + four outputs
    client.post(f"/papers/{pid}/study", headers=bearer(user))  # "start" again
    for kind in study.OUTPUTS:
        output(client, user, pid, kind)  # opening every tab
    client.get(f"/papers/{pid}/study", headers=bearer(user))
    assert len(ai.calls) == made  # nothing regenerated
    db = SessionLocal()
    kinds = {a.kind for a in db.query(models.StudyArtifact).filter_by(paper_id=pid)}
    db.close()
    assert {"chunk:0", "summary", "flashcards", "questions", "highlights"} <= kinds


def test_queued_state_right_after_upload(client, user, ai, monkeypatch):
    monkeypatch.setattr(tasks, "enqueue_study", lambda *a: None)  # queued, worker has not run yet
    pid = upload(client, user, text_pdf(2))
    st = client.get(f"/papers/{pid}/study", headers=bearer(user)).json()
    assert st["status"] == "processing" and st["chunks"] == {"total": 1, "pending": 1, "processing": 0, "ready": 0, "failed": 0}
    assert all(o["status"] == "pending" for o in st["outputs"].values())
    pending = output(client, user, pid, "summary")
    assert pending["status"] == "pending" and pending["content"] is None
    assert ai.calls == []  # reading status and outputs never calls the AI


def test_older_paper_without_a_kit_can_still_start_one(client, user, ai, monkeypatch):
    pid = upload(client, user, text_pdf(2))
    db = SessionLocal()
    db.query(models.StudyArtifact).filter_by(paper_id=pid).delete()  # as if uploaded before automatic kits
    db.commit()
    db.close()
    assert client.get(f"/papers/{pid}/study", headers=bearer(user)).json()["status"] == "not_started"
    assert client.get(f"/papers/{pid}/study/summary", headers=bearer(user)).status_code == 404
    assert client.post(f"/papers/{pid}/study", headers=bearer(user)).json()["status"] == "ready"


def test_failed_chunk_gives_partial_kit_and_retry_redoes_only_that(client, user, monkeypatch):
    monkeypatch.setattr(tasks, "enqueue_paper", lambda *a: None)
    monkeypatch.setattr(study, "MAX_CHUNK_PAGES", 2)
    flaky = FakeStudyGemini(fail_chunk_pages={3})
    monkeypatch.setattr(study, "_call_gemini", flaky)
    pid = upload(client, user, text_pdf(6))
    st = client.post(f"/papers/{pid}/study", headers=bearer(user)).json()
    assert st["status"] == "partial" and st["chunks"]["failed"] == 1 and st["pages_covered"] == 4
    summary = output(client, user, pid, "summary")["content"]
    assert summary["coverage"]["chunks_used"] == 2 and summary["coverage"]["chunks_total"] == 3

    fixed = FakeStudyGemini()
    monkeypatch.setattr(study, "_call_gemini", fixed)
    st = client.post(f"/papers/{pid}/study/retry", headers=bearer(user)).json()
    assert st["status"] == "ready" and st["pages_covered"] == 6
    assert fixed.count("ChunkNotes") == 1  # only the failed chunk
    assert output(client, user, pid, "summary")["content"]["coverage"]["chunks_used"] == 3  # rebuilt with full coverage


def test_failed_output_is_retried_independently(client, user, monkeypatch):
    monkeypatch.setattr(tasks, "enqueue_paper", lambda *a: None)
    monkeypatch.setattr(study, "_call_gemini", FakeStudyGemini(fail_kinds={"flashcards"}))
    pid = upload(client, user, text_pdf(3))
    st = client.post(f"/papers/{pid}/study", headers=bearer(user)).json()
    assert st["status"] == "partial" and st["outputs"]["flashcards"]["status"] == "failed"
    err = st["outputs"]["flashcards"]["error"]
    assert "quota" in err and "RESOURCE_EXHAUSTED" not in err  # safe wording
    assert output(client, user, pid, "summary")["status"] == "ready"

    fixed = FakeStudyGemini()
    monkeypatch.setattr(study, "_call_gemini", fixed)
    st = client.post(f"/papers/{pid}/study/retry", headers=bearer(user)).json()
    assert st["status"] == "ready" and [n for n, _ in fixed.calls] == ["FlashcardSet"]


def test_everything_failing_is_reported_as_failed(client, user, monkeypatch):
    monkeypatch.setattr(tasks, "enqueue_paper", lambda *a: None)
    monkeypatch.setattr(study, "_call_gemini", FakeStudyGemini(fail_chunk_pages=set(range(1, 10))))
    pid = upload(client, user, text_pdf(2))
    st = client.post(f"/papers/{pid}/study", headers=bearer(user)).json()
    assert st["status"] == "failed"
    assert all(o["status"] == "failed" for o in st["outputs"].values())


def test_unfinished_kit_resumes_after_restart(client, user, ai, monkeypatch):
    monkeypatch.setattr(tasks, "enqueue_study", lambda *a: None)
    pid = upload(client, user, text_pdf(3))
    client.post(f"/papers/{pid}/study", headers=bearer(user))
    db = SessionLocal()
    db.query(models.StudyArtifact).filter_by(paper_id=pid, kind="chunk:0").update({"status": "processing"})
    db.commit()
    db.close()
    monkeypatch.undo()
    monkeypatch.setattr(study, "_call_gemini", ai)
    monkeypatch.setattr(tasks, "enqueue_paper", lambda *a: None)
    tasks.resume_unfinished()
    assert client.get(f"/papers/{pid}/study", headers=bearer(user)).json()["status"] == "ready"


def test_scanned_pdf_cannot_start_a_kit(client, user, ai):
    pid = upload(client, user, scanned_pdf())
    r = client.post(f"/papers/{pid}/study", headers=bearer(user))
    assert r.status_code == 400 and "OCR" in r.json()["detail"] and ai.calls == []


# ───────── Ask this paper ─────────

def test_retrieval_picks_relevant_pages():
    pages = [(1, "Introduction to memory."), (2, "Spacing schedules and interleaving."), (3, "Results: spacing improved recall."), (4, "References.")]
    assert study.retrieve_pages(pages, "What did spacing do to recall?") == [2, 3]
    assert study.retrieve_pages(pages, "What about page 4?") == [4]
    assert study.retrieve_pages(pages, "the and of") == []


def test_ask_is_grounded_with_verified_citations(client, user, ai):
    pid = upload(client, user, text_pdf(5))
    r = client.post(f"/papers/{pid}/ask", headers=bearer(user), json={"question": "What is discussed about topic3?"})
    assert r.status_code == 200
    entry = r.json()
    assert entry["pages_considered"] == [3]  # only the page that mentions topic3
    assert entry["found"] and entry["grounded"]
    assert [c["page"] for c in entry["citations"]] == [3, 3]  # citation to page 9999 dropped
    assert [c["verified"] for c in entry["citations"]] == [True, False]
    history = client.get(f"/papers/{pid}/asks", headers=bearer(user)).json()["items"]
    assert [h["question"] for h in history] == ["What is discussed about topic3?"]


def test_ask_without_matching_pages_does_not_invent(client, user, ai):
    pid = upload(client, user, text_pdf(3))
    entry = client.post(f"/papers/{pid}/ask", headers=bearer(user), json={"question": "What about quantum chromodynamics?"}).json()
    assert entry["found"] is False and entry["citations"] == [] and ai.count("AskAnswer") == 0


def test_ask_ai_failure_is_reported_safely(client, user, monkeypatch):
    monkeypatch.setattr(tasks, "enqueue_paper", lambda *a: None)

    def down(prompt, schema):
        raise HTTPException(status_code=503, detail="All Gemini models unavailable: secret-internal")

    monkeypatch.setattr(study, "_call_gemini", down)
    pid = upload(client, user, text_pdf(2))
    r = client.post(f"/papers/{pid}/ask", headers=bearer(user), json={"question": "What is said about topic1?"})
    assert r.status_code == 503 and "secret-internal" not in r.json()["detail"]
    assert client.get(f"/papers/{pid}/asks", headers=bearer(user)).json()["items"] == []


# ───────── isolation ─────────

def test_other_users_cannot_reach_the_study_kit(client, user, ai):
    pid = upload(client, user, text_pdf(2))
    client.post(f"/papers/{pid}/study", headers=bearer(user))
    other = register(new_client(), email="intruder@example.com").json()["access_token"]
    for method, path, kw in [
        ("get", f"/papers/{pid}/study", {}), ("post", f"/papers/{pid}/study", {}), ("post", f"/papers/{pid}/study/retry", {}),
        ("get", f"/papers/{pid}/study/summary", {}), ("post", f"/papers/{pid}/study/flashcards/regenerate", {}),
        ("put", f"/papers/{pid}/study/flashcards/progress", {"json": {"card_id": "x", "state": "known"}}),
        ("get", f"/papers/{pid}/asks", {}), ("post", f"/papers/{pid}/ask", {"json": {"question": "What about topic1?"}}),
    ]:
        assert getattr(client, method)(path, headers=bearer(other), **kw).status_code == 404, path



# ───────── automatic study kit ─────────

def test_upload_starts_the_study_kit_automatically(client, user, ai):
    pid = upload(client, user, text_pdf(4))
    # nothing else was called: the upload alone produced the kit
    assert ai.count("ChunkNotes") == 1
    assert [ai.count(n) for n in ("PaperSummary", "FlashcardSet", "QuestionBank", "HighlightSet")] == [1, 1, 1, 1]
    st = client.get(f"/papers/{pid}/study", headers=bearer(user)).json()
    assert st["status"] == "ready" and all(o["status"] == "ready" for o in st["outputs"].values())


def test_no_duplicate_generation_on_refresh_or_repeated_requests(client, user, ai):
    pid = upload(client, user, text_pdf(4))
    made = len(ai.calls)
    for _ in range(3):
        client.get(f"/papers/{pid}/study", headers=bearer(user))
        for kind in study.OUTPUTS:
            output(client, user, pid, kind)
    client.post(f"/papers/{pid}/study", headers=bearer(user))
    client.post(f"/papers/{pid}/study", headers=bearer(user))
    client.post(f"/papers/{pid}/study/retry", headers=bearer(user))  # nothing failed: nothing to retry
    tasks.resume_unfinished()  # a restart
    assert len(ai.calls) == made


def test_scanned_upload_starts_nothing(client, user, ai):
    pid = upload(client, user, scanned_pdf())
    db = SessionLocal()
    assert db.query(models.StudyArtifact).filter_by(paper_id=pid).count() == 0
    db.close()
    assert ai.calls == []
    assert client.get(f"/papers/{pid}/study", headers=bearer(user)).json()["status"] == "not_started"


def test_artifacts_progress_and_fail_independently(client, user, monkeypatch):
    monkeypatch.setattr(tasks, "enqueue_paper", lambda *a: None)
    monkeypatch.setattr(study, "_call_gemini", FakeStudyGemini(fail_kinds={"questions"}))
    pid = upload(client, user, text_pdf(3))
    st = client.get(f"/papers/{pid}/study", headers=bearer(user)).json()
    assert {k: o["status"] for k, o in st["outputs"].items()} == {
        "summary": "ready", "flashcards": "ready", "questions": "failed", "highlights": "ready"}
    assert st["status"] == "partial"
    assert output(client, user, pid, "highlights")["status"] == "ready"  # usable while another failed


def test_study_queue_is_idempotent_per_paper(monkeypatch):
    class LiveWorker:
        def is_alive(self):
            return True

    monkeypatch.delenv("PAPER_WORKER", raising=False)
    monkeypatch.setattr(tasks, "_study_worker", LiveWorker())
    monkeypatch.setattr(tasks, "_study_queued", set())
    monkeypatch.setattr(tasks, "_study_running", set())
    monkeypatch.setattr(tasks, "_study_rerun", set())
    monkeypatch.setattr(tasks, "_study_queue", tasks.queue.Queue())
    tasks.enqueue_study("p1")
    tasks.enqueue_study("p1")  # e.g. a refresh while it waits
    assert tasks._study_queue.qsize() == 1
    tasks._study_queued.clear()
    monkeypatch.setattr(tasks, "_study_queue", tasks.queue.Queue())
    tasks._study_running.add("p1")  # now it is running
    tasks.enqueue_study("p1")
    assert tasks._study_queue.qsize() == 0 and tasks._study_rerun == {"p1"}  # no second job, one follow-up run


# ───────── flashcard review API ─────────

def test_flashcard_progress_api_success_failure_and_persistence(client, user, ai, monkeypatch):
    monkeypatch.setattr(tasks, "enqueue_study", lambda *a: None)
    pid = upload(client, user, text_pdf(3))
    early = client.put(f"/papers/{pid}/study/flashcards/progress", headers=bearer(user), json={"card_id": "fc-x", "state": "known"})
    assert early.status_code == 404 and "ready yet" in early.json()["detail"]

    monkeypatch.undo()
    monkeypatch.setattr(study, "_call_gemini", ai)
    tasks.enqueue_study(pid)
    cards = output(client, user, pid, "flashcards")["content"]["cards"]
    cid = cards[0]["id"]

    def put(body):
        return client.put(f"/papers/{pid}/study/flashcards/progress", headers=bearer(user), json=body)

    assert put({"card_id": cid, "state": "maybe"}).status_code == 422
    gone = put({"card_id": "fc-deleted", "state": "known"})
    assert gone.status_code == 404 and "no longer exists" in gone.json()["detail"]
    ok = put({"card_id": cid, "state": "review"})
    assert ok.status_code == 200 and ok.json()["states"] == {cid: "review"}
    # a fresh client (a page refresh, or another device) sees the saved state
    again = new_client()
    assert again.get(f"/papers/{pid}/study/flashcards", headers=bearer(user)).json()["progress"] == {cid: "review"}
    assert put({"card_id": cid, "state": None}).json()["states"] == {}


def test_regenerated_deck_drops_marks_only_for_removed_cards(client, user, ai, monkeypatch):
    pid = upload(client, user, text_pdf(3))
    cards = output(client, user, pid, "flashcards")["content"]["cards"]
    keep, drop = cards[0]["id"], cards[1]["id"]
    for cid in (keep, drop):
        client.put(f"/papers/{pid}/study/flashcards/progress", headers=bearer(user), json={"card_id": cid, "state": "known"})

    class NewDeck(FakeStudyGemini):
        def __call__(self, prompt, schema):
            if schema.__name__ == "FlashcardSet":
                return schema(cards=[
                    {"category": "term", "question": "What is retrieval practice?", "answer": "Recalling from memory.", "pages": [1]},
                    {"category": "concept", "question": "Why does spacing help memory consolidation?", "answer": "Gaps force effortful recall.", "pages": [2]},
                ])
            return super().__call__(prompt, schema)

    monkeypatch.setattr(study, "_call_gemini", NewDeck())
    client.post(f"/papers/{pid}/study/flashcards/regenerate", headers=bearer(user))
    fc = output(client, user, pid, "flashcards")
    assert keep in {c["id"] for c in fc["content"]["cards"]}
    assert fc["progress"] == {keep: "known"}  # unchanged card keeps its mark; the removed card's mark is gone
