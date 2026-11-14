"use client";

import { Suspense, useState, useRef, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, Plus, Copy, Check, PanelRightClose, PanelRightOpen, RotateCcw, AlertCircle, ShieldCheck } from "lucide-react";
import { useUiStore } from "@/lib/store";
import { ChatMessage, OutputFormat } from "@/lib/types";
import { buildResearchView, ResearchView } from "@/lib/research-view";
import { AgentStepsCard } from "@/components/chat/agent-steps-card";
import { NeuralField } from "@/components/neural/neural-field";
import { Composer } from "@/components/research/composer";
import { AgentLive, AgentRun, Verdicts } from "@/components/research/agent-run";
import { ReportBody, SourceRow } from "@/components/research/report-body";
import { BrandMark } from "@/components/ui/brand-mark";
import { cn } from "@/lib/utils";

const CHIPS = [
  "Does AI actually help developers work faster?",
  "Compare attention mechanisms vs CNNs",
  "What does the evidence say about spaced repetition?",
  "Is there a replication crisis in psychology?",
];

const HOW = [
  ["Plans", "Breaks your question into testable hypotheses."],
  ["Searches", "Runs several rounds of searches across sources."],
  ["Verifies", "Checks every quote against the original page."],
  ["Reports", "Writes a cited report and audits its own claims."],
];

/* ───────────── Empty state ───────────── */

