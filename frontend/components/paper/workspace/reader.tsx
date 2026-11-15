"use client";

/**
 * The reading desk. One page at a time by default, or two, three, or a custom
 * grid of up to five, each page in its own scrolling container at its own
 * zoom. Layout rules live in lib/reader-layout.ts (unit-tested); this file
 * draws them and turns pointer and keyboard input into those operations.
 */
import "react-pdf/dist/esm/Page/TextLayer.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  Check, ChevronLeft, ChevronRight, Columns2, Columns3, GripVertical, Keyboard, LayoutGrid, Maximize, Minimize, Minus,
  MoreHorizontal, MoveHorizontal, PanelLeft, Plus, RectangleVertical, RotateCcw, Scan, Sparkles, X,
} from "lucide-react";
import { usePaperFile } from "@/lib/paper-file";
import { usePageTextQuery } from "@/lib/queries";
import {
  MAX_PANELS, closePanel, comparePages, focusPanel, focusedPanel, goToPage, modeOf, movePanel, openPanel, resetSizes, resizeColumn, resizeRow,
  resolveScale, rowSlices, setPanelPage, setViewMode, setZoom, sizesAreEqual, stepZoom, toggleSelected, ZOOM_STEPS,
  type Panel, type ReaderLayout, type ViewMode, type Zoom,
} from "@/lib/reader-layout";
import { listPages } from "@/lib/workspace-commands";
import { isTyping, renderedScale } from "@/lib/reader-runtime";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

type SetLayout = (update: (l: ReaderLayout) => ReaderLayout) => void;
type Size = { w: number; h: number };

/** US Letter at 100%, used until a page's real size is known. */
const DEFAULT_SIZE: Size = { w: 816, h: 1056 };
const MIN_PANEL_PX = 380;


export const READER_SHORTCUTS: [string, string][] = [
  ["← →", "Previous / next page"],
  ["+ −", "Zoom in / out"],
  ["0", "Reset zoom"],
  ["W  P", "Fit width / fit page"],
  ["1 2 3 4", "One, two, three pages or custom"],
  ["F", "Full-screen reading (Esc leaves)"],
  ["C", "Compare the open pages"],
  ["X", "Close the focused page"],
  ["Alt ← →", "Move the focused page left / right"],
  ["N", "Show or hide page notes"],
  ["/", "Ask the assistant"],
  ["?", "This list"],
];

const MODES: { mode: ViewMode; label: string; icon: typeof Columns2 }[] = [
  { mode: "single", label: "Single page", icon: RectangleVertical },
  { mode: "two", label: "Two pages", icon: Columns2 },
  { mode: "three", label: "Three pages", icon: Columns3 },
  { mode: "custom", label: "Custom layout: four or five pages in a grid", icon: LayoutGrid },
];

export interface ReaderProps {
  paperId: string;
  pageCount: number;
  hasText: (page: number) => boolean;
  explained: (page: number) => boolean;
  layout: ReaderLayout;
  setLayout: SetLayout;
  immersive: boolean;
  onImmersive: (on: boolean) => void;
  railOpen: boolean;
  onRailOpen: (open: boolean) => void;
  onExplainSelection: (page: number, text: string) => void;
  onCompare: (pages: number[]) => void;
  onNotice: (message: string) => void;
}

/** Size of an element's content box, kept up to date. */
function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<Size>({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, []);
  return [ref, box] as const;
}

function Tool({ label, onClick, disabled, active, children, className, small }: {
  label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: React.ReactNode; className?: string; small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex flex-shrink-0 items-center justify-center rounded-[3px] transition-colors duration-150 disabled:pointer-events-none disabled:opacity-30",
        small ? "h-6 w-6" : "h-8 w-8",
        active ? "bg-ink/[0.08] text-ink" : "text-ink-soft hover:bg-ink/[0.05] hover:text-ink",
        className
      )}
    >
      {children}
    </button>
  );
}

const Rule = () => <span aria-hidden className="mx-1.5 h-4 w-px flex-shrink-0 bg-line" />;

