"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  UploadCloud, FileText, AlertCircle, Loader2, CheckCircle,
  BookOpen, FileSearch, Brain, StickyNote, GitCompare, Lightbulb,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { FloatingPanel, PanelType } from "@/components/ui/floating-panel";
import { ResearchCanvas } from "@/components/ui/research-canvas";
import { spreadLayout } from "@/lib/canvas-layout";

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
    .replace(/^> (.+)/gm, '<blockquote class="border-l-2 border-blush-deep pl-3 italic text-ink-faint">$1</blockquote>')
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
  const panelTypes: { type: PanelType; icon: React.ElementType; label: string; color: string }[] = [
    { type: "summary", icon: FileSearch, label: "Summary", color: "var(--rose)" },
    { type: "concept", icon: Brain, label: "Concept", color: "var(--lavender)" },
    { type: "evidence", icon: FileText, label: "Evidence", color: "var(--warn)" },
    { type: "notes", icon: StickyNote, label: "Notes", color: "var(--ok)" },
    { type: "comparison", icon: GitCompare, label: "Compare", color: "var(--lavender)" },
    { type: "insight", icon: Lightbulb, label: "Insight", color: "var(--rose)" },
  ];

  return (
    <div className="hud-dock absolute top-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-2xl px-3 py-2">
      <span className="mr-1 hidden text-[11px] text-ink-faint sm:inline">Add</span>
      {panelTypes.map(({ type, icon: Icon, label, color }) => (
        <button
          key={type}
          onClick={() => onAdd(type)}
          title={`Add ${label} panel`}
          className="flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-[12px] font-medium text-ink-soft transition-all hover:bg-blush hover:text-rose"
        >
          <Icon size={13} style={{ color }} />
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
    <div className="hud-dock absolute left-3 top-1/2 flex max-h-[70vh] w-[72px] -translate-y-1/2 flex-col items-center gap-2 overflow-y-auto rounded-2xl px-2 py-3 sm:w-[88px]">
      <span className="text-[9px] uppercase tracking-[0.16em] text-ink-faint">Pages</span>
      {PAGE_BANK.map((p) => {
        const n = p.title.match(/\d+/)?.[0] ?? "";
        const open = openIds.has(p.id);
        return (
          <button
            key={p.id}
            onClick={() => onToggle(p.id)}
            className={`flex h-11 w-11 flex-col items-center justify-center rounded-xl text-[11px] font-medium transition-all ${
              open ? "bg-rose text-white shadow-panel" : "bg-surface2 text-ink-soft hover:bg-blush hover:text-rose"
            }`}
            title={p.title}
          >
            <span className="text-[9px] uppercase tracking-wider opacity-80">p</span>
            {n}
          </button>
        );
      })}
      <button
        onClick={onOpenFive}
        className="mt-1 w-full rounded-xl bg-blush px-1 py-2 text-[10px] font-medium leading-tight text-rose hover:bg-blush-deep"
      >
        Open 5 together
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
              className="text-[13px] leading-relaxed text-ink-soft"
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

  const read = async (f: File) => {
    if (f.type !== "application/pdf") return;
    try {
      const { pdfjs } = await import("react-pdf");
      pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;
      const buf = await f.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      onFile(f, doc.numPages);
    } catch {}
  };

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden p-6 sm:p-10">
      <div className="aurora aurora-a" />
      <div className="aurora aurora-b" />
      <div className="relative w-full max-w-lg animate-fade-up text-center">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-blush-deep bg-blush/50 px-4 py-1.5">
          <BookOpen size={13} className="text-rose" />
          <span className="text-[12px] font-medium text-rose">Paper Study</span>
        </div>
        <h1 className="mt-4 font-serif text-3xl font-normal text-ink sm:text-4xl">
          Spread the paper on a{" "}
          <span className="text-gradient-rose">living desk.</span>
        </h1>
        <p className="mt-3 text-[14px] text-ink-soft">
          Open four or five page summaries at once. Drag them with your hand, pinch to resize, and keep the argument in view.
        </p>

        <label
          className={`mt-8 flex cursor-pointer flex-col items-center gap-4 rounded-3xl border-2 border-dashed p-10 transition-all duration-200 sm:p-12 ${
            dragOver ? "border-rose bg-blush/40 scale-[1.01]" : "border-line bg-surface/80 hover:border-rose/60 hover:bg-blush/20"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) read(f);
          }}
        >
          <div className={`rounded-2xl p-4 transition-all ${dragOver ? "bg-rose/20 text-rose" : "bg-surface2 text-ink-faint"}`}>
            <UploadCloud size={28} />
          </div>
          <div>
            <span className="block text-[15px] font-medium text-ink">Drop a PDF here, or click to choose</span>
            <span className="block mt-1 text-[13px] text-ink-faint">Up to 100 MB · Text and scanned papers</span>
          </div>
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); }}
          />
        </label>

        {error && (
          <div className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-bad/10 px-4 py-3 text-[13px] text-bad">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <button
          onClick={() => onFile(new File([], "demo-paper.pdf", { type: "application/pdf" }), 50)}
          className="mt-6 text-[13px] text-ink-faint underline underline-offset-2 hover:text-rose transition-colors"
        >
          Open the demo canvas with 5 pages →
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
      className={`relative rounded-2xl border p-5 text-left transition-all duration-200 ${
        selected ? "border-rose bg-blush/40 shadow-sm" : "border-line bg-surface hover:border-rose/50 hover:bg-blush/10"
      }`}
    >
      {selected && <span className="absolute right-4 top-4 text-rose"><CheckCircle size={16} /></span>}
      <div className={`mb-2 text-[14px] font-semibold ${selected ? "text-rose" : "text-ink"}`}>{title}</div>
      <p className="text-[13px] text-ink-soft leading-relaxed">{desc}</p>
    </button>
  );
}

function ProcessingStep({ paperId, onDone }: { paperId: string; onDone: () => void }) {
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });

  useEffect(() => {
    if (paperId === "demo") {
      const t = setTimeout(onDone, 1600);
      return () => clearTimeout(t);
    }
  }, [paperId, onDone]);

  if (paperId === "demo") {
    return (
      <div className="relative flex h-full flex-col items-center justify-center gap-6 overflow-hidden p-10">
        <div className="aurora aurora-a" />
        <div className="h-14 w-14 rounded-2xl bg-blush flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-rose" />
        </div>
        <div className="text-center">
          <h2 className="font-serif text-2xl text-ink">Spreading five pages…</h2>
          <p className="mt-1 text-[14px] text-ink-soft">Summaries will sit together so you can read them as one argument</p>
        </div>
        <div className="w-72 h-1.5 rounded-full bg-surface2 overflow-hidden">
          <div className="h-full w-full rounded-full bg-gradient-rose animate-[grow_1.6s_ease-out_forwards]" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-10">
      <div className="h-14 w-14 rounded-2xl bg-blush flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-rose" />
      </div>
      <div className="text-center">
        <h2 className="font-serif text-2xl text-ink">Analyzing document…</h2>
        <p className="mt-1 text-[14px] text-ink-soft">
          {progress.total > 0
            ? `Summarized ${Math.min(progress.done + progress.failed, progress.total)} of ${progress.total} pages`
            : "Extracting pages…"}
        </p>
      </div>
      {progress.total > 0 && (
        <div className="w-72 h-1.5 rounded-full bg-surface2 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(100, ((progress.done + progress.failed) / progress.total) * 100)}%`,
              background: "linear-gradient(90deg, var(--rose), var(--lavender))",
            }}
          />
        </div>
      )}
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
    if (pages > 100) { setError(`Exceeds 100 page limit (${pages} pages).`); return; }
    setFile(f);
    setPageCount(pages);
    if (f.size === 0) { setPaperId("demo"); setStep("processing"); }
    else setStep("level");
  };

  if (step === "upload") {
    return (
      <div className="h-full bg-bg">
        <UploadStep onFile={handleFile} error={error} />
      </div>
    );
  }

  if (step === "level" && file) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-bg p-6 sm:p-10">
        <div className="w-full max-w-xl animate-fade-up">
          <div className="mb-6 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blush text-rose">
              <FileText size={18} />
            </div>
            <div>
              <div className="text-[14px] font-medium text-ink truncate max-w-xs">{file.name}</div>
              <div className="text-[12px] text-ink-faint">{pageCount} pages · {(file.size / 1024 / 1024).toFixed(1)} MB</div>
            </div>
          </div>

          <h2 className="font-serif text-2xl text-ink mb-1">How should Cognexa explain?</h2>
          <p className="text-[14px] text-ink-soft mb-6">Choose the level of detail that fits your background.</p>

          <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <LevelCard title="Beginner" desc="Plain language, every term explained, simple analogies." selected={level === "Beginner"} onClick={() => setLevel("Beginner")} />
            <LevelCard title="Medium" desc="Assumes basic knowledge. Focuses on the 'why'." selected={level === "Medium"} onClick={() => setLevel("Medium")} />
            <LevelCard title="Pro" desc="Concise and technical. Contribution and results." selected={level === "Pro"} onClick={() => setLevel("Pro")} />
          </div>

          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep("upload")} disabled={uploadMutation.isPending} className="flex-1">
              Back
            </Button>
            <button
              onClick={() => uploadMutation.mutate()}
              disabled={uploadMutation.isPending}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-rose px-6 py-3 text-[14px] font-medium text-white shadow-sm transition-all hover:bg-rose/90 hover:shadow-panel disabled:opacity-60"
            >
              {uploadMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : null}
              Begin Study Session
            </button>
          </div>
          {error && <div className="mt-4 text-[13px] text-bad text-center">{error}</div>}
        </div>
      </div>
    );
  }

  if (step === "processing" && paperId) {
    return (
      <div className="h-full bg-bg">
        <ProcessingStep paperId={paperId} onDone={() => setStep("done")} />
      </div>
    );
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
