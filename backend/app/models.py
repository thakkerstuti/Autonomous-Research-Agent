import datetime
from sqlalchemy import Column, String, Integer, Text, DateTime, JSON, UniqueConstraint
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