/** Page number box: type a page and press Enter. */
function PageField({ page, pageCount, onGo, label, compact }: { page: number; pageCount: number; onGo: (p: number) => void; label: string; compact?: boolean }) {
  const [draft, setDraft] = useState(String(page));
  useEffect(() => setDraft(String(page)), [page]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isInteger(n) && n >= 1 && n <= pageCount) {
      if (n !== page) onGo(n);
    } else setDraft(String(page));
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); commit(); }} className="flex items-center gap-1.5 text-[12.5px]">
      <input
        value={draft}
        inputMode="numeric"
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 4))}
        onBlur={commit}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => { if (e.key === "Escape") { setDraft(String(page)); e.currentTarget.blur(); } }}
        aria-label={label}
        className={cn("mono rounded-[3px] border border-transparent bg-transparent text-center text-ink outline-none transition-colors hover:border-line focus:border-accent/60 focus:bg-bg", compact ? "h-6 w-9 text-[11.5px]" : "h-7 w-11 text-[12.5px]")}
      />
      <span className="mono whitespace-nowrap text-ink-faint">{compact ? "/" : "of"} {pageCount}</span>
    </form>
  );
}

function TextFallback({ paperId, page }: { paperId: string; page: number }) {
  const q = usePageTextQuery(paperId, page, true);
  const text = q.data?.text?.trim();
  return (
    <div className="reader-sheet mx-auto w-full max-w-[720px] px-10 py-12 text-black">
      <p className="mb-6 font-sans text-[11.5px] text-neutral-500">Extracted text of page {page}. The original PDF file isn&rsquo;t available on the server, so its layout can&rsquo;t be shown.</p>
      {q.isLoading ? (
        <div className="h-64 animate-pulse rounded bg-black/[0.04]" />
      ) : text ? (
        <div className="whitespace-pre-wrap font-serif text-[15.5px] leading-[1.75]">{text}</div>
      ) : (
        <p className="text-[14px] text-neutral-600">This page has no selectable text; it may be an image or a scan.</p>
      )}
    </div>
  );
}

