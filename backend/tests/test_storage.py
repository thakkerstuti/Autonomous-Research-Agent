"""Original PDFs in Supabase Storage, with an in-memory bucket in place of the
real one (backend/conftest.py blanks the real settings, so no test reaches it).

Covers: where an upload is stored, what happens when Storage or the database
fails, authenticated download with byte ranges, ownership, legacy papers, and
the production rule that uploads never fall back to the server's own disk.
"""
import hashlib
import logging
import os

import fitz
import pytest

from app import models, papers, storage
from app.database import SessionLocal
from conftest import bearer, register

FAKE_KEY = "sb_secret_TEST_ONLY_never_logged"


def text_pdf(n_pages: int = 2) -> bytes:
    doc = fitz.open()
    for i in range(1, n_pages + 1):
        doc.new_page().insert_text((72, 72), f"Page {i}. Spaced retrieval practice strengthens memory.")
    return doc.tobytes()


class ApiError(Exception):
    """Shaped like storage3's StorageApiError (status, code, message)."""

    def __init__(self, message, status, code):
        super().__init__(message)
        self.message, self.status, self.code = message, status, code


class FakeBucket:
    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.options: dict[str, dict] = {}
        self.removed: list[str] = []
        self.fail_upload: Exception | None = None
        self.fail_download: Exception | None = None
        self.fail_remove: Exception | None = None

    def upload(self, path, data, options):
        if self.fail_upload:
            raise self.fail_upload
        if path in self.objects:  # like Storage without upsert
            raise ApiError("The resource already exists", 409, "Duplicate")
        self.objects[path] = bytes(data)
        self.options[path] = options

    def download(self, path):
        if self.fail_download:
            raise self.fail_download
        if path not in self.objects:
            raise ApiError("Object not found", 400, "not_found")
        return self.objects[path]

    def remove(self, paths):
        if self.fail_remove:
            raise self.fail_remove
        for p in paths:
            self.removed.append(p)
            self.objects.pop(p, None)


@pytest.fixture
def bucket(monkeypatch):
    fake = FakeBucket()
    monkeypatch.setenv("SUPABASE_URL", "https://example-project.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", FAKE_KEY)
    monkeypatch.setenv("SUPABASE_STORAGE_BUCKET", "cognexa-papers")
    monkeypatch.setattr(storage, "_bucket", lambda: fake)
    return fake


@pytest.fixture
def token(client):
    return register(client, email="owner@example.com").json()["access_token"]


def user_id(token_: str, client) -> str:
    return client.get("/auth/me", headers=bearer(token_)).json()["id"]


def upload(client, token_, data, name="paper.pdf"):
    return client.post("/papers", headers=bearer(token_), files={"file": (name, data, "application/pdf")}, data={"level": "Medium"})


def counts():
    with SessionLocal() as db:
        return db.query(models.Paper).count(), db.query(models.PaperPage).count()


def local_file(paper_id):
    return os.path.join(papers.UPLOAD_DIR, f"{paper_id}.pdf")


# ───────── upload ─────────

def test_upload_stores_pdf_in_bucket_and_records_path(client, token, bucket):
    data = text_pdf(3)
    r = upload(client, token, data)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    expected = f"{user_id(token, client)}/{pid}/original.pdf"

    assert list(bucket.objects) == [expected]
    assert hashlib.sha256(bucket.objects[expected]).hexdigest() == hashlib.sha256(data).hexdigest()
    assert bucket.options[expected]["content-type"] == "application/pdf"
    with SessionLocal() as db:
        paper = db.get(models.Paper, pid)
        assert paper.storage_path == expected
        assert db.query(models.PaperPage).filter_by(paper_id=pid).count() == 3  # extraction unchanged
    assert not os.path.exists(local_file(pid))  # nothing on the server's disk


def test_storage_failure_saves_nothing(client, token, bucket, caplog):
    bucket.fail_upload = ApiError(f"boom with {FAKE_KEY}", 500, "InternalError")
    before, files_before = counts(), set(os.listdir(papers.UPLOAD_DIR))
    with caplog.at_level(logging.DEBUG):
        r = upload(client, token, text_pdf())
    assert r.status_code == 503
    assert "nothing was saved" in r.json()["detail"]
    assert counts() == before  # no paper, no pages
    assert bucket.objects == {}
    assert set(os.listdir(papers.UPLOAD_DIR)) == files_before  # no fallback to local disk
    assert FAKE_KEY not in caplog.text and "boom" not in caplog.text  # only type/status/code are logged


def test_database_failure_removes_only_the_new_object(client, token, bucket, monkeypatch):
    other = "someone/else/original.pdf"
    bucket.objects[other] = b"%PDF existing document"

    def broken_page(**kwargs):
        raise RuntimeError("database write failed")

    before = counts()
    monkeypatch.setattr(models, "PaperPage", broken_page)
    r = upload(client, token, text_pdf())
    assert r.status_code == 500
    assert "nothing was kept" in r.json()["detail"]
    monkeypatch.undo()

    assert counts() == before
    assert len(bucket.removed) == 1 and bucket.removed[0].startswith(user_id(token, client) + "/")
    assert bucket.objects == {other: b"%PDF existing document"}  # the existing document is untouched


