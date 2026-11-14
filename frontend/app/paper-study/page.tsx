"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  UploadCloud, FileText, AlertCircle, Loader2, Check,
  FileSearch, Brain, StickyNote, GitCompare, Lightbulb, ArrowLeft, ArrowRight,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { FloatingPanel, PanelType } from "@/components/ui/floating-panel";
import { ResearchCanvas } from "@/components/ui/research-canvas";
import { spreadLayout } from "@/lib/canvas-layout";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { cn } from "@/lib/utils";

type Step = "upload" | "level" | "processing" | "done";
type Level = "Beginner" | "Medium" | "Pro";

interface Panel {
  id: string;
  type: PanelType;
  title: string;
  subtitle?: string;
  content: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
  isNew: boolean;
}

let topZ = 20;

const PAGE_BANK: Array<Omit<Panel, "isNew" | "x" | "y" | "w" | "h" | "zIndex">> = [
  {
    id: "page-7",
    type: "summary",
    title: "Page 7 summary",
    subtitle: "Source · page 7",
    content: `**Expert routing and load balancing**

Top-2 gating sends each token to two of 64 experts.

An auxiliary loss keeps expert load within **12% of uniform**.

Routing noise during training improves specialization.

The routing map is the paper's working definition of "who sees this token."`,
  },
  {
    id: "page-12",
    type: "summary",
    title: "Page 12 summary",
    subtitle: "Source · page 12",
    content: `**Capacity and communication**

Expert capacity is capped so a single expert cannot absorb the whole batch.

Tokens above capacity are dropped or overflowed to a residual path.

Communication volume grows with expert count, not with model depth.

This is why **64 experts** is treated as a systems choice, not just a quality knob.`,
  },
  {
    id: "page-18",
    type: "summary",
    title: "Page 18 summary",
    subtitle: "Source · page 18",
    content: `**Quality vs expert count**

Downstream scores rise quickly from 8 → 32 experts, then slow.

Beyond 64 experts, average gain is within noise on 3 of 5 benchmarks.

The authors argue extra experts buy **coverage**, not automatic accuracy.

Hold this next to the page 20 instability notes.`,
  },
  {
    id: "page-20",
    type: "summary",
    title: "Page 20 summary",
    subtitle: "Source · page 20",
    content: `**Training instability and loss spikes**

Loss spikes appear in **3 of 8 runs** at higher learning rates.

Router z-loss removes most spikes at a small quality cost.

Figure 4 shows spiking versus stabilized curves.

Instability, not routing math, may be the real ceiling.`,
  },
  {
    id: "page-24",
    type: "summary",
    title: "Page 24 summary",
    subtitle: "Source · page 24",
    content: `**What the ablation actually shows**

Removing load-balancing loss hurts rare-token experts first.

The counter-evidence uses far more training tokens, so flattening may be a **compute artifact**.

Claim to carry: gains flatten beyond 64 experts — unless you train longer.`,
  },
];

function markdownToHtml(content: string) {
  return content
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^> (.+)/gm, '<blockquote class="border-l border-accent-line pl-3 italic text-ink-faint">$1</blockquote>')
    .replace(/\n/g, "<br/>");
}

function buildSpread(
  items: Array<Omit<Panel, "isNew" | "x" | "y" | "w" | "h"> & { zIndex: number }>,
  canvas: { w: number; h: number },
  isNew = false
): Panel[] {
  const rects = spreadLayout(items.length, canvas.w, canvas.h);
  return items.map((p, i) => ({
    ...p,
    x: rects[i].x,
    y: rects[i].y,
    w: rects[i].w,
    h: rects[i].h,
    isNew,
  }));
}

