// Assistant workspace commands: parsing and applying them to the reader. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand, runCommand } from "../lib/workspace-commands.ts";
import { initialLayout, openPanel, focusedPanel, setZoom } from "../lib/reader-layout.ts";

const pages = (l) => l.panels.map((p) => p.page);
const ctx = { pageCount: 12, hasText: (p) => p !== 11, scaleOf: () => 1 };
const run = (layout, text) => runCommand(layout, parseCommand(text), ctx);

test("parses the requests from the brief", () => {
  assert.deepEqual(parseCommand("Show pages 2 and 3 together."), { type: "show", pages: [2, 3] });
  assert.deepEqual(parseCommand("Open pages 1, 4 and 5"), { type: "show", pages: [1, 4, 5] });
  assert.deepEqual(parseCommand("Compare pages 2 and 6"), { type: "compare", pages: [2, 6] });
  assert.deepEqual(parseCommand("Focus on page 3"), { type: "goto", page: 3 });
  assert.deepEqual(parseCommand("Zoom in on the current page"), { type: "zoom", zoom: "in" });
  assert.deepEqual(parseCommand("Return to single-page mode"), { type: "mode", mode: "single" });
  assert.deepEqual(parseCommand("Close the second panel"), { type: "close", target: { panel: 2 } });
});

test("parses other phrasings", () => {
  assert.deepEqual(parseCommand("please show me page four"), { type: "goto", page: 4 });
  assert.deepEqual(parseCommand("open page 7 next to this one"), { type: "add", pages: [7] });
  assert.deepEqual(parseCommand("show pages 2-4"), { type: "show", pages: [2, 3, 4] });
  assert.deepEqual(parseCommand("compare 2 and 6"), { type: "compare", pages: [2, 6] });
  assert.deepEqual(parseCommand("compare these pages"), { type: "compare", pages: null });
  assert.deepEqual(parseCommand("show two pages"), { type: "mode", mode: "two" });
  assert.deepEqual(parseCommand("three page view"), { type: "mode", mode: "three" });
  assert.deepEqual(parseCommand("fit to width"), { type: "zoom", zoom: "width" });
  assert.deepEqual(parseCommand("fit the whole page"), { type: "zoom", zoom: "page" });
  assert.deepEqual(parseCommand("zoom to 150%"), { type: "zoom", zoom: 1.5 });
  assert.deepEqual(parseCommand("reset zoom"), { type: "zoom", zoom: "reset" });
  assert.deepEqual(parseCommand("zoom out on page 3"), { type: "zoom", zoom: "out", page: 3 });
  assert.deepEqual(parseCommand("close page 5"), { type: "close", target: { page: 5 } });
  assert.deepEqual(parseCommand("close the other pages"), { type: "close", target: "others" });
  assert.deepEqual(parseCommand("next page"), { type: "step", dir: 1 });
  assert.deepEqual(parseCommand("go to the previous page"), { type: "step", dir: -1 });
  assert.deepEqual(parseCommand("full screen"), { type: "fullscreen", on: true });
  assert.deepEqual(parseCommand("exit full screen"), { type: "fullscreen", on: false });
  assert.deepEqual(parseCommand("explain this page"), { type: "explain", page: null });
  assert.deepEqual(parseCommand("explain page 3"), { type: "explain", page: 3 });
  assert.deepEqual(parseCommand("summarize pages 2 and 3"), { type: "summarize", pages: [2, 3] });
});

test("questions about the paper are not commands", () => {
  for (const q of [
    "What does page 3 say about recall?",
    "Explain why spacing improved recall",
    "Summarize the paper",
    "Show the main results",
    "How was the experiment designed?",
    "close reading of the method",
  ]) assert.equal(parseCommand(q), null, q);
});

test("show pages 2 and 3 together puts exactly those pages side by side", () => {
  const r = run(initialLayout(1), "Show pages 2 and 3 together");
  assert.equal(r.ok, true);
  assert.deepEqual(pages(r.layout), [2, 3]);
  assert.match(r.message, /pages 2 and 3 side by side/);
});

test("open pages 1, 4 and 5; more than five or a missing page is refused with a reason", () => {
  assert.deepEqual(pages(run(initialLayout(1), "Open pages 1, 4 and 5").layout), [1, 4, 5]);
  const many = run(initialLayout(1), "open pages 1, 2, 3, 4, 5 and 6");
  assert.equal(many.ok, false);
  assert.equal(many.layout, undefined);
  assert.match(many.message, /at most 5 pages/);
  const missing = run(initialLayout(1), "show pages 2 and 14");
  assert.equal(missing.ok, false);
  assert.match(missing.message, /12 pages, so there is no page 14/);
});

test("compare opens the pages and asks the assistant to compare exactly them", () => {
  const r = run(initialLayout(1), "Compare pages 2 and 6");
  assert.deepEqual(pages(r.layout), [2, 6]);
  assert.deepEqual(r.ai, { action: "compare_pages", pages: [2, 6] });
  assert.equal(run(initialLayout(1), "compare page 2").ok, false);
  assert.match(run(initialLayout(1), "compare pages 2 and 11").message, /no selectable text/);
  // "compare these" uses the open pages
  const open = openPanel(initialLayout(4), 9);
  assert.deepEqual(run(open, "compare these pages").ai.pages, [4, 9]);
});

test("focus, zoom, mode and close update the reader", () => {
  let l = run(initialLayout(1), "show pages 2, 3 and 4").layout;
  l = run(l, "Focus on page 3").layout;
  assert.equal(focusedPanel(l).page, 3);
  const z = run(l, "Zoom in on the current page");
  assert.equal(focusedPanel(z.layout).zoom, 1.1);
  assert.match(z.message, /Page 3 is at 110%/);
  const closed = run(z.layout, "Close the second panel");
  assert.deepEqual(pages(closed.layout), [2, 4]);
  const single = run(closed.layout, "Return to single-page mode");
  assert.equal(single.layout.panels.length, 1);
  assert.equal(run(single.layout, "close the second panel").ok, false);
  assert.match(run(l, "close the fifth panel").message, /only 3 panels/);
});

test("zoom in stops at the largest zoom and says so", () => {
  let l = initialLayout(1);
  l = setZoom(l, l.panels[0].id, 4);
  const r = runCommand(l, parseCommand("zoom in"), { ...ctx, scaleOf: () => 4 });
  assert.equal(r.ok, false);
  assert.match(r.message, /largest zoom/);
});

test("next and previous stop at the ends of the paper", () => {
  assert.equal(run(initialLayout(12), "next page").ok, false);
  assert.equal(run(initialLayout(1), "previous page").ok, false);
  assert.deepEqual(pages(run(initialLayout(5), "next page").layout), [6]);
});

test("adding a sixth page is refused and explains the limit", () => {
  let l = initialLayout(1);
  for (const p of [2, 3, 4, 5]) l = openPanel(l, p);
  const r = run(l, "open page 9 beside this one");
  assert.equal(r.ok, false);
  assert.match(r.message, /at most 5/);
});
