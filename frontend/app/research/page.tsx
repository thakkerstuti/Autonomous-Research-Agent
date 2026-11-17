"use client";

import { Suspense, useState, useRef, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, Plus, Copy, Check, RotateCcw, AlertCircle, ChevronDown, Info } from "lucide-react";
import { useUiStore } from "@/lib/store";
import { ChatMessage, OutputFormat } from "@/lib/types";
import { buildResearchView, ResearchView } from "@/lib/research-view";
import { Composer } from "@/components/research/composer";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { ReportBody, SourceRow } from "@/components/research/report-body";
import { WorkingFlow, formatDuration } from "@/components/research/working-flow";
import { PaperCard, WritePaperAction } from "@/components/research/paper-card";
import { cn } from "@/lib/utils";
import { readWorkspace, updateWorkspace } from "@/lib/workspace";
import { queryClient } from "@/lib/query-client";
import { DocumentSummary, MODE_LABEL, ResearchRun, getRun, getThread, startRun } from "@/lib/research-runs";

const CHIPS = [
  "Does AI actually help developers work faster?",
  "Compare attention mechanisms vs CNNs",
  "What does the evidence say about spaced repetition?",
  "Is there a replication crisis in psychology?",
];

const HOW = [
  ["Understands", "Works out what your question is really asking."],
  ["Discovers", "Finds relevant sources over several searches."],
  ["Verifies", "Checks quotes against the original pages and weighs each source."],
  ["Delivers", "A quick answer, a detailed analysis or a full research paper."],
];

const FORMATS: OutputFormat[] = ["quick", "detailed", "full"];

/* ───────────── Empty state ───────────── */

