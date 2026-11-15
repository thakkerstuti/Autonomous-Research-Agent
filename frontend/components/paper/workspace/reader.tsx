"use client";

/**
 * The multi-page reader: up to five panels showing real PDF pages side by side.
 * Layout rules (opening, closing, reordering, resizing, presets) live in
 * lib/reader-layout.ts and are unit-tested; this component draws them and
 * turns pointer and keyboard input into those operations.
 */
import "react-pdf/dist/esm/Page/TextLayer.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import {
  ChevronLeft, ChevronRight, Columns3, GitCompare, GripVertical, Keyboard, LayoutGrid, Plus, RotateCcw, Sparkles, SquareCheck, Square, X,
} from "lucide-react";
import { usePaperFile } from "@/lib/paper-file";
import { usePageTextQuery } from "@/lib/queries";
import {
  MAX_PANELS, closePanel, focusPanel, focusedPanel, movePanel, openPanel, resetLayout, resizeColumn, resizeRow, rowSlices,
  selectedPages, setArrangement, setPanelPage, toggleSelected, type Panel, type ReaderLayout,
} from "@/lib/reader-layout";
import { cn } from "@/lib/utils";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

type SetLayout = (update: (l: ReaderLayout) => ReaderLayout) => void;

export interface ReaderProps {
  paperId: string;
  pageCount: number;
  hasText: (page: number) => boolean;
  layout: ReaderLayout;
  setLayout: SetLayout;
  onExplainPage: (page: number) => void;
  onExplainSelection: (page: number, text: string) => void;
  onCompare: (pages: number[]) => void;
}

export const SHORTCUTS: [string, string][] = [
  ["[ / ]", "Previous / next page in the focused panel"],
  ["N", "Open the next page in a new panel"],
  ["X", "Close the focused panel"],
  ["1 – 5", "Focus panel 1 to 5"],
  ["Alt + ← / →", "Move the focused panel left or right"],
  ["S", "Tick the focused panel for comparison"],
  ["C", "Compare the ticked pages"],
  ["/", "Ask the assistant"],
  ["A", "Show or hide the assistant"],
];

