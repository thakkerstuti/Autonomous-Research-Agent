// Multi-page reader layout. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PANELS, MIN_FRACTION, initialLayout, openPanel, closePanel, showPage, setPanelPage, movePanel, focusPanel,
  resizeColumn, resizeRow, rowsFor, rowSlices, setArrangement, resetLayout, toggleSelected, selectedPages, restoreLayout, focusedPanel,
} from "../lib/reader-layout.ts";

const pages = (l) => l.panels.map((p) => p.page);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const near = (a, b) => Math.abs(a - b) < 1e-9;

function withPages(...ps) {
  let l = initialLayout(ps[0]);
  for (const p of ps.slice(1)) l = openPanel(l, p);
  return l;
}

test("layout presets: single, two, three, 2x2 grid, 3 over 2", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => rowsFor(n, "auto")), [[1], [2], [3], [2, 2], [3, 2]]);
  assert.deepEqual(rowsFor(5, "columns"), [5]);
});

test("opening pages: at most five panels", () => {
  let l = initialLayout(1);
  for (let p = 2; p <= 5; p++) l = openPanel(l, p);
  assert.equal(l.panels.length, MAX_PANELS);
  assert.equal(openPanel(l, 6), null); // the sixth is refused
  assert.deepEqual(l.rows, [3, 2]);
});

test("a new panel opens next to the focused one and takes focus", () => {
  let l = withPages(1, 2, 3);
  l = focusPanel(l, l.panels[0].id);
  l = openPanel(l, 9);
  assert.deepEqual(pages(l), [1, 9, 2, 3]);
  assert.equal(focusedPanel(l).page, 9);
});

test("closing a panel keeps at least one and moves focus sensibly", () => {
  let l = withPages(1, 2, 3);
  const mid = l.panels[1].id;
  l = focusPanel(l, mid);
  l = closePanel(l, mid);
  assert.deepEqual(pages(l), [1, 3]);
  assert.equal(focusedPanel(l).page, 3);
  let one = initialLayout(4);
  assert.equal(closePanel(one, one.panels[0].id).panels.length, 1);
});

test("switching the page inside a panel keeps the panel", () => {
  let l = withPages(1, 2);
  const id = l.panels[1].id;
  l = setPanelPage(l, id, 7);
  assert.deepEqual(pages(l), [1, 7]);
  assert.equal(l.panels[1].id, id);
});

test("citations: focus an open page, else open it, else show it in the focused panel", () => {
  let l = withPages(1, 2);
  let r = showPage(l, 2);
  assert.equal(r.how, "focused");
  assert.equal(focusedPanel(r.layout).page, 2);
  r = showPage(l, 8);
  assert.equal(r.how, "opened");
  assert.deepEqual(pages(r.layout), [1, 2, 8]);
  let full = withPages(1, 2, 3, 4, 5);
  full = focusPanel(full, full.panels[1].id);
  r = showPage(full, 9);
  assert.equal(r.how, "replaced");
  assert.deepEqual(pages(r.layout), [1, 9, 3, 4, 5]); // still five, nothing closed
});

test("drag and drop reorders panels and keeps sizes", () => {
  let l = withPages(1, 2, 3);
  l = resizeColumn(l, 0, 0, 0.1);
  const sizes = l.colSizes[0];
  l = movePanel(l, 0, 2);
  assert.deepEqual(pages(l), [2, 3, 1]);
  assert.deepEqual(l.colSizes[0], sizes);
  assert.equal(movePanel(l, 0, 9), l); // out of range is ignored
});

test("resizing columns respects the minimum and keeps rows summing to 1", () => {
  let l = withPages(1, 2);
  l = resizeColumn(l, 0, 0, 0.2);
  assert.ok(near(l.colSizes[0][0], 0.7) && near(sum(l.colSizes[0]), 1));
  l = resizeColumn(l, 0, 0, 5); // dragged far past the edge
  assert.ok(near(l.colSizes[0][1], MIN_FRACTION) && near(sum(l.colSizes[0]), 1));
  assert.equal(resizeColumn(l, 0, 3, 0.1).colSizes[0], l.colSizes[0]); // no such divider
});

test("resizing rows in the grid", () => {
  let l = withPages(1, 2, 3, 4);
  assert.deepEqual(rowSlices(l).map((r) => r.map((p) => p.page)), [[1, 2], [3, 4]]);
  l = resizeRow(l, 0, -0.2);
  assert.ok(near(l.rowSizes[0], 0.3) && near(sum(l.rowSizes), 1));
  l = resizeRow(l, 0, -1);
  assert.ok(near(l.rowSizes[0], MIN_FRACTION));
});

test("arrangement and reset", () => {
  let l = withPages(1, 2, 3, 4);
  l = setArrangement(l, "columns");
  assert.deepEqual(l.rows, [4]);
  l = resizeColumn(l, 0, 1, 0.05);
  l = resetLayout(l);
  assert.deepEqual(l.rows, [2, 2]);
  assert.ok(l.colSizes.every((row) => row.every((s) => near(s, 0.5))));
  assert.deepEqual(pages(l), [1, 2, 3, 4]); // open pages kept
});

test("compare selection uses the ticked pages, de-duplicated, in page order", () => {
  let l = withPages(5, 2, 7);
  l = toggleSelected(l, l.panels[0].id);
  l = toggleSelected(l, l.panels[1].id);
  assert.deepEqual(selectedPages(l), [2, 5]);
  l = toggleSelected(l, l.panels[0].id); // untick
  assert.deepEqual(selectedPages(l), [2]);
  l = closePanel(l, l.panels[1].id);
  assert.deepEqual(l.selected, []); // closing a panel drops it from the selection
});

test("saved layouts are restored, and bad ones rejected", () => {
  let l = withPages(1, 2, 3);
  l = resizeColumn(l, 0, 1, 0.1);
  const saved = JSON.parse(JSON.stringify(l));
  const back = restoreLayout(saved, 10);
  assert.deepEqual(pages(back), [1, 2, 3]);
  assert.deepEqual(back.colSizes, l.colSizes);
  assert.equal(restoreLayout(saved, 2), null); // page 3 no longer exists
  assert.equal(restoreLayout({ panels: [] }, 10), null);
  assert.equal(restoreLayout("junk", 10), null);
  const tooMany = { ...saved, panels: [1, 2, 3, 4, 5, 6].map((p) => ({ id: `x${p}`, page: p })) };
  assert.equal(restoreLayout(tooMany, 10), null);
  const badSizes = { ...saved, colSizes: [[0.9, 0.05, 0.05]] };
  assert.ok(restoreLayout(badSizes, 10).colSizes[0].every((s) => near(s, 1 / 3))); // falls back to equal sizes
});
