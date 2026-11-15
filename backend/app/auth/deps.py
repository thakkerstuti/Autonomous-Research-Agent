"""FastAPI dependencies: the authenticated user is always derived from the
verified access token, never from anything the client sends as data."""
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app import models
from app.auth import config
from app.auth.tokens import decode_access_token
from app.database import get_db

_UNAUTHORIZED = {"WWW-Authenticate": "Bearer"}


def _bearer(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def get_current_user(request: Request, db: Session = Depends(get_db)) -> models.User:
    if not config.AUTH_CONFIGURED:
        raise HTTPException(status_code=503, detail="Authentication is not configured on the server.")
    token = _bearer(request)
    if not token:
        raise HTTPException(status_code=401, detail="Sign in to continue.", headers=_UNAUTHORIZED)
    user_id = decode_access_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Your session has expired. Sign in again.", headers=_UNAUTHORIZED)
    user = db.get(models.User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in to continue.", headers=_UNAUTHORIZED)
    return user
