/**
 * Pure logic for the Paper Study kit: no React, no imports, so it can be
 * unit-tested directly with `node --test` (see tests/study-logic.test.mjs).
 */

export type OutputKind = "summary" | "flashcards" | "questions" | "highlights";
export const OUTPUT_KINDS: OutputKind[] = ["summary", "flashcards", "questions", "highlights"];
export type ArtifactStatus = "pending" | "processing" | "ready" | "failed";
export type KitStatusName = "not_started" | "processing" | "ready" | "partial" | "failed";

export interface KitStatus {
  paper_id: string;
  status: KitStatusName;
  chunks: { total: number; pending: number; processing: number; ready: number; failed: number };
  outputs: Record<OutputKind, { status: ArtifactStatus; error: string | null; updated_at: string | null } | null>;
  pages_covered: number;
  text_pages: number;
}

export type CardState = "known" | "review";
export interface Card {
  id: string;
  category: string;
  question: string;
  answer: string;
  pages: number[];
}

/** "p. 3", "pp. 3, 5–7" */
export function formatPages(pages: number[] | null | undefined): string {
  const sorted = [...new Set((pages ?? []).filter((p) => Number.isInteger(p) && p > 0))].sort((a, b) => a - b);
  if (!sorted.length) return "";
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const p = sorted[i];
    if (p === prev + 1) {
      prev = p;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = p;
    prev = p;
  }
  return `${sorted.length === 1 ? "p." : "pp."} ${parts.join(", ")}`;
}

// ───────── flashcards ─────────

export function deckProgress(cards: Card[], states: Record<string, CardState>) {
  let known = 0;
  let review = 0;
  for (const c of cards) {
    if (states[c.id] === "known") known++;
    else if (states[c.id] === "review") review++;
  }
  const total = cards.length;
  return { total, known, review, unseen: total - known - review, pctKnown: total ? Math.round((known / total) * 100) : 0 };
}

export function visibleCards(cards: Card[], states: Record<string, CardState>, onlyReview: boolean): Card[] {
  return onlyReview ? cards.filter((c) => states[c.id] === "review") : cards;
}

export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

/** Toggle: marking a card with its current state clears it. */
export function nextCardState(current: CardState | undefined, chosen: CardState): CardState | null {
  return current === chosen ? null : chosen;
}

// ───────── grouping ─────────

export const QUESTION_CATEGORIES: { key: string; label: string }[] = [
  { key: "basic", label: "Basic understanding" },
  { key: "conceptual", label: "Conceptual" },
  { key: "technical", label: "Technical" },
  { key: "methodology", label: "Methodology" },
  { key: "analytical", label: "Analytical" },
  { key: "findings", label: "Findings and conclusions" },
];

export const HIGHLIGHT_CATEGORIES: { key: string; label: string }[] = [
  { key: "finding", label: "Key findings" },
  { key: "statistic", label: "Numbers to remember" },
  { key: "argument", label: "Key arguments" },
  { key: "contribution", label: "Contributions" },
  { key: "definition", label: "Definitions" },
  { key: "formula", label: "Formulas and equations" },
  { key: "limitation", label: "Limitations" },
  { key: "conclusion", label: "Conclusions" },
];

export const CARD_CATEGORY_LABEL: Record<string, string> = {
  term: "Term",
  concept: "Concept",
  formula: "Formula",
  method: "Method",
  finding: "Finding",
  distinction: "Distinction",
};

export function groupByCategory<T extends { category: string }>(items: T[], order: { key: string; label: string }[]) {
  return order
    .map(({ key, label }) => ({ key, label, items: items.filter((i) => i.category === key) }))
    .filter((g) => g.items.length > 0);
}

// ───────── per-section status for the automatic study kit ─────────

export type SectionState = "not_started" | "waiting" | "generating" | "ready" | "failed";

export const SECTION_LABEL: Record<OutputKind, string> = {
  summary: "Summary",
  flashcards: "Flashcards",
  questions: "Q&A",
  highlights: "Highlights",
};

/** Waiting = queued or still reading the paper; Generating = being written now. */
export function sectionState(kit: KitStatus | undefined | null, kind: OutputKind): SectionState {
  const out = kit?.outputs?.[kind];
  if (!kit || kit.status === "not_started" || !out) return "not_started";
  if (out.status === "ready") return "ready";
  if (out.status === "failed") return "failed";
  if (out.status === "processing") return "generating";
  return "waiting";
}

/** Overall kit progress: every chunk read and every section written counts as one step. */
export function kitProgress(kit: KitStatus | undefined | null) {
  if (!kit || kit.status === "not_started") return { done: 0, total: 0, pct: 0 };
  const outs = OUTPUT_KINDS.map((k) => kit.outputs[k]).filter(Boolean) as { status: ArtifactStatus }[];
  const settled = (s: ArtifactStatus) => s === "ready" || s === "failed";
  const done = kit.chunks.ready + kit.chunks.failed + outs.filter((o) => settled(o.status)).length;
  const total = kit.chunks.total + outs.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}
