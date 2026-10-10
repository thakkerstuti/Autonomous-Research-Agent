import os
from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.database import get_db
import app.models as models
import fitz # PyMuPDF
import json

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

router = APIRouter(prefix="/papers", tags=["papers"])

@router.post("")
def upload_paper(
    background_tasks: BackgroundTasks,
    level: str = Form("Medium"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db) 
):
    file_bytes = file.file.read()
    
    # Validation 4: check real %PDF header
    if not file_bytes.startswith(b'%PDF'):
        raise HTTPException(status_code=400, detail="Invalid file format. Must be a PDF.")
        
    if len(file_bytes) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size exceeds limit (20MB).")
        
    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid or corrupt PDF file.")
        
    page_count = len(doc)
    if page_count > 100:
        raise HTTPException(status_code=400, detail="Paper exceeds maximum allowed pages (100).")
        
    new_paper = models.Paper(
        title=file.filename,
        page_count=page_count,
        file_size=len(file_bytes),
        level=level,
        status="processing"
    )
    db.add(new_paper)
    db.commit()
    db.refresh(new_paper)
    
    # Save file
    file_path = os.path.join(UPLOAD_DIR, f"{new_paper.id}.pdf")
    with open(file_path, "wb") as f:
        f.write(file_bytes)
    
    for i in range(page_count):
        page = doc[i]
        text = page.get_text("text").strip()
        status = "ready" if text else "no_text"
            
        paper_page = models.PaperPage(
            paper_id=new_paper.id,
            page_number=i + 1,
            text=text,
            status=status
        )
        db.add(paper_page)
        
        if status == "ready":
            summary = models.PageSummary(
                paper_id=new_paper.id,
                page_number=i + 1,
                level=level,
                status="pending"
            )
            db.add(summary)
            
    db.commit()
    
    from app.tasks import generate_summaries_job
    background_tasks.add_task(generate_summaries_job, new_paper.id, level)
    
    return {"id": new_paper.id, "message": "Queued for processing."}

@router.get("/{paper_id}/file")
def get_paper_file(paper_id: str):
    file_path = os.path.join(UPLOAD_DIR, f"{paper_id}.pdf")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path, media_type="application/pdf")

@router.get("/{paper_id}")
def get_paper(paper_id: str, db: Session = Depends(get_db)):
    paper = db.query(models.Paper).filter(models.Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    return paper

@router.patch("/{paper_id}")
def update_paper(paper_id: str, level: str = Form(...), db: Session = Depends(get_db), background_tasks=BackgroundTasks()):
    paper = db.query(models.Paper).filter(models.Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
        
    paper.level = level
    
    # Create missing summary rows for new level
    pages = db.query(models.PaperPage).filter(models.PaperPage.paper_id == paper_id, models.PaperPage.status == "ready").all()
    existing_summaries = db.query(models.PageSummary).filter(
        models.PageSummary.paper_id == paper_id,
        models.PageSummary.level == level
    ).all()
    
    existing_pages = {s.page_number for s in existing_summaries}
    new_summaries = 0
    for page in pages:
        if page.page_number not in existing_pages:
            new_summary = models.PageSummary(
                paper_id=paper_id,
                page_number=page.page_number,
                level=level,
                status="pending"
            )
            db.add(new_summary)
            new_summaries += 1
            
    db.commit()
    
    if new_summaries > 0:
        from app.tasks import generate_summaries_job
        background_tasks.add_task(generate_summaries_job, paper.id, level)
    
    return {"id": paper.id, "level": level, "status": "processing" if new_summaries > 0 else "ready"}

@router.get("/{paper_id}/pages")
def get_paper_pages(paper_id: str, db: Session = Depends(get_db)):
    paper = db.query(models.Paper).filter(models.Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
        
    summaries = db.query(models.PageSummary).filter(
        models.PageSummary.paper_id == paper_id,
        models.PageSummary.level == paper.level
    ).order_by(models.PageSummary.page_number).all()
    
    return {"pages": [{"page_number": s.page_number, "status": s.status} for s in summaries]}

@router.get("/{paper_id}/pages/{page_number}")
def get_paper_page(paper_id: str, page_number: int, level: str = "Medium", db: Session = Depends(get_db)):
    paper = db.query(models.Paper).filter(models.Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
        
    summary = db.query(models.PageSummary).filter(
        models.PageSummary.paper_id == paper_id,
        models.PageSummary.page_number == page_number,
        models.PageSummary.level == level
    ).first()
    
    if not summary:
        raise HTTPException(status_code=404, detail="Summary not found")
        
    if summary.status != "ready":
        # Generate on demand
        from app.tasks import generate_single_page_summary
        summary = generate_single_page_summary(paper_id, page_number, level, db)
        
    return summary

@router.post("/{paper_id}/pages/{page_number}/regenerate")
def regenerate_paper_page(paper_id: str, page_number: int, level: str = "Medium", db: Session = Depends(get_db)):
    paper = db.query(models.Paper).filter(models.Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
        
    summary = db.query(models.PageSummary).filter(
        models.PageSummary.paper_id == paper_id,
        models.PageSummary.page_number == page_number,
        models.PageSummary.level == level
    ).first()
    
    if not summary:
        raise HTTPException(status_code=404, detail="Summary not found")
        
    from app.tasks import generate_single_page_summary
    doc = generate_single_page_summary(paper_id, page_number, level, db)
    return doc

import time
import asyncio
from fastapi.responses import StreamingResponse

@router.get("/{paper_id}/progress")
async def get_paper_progress(paper_id: str, db: Session = Depends(get_db)):
    paper = db.query(models.Paper).filter(models.Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
        
    level = paper.level

    async def event_generator():
        while True:
            # Reopen session just for queries
            from app.database import SessionLocal
            local_db = SessionLocal()
            try:
                summaries = local_db.query(models.PageSummary).filter(
                    models.PageSummary.paper_id == paper_id,
                    models.PageSummary.level == level
                ).all()
                total = len(summaries)
                done = sum(1 for s in summaries if s.status == "ready")
                failed = sum(1 for s in summaries if s.status == "failed")
                pending = sum(1 for s in summaries if s.status == "pending")
                
                yield f"data: {json.dumps({'done': done, 'total': total, 'failed': failed, 'current_page': done + 1})}\n\n"
                
                if total > 0 and (done + failed) == total:
                    break
            finally:
                local_db.close()
                
            await asyncio.sleep(2)
            
    return StreamingResponse(event_generator(), media_type="text/event-stream")