def test_failed_cleanup_is_logged_not_hidden(client, token, bucket, monkeypatch, caplog):
    bucket.fail_remove = ApiError("remove failed", 500, "InternalError")
    monkeypatch.setattr(models, "PaperPage", lambda **kw: (_ for _ in ()).throw(RuntimeError("db down")))
    with caplog.at_level(logging.ERROR):
        r = upload(client, token, text_pdf())
    assert r.status_code == 500
    assert "orphan file left" in caplog.text


def test_production_without_storage_refuses_upload(client, token, monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    before = counts()
    r = upload(client, token, text_pdf())
    assert r.status_code == 503
    assert "uploads are paused" in r.json()["detail"]
    assert counts() == before


def test_development_without_storage_uses_local_folder(client, token):
    data = text_pdf()
    r = upload(client, token, data)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    with SessionLocal() as db:
        assert db.get(models.Paper, pid).storage_path is None
    assert os.path.exists(local_file(pid))
    f = client.get(f"/papers/{pid}/file", headers=bearer(token))
    assert f.status_code == 200 and f.content == data


# ───────── download ─────────

def test_download_matches_original_and_supports_ranges(client, token, bucket):
    data = text_pdf(4)
    pid = upload(client, token, data).json()["id"]

    r = client.get(f"/papers/{pid}/file", headers=bearer(token))
    assert r.status_code == 200
    assert hashlib.sha256(r.content).hexdigest() == hashlib.sha256(data).hexdigest()
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["accept-ranges"] == "bytes"
    assert "no-store" in r.headers["cache-control"]

    r = client.get(f"/papers/{pid}/file", headers={**bearer(token), "Range": "bytes=0-1023"})
    assert r.status_code == 206 and r.content == data[:1024]
    assert r.headers["content-range"] == f"bytes 0-1023/{len(data)}"

    r = client.get(f"/papers/{pid}/file", headers={**bearer(token), "Range": "bytes=100-"})
    assert r.status_code == 206 and r.content == data[100:]

    r = client.get(f"/papers/{pid}/file", headers={**bearer(token), "Range": "bytes=-50"})
    assert r.status_code == 206 and r.content == data[-50:]

    r = client.get(f"/papers/{pid}/file", headers={**bearer(token), "Range": f"bytes={len(data) + 10}-"})
    assert r.status_code == 416 and r.headers["content-range"] == f"bytes */{len(data)}"


def test_other_user_gets_no_access(client, token, bucket):
    pid = upload(client, token, text_pdf()).json()["id"]
    other = register(client, email="other@example.com").json()["access_token"]
    downloads = []
    original = bucket.download
    bucket.download = lambda path: downloads.append(path) or original(path)

    r = client.get(f"/papers/{pid}/file", headers=bearer(other))
    assert r.status_code == 404
    assert downloads == []  # ownership is checked before Storage is touched
    assert client.get(f"/papers/{pid}/file").status_code == 401


def test_missing_object_and_storage_outage(client, token, bucket):
    pid = upload(client, token, text_pdf()).json()["id"]
    bucket.objects.clear()
    r = client.get(f"/papers/{pid}/file", headers=bearer(token))
    assert r.status_code == 404 and r.json()["detail"] == papers.NOT_STORED

    bucket.fail_download = ApiError(f"down {FAKE_KEY}", 503, "ServiceUnavailable")
    r = client.get(f"/papers/{pid}/file", headers=bearer(token))
    assert r.status_code == 502
    assert FAKE_KEY not in r.text


def test_legacy_paper_without_file_reports_not_stored(client, token):
    pid = upload(client, token, text_pdf()).json()["id"]
    os.remove(local_file(pid))  # test temp folder only
    r = client.get(f"/papers/{pid}/file", headers=bearer(token))
    assert r.status_code == 404 and r.json()["detail"] == papers.NOT_STORED
    # the paper's text is still there
    assert client.get(f"/papers/{pid}/pages/1/text", headers=bearer(token)).status_code == 200


# ───────── storage module ─────────

def test_settings_are_blank_in_tests():
    """Guard: the real bucket settings from backend/.env never reach the tests."""
    assert not storage.is_configured()
    assert storage.describe() == "not configured"


def test_describe_never_includes_the_key(bucket):
    assert FAKE_KEY not in storage.describe()
    assert "example-project.supabase.co" in storage.describe()


def test_not_found_is_mapped(bucket):
    with pytest.raises(storage.StorageNotFound):
        storage.download_pdf("nobody/none/original.pdf")


def test_uploads_never_overwrite(bucket):
    storage.upload_pdf("u/p/original.pdf", b"first")
    with pytest.raises(storage.StorageError):
        storage.upload_pdf("u/p/original.pdf", b"second")
    assert bucket.objects["u/p/original.pdf"] == b"first"
