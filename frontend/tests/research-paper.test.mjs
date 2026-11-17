// Run with: npm test   (node --test, no extra dependencies; Node strips the TS types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { numberSections, splitBlocks, splitInline, paperWordCount } from "../lib/paper-format.ts";
import { STAGE_ORDER, stageStates } from "../lib/run-stages.ts";

test("headings are numbered like the PDF: sections, then subsections", () => {
  const nums = numberSections([{ level: 1 }, { level: 2 }, { level: 2 }, { level: 1 }, { level: 1 }, { level: 2 }]).map((n) => n.num);
  assert.deepEqual(nums, ["1.", "1.1", "1.2", "2.", "3.", "3.1"]);
  assert.deepEqual(numberSections([{ level: 2 }]).map((n) => n.num), ["1"]); // a leading subsection still gets a number
});

test("body text splits into paragraphs and lists", () => {
  const blocks = splitBlocks("First line\ncontinues here.\n\n- one\n- two\n\n- three\n\nLast paragraph.");
  assert.deepEqual(blocks, [
    { type: "p", text: "First line continues here." },
    { type: "list", items: ["one", "two", "three"] },
    { type: "p", text: "Last paragraph." },
  ]);
  assert.deepEqual(splitBlocks("   \n\n  "), []);
});

test("citations, bold and italic are recognised; other brackets are text", () => {
  const parts = splitInline("A finding [1, 3] is **strong** but *limited* [2]; see [note] and 2*3*4.");
  assert.deepEqual(parts, [
    { type: "text", text: "A finding " },
    { type: "cite", numbers: [1, 3] },
    { type: "text", text: " is " },
    { type: "bold", text: "strong" },
    { type: "text", text: " but " },
    { type: "italic", text: "limited" },
    { type: "text", text: " " },
    { type: "cite", numbers: [2] },
    { type: "text", text: "; see [note] and 2*3*4." },
  ]);
});

test("word count covers the abstract, headings and bodies", () => {
  assert.equal(paperWordCount({ abstract: "Two words", sections: [{ heading: "Intro", body: "three more words" }] }), 6);
});

test("working flow: stages in order, completed when done, kept where a failed run stopped", () => {
  assert.equal(STAGE_ORDER.length, 6);
  const running = { stage: "gathering", stages: { understanding: "completed", discovering: "completed", gathering: "in_progress" }, detail: null, started_at: null, finished_at: null };
  assert.deepEqual(stageStates(running, "in_progress").map((s) => s.state),
    ["completed", "completed", "in_progress", "pending", "pending", "pending"]);
  assert.ok(stageStates(running, "ready").every((s) => s.state === "completed"));
  assert.ok(stageStates(null, "review").every((s) => s.state === "completed")); // older sessions have no progress
  assert.equal(stageStates(running, "failed")[2].state, "in_progress");
  assert.ok(stageStates(undefined, "in_progress").every((s) => s.state === "pending"));
});