function PanelAdder({ onAdd }: { onAdd: (type: PanelType) => void }) {
  const panelTypes: { type: PanelType; icon: React.ElementType; label: string }[] = [
    { type: "summary", icon: FileSearch, label: "Summary" },
    { type: "concept", icon: Brain, label: "Concept" },
    { type: "evidence", icon: FileText, label: "Evidence" },
    { type: "notes", icon: StickyNote, label: "Notes" },
    { type: "comparison", icon: GitCompare, label: "Compare" },
    { type: "insight", icon: Lightbulb, label: "Insight" },
  ];

  return (
    <div className="hud-dock absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-0.5 rounded-2xl p-1">
      <span className="hidden px-2.5 text-[12px] text-ink-faint sm:inline">Add</span>
      {panelTypes.map(({ type, icon: Icon, label }) => (
        <button
          key={type}
          onClick={() => onAdd(type)}
          aria-label={`Add ${label} panel`}
          className="pressable flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-[12.5px] font-medium text-ink-soft hover:bg-surface2 hover:text-ink"
        >
          <Icon size={14} strokeWidth={1.75} />
          <span className="hidden md:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

function PageRail({
  openIds,
  onToggle,
  onOpenFive,
}: {
  openIds: Set<string>;
  onToggle: (id: string) => void;
  onOpenFive: () => void;
}) {
  return (
    <div className="hud-dock absolute left-3 top-1/2 flex max-h-[70vh] w-[64px] -translate-y-1/2 flex-col items-center gap-1.5 overflow-y-auto rounded-2xl p-1.5">
      <span className="py-1 text-[10.5px] font-medium text-ink-faint">Pages</span>
      {PAGE_BANK.map((p) => {
        const n = p.title.match(/\d+/)?.[0] ?? "";
        const open = openIds.has(p.id);
        return (
          <button
            key={p.id}
            onClick={() => onToggle(p.id)}
            aria-pressed={open}
            aria-label={p.title}
            className={cn(
              "pressable mono flex h-11 w-11 items-center justify-center rounded-xl text-[13px]",
              open ? "bg-primary text-on-primary" : "bg-surface2 text-ink-soft hover:bg-surface3 hover:text-ink"
            )}
          >
            {n}
          </button>
        );
      })}
      <button
        onClick={onOpenFive}
        className="pressable mt-1 w-full rounded-xl bg-accent-soft px-1 py-2 text-[10.5px] font-medium leading-tight text-accent hover:bg-accent/15"
      >
        Open all
      </button>
    </div>
  );
}

function CanvasWorkspace() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [layoutNonce, setLayoutNonce] = useState(1);
  const [scale, setScale] = useState(1);
  const [panels, setPanels] = useState<Panel[]>([]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setCanvasSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (seeded.current) return;
    if (canvasSize.w < 40 || canvasSize.h < 40) return;
    seeded.current = true;
    setPanels(buildSpread(
      PAGE_BANK.map((p, i) => ({ ...p, zIndex: 10 + i })),
      canvasSize
    ));
    setLayoutNonce((n) => n + 1);
  }, [canvasSize]);

  const bumpLayout = () => setLayoutNonce((n) => n + 1);

  const bringToFront = useCallback((id: string) => {
    topZ += 1;
    setPanels((ps) => ps.map((p) => (p.id === id ? { ...p, zIndex: topZ } : p)));
  }, []);

  const closePanel = useCallback((id: string) => {
    setPanels((ps) => ps.filter((p) => p.id !== id));
  }, []);

  const placeNew = useCallback((panel: Omit<Panel, "isNew">) => {
    topZ += 1;
    setPanels((ps) => {
      const next = [...ps.filter((p) => p.id !== panel.id), { ...panel, zIndex: topZ, isNew: true }];
      const rects = spreadLayout(next.length, canvasSize.w, canvasSize.h);
      return next.map((p, i) => ({ ...p, x: rects[i].x, y: rects[i].y, w: rects[i].w, h: rects[i].h }));
    });
    bumpLayout();
  }, [canvasSize]);

  const addPanel = useCallback((type: PanelType) => {
    placeNew({
      id: crypto.randomUUID(),
      type,
      title: `${type.charAt(0).toUpperCase() + type.slice(1)} panel`,
      subtitle: "Generated by Cognexa",
      content: `Ask Cognexa to fill this **${type}** panel from the pages you already have open.`,
      x: 120,
      y: 80,
      w: 380,
      h: 280,
      zIndex: topZ,
    });
  }, [placeNew]);

  const togglePage = useCallback((id: string) => {
    setPanels((ps) => {
      if (ps.some((p) => p.id === id)) return ps.filter((p) => p.id !== id);
      const src = PAGE_BANK.find((p) => p.id === id);
      if (!src) return ps;
      topZ += 1;
      const next = [...ps, { ...src, x: 80, y: 80, w: 380, h: 300, zIndex: topZ, isNew: true }];
      const rects = spreadLayout(next.length, canvasSize.w, canvasSize.h);
      return next.map((p, i) => ({ ...p, ...rects[i] }));
    });
    bumpLayout();
  }, [canvasSize]);

  const openFive = useCallback(() => {
    setPanels(buildSpread(
      PAGE_BANK.map((p, i) => ({ ...p, zIndex: 12 + i })),
      canvasSize,
      true
    ));
    bumpLayout();
  }, [canvasSize]);

  const arrangeNeatly = useCallback(() => {
    setPanels((ps) => {
      const rects = spreadLayout(ps.length, canvasSize.w, canvasSize.h);
      return ps.map((p, i) => ({ ...p, ...rects[i], isNew: false }));
    });
    bumpLayout();
  }, [canvasSize]);

  const resetCanvas = useCallback(() => {
    openFive();
  }, [openFive]);

  const onCommand = useCallback((text: string) => {
    const t = text.toLowerCase();
    const pageMatch = t.match(/page\s+(\d+)/);
    if (pageMatch) {
      const id = `page-${pageMatch[1]}`;
      const src = PAGE_BANK.find((p) => p.id === id);
      if (src) {
        placeNew({ ...src, x: 80, y: 80, w: 400, h: 320, zIndex: topZ });
        return;
      }
    }
    if (t.includes("together") || t.includes("spread") || t.includes("five") || t.includes("5 page")) {
      openFive();
      return;
    }
    if (t.includes("arrange") || t.includes("beside")) {
      arrangeNeatly();
      return;
    }
    if (t.includes("compare")) {
      addPanel("comparison");
      return;
    }
    if (t.includes("larger") || t.includes("bigger")) {
      setPanels((ps) => {
        if (!ps.length) return ps;
        const top = [...ps].sort((a, b) => b.zIndex - a.zIndex)[0];
        return ps.map((p) => p.id === top.id ? { ...p, w: Math.min(640, p.w + 80), h: Math.min(560, p.h + 60) } : p);
      });
      bumpLayout();
      return;
    }
    addPanel("insight");
  }, [addPanel, arrangeNeatly, openFive, placeNew]);

  const openIds = new Set(panels.map((p) => p.id));

  return (
    <div ref={wrapRef} className="h-full w-full">
      <ResearchCanvas
        panelCount={panels.length}
        onArrange={arrangeNeatly}
        onReset={resetCanvas}
        onSpread={openFive}
        onViewScale={setScale}
        command={{
          onCommand,
          placeholder: "Type or say a command…",
          suggestions: [
            "Open 5 page summaries together",
            "Open the summary of page 7",
            "Compare these panels",
            "Make this panel larger",
          ],
        }}
        hud={
          <>
            <PanelAdder onAdd={addPanel} />
            <PageRail openIds={openIds} onToggle={togglePage} onOpenFive={openFive} />
          </>
        }
      >
        {panels.map((panel) => (
          <FloatingPanel
            key={panel.id}
            id={panel.id}
            type={panel.type}
            title={panel.title}
            subtitle={panel.subtitle}
            initialX={panel.x}
            initialY={panel.y}
            initialW={panel.w}
            initialH={panel.h}
            zIndex={panel.zIndex}
            isNew={panel.isNew}
            layoutNonce={layoutNonce}
            scale={scale}
            onClose={closePanel}
            onFocus={bringToFront}
          >
            <div
              className="text-[13.5px] leading-[1.65] text-ink-soft [&_strong]:font-semibold [&_strong]:text-ink"
              dangerouslySetInnerHTML={{ __html: markdownToHtml(panel.content) }}
            />
          </FloatingPanel>
        ))}
      </ResearchCanvas>
    </div>
  );
}

function UploadStep({ onFile, error }: { onFile: (f: File, pages: number) => void; error: string | null }) {
  const [dragOver, setDragOver] = useState(false);
  const [reading, setReading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const read = async (f: File) => {
    setLocalError(null);
    if (f.type !== "application/pdf") {
      setLocalError("That file isn't a PDF. Choose a .pdf file to study.");
      return;
    }
    setReading(true);
    try {
      const { pdfjs } = await import("react-pdf");
      pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;
      const buf = await f.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      onFile(f, doc.numPages);
    } catch {
      setLocalError("We couldn't read that PDF. It may be encrypted or damaged.");
    } finally {
      setReading(false);
    }
  };

  const shownError = localError ?? error;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-[640px] flex-col justify-center px-5 py-12 sm:px-7">
        <div className="animate-view-in">
          <h1 className="font-display text-display-xl font-semibold text-ink">
            Spread the paper on a desk.
          </h1>
          <p className="mt-4 max-w-[50ch] text-[15px] leading-relaxed text-ink-soft">
            Open several page summaries at once, drag them side by side, resize any edge and keep the whole argument in view.
          </p>
        </div>

        <label
          className={cn(
            "animate-view-in group relative mt-10 flex cursor-pointer flex-col items-center gap-4 overflow-hidden rounded-[22px] border border-dashed px-6 py-14 text-center transition-[border-color,background-color,transform] duration-200 ease-out",
            dragOver ? "scale-[1.01] border-accent bg-accent-soft" : "border-line-hover bg-surface hover:border-ink-faint/50"
          )}
          style={{ animationDelay: "80ms" }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) read(f);
          }}
        >
          <span
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-2xl transition-colors duration-200",
              dragOver ? "bg-accent text-on-primary" : "bg-surface3 text-ink-soft group-hover:text-ink"
            )}
          >
            {reading ? <Loader2 size={20} className="animate-spin" /> : <UploadCloud size={20} strokeWidth={1.75} />}
          </span>
          <span>
            <span className="block text-[15px] font-medium text-ink">
              {reading ? "Reading the PDF…" : dragOver ? "Drop to open" : "Drop a PDF here, or click to choose"}
            </span>
            <span className="mt-1 block text-[13px] text-ink-faint">Up to 100 MB · text or scanned papers</span>
          </span>
          <input
            type="file"
            accept="application/pdf"
            className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); }}
          />
        </label>

        {shownError && (
          <div role="alert" className="mt-4 flex items-center gap-2 rounded-xl bg-bad/10 px-4 py-3 text-[13px] text-bad">
            <AlertCircle size={15} className="flex-shrink-0" /> {shownError}
          </div>
        )}

        <button
          onClick={() => onFile(new File([], "demo-paper.pdf", { type: "application/pdf" }), 50)}
          className="group mt-6 inline-flex items-center gap-1.5 self-start text-[13.5px] font-medium text-ink-soft transition-colors hover:text-ink"
        >
          Or open the demo canvas
          <ArrowRight size={14} className="transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}

