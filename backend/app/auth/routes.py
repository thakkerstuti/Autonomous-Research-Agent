"""Authentication endpoints.

Session model
- Access token: 15-minute JWT returned in the JSON body. The frontend keeps
  it in memory only and sends it as `Authorization: Bearer` to the API.
- Refresh token: opaque random value in an HTTP-only cookie, stored hashed,
  rotated on every use, revocable per session or for all sessions.
- The browser reaches these endpoints through the frontend's own origin
  (Next.js rewrite /backend/auth/* -> API), so the cookie is first-party on
  the frontend domain and works without third-party cookies.
"""
import datetime as dt
import secrets
from urllib.parse import quote

from email_validator import EmailNotValidError, validate_email
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.auth import config, google, passwords, tokens
from app.auth.deps import get_current_user
from app.auth.emailer import send_password_reset
from app.auth.security import client_ip, limiter, require_trusted_origin
from app.database import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


# ───────── request bodies ─────────

class RegisterBody(BaseModel):
    email: str
    password: str
    name: str | None = None


class LoginBody(BaseModel):
    email: str
    password: str


class ForgotBody(BaseModel):
    email: str


class ResetBody(BaseModel):
    token: str
    password: str


class ProfileBody(BaseModel):
    name: str


# ───────── helpers ─────────

def _require_configured() -> None:
    if not config.AUTH_CONFIGURED:
        raise HTTPException(status_code=503, detail="Authentication is not configured on the server.")


def _normalise_email(raw: str) -> str:
    try:
        return validate_email((raw or "").strip(), check_deliverability=False).normalized.lower()
    except EmailNotValidError:
        raise HTTPException(status_code=400, detail="Enter a valid email address.")


def _clean_name(raw: str | None) -> str | None:
    name = " ".join((raw or "").split())[:120]
    return name or None


def _safe_next(path: str | None) -> str:
    """Only same-site relative paths, so the callback can't redirect elsewhere."""
    if not path or not path.startswith("/") or path.startswith("//") or "\\" in path or "://" in path:
        return "/dashboard"
    return path[:512]


def public_user(db: Session, user: models.User) -> dict:
    providers = [a.provider for a in db.query(models.OAuthAccount).filter(models.OAuthAccount.user_id == user.id)]
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "avatar_url": user.avatar_url,
        "email_verified": bool(user.email_verified),
        "has_password": user.password_hash is not None,
        "providers": providers,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


