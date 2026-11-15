/**
 * Workspace commands for the research assistant. A request such as "show
 * pages 2 and 3 together" is parsed into a typed command, validated against
 * the paper, and applied to the real reader layout. Anything that isn't a
 * workspace command is left to the assistant as a question about the paper.
 *
 * Pure functions only, unit-tested with `node --test`.
 */
import {
  MAX_PANELS, checkPages, clampScale, closePanel, comparePages, focusedPanel, goToPage, modeOf, openPanel, setViewMode,
  setZoom, showPages, stepZoom, type ReaderLayout, type ViewMode, type Zoom,
} from "./reader-layout.ts";

export type ZoomRequest = "in" | "out" | "width" | "page" | "reset" | number;

export type Command =
  | { type: "goto"; page: number }
  | { type: "add"; pages: number[] }
  | { type: "show"; pages: number[] }
  | { type: "compare"; pages: number[] | null }
  | { type: "zoom"; zoom: ZoomRequest; page?: number }
  | { type: "mode"; mode: ViewMode }
  | { type: "close"; target: { panel: number } | { page: number } | "focused" | "others" }
  | { type: "step"; dir: 1 | -1 }
  | { type: "fullscreen"; on: boolean }
  | { type: "explain"; page: number | null }
  | { type: "summarize"; pages: number[] | null };

const WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17",
  eighteen: "18", nineteen: "19", twenty: "20",
};
const ORDINALS: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5 };

