"""Renders a research paper's saved content (app.research_paper JSON) to a PDF.

Uses PyMuPDF's HTML layout engine (already a dependency for Paper Study), so no
new package is needed. The layout is a conventional academic document: A4,
generous margins, a cover page, the abstract, numbered sections, references on
a new page, a running header and page numbers.
"""
import datetime
import html
import re

import fitz  # PyMuPDF

PAGE = fitz.paper_rect("a4")  # 595 x 842 pt
MARGIN_X, MARGIN_TOP, MARGIN_BOTTOM = 72, 78, 72
BODY_RECT = fitz.Rect(MARGIN_X, MARGIN_TOP, PAGE.width - MARGIN_X, PAGE.height - MARGIN_BOTTOM)

CSS = """
* { font-family: serif; color: #1c1c1f; }
body { font-size: 11pt; line-height: 1.5; }
p { margin: 0 0 7pt 0; text-align: justify; }
h1 { font-size: 13.5pt; font-weight: bold; margin: 20pt 0 8pt 0; }
h2 { font-size: 11.5pt; font-weight: bold; font-style: italic; margin: 14pt 0 6pt 0; }
ul { margin: 0 0 8pt 0; padding-left: 16pt; }
li { margin: 0 0 3pt 0; text-align: justify; }
.abstract-h { font-size: 12pt; font-weight: bold; text-align: center; margin: 0 0 8pt 0; }
.abstract { font-size: 10.5pt; margin: 0 22pt 8pt 22pt; }
.keywords { font-size: 10pt; margin: 0 22pt 16pt 22pt; }
.cover-kicker { font-size: 9pt; letter-spacing: 2pt; color: #6b6b70; text-align: center; margin: 0 0 18pt 0; }
.cover-title { font-size: 23pt; font-weight: bold; line-height: 1.25; text-align: center; margin: 0 0 18pt 0; }
.cover-question { font-size: 11pt; font-style: italic; color: #46464b; text-align: center; margin: 0 30pt 34pt 30pt; }
.cover-meta { font-size: 11pt; text-align: center; margin: 0 0 4pt 0; }
.cover-note { font-size: 9pt; color: #6b6b70; text-align: center; margin: 40pt 40pt 0 40pt; }
.ref { font-size: 9.5pt; line-height: 1.4; margin: 0 0 6pt 0; text-align: left; }
.ref-n { font-weight: bold; }
"""


def _esc(text: str) -> str:
    return html.escape(text or "", quote=False)


def _inline(text: str) -> str:
    """Escape, then allow **bold** and *italic* from the editor."""
    out = _esc(text)
    out = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", out)
    out = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<i>\1</i>", out)
    return out


def _body_html(body: str) -> str:
    parts, items = [], []

    def flush():
        if items:
            parts.append("<ul>" + "".join(f"<li>{_inline(i)}</li>" for i in items) + "</ul>")
            items.clear()

    for block in re.split(r"\n\s*\n", (body or "").strip()):
        lines = [ln.rstrip() for ln in block.split("\n") if ln.strip()]
        if not lines:
            continue
        if all(re.match(r"^\s*[-*•]\s+", ln) for ln in lines):
            items.extend(re.sub(r"^\s*[-*•]\s+", "", ln) for ln in lines)
            continue
        flush()
        parts.append(f"<p>{_inline(' '.join(ln.strip() for ln in lines))}</p>")
    flush()
    return "".join(parts)


def _long_date(iso: str) -> str:
    try:
        d = datetime.date.fromisoformat((iso or "")[:10])
        return f"{d.day} {d.strftime('%B %Y')}"
    except ValueError:
        return iso or ""


def numbered_headings(sections: list[dict]) -> list[tuple[str, dict]]:
    out, n1, n2 = [], 0, 0
    for s in sections:
        if s.get("level") == 2:
            n2 += 1
            num = f"{n1}.{n2}" if n1 else f"{n2}"
        else:
            n1, n2 = n1 + 1, 0
            num = f"{n1}."
        out.append((num, s))
    return out