def _set_refresh_cookie(response: Response, raw: str) -> None:
    response.set_cookie(
        config.REFRESH_COOKIE,
        raw,
        max_age=config.REFRESH_TOKEN_DAYS * 86400,
        httponly=True,
        secure=config.COOKIE_SECURE,
        samesite="lax",
        path=config.COOKIE_PATH,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(config.REFRESH_COOKIE, path=config.COOKIE_PATH, secure=config.COOKIE_SECURE, httponly=True, samesite="lax")


def _start_session(db: Session, user: models.User, request: Request, response: Response) -> dict:
    user.last_login_at = tokens.utcnow()
    raw = tokens.issue_refresh_token(db, user.id, user_agent=request.headers.get("user-agent"))
    db.commit()
    _set_refresh_cookie(response, raw)
    access, expires_in = tokens.create_access_token(user.id)
    return {"access_token": access, "token_type": "bearer", "expires_in": expires_in, "user": public_user(db, user)}


# ───────── email + password ─────────

@router.post("/register", status_code=201)
def register(body: RegisterBody, request: Request, response: Response, db: Session = Depends(get_db)):
    _require_configured()
    require_trusted_origin(request)
    limiter.hit(f"register:ip:{client_ip(request)}", 10, 3600)

    email = _normalise_email(body.email)
    problem = passwords.password_problem(body.password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    if db.query(models.User).filter(models.User.email == email).first():
        raise HTTPException(status_code=409, detail="An account with this email already exists. Sign in instead.")

    user = models.User(email=email, password_hash=passwords.hash_password(body.password), name=_clean_name(body.name))
    db.add(user)
    db.flush()
    return _start_session(db, user, request, response)


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response, db: Session = Depends(get_db)):
    _require_configured()
    require_trusted_origin(request)
    email = (body.email or "").strip().lower()
    limiter.hit(f"login:ip:{client_ip(request)}", 30, 900)
    limiter.hit(f"login:email:{email}", 10, 900)

    user = db.query(models.User).filter(models.User.email == email).first()
    # verify_password always runs Argon2, so unknown emails take as long as known ones
    if not passwords.verify_password(body.password, user.password_hash if user else None):
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    if passwords.needs_rehash(user.password_hash):
        user.password_hash = passwords.hash_password(body.password)
    return _start_session(db, user, request, response)


@router.post("/refresh")
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    _require_configured()
    require_trusted_origin(request)
    limiter.hit(f"refresh:ip:{client_ip(request)}", 120, 60)
    raw = request.cookies.get(config.REFRESH_COOKIE)
    if not raw:
        raise HTTPException(status_code=401, detail="Not signed in.")
    try:
        user, new_raw = tokens.rotate_refresh_token(db, raw, user_agent=request.headers.get("user-agent"))
    except tokens.RefreshError:
        failed = JSONResponse({"detail": "Your session has ended. Sign in again."}, status_code=401)
        _clear_refresh_cookie(failed)
        return failed
    _set_refresh_cookie(response, new_raw)
    access, expires_in = tokens.create_access_token(user.id)
    return {"access_token": access, "token_type": "bearer", "expires_in": expires_in, "user": public_user(db, user)}


@router.post("/logout", status_code=204)
def logout(request: Request, db: Session = Depends(get_db)):
    require_trusted_origin(request)
    raw = request.cookies.get(config.REFRESH_COOKIE)
    if raw and config.AUTH_CONFIGURED:
        record = tokens.family_of(db, raw)
        if record:
            tokens.revoke_family(db, record.family_id, "logout")
            db.commit()
    response = Response(status_code=204)
    _clear_refresh_cookie(response)
    return response


@router.post("/logout-all", status_code=204)
def logout_all(request: Request, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_trusted_origin(request)
    tokens.revoke_all_for_user(db, user.id, "logout_all")
    db.commit()
    response = Response(status_code=204)
    _clear_refresh_cookie(response)
    return response


@router.get("/me")
def me(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    return public_user(db, user)


@router.patch("/me")
def update_me(body: ProfileBody, request: Request, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_trusted_origin(request)
    name = _clean_name(body.name)
    if not name:
        raise HTTPException(status_code=400, detail="Enter your name.")
    user.name = name
    db.commit()
    return public_user(db, user)


# ───────── forgot / reset password ─────────

@router.post("/forgot-password", status_code=202)
def forgot_password(body: ForgotBody, request: Request, background: BackgroundTasks, db: Session = Depends(get_db)):
    _require_configured()
    require_trusted_origin(request)
    email = (body.email or "").strip().lower()
    limiter.hit(f"forgot:ip:{client_ip(request)}", 10, 3600)
    limiter.hit(f"forgot:email:{email}", 3, 3600)

    generic = {"detail": "If an account exists for that email, we've sent a link to reset the password."}
    user = db.query(models.User).filter(models.User.email == email).first()
    if not user:
        return generic

    now = tokens.utcnow()
    # Only the newest link works
    db.query(models.AuthToken).filter(
        models.AuthToken.user_id == user.id,
        models.AuthToken.purpose == "reset_password",
        models.AuthToken.used_at.is_(None),
    ).update({"used_at": now}, synchronize_session=False)
    raw = secrets.token_urlsafe(32)
    db.add(models.AuthToken(
        user_id=user.id,
        purpose="reset_password",
        token_hash=tokens.sha256(raw),
        expires_at=now + dt.timedelta(minutes=config.RESET_TOKEN_MINUTES),
    ))
    db.commit()
    background.add_task(send_password_reset, user.email, f"{config.FRONTEND_URL}/reset-password?token={quote(raw)}")
    return generic


@router.post("/reset-password")
def reset_password(body: ResetBody, request: Request, db: Session = Depends(get_db)):
    _require_configured()
    require_trusted_origin(request)
    limiter.hit(f"reset:ip:{client_ip(request)}", 10, 3600)

    problem = passwords.password_problem(body.password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    record = db.query(models.AuthToken).filter(
        models.AuthToken.token_hash == tokens.sha256(body.token or ""),
        models.AuthToken.purpose == "reset_password",
    ).first()
    now = tokens.utcnow()
    if not record or record.used_at is not None or record.expires_at <= now:
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired. Request a new one.")
    user = db.get(models.User, record.user_id)
    if not user:
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired. Request a new one.")

    user.password_hash = passwords.hash_password(body.password)
    # Receiving the link proves the address belongs to them
    user.email_verified = True
    record.used_at = now
    tokens.revoke_all_for_user(db, user.id, "password_reset")
    db.commit()
    return {"detail": "Your password has been changed. Sign in with the new password."}


# ───────── Google ─────────

def _login_redirect(error: str) -> RedirectResponse:
    resp = RedirectResponse(f"{config.FRONTEND_URL}/login?error={quote(error)}", status_code=303)
    resp.delete_cookie(config.OAUTH_STATE_COOKIE, path=f"{config.COOKIE_PATH}/google")
    return resp


@router.post("/google/link-intent")
def google_link_intent(request: Request, user: models.User = Depends(get_current_user)):
    """Linking Google to an existing account only happens while signed in.
    The navigation that follows can't carry the bearer token, so it carries
    a short-lived signed reference to this user instead."""
    require_trusted_origin(request)
    ticket = tokens.sign_value({"uid": user.id}, "google_link", minutes=5)
    return {"url": f"{config.COOKIE_PATH}/google/login?link={quote(ticket)}"}


@router.get("/google/login")
def google_login(request: Request, next: str | None = None, link: str | None = None, db: Session = Depends(get_db)):
    if not (config.AUTH_CONFIGURED and config.GOOGLE_CONFIGURED):
        return _login_redirect("google_unavailable")
    limiter.hit(f"google:ip:{client_ip(request)}", 30, 600)

    link_uid = None
    if link:
        ticket = tokens.read_signed_value(link, "google_link")
        if not ticket:
            return _login_redirect("link_expired")
        # The ticket only works in the browser that asked for it: that
        # browser's own live session cookie must belong to the same user,
        # so a leaked link can't attach someone else's Google account.
        raw = request.cookies.get(config.REFRESH_COOKIE)
        session = tokens.family_of(db, raw) if raw else None
        if (
            session is None
            or session.user_id != ticket["uid"]
            or session.revoked_at is not None
            or session.expires_at <= tokens.utcnow()
        ):
            return _login_redirect("link_expired")
        link_uid = ticket["uid"]

    req = google.build_authorization_request()
    state_cookie = tokens.sign_value(
        {
            "state": req["state"],
            "nonce": req["nonce"],
            "cv": req["code_verifier"],
            "next": "/settings" if link_uid else _safe_next(next),
            "link_uid": link_uid,
        },
        "oauth_state",
        minutes=10,
    )
    resp = RedirectResponse(req["url"], status_code=303)
    resp.set_cookie(
        config.OAUTH_STATE_COOKIE,
        state_cookie,
        max_age=600,
        httponly=True,
        secure=config.COOKIE_SECURE,
        samesite="lax",  # sent on Google's top-level redirect back to us
        path=f"{config.COOKIE_PATH}/google",
    )
    return resp


@router.get("/google/callback")
def google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    if not (config.AUTH_CONFIGURED and config.GOOGLE_CONFIGURED):
        return _login_redirect("google_unavailable")
    if error:
        return _login_redirect("google_cancelled" if error == "access_denied" else "google_failed")

    saved = tokens.read_signed_value(request.cookies.get(config.OAUTH_STATE_COOKIE, ""), "oauth_state")
    if not saved or not state or not code or not secrets.compare_digest(saved["state"], state):
        return _login_redirect("google_state")

    try:
        token = google.exchange_code(code, saved["cv"])
        claims = google.verify_id_token(token.get("id_token", ""), saved["nonce"])
    except google.GoogleAuthError:
        return _login_redirect("google_failed")

    if not claims.get("email") or claims.get("email_verified") is not True:
        return _login_redirect("google_unverified")
    subject = str(claims["sub"])
    email = str(claims["email"]).strip().lower()

    account = db.query(models.OAuthAccount).filter(
        models.OAuthAccount.provider == "google",
        models.OAuthAccount.provider_subject == subject,
    ).first()

    link_uid = saved.get("link_uid")
    if link_uid:
        # Signed-in user connecting Google from Settings
        user = db.get(models.User, link_uid)
        if not user:
            return _login_redirect("link_expired")
        if account and account.user_id != user.id:
            resp = RedirectResponse(f"{config.FRONTEND_URL}/settings?google=in_use", status_code=303)
            resp.delete_cookie(config.OAUTH_STATE_COOKIE, path=f"{config.COOKIE_PATH}/google")
            return resp
        if not account:
            db.add(models.OAuthAccount(user_id=user.id, provider="google", provider_subject=subject, email=email))
        if not user.avatar_url and claims.get("picture"):
            user.avatar_url = str(claims["picture"])[:1024]
        db.commit()
        next_path = "/settings?google=linked"
    elif account:
        user = db.get(models.User, account.user_id)
        if not user:
            return _login_redirect("google_failed")
        next_path = saved.get("next") or "/dashboard"
    else:
        existing = db.query(models.User).filter(models.User.email == email).first()
        if existing:
            # Never link on a matching email alone: the owner must sign in
            # with their password first and connect Google from Settings.
            return _login_redirect("account_exists")
        user = models.User(
            email=email,
            email_verified=True,
            name=_clean_name(claims.get("name")),
            avatar_url=(str(claims["picture"])[:1024] if claims.get("picture") else None),
        )
        db.add(user)
        db.flush()
        db.add(models.OAuthAccount(user_id=user.id, provider="google", provider_subject=subject, email=email))
        db.commit()
        next_path = saved.get("next") or "/dashboard"

    resp = RedirectResponse(f"{config.FRONTEND_URL}{_safe_next(next_path)}", status_code=303)
    resp.delete_cookie(config.OAUTH_STATE_COOKIE, path=f"{config.COOKIE_PATH}/google")
    user.last_login_at = tokens.utcnow()
    raw = tokens.issue_refresh_token(db, user.id, user_agent=request.headers.get("user-agent"))
    db.commit()
    _set_refresh_cookie(resp, raw)
    return resp
