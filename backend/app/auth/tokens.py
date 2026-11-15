"""Access tokens (short-lived JWT, held in browser memory) and refresh tokens
(opaque, HTTP-only cookie, stored hashed, rotated on every use)."""
import datetime as dt
import hashlib
import secrets
import uuid

import jwt
from sqlalchemy.orm import Session

from app import models
from app.auth import config


def utcnow() -> dt.datetime:
    # The existing schema stores naive UTC datetimes; stay consistent with it.
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


# ───────── access tokens ─────────

def create_access_token(user_id: str) -> tuple[str, int]:
    now = dt.datetime.now(dt.timezone.utc)
    lifetime = dt.timedelta(minutes=config.ACCESS_TOKEN_MINUTES)
    payload = {
        "sub": user_id,
        "typ": "access",
        "iss": config.JWT_ISSUER,
        "aud": config.JWT_AUDIENCE,
        "iat": now,
        "exp": now + lifetime,
        "jti": uuid.uuid4().hex,
    }
    token = jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)
    return token, int(lifetime.total_seconds())


def decode_access_token(token: str) -> str | None:
    """Returns the user id, or None when the token is invalid or expired."""
    try:
        payload = jwt.decode(
            token,
            config.JWT_SECRET,
            algorithms=[config.JWT_ALGORITHM],
            audience=config.JWT_AUDIENCE,
            issuer=config.JWT_ISSUER,
            options={"require": ["exp", "iat", "sub", "aud", "iss"]},
        )
    except jwt.PyJWTError:
        return None
    if payload.get("typ") != "access":
        return None
    return payload.get("sub")


# ───────── signed short-lived values (OAuth state cookie) ─────────

def sign_value(data: dict, purpose: str, minutes: int) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    payload = {**data, "typ": purpose, "iat": now, "exp": now + dt.timedelta(minutes=minutes)}
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)


def read_signed_value(token: str, purpose: str) -> dict | None:
    try:
        payload = jwt.decode(token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
    return payload if payload.get("typ") == purpose else None


# ───────── refresh tokens ─────────

def issue_refresh_token(db: Session, user_id: str, family_id: str | None = None, user_agent: str | None = None) -> str:
    raw = secrets.token_urlsafe(32)
    db.add(
        models.RefreshToken(
            user_id=user_id,
            family_id=family_id or uuid.uuid4().hex,
            token_hash=sha256(raw),
            expires_at=utcnow() + dt.timedelta(days=config.REFRESH_TOKEN_DAYS),
            user_agent=(user_agent or "")[:512] or None,
        )
    )
    return raw


def revoke_family(db: Session, family_id: str, reason: str) -> None:
    now = utcnow()
    db.query(models.RefreshToken).filter(
        models.RefreshToken.family_id == family_id,
        models.RefreshToken.revoked_at.is_(None),
    ).update({"revoked_at": now, "revoked_reason": reason}, synchronize_session=False)


def revoke_all_for_user(db: Session, user_id: str, reason: str) -> None:
    now = utcnow()
    db.query(models.RefreshToken).filter(
        models.RefreshToken.user_id == user_id,
        models.RefreshToken.revoked_at.is_(None),
    ).update({"revoked_at": now, "revoked_reason": reason}, synchronize_session=False)


class RefreshError(Exception):
    pass


def rotate_refresh_token(db: Session, raw: str, user_agent: str | None = None) -> tuple[models.User, str]:
    """Consumes a refresh token and returns (user, new raw token).

    A token that was already rotated is reuse. Within a short grace window
    this is two tabs refreshing at the same moment and gets a fresh token in
    the same family; after it, the whole family is revoked (likely theft).
    """
    record = db.query(models.RefreshToken).filter(models.RefreshToken.token_hash == sha256(raw)).first()
    if record is None:
        raise RefreshError("unknown")
    now = utcnow()

    if record.revoked_at is not None:
        within_grace = (
            record.revoked_reason == "rotated"
            and (now - record.revoked_at).total_seconds() <= config.REFRESH_REUSE_GRACE_SECONDS
        )
        family_alive = db.query(models.RefreshToken).filter(
            models.RefreshToken.family_id == record.family_id,
            models.RefreshToken.revoked_at.is_(None),
        ).count() > 0
        if not (within_grace and family_alive):
            revoke_family(db, record.family_id, "reuse_detected")
            db.commit()
            raise RefreshError("reused")
    elif record.expires_at <= now:
        raise RefreshError("expired")

    user = db.get(models.User, record.user_id)
    if user is None:
        raise RefreshError("no_user")

    if record.revoked_at is None:
        record.revoked_at = now
        record.revoked_reason = "rotated"
    new_raw = issue_refresh_token(db, user.id, family_id=record.family_id, user_agent=user_agent)
    db.commit()
    return user, new_raw


def family_of(db: Session, raw: str) -> models.RefreshToken | None:
    return db.query(models.RefreshToken).filter(models.RefreshToken.token_hash == sha256(raw)).first()
