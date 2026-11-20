"""Which pages of a paper are worth explaining.

Page-wise explanations skip the pages a reader doesn't need explained: front matter (a title page,
an abstract-only page, a contents page, a copyright or licence page) and back matter (references,
acknowledgements). Pure text rules, no AI call, so skipped pages cost nothing. If the rules would
skip every page (a very short document), nothing is skipped.
"""
import re

CONTENT = "content"
REASONS = {
    "front": "Title page and abstract",
    "contents": "Table of contents",
    "references": "References",
    "acknowledgements": "Acknowledgements",
}

_INTRO = re.compile(r"(^|\n)\s*(?:\d+(?:\.\d+)*\.?|[ivx]+\.)?\s*introduction\b", re.I)
_BODY_HEADING = re.compile(r"(^|\n)\s*(?:\d+(?:\.\d+)*\.?|[ivx]+\.)\s*[A-Z][^\n]{2,80}\n", re.M)
_FRONT_MARKERS = re.compile(r"\b(abstract|keywords?|index terms|copyright|all rights reserved|licen[cs]e|arxiv:\s*\d|"
                            r"corresponding author|received\s+\d|accepted\s+\d|doi:\s*10\.)", re.I)
_YEAR = re.compile(r"\b(?:19|20)\d{2}[a-z]?\b")
_REF_LINE = re.compile(r"^\s*(?:\[\d+\]|\d+\.\s|[A-Z][A-Za-z'\-]+,\s*[A-Z]\.)")


def _lines(text: str) -> list[str]:
    return [line for line in (text or "").splitlines() if line.strip()]


def _looks_like_references(text: str) -> bool:
    lines = _lines(text)
    if len(lines) < 6:
        return False
    cited = sum(1 for line in lines if _YEAR.search(line) and (_REF_LINE.match(line) or "et al" in line or "doi" in line.lower()))
    return cited / len(lines) >= 0.45


def page_role(number: int, text: str, total: int) -> str:
    """CONTENT, or one of REASONS' keys for a page to skip."""
    text = text or ""
    head = text.strip()[:300].lower()
    words = len(text.split())

    if re.match(r"(?:\d+\.?\s*)?(references|bibliography|works cited|literature cited)\b", head):
        return "references"
    if number > max(2, total * 0.5) and _looks_like_references(text):
        return "references"  # a references page that continues from the previous one
    if re.match(r"(?:table of )?contents\b", head) and len(re.findall(r"\.{4,}|\s\d{1,3}\s*$", text, re.M)) >= 4:
        return "contents"
    if re.match(r"(?:\d+\.?\s*)?acknowledge?ments?\b", head) and words < 350:
        return "acknowledgements"
    if number <= 3 and not _INTRO.search(text):
        # Front matter: an abstract-only page, keywords, licence or copyright pages; and a full-length
        # paper's separate title page (a short first page). Short pages of short documents are content.
        if _FRONT_MARKERS.search(text[:2500]) or (number == 1 and total >= 6 and words < 80):
            return "front"
    return CONTENT


def roles(pages: list[tuple[int, str]]) -> dict[int, str]:
    """Each page's role; never skips everything."""
    total = max((n for n, _ in pages), default=0)
    out = {n: page_role(n, t, total) for n, t in pages}
    if out and all(r != CONTENT for r in out.values()):
        return {n: CONTENT for n in out}
    return out