function PanelView({
  panel, index, total, layout, setLayout, paperId, pageCount, pdf, pdfMode, size, onScale, onZoom, onExplainSelection, dragId, setDragId, drop, setDrop,
}: {
  panel: Panel; index: number; total: number; layout: ReaderLayout; setLayout: SetLayout; paperId: string; pageCount: number;
  pdf: PDFDocumentProxy | null; pdfMode: boolean; size: Size; onScale: (id: string, scale: number) => void;
  onZoom: (dir: 1 | -1) => void;
  onExplainSelection: (page: number, text: string) => void;
  dragId: string | null; setDragId: (id: string | null) => void;
  drop: { id: string; side: "before" | "after" } | null; setDrop: (d: { id: string; side: "before" | "after" } | null) => void;
}) {
  const [bodyRef, box] = useBox<HTMLDivElement>();
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const multi = total > 1;
  const focused = layout.focusedId === panel.id;
  const ticked = layout.selected.includes(panel.id);
  const gutter = multi ? 14 : 40;
  const padY = multi ? 14 : 32;
  const scale = resolveScale(panel.zoom, size, { w: box.w - gutter * 2, h: box.h - padY * 2 - (multi ? 0 : 44) });
  const width = Math.round(size.w * scale);
  const height = Math.round(size.h * scale);
  useEffect(() => {
    if (box.w > 0) onScale(panel.id, scale);
  }, [panel.id, scale, box.w, onScale]);
  useEffect(() => () => void renderedScale.delete(panel.id), [panel.id]);
  // A new page starts at its top
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0, left: 0 });
    setSelection(null);
  }, [panel.page, bodyRef]);

  const go = (page: number) => page >= 1 && page <= pageCount && setLayout((l) => setPanelPage(l, panel.id, page));

  const onMouseUp = () => {
    const sel = window.getSelection();
    const body = bodyRef.current;
    const text = sel?.toString().replace(/\s+/g, " ").trim() ?? "";
    if (!sel || !body || text.length < 3 || !sel.anchorNode || !body.contains(sel.anchorNode)) return setSelection(null);
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const b = body.getBoundingClientRect();
    setSelection({ text: text.slice(0, 1500), x: rect.left - b.left + body.scrollLeft + rect.width / 2, y: rect.top - b.top + body.scrollTop });
  };

  return (
    <section
      aria-label={`Page ${panel.page}${multi ? `, panel ${index + 1} of ${total}` : ""}`}
      data-panel={panel.id}
      data-page={panel.page}
      data-focused={focused || undefined}
      onPointerDown={() => !focused && setLayout((l) => focusPanel(l, panel.id))}
      onDragOver={(e) => {
        if (!dragId || dragId === panel.id) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        setDrop({ id: panel.id, side: e.clientX < r.left + r.width / 2 ? "before" : "after" });
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (!dragId || !drop) return;
        setLayout((l) => {
          const from = l.panels.findIndex((p) => p.id === dragId);
          let to = l.panels.findIndex((p) => p.id === drop.id) + (drop.side === "after" ? 1 : 0);
          if (from < to) to -= 1;
          return movePanel(l, from, to);
        });
        setDragId(null);
        setDrop(null);
      }}
      className={cn(
        "relative flex h-full min-h-0 min-w-0 flex-col",
        multi && "rounded-[3px] border bg-surface transition-colors",
        multi && (focused ? "border-accent/60" : "border-line"),
        dragId === panel.id && "opacity-40"
      )}
    >
      {drop?.id === panel.id && (
        <span aria-hidden className={cn("pointer-events-none absolute bottom-0 top-0 z-20 w-[2px] bg-accent", drop.side === "before" ? "-left-[7px]" : "-right-[7px]")} />
      )}

      {multi && (
        <header className={cn("flex h-9 flex-shrink-0 items-center gap-1 overflow-hidden whitespace-nowrap border-b pl-1.5 pr-1 transition-colors", focused ? "border-accent/25 bg-accent-soft" : "border-line")}>
          <span
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", panel.id);
              e.dataTransfer.effectAllowed = "move";
              setDragId(panel.id);
              document.body.classList.add("select-none");
            }}
            onDragEnd={() => {
              setDragId(null);
              setDrop(null);
              document.body.classList.remove("select-none");
            }}
            title="Drag to move this page"
            className="flex min-w-0 cursor-grab items-center gap-1.5 py-1 pr-2 text-[12.5px] text-ink active:cursor-grabbing"
          >
            <GripVertical size={13} className="flex-shrink-0 text-ink-faint" aria-hidden />
            Page {panel.page}
          </span>
          <span className="flex-1" />
          {focused && pdfMode && (
            <span className="flex items-center" role="group" aria-label={`Zoom page ${panel.page}`}>
              <Tool small label="Zoom out (−)" onClick={() => onZoom(-1)} disabled={scale <= ZOOM_STEPS[0] + 0.005}><Minus size={12} /></Tool>
              <span className="mono w-10 text-center text-[11px] text-ink-soft">{Math.round(scale * 100)}%</span>
              <Tool small label="Zoom in (+)" onClick={() => onZoom(1)} disabled={scale >= 4 - 0.005}><Plus size={12} /></Tool>
            </span>
          )}
          <label title={ticked ? "This page will be compared" : "Compare only the ticked pages (none ticked compares every open page)"} className="flex h-6 w-6 cursor-pointer items-center justify-center">
            <input
              type="checkbox"
              checked={ticked}
              onChange={() => setLayout((l) => toggleSelected(l, panel.id))}
              aria-label={`Include page ${panel.page} in comparison`}
              className="h-3 w-3 accent-[rgb(var(--accent))]"
            />
          </label>
          <Tool small label={`Close page ${panel.page}`} onClick={() => setLayout((l) => closePanel(l, panel.id))}><X size={13} /></Tool>
        </header>
      )}

      <div
        ref={bodyRef}
        data-panel-body
        onMouseUp={onMouseUp}
        onMouseDown={() => setSelection(null)}
        onScroll={() => selection && setSelection(null)}
        className={cn("reader-desk relative min-h-0 flex-1 overflow-auto", multi && "!bg-surface")}
      >
        <div className="flex w-max min-w-full flex-col items-center" style={{ padding: `${padY}px ${gutter}px` }}>
          {pdfMode ? (
            <div className="reader-sheet relative flex-shrink-0" style={{ width, height }} data-sheet>
              {pdf && box.w > 0 && (
                <Page
                  key={`${panel.page}`}
                  pageNumber={panel.page}
                  width={width}
                  renderAnnotationLayer={false}
                  loading={null}
                  error={<p className="p-6 font-sans text-[13px] text-neutral-600">This page couldn&rsquo;t be drawn.</p>}
                />
              )}
            </div>
          ) : (
            <TextFallback paperId={paperId} page={panel.page} />
          )}
          {!multi && (
            <div className="mt-4 flex items-center gap-2 text-[11.5px] text-ink-faint">
              <button type="button" onClick={() => go(panel.page - 1)} disabled={panel.page <= 1} aria-label="Previous page (←)" className="flex h-6 w-6 items-center justify-center transition-colors hover:text-ink disabled:opacity-30">
                <ChevronLeft size={13} />
              </button>
              <span>Page {panel.page} of {pageCount}</span>
              <button type="button" onClick={() => go(panel.page + 1)} disabled={panel.page >= pageCount} aria-label="Next page (→)" className="flex h-6 w-6 items-center justify-center transition-colors hover:text-ink disabled:opacity-30">
                <ChevronRight size={13} />
              </button>
            </div>
          )}
        </div>
        {selection && (
          <button
            type="button"
            onMouseDown={(e) => {
              // Keep the selection; don't let the body's mousedown (which clears it) remove this button
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={() => {
              onExplainSelection(panel.page, selection.text);
              setSelection(null);
              window.getSelection()?.removeAllRanges();
            }}
            style={{ left: Math.max(8, selection.x - 70), top: Math.max(6, selection.y - 42) }}
            className="absolute z-30 flex items-center gap-1.5 rounded-[3px] bg-primary px-2.5 py-1.5 text-[12.5px] font-medium text-on-primary shadow-[0_6px_18px_-6px_rgb(0_0_0/0.45)]"
          >
            <Sparkles size={13} /> Explain selection
          </button>
        )}
      </div>

      {multi && (
        <footer className="flex h-9 flex-shrink-0 items-center justify-between border-t border-line px-1.5 text-ink-faint">
          <Tool small label="Previous page" onClick={() => go(panel.page - 1)} disabled={panel.page <= 1}><ChevronLeft size={13} /></Tool>
          <PageField page={panel.page} pageCount={pageCount} onGo={go} label={`Page shown in panel ${index + 1}`} compact />
          <Tool small label="Next page" onClick={() => go(panel.page + 1)} disabled={panel.page >= pageCount}><ChevronRight size={13} /></Tool>
        </footer>
      )}
    </section>
  );
}

