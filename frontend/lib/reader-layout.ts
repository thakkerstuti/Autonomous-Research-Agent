/**
 * Multi-page reader layout: up to five page panels, arranged in rows, with
 * user-resizable column widths and row heights. Pure functions only (no React,
 * no imports) so the behaviour is unit-tested directly with `node --test`.
 */

export const MAX_PANELS = 5;
export const MIN_FRACTION = 0.14; // smallest share a panel or row can be resized to

export type Arrangement = "auto" | "columns";

export interface Panel {
  id: string;
  page: number;
}

export interface ReaderLayout {
  panels: Panel[];
  focusedId: string | null;
  arrangement: Arrangement;
  /** Panels per row, top to bottom (derived from count + arrangement unless reset). */
  rows: number[];
  /** Height share of each row (sums to 1). */
  rowSizes: number[];
  /** Width share of each panel within its row (each row sums to 1). */
  colSizes: number[][];
  /** Panels ticked for an AI comparison. */
  selected: string[];
}

let counter = 0;
export function newPanelId(): string {
  counter += 1;
  return `p${Date.now().toString(36)}${counter.toString(36)}`;
}

/** Single, two side by side, three side by side, a 2 x 2 grid, then 3 over 2. */
export function rowsFor(count: number, arrangement: Arrangement): number[] {
  if (count <= 0) return [];
  if (arrangement === "columns" || count <= 3) return [count];
  return count === 4 ? [2, 2] : [3, 2];
}

const equal = (n: number) => Array.from({ length: n }, () => 1 / n);

function withShape(layout: ReaderLayout, keepSizes: boolean): ReaderLayout {
  const rows = rowsFor(layout.panels.length, layout.arrangement);
  const sameShape = keepSizes && rows.length === layout.rows.length && rows.every((r, i) => r === layout.rows[i]);
  return {
    ...layout,
    rows,
    rowSizes: sameShape ? layout.rowSizes : equal(rows.length),
    colSizes: sameShape ? layout.colSizes : rows.map((r) => equal(r)),
  };
}

export function initialLayout(page = 1): ReaderLayout {
  const first = { id: newPanelId(), page };
  return withShape({ panels: [first], focusedId: first.id, arrangement: "auto", rows: [], rowSizes: [], colSizes: [], selected: [] }, false);
}

export function focusedPanel(layout: ReaderLayout): Panel | undefined {
  return layout.panels.find((p) => p.id === layout.focusedId) ?? layout.panels[0];
}

/** Opens a page in a new panel. Returns null when five are already open. */
export function openPanel(layout: ReaderLayout, page: number): ReaderLayout | null {
  if (layout.panels.length >= MAX_PANELS) return null;
  const panel = { id: newPanelId(), page };
  const focusIdx = layout.panels.findIndex((p) => p.id === layout.focusedId);
  const panels = [...layout.panels];
  panels.splice(focusIdx >= 0 ? focusIdx + 1 : panels.length, 0, panel); // next to the one being read
  return withShape({ ...layout, panels, focusedId: panel.id }, false);
}

/**
 * For citations and the page list: focus the page if it's already open,
 * otherwise open it in a new panel, or (with five open) show it in the
 * focused panel, so no panel is ever closed behind the reader's back.
 */
export function showPage(layout: ReaderLayout, page: number): { layout: ReaderLayout; how: "focused" | "opened" | "replaced" } {
  const existing = layout.panels.find((p) => p.page === page);
  if (existing) return { layout: { ...layout, focusedId: existing.id }, how: "focused" };
  const opened = openPanel(layout, page);
  if (opened) return { layout: opened, how: "opened" };
  const target = focusedPanel(layout)!;
  return { layout: setPanelPage(layout, target.id, page), how: "replaced" };
}

export function closePanel(layout: ReaderLayout, id: string): ReaderLayout {
  if (layout.panels.length <= 1) return layout; // always keep one page open
  const idx = layout.panels.findIndex((p) => p.id === id);
  if (idx < 0) return layout;
  const panels = layout.panels.filter((p) => p.id !== id);
  const focusedId = layout.focusedId === id ? panels[Math.min(idx, panels.length - 1)].id : layout.focusedId;
  return withShape({ ...layout, panels, focusedId, selected: layout.selected.filter((s) => s !== id) }, false);
}

/** Change the page shown in a panel (the panel itself stays). */
export function setPanelPage(layout: ReaderLayout, id: string, page: number): ReaderLayout {
  return { ...layout, panels: layout.panels.map((p) => (p.id === id ? { ...p, page } : p)), focusedId: id };
}

export function focusPanel(layout: ReaderLayout, id: string): ReaderLayout {
  return layout.panels.some((p) => p.id === id) ? { ...layout, focusedId: id } : layout;
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

/** Index range of the panels in each row. */
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

export function setArrangement(layout: ReaderLayout, arrangement: Arrangement): ReaderLayout {
  return withShape({ ...layout, arrangement }, false);
}

/** Back to equal sizes and the automatic arrangement; open pages are kept. */
export function resetLayout(layout: ReaderLayout): ReaderLayout {
  return withShape({ ...layout, arrangement: "auto" }, false);
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

/**
 * Restores a saved layout, rejecting anything inconsistent (bad pages, wrong
 * sizes, too many panels), so a corrupt or stale entry can never break the reader.
 */
export function restoreLayout(saved: unknown, pageCount: number): ReaderLayout | null {
  if (!saved || typeof saved !== "object") return null;
  const s = saved as Partial<ReaderLayout>;
  if (!Array.isArray(s.panels) || s.panels.length < 1 || s.panels.length > MAX_PANELS) return null;
  const panels: Panel[] = [];
  for (const p of s.panels) {
    if (!p || typeof p.id !== "string" || !Number.isInteger(p.page) || p.page < 1 || p.page > pageCount) return null;
    panels.push({ id: p.id, page: p.page });
  }
  const arrangement: Arrangement = s.arrangement === "columns" ? "columns" : "auto";
  const base = withShape(
    { panels, focusedId: panels.some((p) => p.id === s.focusedId) ? s.focusedId! : panels[0].id, arrangement, rows: [], rowSizes: [], colSizes: [], selected: [] },
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
  };
}
