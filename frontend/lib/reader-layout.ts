/**
 * Reader layout: which pages are open, how they are arranged, and how each one
 * is zoomed. Pure functions only (no React, no imports) so the behaviour is
 * unit-tested directly with `node --test`.
 *
 * View modes follow from the number of open pages: one page (single), two or
 * three side by side, or a custom grid of four or five.
 */

export const MAX_PANELS = 5;
export const MIN_FRACTION = 0.14; // smallest share a panel or row can be resized to

/**
 * "auto" shows the whole page where it can (as in the design), but never below
 * AUTO_MIN so text stays readable, never wider than the space and never past
 * AUTO_MAX. A number is a scale where 1 = actual size.
 */
export type Zoom = "auto" | "width" | "page" | number;
export const AUTO_MAX = 1.25;
export const AUTO_MIN = 0.8;
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

export type ViewMode = "single" | "two" | "three" | "custom";
export const MODE_COUNT: Record<Exclude<ViewMode, "custom">, number> = { single: 1, two: 2, three: 3 };

export interface Panel {
  id: string;
  page: number;
  zoom: Zoom;
}

export interface ReaderLayout {
  panels: Panel[];
  focusedId: string | null;
  /** Panels per row, top to bottom. */
  rows: number[];
  /** Height share of each row (sums to 1). */
  rowSizes: number[];
  /** Width share of each panel within its row (each row sums to 1). */
  colSizes: number[][];
  /** Panels ticked for an AI comparison; none ticked means "all open pages". */
  selected: string[];
  /** Pages closed by switching to fewer pages, offered again when switching back. */
  stash: number[];
}

let counter = 0;
export function newPanelId(): string {
  counter += 1;
  return `p${Date.now().toString(36)}${counter.toString(36)}`;
}

/** One row for up to three pages, then a 2 x 2 grid, then 3 over 2. */
export function rowsFor(count: number): number[] {
  if (count <= 0) return [];
  if (count <= 3) return [count];
  return count === 4 ? [2, 2] : [3, 2];
}

export function modeOf(layout: ReaderLayout): ViewMode {
  const n = layout.panels.length;
  return n <= 1 ? "single" : n === 2 ? "two" : n === 3 ? "three" : "custom";
}

const equal = (n: number) => Array.from({ length: n }, () => 1 / n);

function withShape(layout: ReaderLayout, keepSizes: boolean): ReaderLayout {
  const rows = rowsFor(layout.panels.length);
  const sameShape = keepSizes && rows.length === layout.rows.length && rows.every((r, i) => r === layout.rows[i]);
  return {
    ...layout,
    rows,
    rowSizes: sameShape ? layout.rowSizes : equal(rows.length),
    colSizes: sameShape ? layout.colSizes : rows.map((r) => equal(r)),
  };
}

const panelFor = (page: number, zoom: Zoom = "auto"): Panel => ({ id: newPanelId(), page, zoom });

export function initialLayout(page = 1): ReaderLayout {
  const first = panelFor(page);
  return withShape({ panels: [first], focusedId: first.id, rows: [], rowSizes: [], colSizes: [], selected: [], stash: [] }, false);
}

export function focusedPanel(layout: ReaderLayout): Panel | undefined {
  return layout.panels.find((p) => p.id === layout.focusedId) ?? layout.panels[0];
}

/** Opens a page in a new panel next to the focused one. Returns null when five are already open. */
export function openPanel(layout: ReaderLayout, page: number): ReaderLayout | null {
  if (layout.panels.length >= MAX_PANELS) return null;
  const panel = panelFor(page);
  const focusIdx = layout.panels.findIndex((p) => p.id === layout.focusedId);
  const panels = [...layout.panels];
  panels.splice(focusIdx >= 0 ? focusIdx + 1 : panels.length, 0, panel);
  return withShape({ ...layout, panels, focusedId: panel.id }, false);
}

/**
 * Go to a page from a citation, the page list or a command. In single-page
 * view the page simply turns; with several pages open it focuses the page if
 * it's already showing, otherwise shows it in the focused panel. Nothing is
 * ever opened or closed behind the reader's back.
 */
