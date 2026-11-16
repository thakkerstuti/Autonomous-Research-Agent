"""Original PDF files in Supabase Storage (private bucket).

PostgreSQL keeps each paper's metadata and extracted text; the PDF bytes live in
the bucket at {user_id}/{paper_id}/original.pdf. The bucket is private: only this
backend reads or writes it, with the secret key, after it has checked that the
signed-in user owns the paper. The key never reaches the browser or the logs.

Settings (environment or backend/.env): SUPABASE_URL, SUPABASE_SECRET_KEY,
SUPABASE_STORAGE_BUCKET. Without them, uploads use the local folder in
development only; in production (Render) uploads are refused rather than kept
on a disk that is wiped on restart.
"""
import os
from urllib.parse import urlparse

from dotenv import load_dotenv

from app.log import get_logger

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_DIR, ".env"))  # never overrides variables that are already set

log = get_logger("storage")
PDF_CONTENT_TYPE = "application/pdf"


class StorageError(Exception):
    """The storage service failed or refused the request. The message is safe to log."""


class StorageNotFound(StorageError):
    """The object does not exist in the bucket."""


def _settings() -> tuple[str, str, str]:
    return (
        os.getenv("SUPABASE_URL", "").strip().rstrip("/"),
        os.getenv("SUPABASE_SECRET_KEY", "").strip(),
        os.getenv("SUPABASE_STORAGE_BUCKET", "").strip(),
    )


def is_configured() -> bool:
    return all(_settings())


def is_production() -> bool:
    return os.getenv("APP_ENV", "").lower() == "production" or os.getenv("RENDER", "").lower() == "true"


def local_files_allowed() -> bool:
    """Local disk for PDFs: development only, and only when Storage isn't configured."""
    return not is_configured() and not is_production()


def describe() -> str:
    """A secret-free description, safe for logs."""
    url, _, bucket = _settings()
    if not is_configured():
        return "not configured"
    return f"supabase storage (host={urlparse(url).hostname}, bucket={bucket})"


def object_path(user_id: str, paper_id: str) -> str:
    """Built on the server from ids the database owns; never from request input."""
    return f"{user_id}/{paper_id}/original.pdf"


_client = None
_client_key = None


def _bucket():
    """The bucket API, created once per process (rebuilt if the settings change)."""
    global _client, _client_key
    url, key, bucket = _settings()
    if not (url and key and bucket):
        raise StorageError("Supabase Storage is not configured")
    if _client is None or _client_key != (url, key):
        from storage3 import SyncStorageClient
        _client = SyncStorageClient(f"{url}/storage/v1/", {"apiKey": key, "Authorization": f"Bearer {key}"})
        _client_key = (url, key)
    return _client.from_(bucket)


def _safe(exc: Exception) -> str:
    """Error text without anything that could carry a credential."""
    status = getattr(exc, "status", None)
    code = getattr(exc, "code", None)
    return f"{type(exc).__name__}" + (f" status={status}" if status is not None else "") + (f" code={code}" if code else "")


def _is_not_found(exc: Exception) -> bool:
    status = str(getattr(exc, "status", ""))
    code = str(getattr(exc, "code", "")).lower()
    message = str(getattr(exc, "message", "")).lower()
    return status == "404" or code in ("not_found", "nosuchkey") or "not found" in message


def upload_pdf(path: str, data: bytes) -> None:
    """Store a new object. Never overwrites: an existing object at `path` is an error."""
    try:
        _bucket().upload(path, data, {"content-type": PDF_CONTENT_TYPE, "cache-control": "private, max-age=0"})
    except StorageError:
        raise
    except Exception as exc:
        raise StorageError(f"upload failed: {_safe(exc)}") from None


def download_pdf(path: str) -> bytes:
    try:
        return _bucket().download(path)
    except StorageError:
        raise
    except Exception as exc:
        if _is_not_found(exc):
            raise StorageNotFound("object not found") from None
        raise StorageError(f"download failed: {_safe(exc)}") from None


def remove_object(path: str) -> None:
    """Remove one object this request created (cleanup after a failed database write)."""
    try:
        _bucket().remove([path])
    except StorageError:
        raise
    except Exception as exc:
        raise StorageError(f"remove failed: {_safe(exc)}") from None
