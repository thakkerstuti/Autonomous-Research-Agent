// Reader layout: view modes, panels, zoom, persistence. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PANELS, MIN_FRACTION, AUTO_MAX, AUTO_MIN, initialLayout, openPanel, closePanel, showPage, goToPage, showPages, setViewMode, modeOf,
  setPanelPage, movePanel, focusPanel, resizeColumn, resizeRow, rowsFor, rowSlices, resetSizes, sizesAreEqual, toggleSelected,
  selectedPages, comparePages, restoreLayout, focusedPanel, setZoom, resolveScale, stepZoom, checkPages,
} from "../lib/reader-layout.ts";

const pages = (l) => l.panels.map((p) => p.page);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const near = (a, b) => Math.abs(a - b) < 1e-9;

function withPages(...ps) {
  let l = initialLayout(ps[0]);
  for (const p of ps.slice(1)) l = openPanel(l, p);
  return l;
}

test("starts as single-page reading", () => {
  const l = initialLayout(3);
  assert.deepEqual(pages(l), [3]);
  assert.equal(modeOf(l), "single");
  assert.equal(l.panels[0].zoom, "auto");
});

test("rows: one row up to three pages, then 2x2 and 3 over 2", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(rowsFor), [[1], [2], [3], [2, 2], [3, 2]]);
});

test("view modes: two and three pages add the following pages, single keeps the focused one", () => {
  let l = initialLayout(4);
  l = setViewMode(l, "two", 12);
  assert.deepEqual(pages(l), [4, 5]);
  assert.equal(modeOf(l), "two");
  l = setViewMode(l, "three", 12);
  assert.deepEqual(pages(l), [4, 5, 6]);
  l = focusPanel(l, l.panels[1].id);
  l = setViewMode(l, "single", 12);
  assert.deepEqual(pages(l), [5]);
  assert.equal(modeOf(l), "single");
});

test("going back up restores the pages that were closed by switching down", () => {
  let l = showPages(initialLayout(1), [2, 9]);
  l = setViewMode(l, "single", 12); // keeps page 2 (focused), remembers 9
  assert.deepEqual(pages(l), [2]);
  l = setViewMode(l, "two", 12);
  assert.deepEqual(pages(l), [2, 9]);
});

test("view modes wrap at the end of the paper and respect short papers", () => {
  assert.deepEqual(pages(setViewMode(initialLayout(12), "two", 12)), [12, 1]);
  assert.deepEqual(pages(setViewMode(initialLayout(1), "three", 2)), [1, 2]);
  assert.equal(setViewMode(initialLayout(1), "custom", 12).panels.length, 4);
});

test("panels: open up to five, the sixth is refused, closing keeps one", () => {
  const l = withPages(1, 2, 3, 4, 5);
  assert.equal(l.panels.length, MAX_PANELS);
  assert.equal(openPanel(l, 6), null);
  assert.equal(modeOf(l), "custom");
  let c = closePanel(l, l.panels[2].id);
  assert.deepEqual(pages(c), [1, 2, 4, 5]);
  assert.deepEqual(c.rows, [2, 2]);
  const one = initialLayout(1);
  assert.equal(closePanel(one, one.panels[0].id), one);
});

test("goToPage turns the focused page, or focuses a page that's already open", () => {
  let l = initialLayout(1);
  let r = goToPage(l, 7);
  assert.equal(r.how, "turned");
  assert.deepEqual(pages(r.layout), [7]);
  l = withPages(2, 5);
  r = goToPage(l, 2);
  assert.equal(r.how, "focused");
  assert.equal(focusedPanel(r.layout).page, 2);
  assert.equal(r.layout.panels.length, 2);
});

test("showPage still opens beside when asked", () => {
  const r = showPage(initialLayout(1), 4);
  assert.equal(r.how, "opened");
  assert.deepEqual(pages(r.layout), [1, 4]);
  const full = withPages(1, 2, 3, 4, 5);
  assert.equal(showPage(full, 9).how, "replaced");
});

test("showPages shows exactly the pages asked for and keeps zoom of pages already open", () => {
  let l = withPages(1, 2);
  l = setZoom(l, l.panels[1].id, 1.5);
  const s = showPages(l, [2, 6, 3]);
  assert.deepEqual(pages(s), [2, 6, 3]);
  assert.equal(s.panels[0].zoom, 1.5);
  assert.equal(focusedPanel(s).page, 2);
});