export function goToPage(layout: ReaderLayout, page: number): { layout: ReaderLayout; how: "focused" | "turned" } {
  const existing = layout.panels.find((p) => p.page === page);
  if (existing) return { layout: { ...layout, focusedId: existing.id }, how: "focused" };
  const target = focusedPanel(layout)!;
  return { layout: setPanelPage(layout, target.id, page), how: "turned" };
}

/** Kept for callers that want "open beside": focus if open, else a new panel, else turn the focused one. */
export function showPage(layout: ReaderLayout, page: number): { layout: ReaderLayout; how: "focused" | "opened" | "replaced" } {
  const existing = layout.panels.find((p) => p.page === page);
  if (existing) return { layout: { ...layout, focusedId: existing.id }, how: "focused" };
  const opened = openPanel(layout, page);
  if (opened) return { layout: opened, how: "opened" };
  return { layout: setPanelPage(layout, focusedPanel(layout)!.id, page), how: "replaced" };
}

export type PagesError = "none" | "too_many" | "out_of_range";

/** Validate a list of page numbers for showing together. Duplicates are dropped, order is kept. */
export function checkPages(pages: number[], pageCount: number): { pages: number[]; error: PagesError; bad?: number } {
  const unique = [...new Set(pages)];
  if (!unique.length) return { pages: [], error: "none" };
  const bad = unique.find((p) => !Number.isInteger(p) || p < 1 || p > pageCount);
  if (bad !== undefined) return { pages: unique, error: "out_of_range", bad };
  if (unique.length > MAX_PANELS) return { pages: unique, error: "too_many" };
  return { pages: unique, error: "none" };
}

/** Show exactly these pages, side by side in this order. Panels already showing one of them keep their zoom. */
export function showPages(layout: ReaderLayout, pages: number[]): ReaderLayout {
  if (!pages.length || pages.length > MAX_PANELS) return layout;
  const pool = [...layout.panels];
  const panels = pages.map((page) => {
    const i = pool.findIndex((p) => p.page === page);
    return i >= 0 ? pool.splice(i, 1)[0] : panelFor(page);
  });
  const ids = new Set(panels.map((p) => p.id));
  const sameOrder = panels.length === layout.panels.length && panels.every((p, i) => p.id === layout.panels[i].id);
  return withShape(
    { ...layout, panels, focusedId: panels[0].id, selected: layout.selected.filter((s) => ids.has(s)) },
    sameOrder
  );
}

/**
 * Switch between one, two, three pages or a custom grid. Going down keeps the
 * focused page and its neighbours (the others are remembered); going up brings
 * back remembered pages first, then the pages that follow.
 */
export function setViewMode(layout: ReaderLayout, mode: ViewMode, pageCount: number): ReaderLayout {
  const current = layout.panels.length;
  const wanted = mode === "custom" ? Math.max(4, current) : MODE_COUNT[mode];
  const n = Math.max(1, Math.min(wanted, MAX_PANELS, pageCount));
  if (n === current) return layout;

  if (n < current) {
    const focusIdx = Math.max(0, layout.panels.findIndex((p) => p.id === layout.focusedId));
    const start = Math.max(0, Math.min(focusIdx, current - n));
    const kept = layout.panels.slice(start, start + n);
    const dropped = layout.panels.filter((p) => !kept.includes(p)).map((p) => p.page);
    const ids = new Set(kept.map((p) => p.id));
    return withShape({
      ...layout,
      panels: kept,
      focusedId: ids.has(layout.focusedId ?? "") ? layout.focusedId : kept[0].id,
      selected: layout.selected.filter((s) => ids.has(s)),
      stash: [...dropped, ...layout.stash.filter((p) => !dropped.includes(p))].slice(0, MAX_PANELS),
    }, false);
  }

  const open = new Set(layout.panels.map((p) => p.page));
  const extra: number[] = [];
  const take = (p: number) => {
    if (extra.length < n - current && p >= 1 && p <= pageCount && !open.has(p) && !extra.includes(p)) extra.push(p);
  };
  layout.stash.forEach(take);
  const last = Math.max(...layout.panels.map((p) => p.page));
  for (let k = 1; k <= pageCount && extra.length < n - current; k++) take(((last - 1 + k) % pageCount) + 1);
  const panels = [...layout.panels, ...extra.map((p) => panelFor(p))];
  return withShape({ ...layout, panels, stash: layout.stash.filter((p) => !extra.includes(p)) }, false);
}