/** A divider that resizes the neighbours on either side, by pointer or arrow keys. */
function Divider({ orientation, onResize, label }: { orientation: "vertical" | "horizontal"; onResize: (deltaPx: number, sizePx: number) => void; label: string }) {
  const vertical = orientation === "vertical";
  const box = (el: HTMLElement) => el.closest<HTMLElement>(vertical ? "[data-resize-row]" : "[data-resize-area]")!;
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const container = box(el);
    el.setPointerCapture(e.pointerId);
    let last = vertical ? e.clientX : e.clientY;
    document.body.classList.add("select-none", vertical ? "cursor-col-resize" : "cursor-row-resize");
    const move = (ev: PointerEvent) => {
      const now = vertical ? ev.clientX : ev.clientY;
      const size = vertical ? container.scrollWidth : container.clientHeight;
      if (now !== last && size > 0) onResize(now - last, size);
      last = now;
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      document.body.classList.remove("select-none", "cursor-col-resize", "cursor-row-resize");
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  return (
    <div
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-label={label}
      tabIndex={0}
      onPointerDown={start}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 80 : 24;
        const keys: Record<string, number> = vertical ? { ArrowLeft: -step, ArrowRight: step } : { ArrowUp: -step, ArrowDown: step };
        const d = keys[e.key];
        if (d) {
          e.preventDefault();
          const container = box(e.currentTarget);
          onResize(d, vertical ? container.scrollWidth : container.clientHeight);
        }
      }}
      title="Drag to resize"
      className={cn("group relative z-10 flex flex-shrink-0 items-center justify-center outline-none", vertical ? "w-3.5 cursor-col-resize" : "h-3.5 cursor-row-resize")}
    >
      <span
        aria-hidden
        className={cn(
          "rounded-full bg-ink/20 transition-colors duration-150 group-hover:bg-accent group-focus-visible:bg-accent group-active:bg-accent",
          vertical ? "h-7 w-[2px]" : "h-[2px] w-7"
        )}
      />
    </div>
  );
}