function LevelCard({
  title, desc, selected, onClick,
}: { title: string; desc: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      role="radio"
      aria-checked={selected}
      className={cn(
        "pressable relative rounded-2xl bg-surface p-5 text-left",
        selected ? "shadow-[0_0_0_1.5px_rgb(var(--accent))]" : "shadow-sm hover:shadow-panel"
      )}
    >
      <span
        className={cn(
          "absolute right-4 top-4 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-on-primary transition-[transform,opacity] duration-200 ease-out",
          selected ? "scale-100 opacity-100" : "scale-75 opacity-0"
        )}
      >
        <Check size={12} strokeWidth={2.5} />
      </span>
      <div className="mb-1.5 text-[14px] font-semibold text-ink">{title}</div>
      <p className="text-[13px] leading-relaxed text-ink-soft">{desc}</p>
    </button>
  );
}

function ProcessingStep({ paperId, onDone }: { paperId: string; onDone: () => void }) {
  const [progress] = useState({ done: 0, total: 0, failed: 0 });

  useEffect(() => {
    if (paperId === "demo") {
      const t = setTimeout(onDone, 2600);
      return () => clearTimeout(t);
    }
  }, [paperId, onDone]);

  const isDemo = paperId === "demo";
  const detail = isDemo
    ? "Laying five page summaries side by side"
    : progress.total > 0
      ? `Summarised ${Math.min(progress.done + progress.failed, progress.total)} of ${progress.total} pages`
      : "Extracting pages and writing summaries";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-[680px] flex-col justify-center px-5 py-12 sm:px-7">
        <h1 className="animate-view-in font-display text-display font-semibold text-ink">
          {isDemo ? "Spreading the pages…" : "Reading your paper…"}
        </h1>
        <p className="animate-view-in mt-3 text-[15px] text-ink-soft" style={{ animationDelay: "60ms" }}>
          Summaries will sit together so you can read them as one argument.
        </p>
        <div className="animate-view-in mt-8 rounded-[20px] bg-surface p-6 shadow-sm" role="status" aria-live="polite">
          <div className="flex items-center gap-3">
            <ThinkingMark active size={24} />
            <div className="min-w-0">
              <div className="text-[15px] font-medium text-ink">{isDemo ? "Preparing the canvas" : "Analysing the paper"}</div>
              <div className="mt-0.5 text-[13.5px] text-ink-soft">{detail}</div>
            </div>
          </div>
          <div className="scan mt-5 h-1 overflow-hidden rounded-full bg-ink/[0.07]" />
        </div>
      </div>
    </div>
  );
}

