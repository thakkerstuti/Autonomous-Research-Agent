// Run with: npm test   (node --test, no extra dependencies; Node strips the TS types)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatPages, deckProgress, visibleCards, clampIndex, nextCardState,
  groupByCategory, QUESTION_CATEGORIES, HIGHLIGHT_CATEGORIES,
} from "../lib/study-logic.ts";

const out = (status, error = null) => ({ status, error, updated_at: null });
const kit = (overrides) => ({
  paper_id: "p",
  status: "ready",
  chunks: { total: 3, pending: 0, processing: 0, ready: 3, failed: 0 },
  outputs: { summary: out("ready"), flashcards: out("ready"), questions: out("ready"), highlights: out("ready") },
  pages_covered: 30,
  text_pages: 30,
  ...overrides,
});

test("page references are compact and clean", () => {
  assert.equal(formatPages([3]), "p. 3");
  assert.equal(formatPages([7, 3, 5, 6, 3]), "pp. 3, 5–7");
  assert.equal(formatPages([]), "");
  assert.equal(formatPages([0, -1, 2.5]), "");
});

const cards = [
  { id: "a", category: "term", question: "q1", answer: "a1", pages: [1] },
  { id: "b", category: "concept", question: "q2", answer: "a2", pages: [2] },
  { id: "c", category: "finding", question: "q3", answer: "a3", pages: [3] },
];

test("flashcard progress counts known, review and unseen", () => {
  assert.deepEqual(deckProgress(cards, { a: "known", b: "review" }), { total: 3, known: 1, review: 1, unseen: 1, pctKnown: 33 });
  assert.deepEqual(deckProgress([], {}), { total: 0, known: 0, review: 0, unseen: 0, pctKnown: 0 });
});

test("flashcard navigation stays in range and review filter works", () => {
  assert.equal(clampIndex(-1, 3), 0);
  assert.equal(clampIndex(5, 3), 2);
  assert.equal(clampIndex(1, 0), 0);
  assert.deepEqual(visibleCards(cards, { b: "review", c: "known" }, true).map((c) => c.id), ["b"]);
  assert.equal(visibleCards(cards, {}, false).length, 3);
});

test("marking a card twice clears it", () => {
  assert.equal(nextCardState(undefined, "known"), "known");
  assert.equal(nextCardState("known", "known"), null);
  assert.equal(nextCardState("known", "review"), "review");
});

test("grouping keeps category order and drops empty groups", () => {
  const qs = [{ category: "findings" }, { category: "basic" }, { category: "basic" }];
  assert.deepEqual(groupByCategory(qs, QUESTION_CATEGORIES).map((g) => [g.key, g.items.length]), [["basic", 2], ["findings", 1]]);
  assert.deepEqual(groupByCategory([{ category: "limitation" }], HIGHLIGHT_CATEGORIES).map((g) => g.label), ["Limitations"]);
});

import { sectionState, kitProgress } from "../lib/study-logic.ts";

test("each section reports its own state", () => {
  const k = kit({
    status: "processing",
    chunks: { total: 4, pending: 0, processing: 0, ready: 4, failed: 0 },
    outputs: { summary: out("ready"), flashcards: out("processing"), questions: out("pending"), highlights: out("failed", "x") },
  });
  assert.equal(sectionState(k, "summary"), "ready");
  assert.equal(sectionState(k, "flashcards"), "generating");
  assert.equal(sectionState(k, "questions"), "waiting");
  assert.equal(sectionState(k, "highlights"), "failed");
  assert.equal(sectionState(undefined, "summary"), "not_started");
});

test("overall progress counts chunks read and sections written", () => {
  const k = kit({
    status: "processing",
    chunks: { total: 6, pending: 2, processing: 1, ready: 3, failed: 0 },
    outputs: { summary: out("pending"), flashcards: out("pending"), questions: out("pending"), highlights: out("pending") },
  });
  assert.deepEqual(kitProgress(k), { done: 3, total: 10, pct: 30 });
  assert.deepEqual(kitProgress(kit({})), { done: 7, total: 7, pct: 100 });
  assert.deepEqual(kitProgress(null), { done: 0, total: 0, pct: 0 });
});