export function normalise(input: string): string {
  let t = ` ${input.toLowerCase()} `
    .replace(/[“”"'’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[?!.;:]+(\s|$)/g, " ")
    .replace(/\s+/g, " ");
  t = t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/g, (w) => WORDS[w]);
  t = t.replace(/\bp\.?\s*(?=\d)/g, "page ").replace(/\bpp\.?\s*(?=\d)/g, "pages ");
  // Politeness and filler that doesn't change the request
  t = t.trim().replace(/^(hey|ok|okay|now|so|then)\b,?\s*/, "");
  t = t.replace(/^(please|kindly|can you|could you|would you|will you|i want to|i'd like to|id like to|let me|lets|let us|i want|go ahead and)\s+/, "");
  t = t.replace(/^(please)\s+/, "").replace(/\s+(please|for me|now)$/, "");
  return t.trim();
}

/** Numbers and ranges at the start of `rest`: "2, 3 and 5", "2-4", "2 to 4". */
function numberList(rest: string): number[] {
  return readList(rest).pages;
}

/** True when the whole string is a list of page numbers. */
function isPureList(s: string): boolean {
  const r = readList(s);
  return r.pages.length > 0 && !r.rest.trim();
}

function readList(rest: string): { pages: number[]; rest: string } {
  const out: number[] = [];
  const re = /^\s*(?:(?:,|and|plus|or|pages?)\s*)*(\d+)(?:\s*(?:-|–|to|through|thru)\s*(\d+))?/;
  let m: RegExpMatchArray | null;
  while ((m = rest.match(re))) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (b >= a && b - a < 50) for (let p = a; p <= b; p++) out.push(p);
    else out.push(a);
    rest = rest.slice(m[0].length);
  }
  return { pages: out, rest };
}

/** Page numbers named after the word "page(s)", or straight after a verb ("compare 2 and 6"). */
export function pagesIn(t: string, afterVerb?: RegExp): number[] {
  const m = t.match(/\bpages?\s+(?=\d)/);
  if (m && m.index !== undefined) return numberList(t.slice(m.index + m[0].length));
  if (afterVerb) {
    const v = t.match(afterVerb);
    if (v && v.index !== undefined) return numberList(t.slice(v.index + v[0].length));
  }
  return [];
}

const SHOW_VERBS = /^(show|open|display|view|bring up|pull up|put|place|load|see|read|look at|go to|jump to|turn to|skip to|navigate to|take me to|focus on|focus|move to|add)\b/;

export function parseCommand(input: string): Command | null {
  const t = normalise(input);
  if (!t) return null;

  // Full screen
  if (/^(exit|leave|close|quit|turn off|stop)\s+(the\s+)?(full ?screen|focus mode|reading mode)/.test(t)) return { type: "fullscreen", on: false };
  if (/^((enter|go|switch to|open|turn on|use|start)\s+)?(the\s+)?(full ?screen|focus mode|distraction free|reading mode)( mode| reading| view)?$/.test(t)) return { type: "fullscreen", on: true };

  // View modes
  const mode = t.match(/^(?:(?:return|go back|switch|change|back|go|revert|get back|set it|set)(?: back)?(?: to)? |use |show |set |view |display |open )?(?:a |the |me )?(?:(single|1)[- ]?page|(only|just) (?:1|this|the current) page|(2|3)[- ]?pages?|(custom|grid)(?: layout| view| grid)?)(?: mode| view| layout| side by side| together| at a time| at once| spread)?$/);
  if (mode) {
    if (mode[1] || mode[2]) return { type: "mode", mode: "single" };
    if (mode[3]) return { type: "mode", mode: mode[3] === "2" ? "two" : "three" };
    if (mode[4]) return { type: "mode", mode: "custom" };
  }

  // Zoom
  const zoomPage = pagesIn(t)[0];
  const zp = zoomPage ? { page: zoomPage } : {};
  if (/^(zoom|scale|set (the )?zoom|set zoom)( it| the page)?( to)? (\d+) ?(%|percent)$/.test(t)) {
    const n = Number(t.match(/(\d+) ?(%|percent)$/)![1]);
    return { type: "zoom", zoom: n / 100 };
  }
  if (/^(zoom in|enlarge|magnify|make (it|the page|this page|the text) (bigger|larger))\b/.test(t)) return { type: "zoom", zoom: "in", ...zp };
  if (/^(zoom out|shrink|make (it|the page|this page|the text) smaller)\b/.test(t)) return { type: "zoom", zoom: "out", ...zp };
  if (/^((fit|fill)( (it|the page|this page))?( to)?( the)? (page )?width|page width|full width)\b/.test(t)) return { type: "zoom", zoom: "width", ...zp };
  if (/^((fit|show)( (it|the page|this page))?( to)?( the)? (whole |entire |full )?(page|screen|window)|whole page|entire page)$/.test(t)) return { type: "zoom", zoom: "page", ...zp };
  if (/^(reset|clear|undo)( the)? zoom|^(default|normal|automatic|auto) zoom|^zoom (reset|to default|to normal)/.test(t)) return { type: "zoom", zoom: "reset", ...zp };
  if (/^(actual size|100 ?%)$/.test(t)) return { type: "zoom", zoom: 1, ...zp };

  // Close
  if (/^close\b/.test(t)) {
    if (/\b(other|others|everything else|all (the )?other)\b/.test(t) || /^close all( pages| panels)?$/.test(t)) return { type: "close", target: "others" };
    const ord = t.match(/\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)\s+(panel|page|one|pane)\b/);
    if (ord) return { type: "close", target: { panel: ord[1] === "last" ? -1 : ORDINALS[ord[1]] } };
    const num = t.match(/\b(panel|pane)\s+(\d+)\b/);
    if (num) return { type: "close", target: { panel: Number(num[2]) } };
    const pg = pagesIn(t);
    if (pg.length === 1) return { type: "close", target: { page: pg[0] } };
    if (/^close( (this|the current|the focused|current) (page|panel|pane))?$/.test(t)) return { type: "close", target: "focused" };
    return null;
  }

  // Next / previous
  if (/^((go|turn|move|skip)( to)?( the)? )?(next|following)( page)?$|^(turn the page|forward)$/.test(t)) return { type: "step", dir: 1 };
  if (/^((go|turn|move)( back)?( to)?( the)? )?(previous|prev|preceding|last)( page)?$|^(go back|back( 1)? page)$/.test(t)) return { type: "step", dir: -1 };

  // Compare
  if (/^(compare|contrast)\b/.test(t)) {
    const pages = pagesIn(t, /^(compare|contrast)\s+/);
    return { type: "compare", pages: pages.length ? pages : null };
  }

  // Explain / summarise a page (other "explain ..." requests are questions)
  if (/^explain\b/.test(t)) {
    const pg = pagesIn(t);
    if (pg.length === 1 && /^explain (the )?page \d+$/.test(t)) return { type: "explain", page: pg[0] };
    if (/^explain (this|the current|the open|current) page$/.test(t)) return { type: "explain", page: null };
    return null;
  }
  if (/^(summari[sz]e|sum up)\b/.test(t)) {
    const pg = pagesIn(t);
    if (pg.length && isPureList(t.replace(/^(summari[sz]e|sum up) (the )?pages?\s+/, ""))) return { type: "summarize", pages: pg };
    if (/^(summari[sz]e|sum up) (this|these|the current|the open|current|open) (page|pages)$/.test(t)) return { type: "summarize", pages: null };
    return null;
  }

  // Show, open, focus, go to
  if (SHOW_VERBS.test(t)) {
    const pages = pagesIn(t, /^(show|open|display|view|add|compare)\s+(me\s+)?/);
    if (!pages.length) return null;
    const verb = t.match(SHOW_VERBS)![1];
    const beside = /\b(beside|next to|alongside|along with|in a new (panel|pane)|in another (panel|pane)|as well|too|also)\b/.test(t) || verb === "add";
    if (pages.length === 1) {
      if (beside) return { type: "add", pages };
      return { type: "goto", page: pages[0] };
    }
    return beside ? { type: "add", pages } : { type: "show", pages };
  }
  return null;
}

/* ── Applying a command ── */

export interface CommandContext {
  pageCount: number;
  hasText: (page: number) => boolean;
  /** The scale the focused page is currently drawn at (for zoom in / out). */
  scaleOf: (panelId: string) => number;
}

export interface CommandResult {
  ok: boolean;
  message: string;
  layout?: ReaderLayout;
  fullscreen?: boolean;
  ai?: { action: "compare_pages" | "explain_page" | "summarize_pages"; pages: number[] };
}

export function listPages(pages: number[]): string {
  if (pages.length <= 1) return String(pages[0] ?? "");
  return `${pages.slice(0, -1).join(", ")} and ${pages[pages.length - 1]}`;
}

const fail = (message: string): CommandResult => ({ ok: false, message });

function rangeError(page: number, pageCount: number): CommandResult {
  return fail(`This paper has ${pageCount} page${pageCount === 1 ? "" : "s"}, so there is no page ${page}.`);
}

function pagesError(pages: number[], ctx: CommandContext): CommandResult | null {
  const check = checkPages(pages, ctx.pageCount);
  if (check.error === "out_of_range") return rangeError(check.bad!, ctx.pageCount);
  if (check.error === "too_many") return fail(`The reader shows at most ${MAX_PANELS} pages at once, and that asks for ${check.pages.length}. Name up to ${MAX_PANELS}.`);
  return null;
}

const zoomWord = (z: Zoom, scale: number) =>
  z === "width" ? "fits the width" : z === "page" ? "fits on screen" : z === "auto" ? "is back to the default zoom" : `is at ${Math.round(scale * 100)}%`;

export function runCommand(layout: ReaderLayout, cmd: Command, ctx: CommandContext): CommandResult {
  const focus = focusedPanel(layout)!;
  const open = layout.panels.map((p) => p.page);

  switch (cmd.type) {
    case "goto": {
      if (cmd.page < 1 || cmd.page > ctx.pageCount) return rangeError(cmd.page, ctx.pageCount);
      const r = goToPage(layout, cmd.page);
      return { ok: true, layout: r.layout, message: r.how === "focused" && layout.panels.length > 1 ? `Page ${cmd.page} is open; it now has focus.` : `Now on page ${cmd.page}.` };
    }

    case "add": {
      const err = pagesError(cmd.pages, ctx);
      if (err) return err;
      const fresh = [...new Set(cmd.pages)].filter((p) => !open.includes(p));
      if (!fresh.length) return { ok: true, layout: goToPage(layout, cmd.pages[0]).layout, message: `Page${cmd.pages.length > 1 ? "s" : ""} ${listPages(cmd.pages)} ${cmd.pages.length > 1 ? "are" : "is"} already open.` };
      if (open.length + fresh.length > MAX_PANELS) {
        return fail(`${open.length} page${open.length > 1 ? "s are" : " is"} open and the reader shows at most ${MAX_PANELS}. Close one first, or say which pages to show, e.g. “show pages ${listPages([...open.slice(0, MAX_PANELS - 1), fresh[0]])}”.`);
      }
      let next = layout;
      for (const p of fresh) next = openPanel(next, p)!;
      return { ok: true, layout: next, message: `Opened page${fresh.length > 1 ? "s" : ""} ${listPages(fresh)} beside page ${focus.page}.` };
    }

    case "show": {
      const err = pagesError(cmd.pages, ctx);
      if (err) return err;
      const pages = [...new Set(cmd.pages)];
      if (pages.length === 1) return runCommand(layout, { type: "goto", page: pages[0] }, ctx);
      const next = showPages(layout, pages);
      return { ok: true, layout: next, message: `Showing pages ${listPages(pages)} ${pages.length > 3 ? "in a grid" : "side by side"}.` };
    }

    case "compare": {
      const pages = cmd.pages ? [...new Set(cmd.pages)].sort((a, b) => a - b) : comparePages(layout);
      if (pages.length < 2) {
        return fail(cmd.pages ? "Name at least two pages to compare, for example “compare pages 2 and 6”." : "Only one page is open. Name the pages to compare, for example “compare pages 2 and 6”.");
      }
      const err = pagesError(pages, ctx);
      if (err) return err;
      const blank = pages.find((p) => !ctx.hasText(p));
      if (blank) return fail(`Page ${blank} has no selectable text, so it can't be compared.`);
      const same = pages.length === open.length && pages.every((p) => open.includes(p));
      return {
        ok: true,
        layout: same ? layout : showPages(layout, pages),
        ai: { action: "compare_pages", pages },
        message: `Comparing pages ${listPages(pages)}; they're open side by side.`,
      };
    }

    case "zoom": {
      let base = layout;
      if (cmd.page !== undefined) {
        if (cmd.page < 1 || cmd.page > ctx.pageCount) return rangeError(cmd.page, ctx.pageCount);
        base = goToPage(layout, cmd.page).layout;
      }
      const target = focusedPanel(base)!;
      const current = ctx.scaleOf(target.id);
      const zoom: Zoom =
        cmd.zoom === "in" || cmd.zoom === "out" ? stepZoom(current, cmd.zoom === "in" ? 1 : -1) : cmd.zoom === "reset" ? "auto" : cmd.zoom;
      if (typeof zoom === "number" && (cmd.zoom === "in" || cmd.zoom === "out") && Math.abs(zoom - current) < 0.005) {
        return fail(`Page ${target.page} is already at the ${cmd.zoom === "in" ? "largest" : "smallest"} zoom.`);
      }
      const next = setZoom(base, target.id, zoom);
      const scale = typeof zoom === "number" ? clampScale(zoom) : current;
      return { ok: true, layout: next, message: `Page ${target.page} ${zoomWord(zoom, scale)}.` };
    }

    case "mode": {
      const need = cmd.mode === "single" ? 1 : cmd.mode === "two" ? 2 : cmd.mode === "three" ? 3 : 4;
      if (ctx.pageCount < need) return fail(`This paper has only ${ctx.pageCount} page${ctx.pageCount > 1 ? "s" : ""}, so it can't show ${need} at once.`);
      if (modeOf(layout) === cmd.mode) return { ok: true, layout, message: cmd.mode === "single" ? `Already showing one page (page ${focus.page}).` : `Already showing pages ${listPages(open)}.` };
      const next = setViewMode(layout, cmd.mode, ctx.pageCount);
      const pages = next.panels.map((p) => p.page);
      return {
        ok: true,
        layout: next,
        message: cmd.mode === "single" ? `Back to single-page reading, on page ${focusedPanel(next)!.page}.` : `Showing ${pages.length} pages: ${listPages(pages)}.`,
      };
    }

    case "close": {
      if (layout.panels.length <= 1) return fail("Only one page is open, and the reader always keeps one open.");
      let id: string | undefined;
      if (cmd.target === "others") {
        const next = showPages(layout, [focus.page]);
        return { ok: true, layout: next, message: `Closed the other pages; reading page ${focus.page}.` };
      }
      if (cmd.target === "focused") id = focus.id;
      else if ("panel" in cmd.target) {
        const n = cmd.target.panel === -1 ? layout.panels.length : cmd.target.panel;
        if (n < 1 || n > layout.panels.length) return fail(`There ${layout.panels.length === 1 ? "is" : "are"} only ${layout.panels.length} panels open.`);
        id = layout.panels[n - 1].id;
      } else {
        const page = cmd.target.page;
        id = layout.panels.find((p) => p.page === page)?.id;
        if (!id) return fail(`Page ${page} isn't open. Open pages: ${listPages(open)}.`);
      }
      const closed = layout.panels.find((p) => p.id === id)!;
      return { ok: true, layout: closePanel(layout, id), message: `Closed page ${closed.page}.` };
    }

    case "step": {
      const to = focus.page + cmd.dir;
      if (to < 1) return fail("This is the first page.");
      if (to > ctx.pageCount) return fail(`Page ${ctx.pageCount} is the last page.`);
      return { ok: true, layout: goToPage(layout, to).layout, message: `Now on page ${to}.` };
    }

    case "fullscreen":
      return { ok: true, fullscreen: cmd.on, message: cmd.on ? "Full-screen reading. Press Esc to leave." : "Left full-screen reading." };

    case "explain": {
      const page = cmd.page ?? focus.page;
      if (page < 1 || page > ctx.pageCount) return rangeError(page, ctx.pageCount);
      if (!ctx.hasText(page)) return fail(`Page ${page} has no selectable text, so it can't be explained.`);
      return { ok: true, layout: goToPage(layout, page).layout, ai: { action: "explain_page", pages: [page] }, message: `Explaining page ${page}.` };
    }

    case "summarize": {
      const pages = cmd.pages ? [...new Set(cmd.pages)].sort((a, b) => a - b) : comparePages(layout);
      const err = pagesError(pages, ctx);
      if (err) return err;
      const withText = pages.filter((p) => ctx.hasText(p));
      if (!withText.length) return fail(`Page${pages.length > 1 ? "s" : ""} ${listPages(pages)} ${pages.length > 1 ? "have" : "has"} no selectable text.`);
      return { ok: true, layout, ai: { action: "summarize_pages", pages: withText }, message: `Summarising page${withText.length > 1 ? "s" : ""} ${listPages(withText)}.` };
    }
  }
}