function IconButton({ label, onClick, disabled, active, children }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "pressable flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:opacity-30",
        active ? "bg-ink/[0.07] text-ink" : "text-ink-soft hover:bg-ink/[0.05] hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

/** Width of an element, kept up to date. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function TextFallback({ paperId, page }: { paperId: string; page: number }) {
  const q = usePageTextQuery(paperId, page, true);
  if (q.isLoading) return <div className="m-4 h-[60%] animate-pulse rounded bg-ink/[0.04]" />;
  const text = q.data?.text?.trim();
  return (
    <div className="mx-auto max-w-[68ch] px-5 py-6">
      <p className="mb-4 text-[11.5px] uppercase tracking-[0.08em] text-ink-faint">Extracted text · the original PDF isn&rsquo;t available on the server</p>
      {text ? (
        <div className="whitespace-pre-wrap font-serif text-[15px] leading-[1.75] text-ink">{text}</div>
      ) : (
        <p className="text-[14px] text-ink-soft">This page has no selectable text (it may be an image or a scan).</p>
      )}
    </div>
  );
}

function PanelView({
  panel, index, total, layout, setLayout, paperId, pageCount, pdfMode, hasText, onExplainPage, onExplainSelection,
  dragId, setDragId, drop, setDrop,
}: {
  panel: Panel;
  index: number;
  total: number;
  layout: ReaderLayout;
  setLayout: SetLayout;
  paperId: string;
  pageCount: number;
  pdfMode: boolean;
  hasText: (p: number) => boolean;
  onExplainPage: (page: number) => void;
  onExplainSelection: (page: number, text: string) => void;
  dragId: string | null;
  setDragId: (id: string | null) => void;
  drop: { id: string; side: "before" | "after" } | null;
  setDrop: (d: { id: string; side: "before" | "after" } | null) => void;
}) {
  const [bodyRef, width] = useWidth<HTMLDivElement>();
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const [draft, setDraft] = useState(String(panel.page));
  useEffect(() => setDraft(String(panel.page)), [panel.page]);
  const focused = layout.focusedId === panel.id;
  const compact = width > 0 && width < 300; // narrow panel: keep the header on one line
  const ticked = layout.selected.includes(panel.id);
  const go = (page: number) => {
    if (page >= 1 && page <= pageCount) setLayout((l) => setPanelPage(l, panel.id, page));
    else setDraft(String(panel.page));
  };

  const onMouseUp = () => {
    const sel = window.getSelection();
    const text = sel?.toString().replace(/\s+/g, " ").trim() ?? "";
    if (!sel || text.length < 3 || !bodyRef.current?.contains(sel.anchorNode)) return setSelection(null);
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const box = bodyRef.current.getBoundingClientRect();
    setSelection({ text: text.slice(0, 1500), x: rect.left - box.left + rect.width / 2, y: rect.top - box.top + bodyRef.current.scrollTop });
  };

  return (
    <section
      aria-label={`Panel ${index + 1}: page ${panel.page}`}
      onPointerDown={() => !focused && setLayout((l) => focusPanel(l, panel.id))}
      onDragOver={(e) => {
        if (!dragId || dragId === panel.id) return;
        e.preventDefault();
        const box = e.currentTarget.getBoundingClientRect();
        setDrop({ id: panel.id, side: e.clientX < box.left + box.width / 2 ? "before" : "after" });
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
        "relative flex h-full min-h-0 min-w-0 flex-col bg-canvas transition-[box-shadow] duration-150",
        focused ? "shadow-[inset_0_0_0_1px_rgb(var(--accent)/0.55)]" : "shadow-[inset_0_0_0_1px_var(--line)]",
        dragId === panel.id && "opacity-50"
      )}
    >
      {/* Drop indicator */}
      {drop?.id === panel.id && (
        <span aria-hidden className={cn("pointer-events-none absolute bottom-0 top-0 z-20 w-[3px] bg-accent", drop.side === "before" ? "left-0" : "right-0")} />
      )}

      <header className="flex h-10 flex-shrink-0 items-center gap-0.5 overflow-hidden whitespace-nowrap border-b border-line bg-surface px-1.5">
        <span
          draggable={total > 1}
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
          title={total > 1 ? "Drag to move this panel" : undefined}
          aria-hidden
          className={cn("flex h-7 w-5 items-center justify-center text-ink-faint", total > 1 ? "cursor-grab active:cursor-grabbing hover:text-ink" : "opacity-30")}
        >
          <GripVertical size={14} />
        </span>
        <IconButton label="Previous page" onClick={() => go(panel.page - 1)} disabled={panel.page <= 1}><ChevronLeft size={15} /></IconButton>
        <form onSubmit={(e) => { e.preventDefault(); go(Number(draft)); }} className="flex items-center gap-1 text-[12.5px] text-ink-soft">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
            onBlur={() => go(Number(draft))}
            aria-label={`Page shown in panel ${index + 1}`}
            className="mono h-7 w-10 rounded-[5px] border border-line bg-bg text-center text-[12.5px] text-ink outline-none focus:border-accent/60"
          />
          {!compact && <span className="mono whitespace-nowrap text-ink-faint">/ {pageCount}</span>}
        </form>
        <IconButton label="Next page" onClick={() => go(panel.page + 1)} disabled={panel.page >= pageCount}><ChevronRight size={15} /></IconButton>
        <span className="flex-1" />
        {!compact && <IconButton label={`Explain page ${panel.page}`} onClick={() => onExplainPage(panel.page)} disabled={!hasText(panel.page)}><Sparkles size={14} /></IconButton>}
        <IconButton label={ticked ? "Remove from comparison" : "Tick for comparison"} onClick={() => setLayout((l) => toggleSelected(l, panel.id))} active={ticked}>
          {ticked ? <SquareCheck size={15} className="text-accent" /> : <Square size={15} />}
        </IconButton>
        <IconButton label="Close panel" onClick={() => setLayout((l) => closePanel(l, panel.id))} disabled={total <= 1}><X size={15} /></IconButton>
      </header>

      <div
        ref={bodyRef}
        onMouseUp={onMouseUp}
        onMouseDown={() => setSelection(null)}
        onScroll={() => selection && setSelection(null)}
        className="relative min-h-0 flex-1 overflow-auto"
      >
        {pdfMode ? (
          width > 0 && (
            <div className="flex justify-center px-3 py-4">
              <div className="bg-white shadow-[0_1px_3px_rgb(0_0_0/0.18),0_0_0_1px_rgb(0_0_0/0.05)]">
                <Page
                  key={panel.page}
                  pageNumber={panel.page}
                  width={Math.max(width - 24, 120)}
                  renderAnnotationLayer={false}
                  loading={<div className="animate-pulse bg-black/[0.03]" style={{ width: Math.max(width - 24, 120), height: Math.max(width - 24, 120) * 1.3 }} />}
                />
              </div>
            </div>
          )
        ) : (
          <TextFallback paperId={paperId} page={panel.page} />
        )}
        {selection && (
          <button
            type="button"
            onMouseDown={(e) => {
              // Keep the selection, and don't let the panel's mousedown (which clears it) remove this button
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={() => {
              onExplainSelection(panel.page, selection.text);
              setSelection(null);
              window.getSelection()?.removeAllRanges();
            }}
            style={{ left: Math.max(8, selection.x - 70), top: Math.max(6, selection.y - 40) }}
            className="pressable absolute z-30 flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[12.5px] font-medium text-on-primary shadow-lg"
          >
            <Sparkles size={13} /> Explain selection
          </button>
        )}
      </div>
    </section>
  );
}