export function closePanel(layout: ReaderLayout, id: string): ReaderLayout {
  if (layout.panels.length <= 1) return layout; // always keep one page open
  const idx = layout.panels.findIndex((p) => p.id === id);
  if (idx < 0) return layout;
  const panels = layout.panels.filter((p) => p.id !== id);
  const focusedId = layout.focusedId === id ? panels[Math.min(idx, panels.length - 1)].id : layout.focusedId;
  return withShape({ ...layout, panels, focusedId, selected: layout.selected.filter((s) => s !== id) }, false);
}

/** Change the page shown in a panel (the panel itself stays, and so does its zoom). */
export function setPanelPage(layout: ReaderLayout, id: string, page: number): ReaderLayout {
  return { ...layout, panels: layout.panels.map((p) => (p.id === id ? { ...p, page } : p)), focusedId: id };
}

export function focusPanel(layout: ReaderLayout, id: string): ReaderLayout {
  return layout.panels.some((p) => p.id === id) ? { ...layout, focusedId: id } : layout;
}

export function setZoom(layout: ReaderLayout, id: string, zoom: Zoom): ReaderLayout {
  const z = typeof zoom === "number" ? clampScale(zoom) : zoom;
  return { ...layout, panels: layout.panels.map((p) => (p.id === id ? { ...p, zoom: z } : p)) };
}

/** Drag and drop: move the panel at `from` to position `to`. Sizes are kept. */
export function movePanel(layout: ReaderLayout, from: number, to: number): ReaderLayout {
  const n = layout.panels.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return layout;
  const panels = [...layout.panels];
  const [moved] = panels.splice(from, 1);
  panels.splice(to, 0, moved);
  return { ...layout, panels };
}

/** The panels in each row. */
export function rowSlices(layout: ReaderLayout): Panel[][] {
  const out: Panel[][] = [];
  let i = 0;
  for (const count of layout.rows) {
    out.push(layout.panels.slice(i, i + count));
    i += count;
  }
  return out;
}

/** Move the divider after item `index` by `delta` (a share of the whole), keeping both sides above the minimum. */
function shiftPair(sizes: number[], index: number, delta: number): number[] {
  if (index < 0 || index >= sizes.length - 1) return sizes;
  const a = sizes[index];
  const b = sizes[index + 1];
  const clamped = Math.max(MIN_FRACTION - a, Math.min(b - MIN_FRACTION, delta));
  const next = [...sizes];
  next[index] = a + clamped;
  next[index + 1] = b - clamped;
  return next;
}

export function resizeColumn(layout: ReaderLayout, row: number, divider: number, delta: number): ReaderLayout {
  if (!layout.colSizes[row]) return layout;
  const colSizes = layout.colSizes.map((sizes, r) => (r === row ? shiftPair(sizes, divider, delta) : sizes));
  return { ...layout, colSizes };
}

export function resizeRow(layout: ReaderLayout, divider: number, delta: number): ReaderLayout {
  return { ...layout, rowSizes: shiftPair(layout.rowSizes, divider, delta) };
}

/** Equal sizes again; open pages and their zoom are kept. */
export function resetSizes(layout: ReaderLayout): ReaderLayout {
  return withShape(layout, false);
}

export function sizesAreEqual(layout: ReaderLayout): boolean {
  const flat = (xs: number[]) => xs.every((x) => Math.abs(x - 1 / xs.length) < 1e-3);
  return flat(layout.rowSizes) && layout.colSizes.every(flat);
}

export function toggleSelected(layout: ReaderLayout, id: string): ReaderLayout {
  if (!layout.panels.some((p) => p.id === id)) return layout;
  const selected = layout.selected.includes(id) ? layout.selected.filter((s) => s !== id) : [...layout.selected, id];
  return { ...layout, selected };
}

/** The distinct pages ticked for comparison, in page order. */
export function selectedPages(layout: ReaderLayout): number[] {
  const pages = layout.panels.filter((p) => layout.selected.includes(p.id)).map((p) => p.page);
  return [...new Set(pages)].sort((a, b) => a - b);
}

