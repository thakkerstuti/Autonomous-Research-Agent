import datetime
from sqlalchemy import Column, String, Integer, Text, DateTime, JSON, UniqueConstraint, Boolean, ForeignKey, Index
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
    storage_path = Column(String(512), nullable=True)  # original PDF in Supabase Storage; null = local file or not stored

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
    thread_id = Column(String(36), index=True, nullable=True)  # conversation this question belongs to; null = its own thread
    progress = Column(JSON, nullable=True)  # user-facing working flow (high-level stages only)


class ResearchDocument(Base):
    """The full research paper written from one research session."""
    __tablename__ = "research_documents"
    id = Column(String, primary_key=True, default=generate_uuid)
    session_id = Column(String, ForeignKey("research_sessions.id", ondelete="CASCADE"), unique=True, index=True, nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    title = Column(String(500), nullable=True)
    status = Column(String(16), nullable=False, default="generating")  # generating, ready, failed
    error = Column(Text, nullable=True)
    current_version = Column(Integer, nullable=False, default=0)
    edited = Column(Boolean, nullable=False, default=False)
    pdf_path = Column(String(512), nullable=True)  # private Supabase Storage object of pdf_version
    pdf_version = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class ResearchDocumentVersion(Base):
    """Every saved state of a paper: version 1 is the generated original, later ones are the user's saves."""
    __tablename__ = "research_document_versions"
    id = Column(String, primary_key=True, default=generate_uuid)
    document_id = Column(String, ForeignKey("research_documents.id", ondelete="CASCADE"), index=True, nullable=False)
    version = Column(Integer, nullable=False)
    source = Column(String(16), nullable=False)  # generated, edit
    content = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    __table_args__ = (UniqueConstraint("document_id", "version", name="uix_research_document_version"),)


class ChatMessage(Base):
    """One message in the follow-up chat of a research session (its own conversation, per session)."""
    __tablename__ = "chat_messages"
    id = Column(String, primary_key=True, default=generate_uuid)
    session_id = Column(String, ForeignKey("research_sessions.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    role = Column(String(16), nullable=False)  # user, assistant
    content = Column(Text, nullable=False)
    sources = Column(JSON, nullable=True)  # assistant: the numbered sources its [n] citations point to
    used_web_search = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    __table_args__ = (Index("ix_chat_messages_session_created", "session_id", "created_at"),)



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


# ───────────────────────── Paper Study kit ─────────────────────────
# New table only (created by create_all at startup, like the auth tables).

class StudyArtifact(Base):
    """One generated study output for a paper, stored as JSON.

    kind is "chunk:<n>" for the per-chunk notes of the map step, or one of
    "summary", "flashcards", "questions", "highlights" for paper-level
    outputs, plus "flashcard_progress" and "asks" for the reader's own state.
    """
    __tablename__ = "study_artifacts"
    id = Column(String, primary_key=True, default=generate_uuid)
    paper_id = Column(String, ForeignKey("papers.id", ondelete="CASCADE"), index=True, nullable=False)
    kind = Column(String(64), nullable=False)
    status = Column(String(16), nullable=False, default="pending")  # pending, processing, ready, failed
    content = Column(JSON, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    __table_args__ = (UniqueConstraint("paper_id", "kind", name="uix_study_paper_kind"),)
