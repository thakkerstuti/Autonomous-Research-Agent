"""Application logging for operational events (uploads, processing).

Only the "cognexa" logger tree is configured here, so third-party HTTP
client logs (which can include request URLs) are left at their defaults.
Callers must never log API keys, authorization headers, tokens or PDF text.
"""
import logging
import sys

_root = logging.getLogger("cognexa")
if not _root.handlers:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
    _root.addHandler(handler)
    _root.setLevel(logging.INFO)
    _root.propagate = False


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"cognexa.{name}")
