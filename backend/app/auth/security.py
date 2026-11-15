"""Request-level protections for the auth endpoints: Origin validation,
a CSRF header requirement, and in-memory rate limiting."""
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from app.auth import config

CSRF_HEADER = "x-cognexa-auth"


def client_ip(request: Request) -> str:
    # Render (and the Vercel rewrite in front of it) put the client first in
    # X-Forwarded-For. The header can be spoofed, so per-IP limits are a
    # coarse layer; the per-email limits below are the dependable ones.
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return request.client.host if request.client else "unknown"


def require_trusted_origin(request: Request) -> None:
    """Every state-changing auth request must come from our own frontend.

    Browsers always send Origin on POST, so a missing Origin means a
    non-browser client, which is allowed only when it also sends the CSRF
    header (a cross-site page cannot set custom headers without a CORS
    preflight, which we refuse). A present Origin must be one of ours.
    """
    origin = (request.headers.get("origin") or "").rstrip("/")
    if origin and origin not in config.ALLOWED_ORIGINS:
        raise HTTPException(status_code=403, detail="This request came from an untrusted origin.")
    if request.headers.get(CSRF_HEADER) != "1":
        raise HTTPException(status_code=403, detail="Missing request verification header.")


class RateLimiter:
    """Sliding-window limiter. Per process: fine for one Render instance;
    multiple instances would need a shared store such as Redis."""

    def __init__(self) -> None:
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_seconds: int) -> None:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window_seconds:
                q.popleft()
            if len(q) >= limit:
                retry = int(window_seconds - (now - q[0])) + 1
                raise HTTPException(
                    status_code=429,
                    detail="Too many attempts. Please wait a moment and try again.",
                    headers={"Retry-After": str(retry)},
                )
            q.append(now)
            if len(self._hits) > 50_000:  # keep memory bounded
                for k in [k for k, v in self._hits.items() if not v][:10_000]:
                    del self._hits[k]

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()
