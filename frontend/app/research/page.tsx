"use client";

import { Suspense, useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { Search, Sparkles, Lightbulb, Loader2, FileText, CheckCircle2 } from "lucide-react";
import { FloatingPanel } from "@/components/ui/floating-panel";
import { ResearchCanvas } from "@/components/ui/research-canvas";
import { useUiStore } from "@/lib/store";
import { ChatMessage, OutputFormat } from "@/lib/types";
import { spreadLayout } from "@/lib/canvas-layout";

const CHIPS = [
  "Does AI actually help developers work faster?",
  "Compare attention mechanisms vs CNNs",
  "What does the evidence say about spaced repetition?",
  "Is there a replication crisis in psychology?",
];

interface AnswerPanel {
  id: string;
  title: string;
  subtitle: string;
  body: string;
  pending: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
}

let topZ = 20;

function FormatSelector({
  value,
  onChange,
}: {
  value: OutputFormat;
  onChange: (f: OutputFormat) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-line bg-surface/90 p-1 shadow-sm backdrop-blur-sm">
      <button
        type="button"
        onClick={() => onChange("quick")}
        className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
          value === "quick"
            ? "bg-rose text-white shadow-sm"
            : "text-ink-soft hover:text-ink hover:bg-surface2"
        }`}
      >
        Quick answer
      </button>
      <button
        type="button"
        onClick={() => onChange("detailed")}
        className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
          value === "detailed"
            ? "bg-rose text-white shadow-sm"
            : "text-ink-soft hover:text-ink hover:bg-surface2"
        }`}
      >
        Detailed explanation
      </button>
      <button
        type="button"
        onClick={() => onChange("full")}
        className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
          value === "full"
            ? "bg-rose text-white shadow-sm"
            : "text-ink-soft hover:text-ink hover:bg-surface2"
        }`}
      >
        Full report
      </button>
    </div>
  );
}

function EmptyState({
  onPick,
  outputFormat,
  onFormatChange,
}: {
  onPick: (t: string) => void;
  outputFormat: OutputFormat;
  onFormatChange: (f: OutputFormat) => void;
}) {
  return (
    <div className="relative flex h-full flex-col items-center justify-center p-8 text-center">
      <div className="aurora aurora-a" />
      <div className="aurora aurora-b" />
      <div className="relative animate-fade-up">
        <div className="mb-6 mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-blush to-lavender-soft shadow-panel">
          <Search size={24} className="text-rose" />
        </div>
        <h1 className="font-serif text-3xl font-normal text-ink sm:text-4xl">
          What are you{" "}
          <span className="text-gradient-rose">curious about?</span>
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[14px] text-ink-soft">
          Each answer lands as a floating panel. Keep four or five investigations open and compare them by hand.
        </p>

        {/* Output format picker */}
        <div className="mt-6 flex flex-col items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wider text-ink-faint">Report Depth</span>
          <FormatSelector value={outputFormat} onChange={onFormatChange} />
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {CHIPS.map((chip) => (
            <button
              key={chip}
              onClick={() => onPick(chip)}
              className="rounded-full border border-line bg-surface/80 px-4 py-2 text-[13px] text-ink-soft shadow-sm transition-all hover:border-rose/50 hover:bg-blush/30 hover:text-rose"
            >
              {chip}
            </button>
          ))}
        </div>
        <div className="mx-auto mt-10 flex max-w-md items-center gap-4 rounded-3xl border border-blush-deep bg-blush/30 px-6 py-4 text-left">
          <Lightbulb size={16} className="flex-shrink-0 text-rose" />
          <p className="text-[12px] text-ink-soft">
            Drag a panel by its header. Pull any edge to resize. Pinch with two fingers on a trackpad or touch screen.
          </p>
        </div>
      </div>
    </div>
  );
}

function ResearchPage() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");

  const { chatHistories, appendMessage, updateMessage } = useUiStore();
  const messages = chatHistories["research"];
  const [sending, setSending] = useState(false);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("full");
  const [panels, setPanels] = useState<AnswerPanel[]>([]);
  const [layoutNonce, setLayoutNonce] = useState(1);
  const [scale, setScale] = useState(1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });

  // Reopen existing session if session query parameter is present
  useEffect(() => {
    if (!sessionId) return;
    let active = true;

    async function loadSavedSession() {
      try {
        const { apiClient } = await import("@/lib/api");
        const data = await apiClient<any>(`/research/sessions/${sessionId}`);
        if (!active || !data) return;

        const { adaptResearchResponseToSteps } = await import("@/lib/adapters");
        const events = adaptResearchResponseToSteps(data);
        let answer = "";
        events.forEach((ev: any) => {
          if (ev.type === "done") answer = ev.answer ?? "";
        });

        topZ += 1;
        const panel: AnswerPanel = {
          id: data.session_id || sessionId!,
          title: data.research_question || "Saved Session",
          subtitle: `Saved session · Format: ${data.output_format || "full"}`,
          body: answer || data.report || "No report found.",
          pending: false,
          x: 60,
          y: 60,
          w: 520,
          h: 460,
          zIndex: topZ,
        };

        setPanels([panel]);
      } catch (err) {
        console.warn("Could not load saved session:", err);
      }
    }

    loadSavedSession();
    return () => {
      active = false;
    };
  }, [sessionId]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setCanvasSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const relayout = useCallback((next: AnswerPanel[]) => {
    const rects = spreadLayout(next.length, canvasSize.w, canvasSize.h, { left: 28 });
    return next.map((p, i) => ({ ...p, ...rects[i] }));
  }, [canvasSize]);

  async function send(text: string) {
    if (!text.trim() || sending) return;
    setSending(true);

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", text, status: "done" };
    const aId = crypto.randomUUID();
    const aMsg: ChatMessage = { id: aId, role: "assistant", status: "pending", steps: [{ label: "Starting…", detail: "" }] };

    appendMessage("research", userMsg);
    appendMessage("research", aMsg);

    topZ += 1;
    const pending: AnswerPanel = {
      id: aId,
      title: text.length > 42 ? `${text.slice(0, 42)}…` : text,
      subtitle: `Investigating (${outputFormat})…`,
      body: "",
      pending: true,
      x: 80,
      y: 80,
      w: 480,
      h: 360,
      zIndex: topZ,
    };
    setPanels((ps) => {
      const next = relayout([...ps, pending]);
      setLayoutNonce((n) => n + 1);
      return next;
    });

    try {
      const { apiClient } = await import("@/lib/api");
      const res = await apiClient<any>("/research", {
        method: "POST",
        body: JSON.stringify({ question: text, output_format: outputFormat }),
      });
      const { adaptResearchResponseToSteps } = await import("@/lib/adapters");
      const events = adaptResearchResponseToSteps(res);

      let steps: { label: string; detail: string }[] = [];
      let sources: any;
      let answer = "";

      events.forEach((ev: any) => {
        if (ev.type === "step" && ev.label) steps.push({ label: ev.label, detail: ev.detail ?? "" });
        else if (ev.type === "sources" && ev.sources) { steps.push({ label: "Sources reviewed", detail: "" }); sources = ev.sources; }
        else if (ev.type === "done") answer = ev.answer ?? "";
      });

      const critiqueStatus = res.critique?.status || "verified";
      updateMessage("research", aId, { status: "done", steps, sources, answer });
      setPanels((ps) =>
        ps.map((p) =>
          p.id === aId
            ? {
                ...p,
                pending: false,
                subtitle: `Research answer (${outputFormat}) · Critique: ${critiqueStatus}`,
                body: answer || "No answer returned.",
              }
            : p
        )
      );
    } catch (err: any) {
      const msg = err.message || "Network failure";
      updateMessage("research", aId, { status: "done", answer: `**Error:** ${msg}` });
      setPanels((ps) => ps.map((p) => p.id === aId ? { ...p, pending: false, subtitle: "Could not finish", body: msg } : p));
    } finally {
      setSending(false);
    }
  }

  const arrange = () => {
    setPanels((ps) => relayout(ps));
    setLayoutNonce((n) => n + 1);
  };

  const hasPanels = panels.length > 0 || messages.length > 0;

  return (
    <div ref={wrapRef} className="flex h-full flex-col bg-canvas">
      <div className="flex-shrink-0 flex items-center gap-3 border-b border-line bg-surface/70 px-5 py-3 backdrop-blur-md">
        <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-blush">
          <Search size={14} className="text-rose" />
        </div>
        <span className="text-[14px] font-medium text-ink">Research canvas</span>
        <div className="flex-1" />
        {/* Output format picker in header */}
        <div className="mr-3">
          <FormatSelector value={outputFormat} onChange={setOutputFormat} />
        </div>
        <span className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">
          {panels.filter((p) => !p.pending).length} answers open
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        {!hasPanels ? (
          <>
            <EmptyState
              onPick={(t) => send(t)}
              outputFormat={outputFormat}
              onFormatChange={setOutputFormat}
            />
            <div className="absolute bottom-4 left-1/2 z-50 w-[min(720px,calc(100%-2rem))] -translate-x-1/2">
              <div className="hud-dock flex items-center gap-2 rounded-2xl px-3 py-2">
                <Sparkles size={14} className="text-rose" />
                <input
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      send((e.target as HTMLInputElement).value);
                      (e.target as HTMLInputElement).value = "";
                    }
                  }}
                  placeholder="Ask an open-ended research question…"
                  className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
                />
              </div>
            </div>
          </>
        ) : (
          <ResearchCanvas
            panelCount={panels.length}
            onArrange={arrange}
            onReset={() => { setPanels([]); }}
            onViewScale={setScale}
            command={{
              onCommand: send,
              placeholder: "Ask another question — it opens as a new panel…",
              suggestions: CHIPS.slice(0, 3),
            }}
          >
            {panels.map((panel) => (
              <FloatingPanel
                key={panel.id}
                id={panel.id}
                type="research"
                title={panel.title}
                subtitle={panel.subtitle}
                initialX={panel.x}
                initialY={panel.y}
                initialW={panel.w}
                initialH={panel.h}
                zIndex={panel.zIndex}
                isNew
                layoutNonce={layoutNonce}
                scale={scale}
                onClose={(id) => setPanels((ps) => ps.filter((p) => p.id !== id))}
                onFocus={(id) => {
                  topZ += 1;
                  setPanels((ps) => ps.map((p) => p.id === id ? { ...p, zIndex: topZ } : p));
                }}
              >
                {panel.pending ? (
                  <div className="flex items-center gap-2 text-ink-faint">
                    <Loader2 size={14} className="animate-spin text-rose" />
                    Gathering evidence…
                  </div>
                ) : (
                  <div className="prose prose-sm prose-invert max-w-none text-[13px] leading-relaxed text-ink-soft [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-ink [&_h1]:mt-2 [&_h1]:mb-3 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-ink [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-ink [&_h3]:mt-3 [&_h3]:mb-1 [&_p]:mb-2 [&_ul]:my-1 [&_ul]:pl-4 [&_li]:mb-1 [&_strong]:text-ink [&_blockquote]:border-l-2 [&_blockquote]:border-rose/50 [&_blockquote]:pl-3 [&_blockquote]:text-ink-faint [&_blockquote]:italic">
                    <ReactMarkdown
                      components={{
                        a: ({ node, ...props }) => (
                          <a
                            {...props}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-rose font-medium hover:underline inline-flex items-center gap-0.5"
                          />
                        ),
                      }}
                    >
                      {panel.body}
                    </ReactMarkdown>
                  </div>
                )}

              </FloatingPanel>
            ))}
          </ResearchCanvas>
        )}
      </div>
    </div>
  );
}

export default function ResearchModePage() {
  return (
    <Suspense>
      <ResearchPage />
    </Suspense>
  );
}