function PageRail({ pageCount, layout, hasText, explained, onGo, onOpenBeside }: {
  pageCount: number; layout: ReaderLayout; hasText: (p: number) => boolean; explained: (p: number) => boolean;
  onGo: (p: number) => void; onOpenBeside: (p: number) => void;
}) {
  const open = new Set(layout.panels.map((p) => p.page));
  const focus = focusedPanel(layout)?.page;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-rail-page="${focus}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focus]);
  return (
    <div ref={ref} role="list" aria-label="Pages" className="w-[52px] flex-shrink-0 overflow-y-auto border-r border-line bg-bg py-2">
      {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
        <button
          key={p}
          role="listitem"
          data-rail-page={p}
          onClick={(e) => (e.shiftKey ? onOpenBeside(p) : onGo(p))}
          aria-label={`Go to page ${p}`}
          aria-current={p === focus ? "page" : undefined}
          title={`Page ${p}${!hasText(p) ? " · no selectable text" : ""}${explained(p) ? " · notes written" : ""}${open.has(p) ? " · open" : ""}\nShift-click to open beside`}
          className={cn(
            "mono relative mx-auto flex h-8 w-9 items-center justify-center rounded-[5px] text-[12px] transition-colors",
            p === focus ? "bg-primary text-on-primary" : open.has(p) ? "bg-ink/[0.07] text-ink" : "text-ink-soft hover:bg-ink/[0.05] hover:text-ink",
            !hasText(p) && p !== focus && "text-ink-faint/70"
          )}
        >
          {p}
          {explained(p) && p !== focus && <span aria-hidden className="absolute right-[5px] top-[6px] h-[4px] w-[4px] rounded-full bg-accent/80" />}
        </button>
      ))}
    </div>
  );
}

function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest("[data-shortcuts-toggle]")) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  return (
    <div ref={ref} role="dialog" aria-label="Keyboard shortcuts" className="absolute right-2 top-[calc(100%+6px)] z-40 w-[290px] rounded-[10px] border border-line bg-surface p-3.5 shadow-panel">
      <p className="mb-2 text-[12.5px] font-semibold text-ink">Keyboard shortcuts</p>
      <dl className="grid gap-[7px] text-[12.5px]">
        {READER_SHORTCUTS.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[88px_1fr] items-baseline gap-2">
            <dt className="mono text-[11.5px] text-ink">{k}</dt>
            <dd className="text-ink-soft">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2.5 border-t border-line pt-2 text-[11.5px] text-ink-faint">Shortcuts pause while you type.</p>
    </div>
  );
}