test("checkPages validates range and the five-page limit", () => {
  assert.equal(checkPages([2, 3], 12).error, "none");
  assert.deepEqual(checkPages([0, 2], 12), { pages: [0, 2], error: "out_of_range", bad: 0 });
  assert.equal(checkPages([13], 12).bad, 13);
  assert.equal(checkPages([1, 2, 3, 4, 5, 6], 12).error, "too_many");
  assert.deepEqual(checkPages([3, 3, 4], 12).pages, [3, 4]);
});

test("setPanelPage changes the page and keeps the panel and its zoom", () => {
  let l = withPages(1, 2);
  l = setZoom(l, l.panels[0].id, 2);
  const id = l.panels[0].id;
  l = setPanelPage(l, id, 9);
  assert.equal(l.panels[0].id, id);
  assert.equal(l.panels[0].page, 9);
  assert.equal(l.panels[0].zoom, 2);
});

test("reorder moves a panel and keeps sizes", () => {
  let l = withPages(1, 2, 3);
  l = resizeColumn(l, 0, 0, 0.1);
  const sizes = l.colSizes;
  l = movePanel(l, 0, 2);
  assert.deepEqual(pages(l), [2, 3, 1]);
  assert.deepEqual(l.colSizes, sizes);
  assert.equal(movePanel(l, 0, 9), l);
});

test("resizing clamps to the minimum share and sums stay at 1; reset equalises", () => {
  let l = withPages(1, 2);
  l = resizeColumn(l, 0, 0, 0.9);
  assert.ok(near(l.colSizes[0][1], MIN_FRACTION));
  assert.ok(near(sum(l.colSizes[0]), 1));
  assert.equal(sizesAreEqual(l), false);
  l = resetSizes(l);
  assert.equal(sizesAreEqual(l), true);
  let g = withPages(1, 2, 3, 4);
  g = resizeRow(g, 0, -0.9);
  assert.ok(near(g.rowSizes[0], MIN_FRACTION));
  assert.deepEqual(rowSlices(g).map((r) => r.map((p) => p.page)), [[1, 2], [3, 4]]);
});

test("compare: ticked pages, or every open page when none are ticked", () => {
  let l = withPages(4, 2, 7);
  assert.deepEqual(comparePages(l), [2, 4, 7]);
  l = toggleSelected(l, l.panels[0].id);
  l = toggleSelected(l, l.panels[2].id);
  assert.deepEqual(selectedPages(l), [4, 7]);
  assert.deepEqual(comparePages(l), [4, 7]);
});

test("zoom: auto shows the whole page but stays readable and within the width, fit page uses the height, steps move between presets", () => {
  const natural = { w: 816, h: 1056 };
  assert.ok(near(resolveScale("width", natural, { w: 408, h: 900 }), 0.5));
  assert.equal(resolveScale("auto", natural, { w: 3000, h: 3000 }), AUTO_MAX);
  assert.ok(near(resolveScale("auto", natural, { w: 3000, h: 950.4 }), 0.9)); // the whole page fits
  assert.equal(resolveScale("auto", natural, { w: 3000, h: 400 }), AUTO_MIN); // short window: readable, scrolls
  assert.ok(near(resolveScale("auto", natural, { w: 408, h: 900 }), 0.5));
  assert.equal(resolveScale("page", natural, { w: 3000, h: 528 }), 0.5);
  assert.equal(resolveScale(1.5, natural, { w: 10, h: 10 }), 1.5);
  assert.equal(resolveScale(9, natural, { w: 10, h: 10 }), 4);
  assert.equal(stepZoom(1, 1), 1.1);
  assert.equal(stepZoom(1, -1), 0.9);
  assert.equal(stepZoom(0.93, 1), 1);
  assert.equal(stepZoom(0.5, -1), 0.5);
});

test("restoreLayout keeps a valid saved layout, including zoom, and rejects bad ones", () => {
  let l = withPages(1, 2, 3);
  l = setZoom(l, l.panels[1].id, 1.75);
  l = resizeColumn(l, 0, 0, 0.1);
  const r = restoreLayout(JSON.parse(JSON.stringify(l)), 12);
  assert.deepEqual(pages(r), [1, 2, 3]);
  assert.equal(r.panels[1].zoom, 1.75);
  assert.deepEqual(r.colSizes, l.colSizes);
  assert.equal(restoreLayout({ ...l, panels: [{ id: "x", page: 40 }] }, 12), null);
  assert.equal(restoreLayout({ panels: [] }, 12), null);
  assert.equal(restoreLayout("junk", 12), null);
  // older saved layouts without zoom still load
  const old = restoreLayout({ panels: [{ id: "a", page: 2 }], focusedId: "a", arrangement: "columns", rows: [1], rowSizes: [1], colSizes: [[1]], selected: [] }, 12);
  assert.equal(old.panels[0].zoom, "auto");
});