function EmptyState({ onPick }: { onPick: (t: string) => void }) {
  return (
    <div className="mx-auto grid min-h-full max-w-[1080px] items-center gap-12 px-5 py-12 sm:px-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
      <div className="stagger">
        <h1 className="font-serif text-display-xl font-normal text-ink" style={{ ["--i" as string]: 0 }}>
          Ask a question worth researching.
        </h1>
        <p className="mt-5 max-w-[50ch] text-body-lg text-ink-soft" style={{ ["--i" as string]: 1 }}>
          The agent investigates it the way a careful researcher would, then answers with a report you can check line by line.
        </p>
        <ol className="mt-9 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line pt-6" style={{ ["--i" as string]: 2 }}>
          {HOW.map(([t, d], i) => (
            <li key={t}>
              <div className="flex items-baseline gap-2">
                <span className="mono text-[11px] text-ink-faint">{i + 1}</span>
                <span className="text-[13.5px] font-medium text-ink">{t}</span>
              </div>
              <p className="mt-1 pl-[18px] text-meta text-ink-soft">{d}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="animate-view-in" style={{ animationDelay: "120ms" }}>
        <div className="lens h-[220px] rounded-[22px] sm:h-[260px]">
          <NeuralField mode="idle" seed={23} />
        </div>
        <div className="mt-6">
          <div className="col-label mb-1 px-1">Try one of these</div>
          <ul>
            {CHIPS.map((chip) => (
              <li key={chip} className="border-b border-line last:border-b-0">
                <button
                  onClick={() => onPick(chip)}
                  className="group flex w-full items-center justify-between gap-4 rounded-lg px-1 py-3 text-left text-[14px] text-ink-soft transition-colors duration-150 hover:text-ink"
                >
                  {chip}
                  <ArrowUpRight size={15} className="flex-shrink-0 text-ink-faint transition-[transform,color] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ───────────── One question and its answer ───────────── */

interface EntryData { q: ChatMessage; a?: ChatMessage }

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        let ok = false;
        try {
          await navigator.clipboard.writeText(text);
          ok = true;
        } catch {
          // Fallback for browsers that block the async clipboard API
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.setAttribute("readonly", "");
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          try { ok = document.execCommand("copy"); } catch {}
          ta.remove();
        }
        if (ok) {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        }
      }}
      className="pressable inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-ink-soft hover:bg-surface2 hover:text-ink"
    >
      <span className="relative h-[14px] w-[14px]">
        <Copy size={14} className={cn("absolute inset-0 transition-[opacity,transform] duration-200", done ? "scale-50 opacity-0" : "opacity-100")} />
        <Check size={14} className={cn("absolute inset-0 text-ok transition-[opacity,transform] duration-200", done ? "opacity-100" : "scale-50 opacity-0")} />
      </span>
      {done ? "Copied" : "Copy report"}
    </button>
  );
}

function Entry({
  entry,
  first,
  active,
  onActivate,
  onHover,
  onRetry,
  busy,
}: {
  entry: EntryData;
  first: boolean;
  active: boolean;
  onActivate: () => void;
  onHover: () => void;
  onRetry: (q: string) => void;
  busy: boolean;
}) {
  const { q, a } = entry;
  const view = a?.view;
  const isError = !!a?.answer?.startsWith("**Error:**");
  const body = view?.report ?? a?.answer ?? "";

  const meta = view
    ? [
        view.format ? `${view.format.charAt(0).toUpperCase()}${view.format.slice(1)} report` : null,
        `${view.sources.length} sources`,
        view.verification.verified ? `${view.verification.verified} quotes verified` : null,
        view.stats.duration !== undefined ? `${Math.round(view.stats.duration)}s` : null,
      ].filter(Boolean)
    : [];

  return (
    <article
      onMouseEnter={view ? onHover : undefined}
      className={cn("scroll-mt-6", !first && "border-t border-line pt-14")}
    >
      <header className="animate-msg-in">
        <h2 className={cn("font-serif font-normal text-ink", first ? "text-display" : "text-title")}>{q.text}</h2>
        {meta.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="flex items-center gap-2 text-meta text-ink-faint">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-primary text-on-primary"><BrandMark size={12} /></span>
              {meta.join(" · ")}
            </span>
            <span className="flex-1" />
            <CopyButton text={body} />
            <button
              onClick={onActivate}
              className={cn(
                "pressable hidden h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] hover:bg-surface2 xl:inline-flex",
                active ? "text-ink" : "text-ink-soft hover:text-ink"
              )}
            >
              <ShieldCheck size={14} /> Evidence
            </button>
          </div>
        )}
      </header>

      <div className="mt-7">
        {!a || a.status === "pending" ? (
          <div className="animate-msg-in">
            <AgentLive startedAt={a?.startedAt} />
          </div>
        ) : isError ? (
          <div className="animate-msg-in flex items-start gap-3 rounded-2xl bg-bad/[0.07] px-5 py-4">
            <AlertCircle size={17} className="mt-0.5 flex-shrink-0 text-bad" />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-ink">The agent couldn't finish this one.</p>
              <p className="mt-1 break-words text-meta text-ink-soft">{a.answer?.replace(/^\*\*Error:\*\*\s*/, "")}</p>
            </div>
            <button
              onClick={() => q.text && onRetry(q.text)}
              disabled={busy}
              className="pressable inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12.5px] font-medium text-ink hover:border-line-hover disabled:opacity-40"
            >
              <RotateCcw size={13} /> Try again
            </button>
          </div>
        ) : view ? (
          <div className="flex flex-col gap-10">
            <div className="animate-msg-in"><AgentRun view={view} /></div>
            {view.reportError && (
              <p className="flex items-start gap-2 rounded-xl bg-warn/[0.07] px-4 py-3 text-meta text-ink-soft">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-warn" /> {view.reportError}
              </p>
            )}
            <div className="animate-msg-in" style={{ animationDelay: "60ms" }}>
              <ReportBody markdown={body} view={view} />
            </div>
            <div className="animate-msg-in" style={{ animationDelay: "120ms" }}>
              <Verdicts view={view} />
            </div>
            {view.sources.length > 0 && (
              <section className="xl:hidden">
                <h3 className="mb-2 text-[16px] font-semibold tracking-[-0.012em] text-ink">Sources</h3>
                <div className="-mx-2">
                  {view.sources.map((s, i) => <SourceRow key={s.domain} s={s} index={i} />)}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {!!a.steps?.length && <AgentStepsCard message={a} />}
            <ReportBody markdown={body} />
          </div>
        )}
      </div>
    </article>
  );
}

/* ───────────── Evidence rail ───────────── */

type Filter = "all" | "supports" | "refutes" | "verified";

function EvidenceRail({ view, onClose }: { view?: ResearchView; onClose: () => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const sources = (view?.sources ?? []).filter((s) =>
    filter === "all" ? true : filter === "verified" ? s.verified : s.stances[filter] > 0
  );

  return (
    <aside className="hidden w-[340px] flex-shrink-0 flex-col border-l border-line xl:flex">
      <div className="flex h-14 items-center justify-between px-5">
        <span className="text-[13.5px] font-semibold text-ink">Evidence</span>
        <button onClick={onClose} aria-label="Hide evidence" className="pressable flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint hover:bg-surface2 hover:text-ink">
          <PanelRightClose size={16} strokeWidth={1.75} />
        </button>
      </div>
      {!view ? (
        <p className="px-5 text-meta text-ink-faint">Sources for an answer appear here once the agent finishes a run.</p>
      ) : (
        <>
          <div className="px-5">
            <p className="line-clamp-2 font-serif text-[15px] leading-snug text-ink">{view.question}</p>
            <div className="mt-4 grid grid-cols-3 border-y border-line py-3 text-center">
              <div><div className="figure text-[24px] text-ink">{view.sources.length}</div><div className="mt-1 text-[11px] text-ink-faint">sources</div></div>
              <div className="border-x border-line"><div className="figure text-[24px] text-ink">{view.evidence.length}</div><div className="mt-1 text-[11px] text-ink-faint">evidence</div></div>
              <div><div className="figure text-[24px] text-ok">{view.verification.verified}</div><div className="mt-1 text-[11px] text-ink-faint">verified</div></div>
            </div>
            <div className="mt-3 flex gap-1">
              {(["all", "supports", "refutes", "verified"] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "pressable rounded-full px-2.5 py-1 text-[11.5px] font-medium capitalize",
                    filter === f ? "bg-primary text-on-primary" : "text-ink-soft hover:bg-surface2 hover:text-ink"
                  )}
                >
                  {f === "supports" ? "Supporting" : f === "refutes" ? "Refuting" : f}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-6">
            {sources.length ? (
              sources.map((s, i) => <SourceRow key={s.domain} s={s} index={i} />)
            ) : (
              <p className="px-2 py-6 text-meta text-ink-faint">No sources match this filter.</p>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

/* ───────────── Page ───────────── */

function ResearchPage() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");
  const initialQuery = searchParams.get("q");
  const sentInitial = useRef(false);

  const { chatHistories, appendMessage, updateMessage, resetHistory } = useUiStore();
  const messages = chatHistories["research"];
  const [sending, setSending] = useState(false);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("full");
  const [railOpen, setRailOpen] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Pair each question with its answer
  const entries: EntryData[] = useMemo(() => {
    const out: EntryData[] = [];
    messages.forEach((m) => {
      if (m.role === "user") out.push({ q: m });
      else if (out.length && !out[out.length - 1].a) out[out.length - 1].a = m;
    });
    return out;
  }, [messages]);

  const lastWithView = [...entries].reverse().find((e) => e.a?.view)?.a;
  const activeView = (entries.find((e) => e.a?.id === activeId)?.a ?? lastWithView)?.view;

  // When a new question is asked, bring its entry to the top of the view
  const prevCount = useRef(entries.length);
  useEffect(() => {
    if (entries.length > prevCount.current) {
      const nodes = bodyRef.current?.querySelectorAll("article");
      nodes?.[nodes.length - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    prevCount.current = entries.length;
  }, [entries.length]);

  // Reopen an existing session into the thread if ?session= is present
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
        const steps: { label: string; detail: string }[] = [];
        let sources: any;
        let answer = "";
        events.forEach((ev: any) => {
          if (ev.type === "step" && ev.label) steps.push({ label: ev.label, detail: ev.detail ?? "" });
          else if (ev.type === "sources" && ev.sources) sources = ev.sources;
          else if (ev.type === "done") answer = ev.answer ?? "";
        });

        resetHistory("research", [
          { id: `${sessionId}-q`, role: "user", text: data.research_question || "Saved session", status: "done" },
          {
            id: data.session_id || sessionId!,
            role: "assistant",
            status: "done",
            steps,
            sources,
            answer: answer || data.report || "No report found.",
            view: buildResearchView(data),
          },
        ]);
      } catch (err) {
        console.warn("Could not load saved session:", err);
      }
    }

    loadSavedSession();
    return () => {
      active = false;
    };
  }, [sessionId, resetHistory]);

  async function send(text: string) {
    if (!text.trim() || sending) return;
    setSending(true);

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", text, status: "done" };
    const aId = crypto.randomUUID();
    const aMsg: ChatMessage = {
      id: aId,
      role: "assistant",
      status: "pending",
      steps: [{ label: "Starting…", detail: "" }],
      startedAt: Date.now(),
    };

    appendMessage("research", userMsg);
    appendMessage("research", aMsg);

    try {
      const { apiClient } = await import("@/lib/api");
      const res = await apiClient<any>("/research", {
        method: "POST",
        body: JSON.stringify({ question: text, output_format: outputFormat }),
      });
      const { adaptResearchResponseToSteps } = await import("@/lib/adapters");
      const events = adaptResearchResponseToSteps(res);

      const steps: { label: string; detail: string }[] = [];
      let sources: any;
      let answer = "";

      events.forEach((ev: any) => {
        if (ev.type === "step" && ev.label) steps.push({ label: ev.label, detail: ev.detail ?? "" });
        else if (ev.type === "sources" && ev.sources) {
          steps.push({ label: "Sources reviewed", detail: `${ev.sources.length} sources reviewed` });
          sources = ev.sources;
        } else if (ev.type === "done") answer = ev.answer ?? "";
      });

      updateMessage("research", aId, {
        status: "done",
        steps,
        sources,
        answer: answer || "No answer returned.",
        view: buildResearchView(res),
      });
      setActiveId(aId);
    } catch (err: any) {
      let msg = err.message || "Network failure";
      if (err.status === 400) msg = `Invalid research question: ${msg}`;
      else if (err.status === 503) msg = `Service unavailable (Gemini quota or rate limit): ${msg}`;
      updateMessage("research", aId, { status: "done", steps: [], answer: `**Error:** ${msg}` });
    } finally {
      setSending(false);
    }
  }

  // A question handed over from the dashboard is asked once, then removed from the URL.
  useEffect(() => {
    if (!initialQuery || sentInitial.current) return;
    sentInitial.current = true;
    window.history.replaceState(null, "", "/research");
    send(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const hasMessages = messages.length > 0;
  const threadTitle = entries[0]?.q.text;

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-line px-4 sm:px-6">
          <span className="text-[13.5px] font-semibold text-ink">Research</span>
          {threadTitle && (
            <>
              <span className="text-ink-faint">/</span>
              <span className="min-w-0 truncate text-[13.5px] text-ink-soft">{threadTitle}</span>
            </>
          )}
          <div className="flex-1" />
          {sending && (
            <span className="hidden items-center gap-2 text-meta text-ink-soft sm:flex">
              <span className="live-dot" /> Agent working
            </span>
          )}
          {hasMessages && (
            <button
              onClick={() => resetHistory("research", [])}
              disabled={sending}
              className="pressable flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-ink-soft hover:bg-surface2 hover:text-ink disabled:opacity-40"
            >
              <Plus size={14} /> <span className="hidden sm:inline">New thread</span>
            </button>
          )}
          {hasMessages && !railOpen && (
            <button
              onClick={() => setRailOpen(true)}
              aria-label="Show evidence"
              className="pressable hidden h-8 w-8 items-center justify-center rounded-lg text-ink-faint hover:bg-surface2 hover:text-ink xl:flex"
            >
              <PanelRightOpen size={16} strokeWidth={1.75} />
            </button>
          )}
        </header>

        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto">
          {!hasMessages ? (
            <EmptyState onPick={send} />
          ) : (
            <div className="mx-auto flex max-w-[760px] flex-col gap-14 px-5 pb-16 pt-12 sm:px-8">
              {entries.map((e, i) => (
                <Entry
                  key={e.q.id}
                  entry={e}
                  first={i === 0}
                  busy={sending}
                  active={!!e.a?.view && e.a.view === activeView}
                  onActivate={() => {
                    if (e.a?.view) {
                      setActiveId(e.a.id);
                      setRailOpen(true);
                    }
                  }}
                  onHover={() => e.a?.view && setActiveId(e.a.id)}
                  onRetry={send}
                />
              ))}
            </div>
          )}
        </div>

        <div className="px-4 pb-4 pt-2 sm:px-8 sm:pb-6">
          <div className="mx-auto max-w-[760px]">
            <Composer
              placeholder={hasMessages ? "Ask a follow-up question" : "Ask an open research question"}
              disabled={sending}
              busy={sending}
              onSend={send}
              format={outputFormat}
              onFormatChange={setOutputFormat}
            />
          </div>
        </div>
      </div>

      {hasMessages && railOpen && <EvidenceRail view={activeView} onClose={() => setRailOpen(false)} />}
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