/** What Compare works on: the ticked pages, or every open page when none are ticked. */
export function comparePages(layout: ReaderLayout): number[] {
  const ticked = selectedPages(layout);
  if (ticked.length) return ticked;
  return [...new Set(layout.panels.map((p) => p.page))].sort((a, b) => a - b);
}

/* ── Zoom ── */

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(s * 1000) / 1000));
}

/**
 * The scale a page is drawn at. `natural` is the page size at 100% and `box`
 * the space available for it (both CSS pixels, gutters already removed).
 */
export function resolveScale(zoom: Zoom, natural: { w: number; h: number }, box: { w: number; h: number }): number {
  if (typeof zoom === "number") return clampScale(zoom);
  if (natural.w <= 0 || natural.h <= 0 || box.w <= 0) return 1;
  const fitWidth = box.w / natural.w;
  if (zoom === "width") return clampScale(fitWidth);
  if (zoom === "page") return clampScale(Math.min(fitWidth, box.h > 0 ? box.h / natural.h : fitWidth));
  const fitPage = box.h > 0 ? box.h / natural.h : fitWidth;
  return clampScale(Math.min(fitWidth, Math.max(fitPage, AUTO_MIN), AUTO_MAX));
}

/** The next zoom step above (dir 1) or below (dir -1) the current scale. */
export function stepZoom(current: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > current + 0.005) ?? MAX_SCALE;
  return [...ZOOM_STEPS].reverse().find((s) => s < current - 0.005) ?? ZOOM_STEPS[0];
}

function validZoom(z: unknown): Zoom {
  if (z === "auto" || z === "width" || z === "page") return z;
  if (typeof z === "number" && Number.isFinite(z)) return clampScale(z);
  return "auto";
}

/**
 * Restores a saved layout, rejecting anything inconsistent (bad pages, wrong
 * sizes, too many panels), so a corrupt or stale entry can never break the reader.
 */
export function restoreLayout(saved: unknown, pageCount: number): ReaderLayout | null {
  if (!saved || typeof saved !== "object") return null;
  const s = saved as Partial<ReaderLayout> & { panels?: Partial<Panel>[] };
  if (!Array.isArray(s.panels) || s.panels.length < 1 || s.panels.length > MAX_PANELS) return null;
  const panels: Panel[] = [];
  for (const p of s.panels) {
    if (!p || typeof p.id !== "string" || !Number.isInteger(p.page) || p.page! < 1 || p.page! > pageCount) return null;
    panels.push({ id: p.id, page: p.page!, zoom: validZoom(p.zoom) });
  }
  const base = withShape(
    { panels, focusedId: panels.some((p) => p.id === s.focusedId) ? s.focusedId! : panels[0].id, rows: [], rowSizes: [], colSizes: [], selected: [], stash: [] },
    false
  );
  const sums = (xs: unknown) => Array.isArray(xs) && xs.every((x) => typeof x === "number" && x >= MIN_FRACTION - 1e-6) && Math.abs(xs.reduce((a: number, b: number) => a + b, 0) - 1) < 1e-3;
  const shapeOk = Array.isArray(s.rows) && s.rows.length === base.rows.length && s.rows.every((r, i) => r === base.rows[i]);
  const sizesOk = shapeOk && sums(s.rowSizes) && (s.rowSizes as number[]).length === base.rows.length &&
    Array.isArray(s.colSizes) && s.colSizes.length === base.rows.length && s.colSizes.every((c, i) => sums(c) && (c as number[]).length === base.rows[i]);
  return {
    ...base,
    rowSizes: sizesOk ? (s.rowSizes as number[]) : base.rowSizes,
    colSizes: sizesOk ? (s.colSizes as number[][]) : base.colSizes,
    selected: Array.isArray(s.selected) ? s.selected.filter((id) => panels.some((p) => p.id === id)) : [],
    stash: Array.isArray(s.stash) ? s.stash.filter((p) => Number.isInteger(p) && p >= 1 && p <= pageCount).slice(0, MAX_PANELS) : [],
  };
}