export default function PaperStudyPage({ searchParams }: { searchParams: { paperId?: string } }) {
  const [step, setStep] = useState<Step>(searchParams.paperId ? "processing" : "upload");
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>("Medium");
  const [paperId, setPaperId] = useState<string | null>(searchParams.paperId || null);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file");
      if (file.size === 0) { setPaperId("demo"); setStep("processing"); return; }
      const fd = new FormData();
      fd.append("file", file);
      fd.append("level", level);
      return apiClient<{ id: string }>("/papers", { method: "POST", body: fd });
    },
    onSuccess: (data) => {
      if (data) setPaperId(data.id);
      setStep("processing");
    },
    onError: (e: any) => setError(e.message || "Upload failed"),
  });

  const handleFile = (f: File, pages: number) => {
    setError(null);
    setFile(f);
    setPageCount(pages);
    if (f.size === 0) { setPaperId("demo"); setStep("processing"); }
    else setStep("level");
  };

  if (step === "upload") {
    return <UploadStep onFile={handleFile} error={error} />;
  }

  if (step === "level" && file) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-[680px] flex-col justify-center px-5 py-12 sm:px-7">
          <div className="animate-view-in flex items-center gap-3 rounded-2xl bg-surface p-3.5 shadow-sm">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-surface3 text-ink-soft">
              <FileText size={18} strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[14px] font-medium text-ink">{file.name}</div>
              <div className="mono text-[12px] text-ink-faint">
                {pageCount} pages · {(file.size / 1024 / 1024).toFixed(1)} MB
              </div>
            </div>
          </div>

          <h2 className="animate-view-in mt-10 font-display text-display font-semibold text-ink" style={{ animationDelay: "60ms" }}>
            How should CogNexa explain it?
          </h2>
          <p className="animate-view-in mt-2 text-[15px] text-ink-soft" style={{ animationDelay: "60ms" }}>
            Pick the depth that fits your background.
          </p>

          <div role="radiogroup" aria-label="Explanation level" className="animate-view-in mt-7 grid grid-cols-1 gap-3 sm:grid-cols-3" style={{ animationDelay: "120ms" }}>
            <LevelCard title="Beginner" desc="Plain language, every term explained, simple analogies." selected={level === "Beginner"} onClick={() => setLevel("Beginner")} />
            <LevelCard title="Medium" desc="Assumes the basics. Focuses on the why." selected={level === "Medium"} onClick={() => setLevel("Medium")} />
            <LevelCard title="Pro" desc="Concise and technical. Contribution and results." selected={level === "Pro"} onClick={() => setLevel("Pro")} />
          </div>

          <div className="mt-10 flex items-center justify-between gap-3">
            <Button variant="ghost" onClick={() => setStep("upload")} disabled={uploadMutation.isPending}>
              <ArrowLeft size={15} /> Back
            </Button>
            <Button size="lg" onClick={() => uploadMutation.mutate()} disabled={uploadMutation.isPending}>
              {uploadMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : null}
              Begin study session
            </Button>
          </div>
          {error && <div role="alert" className="mt-4 rounded-xl bg-bad/10 px-4 py-3 text-[13px] text-bad">{error}</div>}
        </div>
      </div>
    );
  }

  if (step === "processing" && paperId) {
    return <ProcessingStep paperId={paperId} onDone={() => setStep("done")} />;
  }

  if (step === "done" && paperId) {
    return (
      <div className="h-full bg-canvas">
        <CanvasWorkspace />
      </div>
    );
  }

  return null;
}