/** A divider that resizes the two neighbours on either side, by pointer or arrow keys. */
function Divider({ orientation, onResize, label }: { orientation: "vertical" | "horizontal"; onResize: (deltaPx: number, sizePx: number) => void; label: string }) {
  const vertical = orientation === "vertical";
  // Measure the row (columns) or the whole reader area (rows); the direct parent is a display:contents wrapper
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
      const size = vertical ? container.clientWidth : container.clientHeight;
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
          onResize(d, vertical ? container.clientWidth : container.clientHeight);
        }
      }}
      title="Drag to resize"
      className={cn(
        "group relative z-10 flex-shrink-0 outline-none",
        vertical ? "w-[7px] cursor-col-resize" : "h-[7px] cursor-row-resize"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute bg-transparent transition-colors duration-150 group-hover:bg-accent/60 group-focus-visible:bg-accent group-active:bg-accent",
          vertical ? "inset-y-0 left-[3px] w-px" : "inset-x-0 top-[3px] h-px"
        )}
      />
    </div>
  );
}

export function Reader({ paperId, pageCount, hasText, layout, setLayout, onExplainPage, onExplainSelection, onCompare }: ReaderProps) {
  const file = usePaperFile(paperId);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; side: "before" | "after" } | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const [areaRef, areaWidth] = useWidth<HTMLDivElement>();
  const stacked = areaWidth > 0 && areaWidth < 720;

  // pdf.js takes ownership of the bytes it's given, so each mount gets its own copy
  const pdfFile = useMemo(() => (file.data ? { data: file.data.slice() } : null), [file.data]);
  const pdfMode = !!pdfFile && !loadFailed;
  const rows = rowSlices(layout);
  const focus = focusedPanel(layout);
  const compare = selectedPages(layout);
  const atMax = layout.panels.length >= MAX_PANELS;

  const openNext = () => {
    const open = new Set(layout.panels.map((p) => p.page));
    const start = focus?.page ?? 0;
    const candidates = [...Array(pageCount)].map((_, i) => ((start + i) % pageCount) + 1);
    const next = candidates.find((p) => !open.has(p)) ?? Math.min(start + 1, pageCount);
    setLayout((l) => openPanel(l, next) ?? l);
  };

  // Keyboard shortcuts while reading (never while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey) return;
      const f = focusedPanel(layout);
      if (!f) return;
      const idx = layout.panels.findIndex((p) => p.id === f.id);
      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        setLayout((l) => movePanel(l, idx, idx + (e.key === "ArrowLeft" ? -1 : 1)));
      } else if (e.key === "]" && f.page < pageCount) setLayout((l) => setPanelPage(l, f.id, f.page + 1));
      else if (e.key === "[" && f.page > 1) setLayout((l) => setPanelPage(l, f.id, f.page - 1));
      else if (e.key === "n" || e.key === "N") openNext();
      else if (e.key === "x" || e.key === "X") setLayout((l) => closePanel(l, f.id));
      else if (e.key === "s" || e.key === "S") setLayout((l) => toggleSelected(l, f.id));
      else if ((e.key === "c" || e.key === "C") && compare.length >= 2) onCompare(compare);
      else if (/^[1-5]$/.test(e.key) && layout.panels[Number(e.key) - 1]) setLayout((l) => focusPanel(l, l.panels[Number(e.key) - 1].id));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const grid = (
    <div ref={areaRef} data-resize-area className={cn("flex min-h-0 flex-1 flex-col", stacked && "overflow-y-auto")}>
      {stacked
        ? layout.panels.map((panel, i) => (
            <div key={panel.id} className="h-[78vh] flex-shrink-0 border-b border-line">
              <PanelView {...{ panel, index: i, total: layout.panels.length, layout, setLayout, paperId, pageCount, pdfMode, hasText, onExplainPage, onExplainSelection, dragId, setDragId, drop, setDrop }} />
            </div>
          ))
        : rows.map((row, r) => {
            let offset = rows.slice(0, r).reduce((n, x) => n + x.length, 0);
            return (
              <div key={r} className="contents">
                {r > 0 && (
                  <Divider orientation="horizontal" label={`Resize rows ${r} and ${r + 1}`} onResize={(d, size) => setLayout((l) => resizeRow(l, r - 1, d / size))} />
                )}
                <div data-resize-row className="flex min-h-0" style={{ flexGrow: layout.rowSizes[r] ?? 1, flexBasis: 0 }}>
                  {row.map((panel, c) => {
                    const index = offset++;
                    return (
                      <div key={panel.id} className="contents">
                        {c > 0 && (
                          <Divider orientation="vertical" label={`Resize panels ${index} and ${index + 1}`} onResize={(d, size) => setLayout((l) => resizeColumn(l, r, c - 1, d / size))} />
                        )}
                        <div className="min-w-0" style={{ flexGrow: layout.colSizes[r]?.[c] ?? 1, flexBasis: 0 }}>
                          <PanelView {...{ panel, index, total: layout.panels.length, layout, setLayout, paperId, pageCount, pdfMode, hasText, onExplainPage, onExplainSelection, dragId, setDragId, drop, setDrop }} />
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex h-11 flex-shrink-0 items-center gap-1 border-b border-line px-3">
        <span className="mr-2 text-[13px] font-medium text-ink">Reader</span>
        <span className="mono mr-3 text-[12px] text-ink-faint">{layout.panels.length} / {MAX_PANELS}</span>
        <IconButton label={atMax ? "Five pages is the most you can open at once" : "Open the next page in a new panel (N)"} onClick={openNext} disabled={atMax}><Plus size={16} /></IconButton>
        <span className="mx-1.5 h-4 w-px bg-line" aria-hidden />
        <IconButton label="Automatic layout (grid for 4 or 5 pages)" onClick={() => setLayout((l) => setArrangement(l, "auto"))} active={layout.arrangement === "auto"}><LayoutGrid size={15} /></IconButton>
        <IconButton label="All pages side by side" onClick={() => setLayout((l) => setArrangement(l, "columns"))} active={layout.arrangement === "columns"}><Columns3 size={15} /></IconButton>
        <IconButton label="Reset layout: equal sizes" onClick={() => setLayout(resetLayout)}><RotateCcw size={14} /></IconButton>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => onCompare(compare)}
          disabled={compare.length < 2}
          title={compare.length < 2 ? "Tick two or more open pages to compare them" : `Ask the assistant to compare pages ${compare.join(", ")} (C)`}
          className="pressable flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-ink-soft transition-colors hover:bg-ink/[0.05] hover:text-ink disabled:opacity-40"
        >
          <GitCompare size={14} /> {compare.length >= 2 ? `Compare ${compare.length} pages` : "Compare"}
        </button>
        <div className="relative">
          <IconButton label="Keyboard shortcuts" onClick={() => setShowKeys((v) => !v)} active={showKeys}><Keyboard size={15} /></IconButton>
          {showKeys && (
            <div role="dialog" aria-label="Keyboard shortcuts" className="absolute right-0 top-10 z-40 w-[300px] rounded-lg border border-line bg-surface p-3 shadow-panel">
              <dl className="grid gap-1.5 text-[12.5px]">
                {SHORTCUTS.map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[92px_1fr] gap-2">
                    <dt className="mono text-ink">{k}</dt>
                    <dd className="text-ink-soft">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>

      {file.isLoading ? (
        <div className="flex-1 p-6"><div className="mx-auto h-full max-w-[640px] animate-pulse rounded bg-ink/[0.04]" /></div>
      ) : pdfMode ? (
        <Document file={pdfFile} onLoadError={() => setLoadFailed(true)} loading={null} error={null} className="flex min-h-0 flex-1 flex-col">
          {grid}
        </Document>
      ) : (
        grid
      )}
    </div>
  );
}
