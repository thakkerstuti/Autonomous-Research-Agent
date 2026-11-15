import datetime
from sqlalchemy import Column, String, Integer, Text, DateTime, JSON, UniqueConstraint, Boolean, ForeignKey
from app.database import Base
import uuid

def generate_uuid():
    return str(uuid.uuid4())

class Paper(Base):
    __tablename__ = "papers"
    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, nullable=True) 
    title = Column(String)
    page_count = Column(Integer)
    file_size = Column(Integer)
    level = Column(String, default="Medium")
    status = Column(String, default="queued")
    overview = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class PaperPage(Base):
    __tablename__ = "paper_pages"
    id = Column(String, primary_key=True, default=generate_uuid)
    paper_id = Column(String, index=True)
    page_number = Column(Integer)
    text = Column(Text)
    status = Column(String) # pending, no_text, ready
    __table_args__ = (UniqueConstraint('paper_id', 'page_number', name='uix_paper_page'),)

class PageSummary(Base):
    __tablename__ = "page_summaries"
    id = Column(String, primary_key=True, default=generate_uuid)
    paper_id = Column(String, index=True)
    page_number = Column(Integer)
    level = Column(String)
    summary = Column(Text)
    key_points = Column(JSON, default=list)
    terms = Column(JSON, default=list)
    figures = Column(JSON, default=list)
    status = Column(String) # pending, processing, ready, failed
    error = Column(Text, nullable=True)
    model = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    __table_args__ = (UniqueConstraint('paper_id', 'page_number', 'level', name='uix_paper_page_level'),)

class ResearchSession(Base):
    __tablename__ = "research_sessions"
    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, nullable=True)
    title = Column(String)
    question = Column(Text)
    output_format = Column(String, default="full")  # quick, detailed, full
    status = Column(String, default="ready")        # ready, in_progress, partial, failed
    hypotheses = Column(JSON, default=list)
    evidence_log = Column(JSON, default=list)
    critique = Column(JSON, default=dict)
    report = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    stats = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)



# ───────────────────────── Authentication ─────────────────────────
# New tables only; created by Base.metadata.create_all at startup.
# Ownership of papers and research sessions uses their existing user_id column.

class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True, default=generate_uuid)
    email = Column(String(320), unique=True, index=True, nullable=False)  # stored lowercased
    email_verified = Column(Boolean, default=False, nullable=False)
    password_hash = Column(String, nullable=True)  # null for Google-only accounts
    name = Column(String(120), nullable=True)
    avatar_url = Column(String(1024), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)


class OAuthAccount(Base):
    __tablename__ = "oauth_accounts"
    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    provider = Column(String(32), nullable=False)
    provider_subject = Column(String(255), nullable=False)  # Google's stable "sub"
    email = Column(String(320), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    __table_args__ = (UniqueConstraint("provider", "provider_subject", name="uix_oauth_provider_subject"),)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    family_id = Column(String, index=True, nullable=False)
    token_hash = Column(String(64), unique=True, index=True, nullable=False)  # sha256 hex; raw token never stored
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)
    revoked_reason = Column(String(32), nullable=True)  # rotated, logout, logout_all, reuse_detected, password_reset
    user_agent = Column(String(512), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class AuthToken(Base):
    """Single-use tokens sent by email (password reset)."""
    __tablename__ = "auth_tokens"
    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    purpose = Column(String(32), nullable=False)
    token_hash = Column(String(64), unique=True, index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
