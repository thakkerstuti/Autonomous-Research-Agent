"use client";

import { Suspense, useState, useRef, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, Plus, Copy, Check, RotateCcw, AlertCircle, ChevronDown } from "lucide-react";
import { useUiStore } from "@/lib/store";
import { ChatMessage, OutputFormat } from "@/lib/types";
import { buildResearchView, ResearchView } from "@/lib/research-view";
import { AgentStepsCard } from "@/components/chat/agent-steps-card";
import { Composer } from "@/components/research/composer";
import { AgentRun, ThinkingLine } from "@/components/research/agent-run";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { ReportBody, SourceRow } from "@/components/research/report-body";
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
        <h1 className="font-display text-display-xl font-semibold text-ink" style={{ ["--i" as string]: 0 }}>
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

      <div className="animate-view-in rounded-[20px] bg-surface p-6 shadow-sm sm:p-7" style={{ animationDelay: "120ms" }}>
        <div>
          <div className="col-label mb-2 px-1">Try one of these</div>
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
      className="pressable -ml-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] text-ink-soft hover:bg-surface2 hover:text-ink"
    >
      <span className="relative h-[14px] w-[14px]">
        <Copy size={14} className={cn("absolute inset-0 transition-[opacity,transform] duration-200", done ? "scale-50 opacity-0" : "opacity-100")} />
        <Check size={14} className={cn("absolute inset-0 text-ok transition-[opacity,transform] duration-200", done ? "opacity-100" : "scale-50 opacity-0")} />
      </span>
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function SourcesToggle({ view }: { view: ResearchView }) {
  const [open, setOpen] = useState(false);
  if (!view.sources.length) return null;
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg py-1 text-[13px] text-ink-soft transition-colors hover:text-ink"
      >
        {view.sources.length} sources
        <span className="text-ink-faint">· {view.verification.verified} quotes verified</span>
        <ChevronDown size={14} className={cn("text-ink-faint transition-transform duration-200 ease-out", open && "rotate-180")} />
      </button>
      <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-out", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
        <div className="overflow-hidden">
          <div className="-mx-2 mt-1">
            {view.sources.map((s, i) => <SourceRow key={s.domain} s={s} index={i} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function Entry({ entry, onRetry, busy }: { entry: EntryData; onRetry: (q: string) => void; busy: boolean }) {
  const { q, a } = entry;
  const view = a?.view;
  const pending = !a || a.status === "pending";
  const isError = !!a?.answer?.startsWith("**Error:**");
  const body = view?.report ?? a?.answer ?? "";

  return (
    <article className="flex scroll-mt-6 flex-col gap-7">
      <div className="animate-msg-in ml-auto max-w-[min(85%,600px)] whitespace-pre-wrap rounded-[20px] bg-surface3 px-4 py-2.5 text-[15.5px] leading-relaxed text-ink">
        {q.text}
      </div>

      <div className="flex gap-3.5">
        <ThinkingMark active={pending} className="mt-[3px]" />
        <div className="min-w-0 flex-1">
          {pending ? (
            <ThinkingLine startedAt={a?.startedAt} />
          ) : isError ? (
            <div className="animate-msg-in">
              <p className="text-[15.5px] text-ink">I couldn&apos;t finish this one.</p>
              <p className="mt-1 break-words text-[14px] text-ink-soft">{a!.answer?.replace(/^\*\*Error:\*\*\s*/, "")}</p>
              <button
                onClick={() => q.text && onRetry(q.text)}
                disabled={busy}
                className="pressable mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-medium text-ink hover:border-line-hover disabled:opacity-40"
              >
                <RotateCcw size={13} /> Try again
              </button>
            </div>
          ) : (
            <div className="animate-msg-in">
              {view?.reportError && (
                <p className="mb-4 flex items-start gap-2 text-[13.5px] text-ink-soft">
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-warn" /> {view.reportError}
                </p>
              )}
              <ReportBody markdown={body} view={view} />
              {!view && !!a!.steps?.length && (
                <div className="mt-6"><AgentStepsCard message={a!} /></div>
              )}
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1">
                <CopyButton text={body} />
                {view?.stats.duration !== undefined && (
                  <span className="text-[12.5px] text-ink-faint">Researched in {Math.round(view.stats.duration)}s</span>
                )}
              </div>
              {view && (
                <div className="mt-1 flex flex-col items-start gap-0.5">
                  <SourcesToggle view={view} />
                  <AgentRun view={view} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
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
    <div className="flex h-full flex-col">
      <header className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-line px-4 sm:px-6">
        <span className="text-[13.5px] font-semibold text-ink">Research</span>
        {threadTitle && (
          <>
            <span className="text-ink-faint">/</span>
            <span className="min-w-0 truncate text-[13.5px] text-ink-soft">{threadTitle}</span>
          </>
        )}
        <div className="flex-1" />
        {hasMessages && (
          <button
            onClick={() => resetHistory("research", [])}
            disabled={sending}
            className="pressable flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-ink-soft hover:bg-surface2 hover:text-ink disabled:opacity-40"
          >
            <Plus size={14} /> <span className="hidden sm:inline">New chat</span>
          </button>
        )}
      </header>

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto">
        {!hasMessages ? (
          <EmptyState onPick={send} />
        ) : (
          <div className="mx-auto flex max-w-[760px] flex-col gap-12 px-5 pb-16 pt-10 sm:px-8">
            {entries.map((e) => (
              <Entry key={e.q.id} entry={e} busy={sending} onRetry={send} />
            ))}
          </div>
        )}
      </div>

      <div className="px-4 pb-4 pt-2 sm:px-8 sm:pb-6">
        <div className="mx-auto max-w-[760px]">
          <Composer
            placeholder={hasMessages ? "Reply to CogNexa" : "Ask an open research question"}
            disabled={sending}
            busy={sending}
            onSend={send}
            format={outputFormat}
            onFormatChange={setOutputFormat}
          />
        </div>
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