function EmptyState({ onPick }: { onPick: (t: string) => void }) {
  return (
    <div className="mx-auto grid min-h-full max-w-[1080px] items-center gap-12 px-5 py-12 sm:px-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
      <div className="stagger">
        <h1 className="font-display text-display-xl font-semibold text-ink" style={{ ["--i" as string]: 0 }}>
          Ask a question worth researching.
        </h1>
        <p className="mt-5 max-w-[50ch] text-body-lg text-ink-soft" style={{ ["--i" as string]: 1 }}>
          CogNexa investigates it the way a careful researcher would, then answers with sources you can check line by line.
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

function Entry({ entry, onRetry, busy }: { entry: EntryData; onRetry: (q: string, format?: OutputFormat) => void; busy: boolean }) {
  const { q, a } = entry;
  const run = a?.run;
  const view = a?.view;
  const mode: OutputFormat = run?.output_format ?? "quick";
  const pending = !a || a.status === "pending" || run?.status === "in_progress";
  const failed = run?.status === "failed" || !!a?.answer?.startsWith("**Error:**");
  const [startedDoc, setStartedDoc] = useState<DocumentSummary | null>(null);
  const doc = run?.document ?? startedDoc;
  // A Full Research Paper turn shows its short answer here and the paper as a document
  const isPaperTurn = mode === "full" && !!doc;
  const body = (isPaperTurn ? run?.summary ?? run?.report : run?.report) ?? view?.report ?? a?.answer ?? "";
  const duration = run?.stats?.duration_seconds;

  return (
    <article className="flex scroll-mt-6 flex-col gap-7">
      <div className="animate-msg-in ml-auto flex max-w-[min(85%,600px)] flex-col items-end gap-1.5">
        <div className="whitespace-pre-wrap rounded-[20px] bg-surface3 px-4 py-2.5 text-[15.5px] leading-relaxed text-ink">{q.text}</div>
        {run && <span className="px-1 text-[11.5px] text-ink-faint">{MODE_LABEL[mode]}</span>}
      </div>

      <div className="flex gap-3.5">
        <ThinkingMark active={pending && !failed} className="mt-[3px]" />
        <div className="min-w-0 flex-1">
          {pending && !failed ? (
            <WorkingFlow progress={run?.progress} status="in_progress" mode={mode} />
          ) : failed ? (
            <div className="animate-msg-in">
              <p className="text-[15.5px] text-ink">I couldn&apos;t finish this one.</p>
              <p className="mt-1 break-words text-[14px] text-ink-soft">
                {run?.error || a?.answer?.replace(/^\*\*Error:\*\*\s*/, "") || "Something went wrong."}
              </p>
              <button
                onClick={() => q.text && onRetry(q.text, mode)}
                disabled={busy}
                className="pressable mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-medium text-ink hover:border-line-hover disabled:opacity-40"
              >
                <RotateCcw size={13} /> Try again
              </button>
              {run && <div className="mt-5"><WorkingFlow progress={run.progress} status="failed" mode={mode} collapsible /></div>}
            </div>
          ) : (
            <div className="animate-msg-in">
              {run?.note && (
                <p className="mb-4 flex items-start gap-2 text-[13.5px] text-ink-soft">
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-warn" /> {run.note}
                </p>
              )}
              {isPaperTurn && <p className="col-label mb-2">In short</p>}
              <ReportBody markdown={body} view={view} />
              {run?.needs_review && (
                <p className="mt-4 flex items-start gap-2 text-[13px] text-ink-faint">
                  <Info size={13} className="mt-0.5 flex-shrink-0" /> Some statements rest on limited evidence; check the cited sources before relying on them.
                </p>
              )}

              {run && mode === "full" && doc && <div className="mt-6"><PaperCard sessionId={run.session_id} initial={doc} /></div>}
              {run && mode === "detailed" && (
                <div className="mt-5">
                  {doc ? <PaperCard sessionId={run.session_id} initial={doc} /> : <WritePaperAction sessionId={run.session_id} onStarted={setStartedDoc} />}
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1">
                <CopyButton text={body} />
                {duration != null && <span className="text-[12.5px] text-ink-faint">Researched in {formatDuration(Math.round(duration))}</span>}
              </div>
              <div className="mt-1 flex flex-col items-start gap-0.5">
                {view && <SourcesToggle view={view} />}
                {run && <WorkingFlow progress={run.progress} status={run.status} mode={mode} collapsible />}
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

/* ───────────── The conversation, from the server ───────────── */

function turnMessages(run: ResearchRun): ChatMessage[] {
  return [
    { id: `q-${run.session_id}`, role: "user", text: run.research_question, status: "done" },
    {
      id: `a-${run.session_id}`,
      role: "assistant",
      status: run.status === "in_progress" ? "pending" : "done",
      run,
      view: run.status === "in_progress" ? undefined : buildResearchView(run),
      answer: run.report ?? undefined,
    },
  ];
}

// One poller per running question, shared across re-renders and navigation
const pollers = new Map<string, ReturnType<typeof setTimeout>>();

function follow(sessionId: string) {
  if (pollers.has(sessionId)) return;
  const tick = async () => {
    try {
      const run = await getRun(sessionId);
      const id = `a-${sessionId}`;
      const store = useUiStore.getState();
      if (!store.chatHistories.research.some((m) => m.id === id)) {
        pollers.delete(sessionId); // the conversation was closed
        return;
      }
      const finished = run.status !== "in_progress";
      store.updateMessage("research", id, {
        run,
        status: finished ? "done" : "pending",
        view: finished ? buildResearchView(run) : undefined,
        answer: run.report ?? undefined,
      });
      if (finished) {
        pollers.delete(sessionId);
        queryClient.invalidateQueries({ queryKey: ["sessions"] });
        queryClient.invalidateQueries({ queryKey: ["threads"] });
        return;
      }
    } catch (err: any) {
      if (err?.status === 404 || err?.status === 401) {
        pollers.delete(sessionId);
        return;
      }
      // Network hiccup: try again on the next tick
    }
    pollers.set(sessionId, setTimeout(tick, 2500));
  };
  pollers.set(sessionId, setTimeout(tick, 1200));
}

async function loadThread(threadId: string): Promise<ChatMessage[] | null> {
  const thread = await getThread(threadId);
  if (!thread?.turns?.length) return null;
  thread.turns.filter((t) => t.status === "in_progress").forEach((t) => follow(t.session_id));
  return thread.turns.flatMap(turnMessages);
}

/* ───────────── Page ───────────── */

function ResearchPage() {
  const searchParams = useSearchParams();
  const threadParam = searchParams.get("thread");
  const sessionParam = searchParams.get("session");
  const initialQuery = searchParams.get("q");
  const sentInitial = useRef(false);

  const { chatHistories, appendMessage, updateMessage, resetHistory } = useUiStore();
  const messages = chatHistories["research"];
  const [sending, setSending] = useState(false);
  const inFlight = messages.some((m) => m.role === "assistant" && m.status === "pending");
  const busy = sending || inFlight;
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("detailed");
  const [loadError, setLoadError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // The conversation's thread: every follow-up joins it
  const threadId = useMemo(
    () => messages.find((m) => m.role === "assistant" && m.run?.thread_id)?.run?.thread_id ?? null,
    [messages]
  );

  useEffect(() => {
    const saved = readWorkspace().research?.format;
    if (saved && FORMATS.includes(saved as OutputFormat)) setOutputFormat(saved as OutputFormat);
  }, []);

  function chooseFormat(f: OutputFormat) {
    setOutputFormat(f);
    updateWorkspace((w) => ({ ...w, research: { ...(w.research ?? {}), format: f } }));
  }

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

  async function openThread(id: string) {
    setLoadError(null);
    try {
      const msgs = await loadThread(id);
      if (!msgs) return;
      resetHistory("research", msgs);
      updateWorkspace((w) => ({ ...w, research: { ...(w.research ?? {}), threadId: id, sessionIds: [], pending: null } }));
    } catch (err: any) {
      if (err?.status === 404) {
        setLoadError("That conversation couldn't be found.");
        updateWorkspace((w) => ({ ...w, research: { ...(w.research ?? {}), threadId: null } }));
      } else {
        setLoadError("Couldn't load this conversation. Check your connection and try again.");
      }
    }
  }

  // Open a conversation from History (?thread=) or an older link to one question (?session=)
  useEffect(() => {
    if (!threadParam && !sessionParam) return;
    let active = true;
    (async () => {
      try {
        const id = threadParam ?? (await getRun(sessionParam!)).thread_id;
        if (active) await openThread(id);
      } catch {
        if (active) setLoadError("That conversation couldn't be found.");
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadParam, sessionParam]);

  // Otherwise reopen the conversation that was open before (after a reload or signing in again)
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || threadParam || sessionParam || initialQuery) return;
    restored.current = true;
    const current = useUiStore.getState().chatHistories.research;
    if (current.length) {
      // Navigated away and back: keep following anything still running
      current.forEach((m) => m.run?.status === "in_progress" && follow(m.run.session_id));
      return;
    }
    const ws = readWorkspace().research;
    (async () => {
      let id = ws?.threadId ?? null;
      const legacy = ws?.sessionIds?.[ws.sessionIds.length - 1];
      if (!id && legacy) {
        try { id = (await getRun(legacy)).thread_id; } catch {}
      }
      if (id && !useUiStore.getState().chatHistories.research.length) await openThread(id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(text: string, format: OutputFormat = outputFormat) {
    if (!text.trim() || busy) return;
    setSending(true);
    setLoadError(null);
    const tempId = crypto.randomUUID();
    appendMessage("research", { id: `q-${tempId}`, role: "user", text, status: "done" });
    appendMessage("research", {
      id: `a-${tempId}`,
      role: "assistant",
      status: "pending",
      startedAt: Date.now(),
    });
    try {
      const run = await startRun(text, format, threadId);
      // Swap the placeholders for the server's ids, then follow the run
      const store = useUiStore.getState();
      store.resetHistory(
        "research",
        store.chatHistories.research.map((m) =>
          m.id === `q-${tempId}` ? { ...m, id: `q-${run.session_id}` } : m.id === `a-${tempId}` ? turnMessages(run)[1] : m
        )
      );
      updateWorkspace((w) => ({ ...w, research: { ...(w.research ?? {}), threadId: run.thread_id, sessionIds: [], pending: null } }));
      follow(run.session_id);
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    } catch (err: any) {
      let msg = err?.message || "Network failure";
      if (err?.status === 503) msg = `The research service is unavailable right now: ${msg}`;
      updateMessage("research", `a-${tempId}`, { status: "done", answer: `**Error:** ${msg}` });
    } finally {
      setSending(false);
    }
  }

  // A question handed over from the dashboard is asked once, then removed from the URL.
  useEffect(() => {
    if (!initialQuery || sentInitial.current) return;
    sentInitial.current = true;
    window.history.replaceState(null, "", "/research");
    resetHistory("research", []);
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
            onClick={() => {
              resetHistory("research", []);
              updateWorkspace((w) => ({ ...w, research: { format: w.research?.format, threadId: null } }));
              if (threadParam || sessionParam) window.history.replaceState(null, "", "/research");
            }}
            disabled={busy}
            className="pressable flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-ink-soft hover:bg-surface2 hover:text-ink disabled:opacity-40"
          >
            <Plus size={14} /> <span className="hidden sm:inline">New chat</span>
          </button>
        )}
      </header>

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto">
        {loadError && (
          <p className="mx-auto mt-6 flex max-w-[760px] items-center gap-2 px-5 text-[13.5px] text-ink-soft sm:px-8">
            <AlertCircle size={14} className="text-warn" /> {loadError}
          </p>
        )}
        {!hasMessages ? (
          <EmptyState onPick={(t) => send(t)} />
        ) : (
          <div className="mx-auto flex max-w-[760px] flex-col gap-12 px-5 pb-16 pt-10 sm:px-8">
            {entries.map((e) => (
              <Entry key={e.q.id} entry={e} busy={busy} onRetry={send} />
            ))}
          </div>
        )}
      </div>

      <div className="px-4 pb-4 pt-2 sm:px-8 sm:pb-6">
        <div className="mx-auto max-w-[760px]">
          <Composer
            placeholder={hasMessages ? "Ask a follow-up question" : "Ask an open research question"}
            disabled={busy}
            busy={busy}
            onSend={(t) => send(t)}
            format={outputFormat}
            onFormatChange={chooseFormat}
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