export function Reader({
  paperId, pageCount, hasText, explained, layout, setLayout, immersive, onImmersive, railOpen, onRailOpen, onExplainSelection, onCompare, onNotice,
}: ReaderProps) {
  const file = usePaperFile(paperId);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<Record<number, Size>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; side: "before" | "after" } | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const [scales, setScales] = useState<Record<string, number>>({});
  const onScale = useCallback((id: string, scale: number) => {
    renderedScale.set(id, scale);
    setScales((s) => (s[id] === scale ? s : { ...s, [id]: scale }));
  }, []);
  const [areaRef, area] = useBox<HTMLDivElement>();
  const [barRef, bar] = useBox<HTMLDivElement>();
  const narrowBar = bar.w > 0 && bar.w < 760;
  const tinyBar = bar.w > 0 && bar.w < 560;

  // pdf.js takes ownership of the bytes it's given, so each mount gets its own copy
  const pdfFile = useMemo(() => (file.data ? { data: file.data.slice() } : null), [file.data]);
  const pdfMode = !!pdfFile && !loadFailed;
  const focus = focusedPanel(layout)!;
  const mode = modeOf(layout);
  const multi = layout.panels.length > 1;
  const stacked = multi && area.w > 0 && area.w < 560;
  const rows = rowSlices(layout);
  const compare = comparePages(layout);
  const scaleNow = scales[focus.id] ?? 1;

  // Real page sizes (rotation included) for every open page
  useEffect(() => {
    if (!pdf) return;
    for (const p of layout.panels) {
      if (sizes[p.page]) continue;
      pdf.getPage(p.page).then((pg) => {
        const v = pg.getViewport({ scale: 1 });
        setSizes((s) => (s[p.page] ? s : { ...s, [p.page]: { w: (v.width * 4) / 3, h: (v.height * 4) / 3 } }));
      }).catch(() => {});
    }
  }, [pdf, layout.panels, sizes]);

  const zoomTo = (z: Zoom) => setLayout((l) => setZoom(l, focusedPanel(l)!.id, z));
  const zoomStep = (dir: 1 | -1) => {
    zoomTo(stepZoom(scales[focus.id] ?? 1, dir));
  };
  const goPage = (p: number) => {
    if (p < 1 || p > pageCount) return;
    setLayout((l) => goToPage(l, p).layout);
  };
  const step = (dir: 1 | -1) => {
    const to = focus.page + dir;
    if (to >= 1 && to <= pageCount) setLayout((l) => setPanelPage(l, focusedPanel(l)!.id, to));
  };
  const chooseMode = (m: ViewMode) => {
    const need = m === "single" ? 1 : m === "two" ? 2 : m === "three" ? 3 : 4;
    if (pageCount < need) return onNotice(`This paper has only ${pageCount} page${pageCount > 1 ? "s" : ""}.`);
    setLayout((l) => setViewMode(l, m, pageCount));
  };
  const addPage = () => {
    const open = new Set(layout.panels.map((p) => p.page));
    const next = Array.from({ length: pageCount }, (_, i) => ((focus.page + i) % pageCount) + 1).find((p) => !open.has(p));
    if (next) setLayout((l) => openPanel(l, next) ?? l);
  };
  const openBeside = (p: number) => {
    if (layout.panels.some((x) => x.page === p)) return goPage(p);
    if (layout.panels.length >= MAX_PANELS) return onNotice(`Five pages are open, the most the reader shows. Close one to open page ${p} beside them.`);
    setLayout((l) => openPanel(l, p) ?? l);
  };

  // Full-screen reading: lift the reader out of the page transition, which would otherwise contain it
  useEffect(() => {
    document.documentElement.classList.toggle("reader-immersive", immersive);
    return () => document.documentElement.classList.remove("reader-immersive");
  }, [immersive]);

  // Keyboard shortcuts while reading; never while typing, never over another handler
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || isTyping(e.target) || e.ctrlKey || e.metaKey) return;
      const idx = layout.panels.findIndex((p) => p.id === focus.id);
      if (e.altKey) {
        if (multi && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          e.preventDefault();
          setLayout((l) => movePanel(l, idx, idx + (e.key === "ArrowLeft" ? -1 : 1)));
        }
        return;
      }
      const k = e.key;
      const act = (fn: () => void) => { e.preventDefault(); fn(); };
      if (k === "ArrowRight" || k === "]") act(() => step(1));
      else if (k === "ArrowLeft" || k === "[") act(() => step(-1));
      else if (k === "+" || k === "=") act(() => zoomStep(1));
      else if (k === "-" || k === "_") act(() => zoomStep(-1));
      else if (k === "0") act(() => zoomTo("auto"));
      else if (k === "w" || k === "W") act(() => zoomTo("width"));
      else if (k === "p" || k === "P") act(() => zoomTo("page"));
      else if (k === "1") act(() => chooseMode("single"));
      else if (k === "2") act(() => chooseMode("two"));
      else if (k === "3") act(() => chooseMode("three"));
      else if (k === "4") act(() => chooseMode("custom"));
      else if (k === "f" || k === "F") act(() => onImmersive(!immersive));
      else if (k === "Escape" && immersive) act(() => onImmersive(false));
      else if ((k === "c" || k === "C") && compare.length >= 2) act(() => onCompare(compare));
      else if ((k === "x" || k === "X") && multi) act(() => setLayout((l) => closePanel(l, focus.id)));
      else if (k === "?") act(() => setShowKeys((v) => !v));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const panelProps = (panel: Panel, index: number) => ({
    panel, index, total: layout.panels.length, layout, setLayout, paperId, pageCount, pdf, pdfMode,
    size: sizes[panel.page] ?? DEFAULT_SIZE, onScale, onZoom: zoomStep, onExplainSelection, dragId, setDragId, drop, setDrop,
  });

  const desk = (
    <div ref={areaRef} data-resize-area className={cn("flex min-h-0 min-w-0 flex-1 flex-col", multi && "bg-desk p-3.5", stacked && "gap-3.5 overflow-y-auto")}>
      {stacked
        ? layout.panels.map((panel, i) => (
            <div key={panel.id} className="h-[82vh] flex-shrink-0">
              <PanelView {...panelProps(panel, i)} />
            </div>
          ))
        : rows.map((row, r) => {
            let offset = rows.slice(0, r).reduce((n, x) => n + x.length, 0);
            return (
              <div key={r} className="contents">
                {r > 0 && <Divider orientation="horizontal" label={`Resize rows ${r} and ${r + 1}`} onResize={(d, s) => setLayout((l) => resizeRow(l, r - 1, d / s))} />}
                <div data-resize-row className="flex min-h-0 overflow-x-auto overflow-y-hidden" style={{ flexGrow: layout.rowSizes[r] ?? 1, flexBasis: 0 }}>
                  {row.map((panel, c) => {
                    const index = offset++;
                    return (
                      <div key={panel.id} className="contents">
                        {c > 0 && <Divider orientation="vertical" label={`Resize pages ${index} and ${index + 1}`} onResize={(d, s) => setLayout((l) => resizeColumn(l, r, c - 1, d / s))} />}
                        <div className="h-full min-w-0" style={{ flexGrow: layout.colSizes[r]?.[c] ?? 1, flexBasis: 0, minWidth: multi ? MIN_PANEL_PX : undefined }}>
                          <PanelView {...panelProps(panel, index)} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
    </div>
  );

  const zoomLabel = focus.zoom === "width" ? "Fit width" : focus.zoom === "page" ? "Fit page" : `${Math.round(scaleNow * 100)}%`;

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-bg", immersive && "fixed inset-0 z-[80]")} data-reader data-immersive={immersive || undefined}>
      {/* Toolbar */}
      <div ref={barRef} role="toolbar" aria-label="Reader" className="relative flex h-11 flex-shrink-0 items-center gap-2 border-b border-line bg-bg px-4">
        <span className="whitespace-nowrap text-[12.5px] text-ink">{multi ? `${layout.panels.length} pages open` : `Page ${focus.page}`}</span>
        <button
          type="button"
          onClick={addPage}
          disabled={layout.panels.length >= MAX_PANELS || pageCount < 2}
          aria-label={layout.panels.length >= MAX_PANELS ? "Five pages is the most you can open at once" : "Open another page beside this one"}
          title={layout.panels.length >= MAX_PANELS ? "Five pages is the most you can open at once" : "Open another page beside this one"}
          className="flex h-6 w-6 items-center justify-center rounded-[3px] bg-accent-soft text-accent transition-colors hover:bg-accent/[0.18] disabled:opacity-40"
        >
          <Plus size={13} />
        </button>
        <span className="flex-1" />
        {immersive && (
          <button type="button" onClick={() => onImmersive(false)} aria-label="Leave full-screen reading (Esc)" className="mr-1 flex h-7 items-center gap-1.5 rounded-[3px] px-2 text-[12px] text-ink-soft transition-colors hover:bg-ink/[0.05] hover:text-ink">
            <Minimize size={13} /> Exit full screen
          </button>
        )}
        {!multi && pdfMode && (
          <div role="group" aria-label="Zoom" className="flex items-center">
            <Tool label="Zoom out (−)" onClick={() => zoomStep(-1)} disabled={scaleNow <= ZOOM_STEPS[0] + 0.005}><Minus size={13} /></Tool>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={`Zoom: ${zoomLabel}`} title="Zoom options" className="mono flex h-8 min-w-[58px] items-center justify-center rounded-[3px] px-1.5 text-[11.5px] text-ink-soft transition-colors hover:bg-ink/[0.05] hover:text-ink data-[state=open]:bg-ink/[0.06]">
                  {zoomLabel}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="studio z-[90] min-w-[168px] rounded-[4px]">
                <DropdownMenuItem onSelect={() => zoomTo("width")}>Fit width<span className="mono ml-auto text-[11px] text-ink-faint">W</span></DropdownMenuItem>
                <DropdownMenuItem onSelect={() => zoomTo("page")}>Fit page<span className="mono ml-auto text-[11px] text-ink-faint">P</span></DropdownMenuItem>
                <DropdownMenuItem onSelect={() => zoomTo("auto")}>Reset zoom<span className="mono ml-auto text-[11px] text-ink-faint">0</span></DropdownMenuItem>
                <div className="my-1 h-px bg-line" />
                {[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((s) => (
                  <DropdownMenuItem key={s} onSelect={() => zoomTo(s)} className="mono text-[12px]">{Math.round(s * 100)}%</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Tool label="Zoom in (+)" onClick={() => zoomStep(1)} disabled={scaleNow >= 4 - 0.005}><Plus size={13} /></Tool>
          </div>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="More reader options" title="More reader options" data-shortcuts-toggle className="flex h-8 w-8 items-center justify-center rounded-[3px] text-ink-soft transition-colors hover:bg-ink/[0.05] hover:text-ink data-[state=open]:bg-ink/[0.06]">
              <MoreHorizontal size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="studio z-[90] min-w-[230px] rounded-[4px]">
            <p className="px-2.5 pb-1 pt-1.5 text-[11.5px] text-ink-faint">Pages shown</p>
            {MODES.map(({ mode: m, label, icon: Icon }) => (
              <DropdownMenuItem key={m} onSelect={() => chooseMode(m)} disabled={pageCount < (m === "single" ? 1 : m === "two" ? 2 : m === "three" ? 3 : 4)} aria-label={label} className="data-[disabled]:opacity-40">
                <Icon size={14} /> {label.split(":")[0]}
                {mode === m && <Check size={13} className="ml-auto text-accent" />}
              </DropdownMenuItem>
            ))}
            <div className="my-1 h-px bg-line" />
            {pdfMode && (
              <>
                <DropdownMenuItem onSelect={() => zoomTo("width")} aria-label="Fit width (W)"><MoveHorizontal size={14} /> Fit width<span className="mono ml-auto text-[11px] text-ink-faint">W</span></DropdownMenuItem>
                <DropdownMenuItem onSelect={() => zoomTo("page")} aria-label="Fit page (P)"><Scan size={14} /> Fit page<span className="mono ml-auto text-[11px] text-ink-faint">P</span></DropdownMenuItem>
                <DropdownMenuItem onSelect={() => zoomTo("auto")} aria-label="Reset zoom (0)"><RotateCcw size={14} /> Reset zoom<span className="mono ml-auto text-[11px] text-ink-faint">0</span></DropdownMenuItem>
                <div className="my-1 h-px bg-line" />
              </>
            )}
            {multi && !sizesAreEqual(layout) && !stacked && (
              <DropdownMenuItem onSelect={() => setLayout(resetSizes)} aria-label="Equal widths"><Columns3 size={14} /> Equal widths</DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => onRailOpen(!railOpen)} aria-label={railOpen ? "Hide the page list" : "Show the page list"}>
              <PanelLeft size={14} /> {railOpen ? "Hide page list" : "Show page list"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onImmersive(!immersive)} aria-label={immersive ? "Leave full-screen reading (Esc)" : "Full-screen reading (F)"}>
              {immersive ? <Minimize size={14} /> : <Maximize size={14} />} {immersive ? "Leave full screen" : "Full-screen reading"}<span className="mono ml-auto text-[11px] text-ink-faint">F</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTimeout(() => setShowKeys(true), 0)} aria-label="Keyboard shortcuts (?)">
              <Keyboard size={14} /> Keyboard shortcuts<span className="mono ml-auto text-[11px] text-ink-faint">?</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {showKeys && <ShortcutsHelp onClose={() => setShowKeys(false)} />}
      </div>

      <div className="flex min-h-0 flex-1">
        {railOpen && !tinyBar && <PageRail pageCount={pageCount} layout={layout} hasText={hasText} explained={explained} onGo={goPage} onOpenBeside={openBeside} />}
        {file.isLoading ? (
          <div className="reader-desk flex flex-1 justify-center p-10"><div className="reader-sheet h-[80%] w-full max-w-[640px] animate-pulse opacity-60" /></div>
        ) : pdfMode ? (
          <Document
            file={pdfFile}
            onLoadSuccess={(doc) => setPdf(doc as unknown as PDFDocumentProxy)}
            onLoadError={() => setLoadFailed(true)}
            loading={null}
            error={null}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            {desk}
          </Document>
        ) : (
          desk
        )}
      </div>
      {multi && (
        <div className="flex h-9 flex-shrink-0 items-center justify-between gap-4 border-t border-line bg-bg px-4 text-[11.5px] text-ink-faint">
          <span>{layout.panels.length} of {MAX_PANELS} pages open</span>
          <span className="hidden truncate sm:inline">Drag page titles to reorder · Drag dividers to resize</span>
        </div>
      )}
    </div>
  );
}