def _cover_html(c: dict) -> str:
    meta = []
    if c.get("author"):
        meta.append(f'<p class="cover-meta">{_esc(c["author"])}</p>')
    meta.append(f'<p class="cover-meta">{_esc(_long_date(c.get("date", "")))}</p>')
    question = c.get("question") or ""
    return (
        '<div style="margin-top:150pt">'
        '<p class="cover-kicker">RESEARCH PAPER</p>'
        f'<p class="cover-title">{_esc(c.get("title") or "Untitled research paper")}</p>'
        + (f'<p class="cover-question">Research question: {_esc(question)}</p>' if question else "")
        + "".join(meta)
        + '<p class="cover-note">Prepared with CogNexa from openly available published sources. '
        "Every citation refers to a source listed in the References.</p></div>"
    )


def _main_html(c: dict) -> str:
    out = []
    if (c.get("abstract") or "").strip():
        out.append('<p class="abstract-h">Abstract</p>')
        out.append(f'<div class="abstract">{_body_html(c["abstract"])}</div>')
        if c.get("keywords"):
            out.append(f'<p class="keywords"><b>Keywords:</b> {_esc(", ".join(c["keywords"]))}</p>')
    for num, s in numbered_headings(c.get("sections") or []):
        tag = "h2" if s.get("level") == 2 else "h1"
        out.append(f"<{tag}>{_esc(num)} {_esc(s.get('heading') or '')}</{tag}>")
        out.append(_body_html(s.get("body") or ""))
    return "".join(out)


def _refs_html(c: dict) -> str:
    refs = c.get("references") or []
    if not refs:
        return ""
    out = ['<h1 style="page-break-before: always; margin-top: 0">References</h1>']
    for r in refs:
        bits = [f'<span class="ref-n">[{r.get("n")}]</span> {_esc(r.get("title") or "Untitled")}.']
        if r.get("site"):
            bits.append(f" {_esc(r['site'])}.")
        url = r.get("url") or ""
        if url.startswith(("http://", "https://")):  # clickable, and copies as the exact URL
            bits.append(f' Available at: <a href="{html.escape(url, quote=True)}">{_esc(url)}</a>')
        elif url:
            bits.append(f" Available at: {_esc(url)}")
        if r.get("accessed"):
            bits.append(f" (accessed {_esc(_long_date(r['accessed']))})")
        out.append(f'<p class="ref">{"".join(bits)}.</p>')
    return "".join(out)


COVER_RECT = fitz.Rect(MARGIN_X + 20, MARGIN_TOP, PAGE.width - MARGIN_X - 20, PAGE.height - MARGIN_BOTTOM)


def render_pdf(content: dict) -> bytes:
    # One flow: cover, then (new page) abstract and sections, then (new page) references.
    # write_with_links keeps the reference URLs clickable.
    markup = (_cover_html(content)
              + f'<div style="page-break-before: always">{_main_html(content) or "<p></p>"}</div>'
              + _refs_html(content))
    story = fitz.Story(markup, user_css=CSS)
    doc = story.write_with_links(lambda n, filled: (PAGE, COVER_RECT if n == 0 else BODY_RECT, None))
    title = content.get("title") or "Research paper"
    short = title if len(title) <= 80 else title[:77].rsplit(" ", 1)[0] + "…"
    total = len(doc) - 1
    for i, page in enumerate(doc):
        if i == 0:
            continue  # the cover carries no header or number
        # insert_htmlbox uses the same Unicode-capable fonts as the body (any script in the title)
        page.insert_htmlbox(fitz.Rect(MARGIN_X, 34, PAGE.width - MARGIN_X, 52), f"<p>{_esc(short)}</p>",
                            css=f"{CSS} p {{ font-size: 8.5pt; font-style: italic; color: #737378; margin: 0; text-align: left; }}")
        page.draw_line((MARGIN_X, 54), (PAGE.width - MARGIN_X, 54), color=(0.82, 0.82, 0.84), width=0.5)
        page.insert_htmlbox(fitz.Rect(MARGIN_X, PAGE.height - 50, PAGE.width - MARGIN_X, PAGE.height - 30), f"<p>{i} of {total}</p>",
                            css=f"{CSS} p {{ font-size: 9pt; color: #737378; margin: 0; text-align: center; }}")
    doc.set_metadata({
        "title": title,
        "author": content.get("author") or "",
        "subject": content.get("question") or "",
        "keywords": ", ".join(content.get("keywords") or []),
        "creator": "CogNexa",
        "producer": "CogNexa",
    })
    return doc.tobytes(garbage=3, deflate=True)


def filename_for(content: dict) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "-", content.get("title") or "research-paper").strip("-")[:80] or "research-paper"
    return f"{slug}.pdf"
