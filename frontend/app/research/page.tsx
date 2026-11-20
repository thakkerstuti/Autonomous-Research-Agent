"use client";

import { Suspense, useState, useRef, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, Copy, Check, RotateCcw, AlertCircle, ChevronDown, Info, Layers, FileText, Zap } from "lucide-react";
import { useUiStore } from "@/lib/store";
import { ChatMessage, OutputFormat } from "@/lib/types";
import { buildResearchView, ResearchView } from "@/lib/research-view";
import { Composer } from "@/components/research/composer";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { ReportBody, SourceRow } from "@/components/research/report-body";
import { WorkingFlow, formatDuration } from "@/components/research/working-flow";
import { PaperCard } from "@/components/research/paper-card";
import { AskQuestionsWhenOff, ThinkWhileYouWait } from "@/components/research/think-while-you-wait";
import { VoiceBar } from "@/components/research/voice-bar";
import { useVoiceBar } from "@/lib/voice-bar";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { readWorkspace, updateWorkspace } from "@/lib/workspace";
import { queryClient } from "@/lib/query-client";
import { MODE_LABEL, ResearchDocument, ResearchRun, getRun, getThread, getThreadMessages, startModeRun, startRun, streamChat } from "@/lib/research-runs";
import { modeCommand, requestSubject } from "@/lib/mode-intent";
import { ChatMessageDto, mergeTimeline } from "@/lib/chat-stream";
import { AddToPaperButton, ChatError, ChatMarkdown, ChatSources } from "@/components/research/chat-answer";

const FORMATS: OutputFormat[] = ["quick", "detailed", "full"];

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

/** After an answer: the same question in another mode, sent as structured data (not a chat message). */
function ModeActions({ run, busy, onAction }: { run: ResearchRun; busy: boolean; onAction: (basedOn: string, mode: OutputFormat) => void }) {
  const next: { mode: OutputFormat; label: string; icon: typeof Layers }[] =
    run.output_format === "quick"
      ? [{ mode: "detailed", label: "Detailed analysis", icon: Layers }, { mode: "full", label: "Research paper", icon: FileText }]
      : run.output_format === "detailed"
      ? [{ mode: "full", label: "Research paper", icon: FileText }]
      : [];
  if (!next.length) return null;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2" role="group" aria-label="Research this question again in another mode">
      <span className="text-[12.5px] text-ink-faint">Go further:</span>
      {next.map(({ mode, label, icon: Icon }) => (
        <button
          key={mode}
          onClick={() => onAction(run.session_id, mode)}
          disabled={busy}
          className="pressable inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-medium text-ink hover:border-line-hover disabled:opacity-40"
          title={mode === "full" ? "A full investigation of this question, written up as an editable research paper" : "An in-depth analysis of this question"}
        >
          <Icon size={13} /> {label}
        </button>
      ))}
    </div>
  );
}

/** After a question is sent: how should it be answered? Nothing runs until one is chosen. */
function ChoiceEntry({ entry, inConversation, suggested, onChoose, onCancel }: {
  entry: EntryData;
  inConversation: boolean;
  suggested: OutputFormat;
  onChoose: (f: OutputFormat) => void;
  onCancel: () => void;
}) {
  const text = entry.q.text ?? "";
  const shortForResearch = text.trim().length < 10; // a research run needs a real question; a quick follow-up doesn't
  const options: { format: OutputFormat; title: string; hint: string; time: string; icon: typeof Zap }[] = [
    {
      format: "quick", icon: Zap, title: "Quick answer", time: inConversation ? "Seconds" : "About a minute",
      hint: inConversation ? "A direct answer that continues this conversation, with sources" : "A concise answer with its key evidence and citations",
    },
    { format: "detailed", icon: Layers, title: "Detailed analysis", time: "1–2 minutes", hint: "An in-depth answer: findings, comparisons, conflicting evidence" },
    { format: "full", icon: FileText, title: "Research paper", time: "A few minutes", hint: "A full investigation written up as an editable paper, with PDF" },
  ];
  // A short message can still be a quick follow-up in a conversation, but not a research run
  const unavailable = (f: OutputFormat) => shortForResearch && (f !== "quick" || !inConversation);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    const first = unavailable(suggested) ? "quick" : suggested;
    refs.current[first]?.focus({ preventScroll: true }); // Enter accepts the type chosen last time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggested]);

  return (
    <article className="flex scroll-mt-6 flex-col gap-6">
      <div className="animate-msg-in ml-auto max-w-[min(85%,600px)] whitespace-pre-wrap rounded-[20px] bg-surface3 px-4 py-2.5 text-[15.5px] leading-relaxed text-ink">
        {text}
      </div>
      <div
        className="flex gap-3.5"
        onKeyDown={(e) => {
          const pick = options[Number(e.key) - 1]; // 1, 2, 3 choose; Esc cancels
          if (pick && !unavailable(pick.format)) onChoose(pick.format);
          if (e.key === "Escape") onCancel();
        }}
      >
        <ThinkingMark className="mt-[3px]" />
        <div className="animate-msg-in min-w-0 flex-1">
          <p className="text-[15px] text-ink">How should I answer this?</p>
          <div role="group" aria-label="Choose how to answer" className="mt-3 grid gap-2 sm:grid-cols-3">
            {options.map(({ format, title, hint, time, icon: Icon }, i) => {
              const disabled = unavailable(format);
              return (
                <button
                  key={format}
                  ref={(el) => { refs.current[format] = el; }}
                  onClick={() => onChoose(format)}
                  disabled={disabled}
                  className={cn(
                    "pressable group flex flex-col items-start gap-1.5 rounded-2xl border bg-surface p-3.5 text-left transition-[border-color,box-shadow] duration-150",
                    "hover:border-line-hover hover:shadow-sm focus-visible:border-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45",
                    format === suggested ? "border-accent-line" : "border-line"
                  )}
                >
                  <span className="flex w-full items-center justify-between">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent"><Icon size={15} /></span>
                    <span className="mono hidden text-[11px] text-ink-faint sm:inline">{i + 1}</span>
                  </span>
                  <span className="text-[14px] font-medium text-ink">{title}</span>
                  <span className="text-[12.5px] leading-snug text-ink-soft">{hint}</span>
                  <span className="mt-auto pt-1 text-[11.5px] text-ink-faint">{time}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 text-[12.5px] text-ink-faint">
            {shortForResearch && <span>Research needs a question of at least 10 characters.</span>}
            <button onClick={onCancel} className="rounded hover:text-ink">Cancel</button>
          </div>
        </div>
      </div>
    </article>
  );
}

/** One chat exchange in the conversation: the question, then the answer as it streams. */
function ChatEntry({ entry, onRetry, busy, paper, onAddedToPaper }: {
  entry: EntryData;
  onRetry: (entry: EntryData) => void;
  busy: boolean;
  /** The ready research paper of this answer's session, if there is one ("Add to paper"). */
  paper?: { id: string } | null;
  onAddedToPaper?: (sessionId: string, doc: ResearchDocument) => void;
}) {
  const { q, a } = entry;
  const chat = a?.chat;
  const working = a?.status === "pending" || a?.status === "streaming";
  const text = a?.answer ?? "";
  return (
    <article className="flex scroll-mt-6 flex-col gap-6">
      <div className="animate-msg-in ml-auto max-w-[min(85%,600px)] whitespace-pre-wrap rounded-[20px] bg-surface3 px-4 py-2.5 text-[15.5px] leading-relaxed text-ink">
        {q.text}
      </div>
      <div className="flex gap-3.5">
        <ThinkingMark active={working} className="mt-[3px]" />
        <div className="min-w-0 flex-1" aria-live="polite" aria-busy={working}>
          {chat?.error ? (
            <ChatError message={chat.error} onRetry={() => onRetry(entry)} busy={busy} />
          ) : (
            <>
              {working && !text && (
                <p className="flex items-center gap-2 text-[15px] text-ink-soft">
                  <span className="thinking-text">{chat?.stageLabel || "Thinking"}</span>
                </p>
              )}
              {text && <ChatMarkdown text={text} sources={chat?.sources ?? []} />}
              {working && text && chat?.stageLabel === "Searching the web" && (
                <p className="mt-2 text-[13px] text-ink-faint">Searching the web…</p>
              )}
              {!working && chat && (
                <div className="mt-2 flex flex-wrap items-start gap-x-4">
                  <CopyButton text={text} />
                  {paper && chat.messageId && text && (
                    <AddToPaperButton
                      documentId={paper.id}
                      messageId={chat.messageId}
                      onAdded={(doc) => onAddedToPaper?.(chat.sessionId, doc)}
                    />
                  )}
                  <ChatSources sources={chat.sources} usedWebSearch={chat.usedWebSearch} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function Entry({ entry, onRetry, onAction, onAsk, busy }: {
  entry: EntryData;
  onRetry: (q: string, format?: OutputFormat, basedOn?: string | null) => void;
  onAction: (basedOn: string, mode: OutputFormat) => void;
  /** A suggested next question from "Your thinking vs the evidence" goes into the follow-up box. */
  onAsk: (question: string) => void;
  busy: boolean;
}) {
  const { q, a } = entry;
  const run = a?.run;
  const view = a?.view;
  const mode: OutputFormat = run?.output_format ?? a?.mode ?? "quick";
  const pending = !a || a.status === "pending" || run?.status === "in_progress";
  const failed = run?.status === "failed" || !!a?.answer?.startsWith("**Error:**");
  const doc = run?.document ?? null;
  // A Research paper turn's result is the document itself (shown as a card), with no short answer in front of it
  const isPaperTurn = mode === "full" && !!doc;
  const body = isPaperTurn ? "" : run?.report ?? view?.report ?? a?.answer ?? "";
  const duration = run?.stats?.duration_seconds;
  const modeRequest = !!(run?.based_on || q.basedOnQuestion);

  return (
    <article className="flex scroll-mt-6 flex-col gap-7">
      <div className="animate-msg-in ml-auto flex max-w-[min(85%,600px)] flex-col items-end gap-1.5">
        {modeRequest ? (
          <div className="rounded-[20px] bg-surface3 px-4 py-2.5 text-ink">
            <div className="flex items-center gap-1.5 text-[14.5px] font-medium">
              {mode === "full" ? <FileText size={14} /> : <Layers size={14} />} {MODE_LABEL[mode]}
            </div>
            <div className="mt-0.5 text-[13.5px] leading-relaxed text-ink-soft">of “{q.basedOnQuestion ?? q.text}”</div>
          </div>
        ) : (
          <div className="whitespace-pre-wrap rounded-[20px] bg-surface3 px-4 py-2.5 text-[15.5px] leading-relaxed text-ink">{q.text}</div>
        )}
        {(run || a?.mode) && !modeRequest && <span className="px-1 text-[11.5px] text-ink-faint">{MODE_LABEL[mode]}</span>}
      </div>

      <div className="flex gap-3.5">
        <ThinkingMark active={pending && !failed} className="mt-[3px]" />
        <div className="min-w-0 flex-1">
          {pending && !failed ? (
            <>
              <WorkingFlow progress={run?.progress} status="in_progress" mode={mode} />
              {run && <AskQuestionsWhenOff className="mt-4" />}
            </>
          ) : failed ? (
            <div className="animate-msg-in">
              <p className="text-[15.5px] text-ink">I couldn&apos;t finish this one.</p>
              <p className="mt-1 break-words text-[14px] text-ink-soft">
                {run?.error || a?.answer?.replace(/^\*\*Error:\*\*\s*/, "") || "Something went wrong."}
              </p>
              <button
                onClick={() => q.text && onRetry(q.basedOnQuestion ?? q.text, mode, run?.based_on)}
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
              {isPaperTurn ? (
                <PaperCard sessionId={run!.session_id} initial={doc} />
              ) : (
                <>
                  <ReportBody markdown={body} view={view} />
                  {run?.needs_review && (
                    <p className="mt-4 flex items-start gap-2 text-[13px] text-ink-faint">
                      <Info size={13} className="mt-0.5 flex-shrink-0" /> Some statements rest on limited evidence; check the cited sources before relying on them.
                    </p>
                  )}
                </>
              )}

              {run && <ModeActions run={run} busy={busy} onAction={onAction} />}

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
                {!isPaperTurn && <CopyButton text={body} />}
                {duration != null && <span className="text-[12.5px] text-ink-faint">Researched in {formatDuration(Math.round(duration))}</span>}
              </div>
              <div className="mt-1 flex flex-col items-start gap-0.5">
                {view && <SourcesToggle view={view} />}
                {run && <WorkingFlow progress={run.progress} status={run.status} mode={mode} collapsible />}
              </div>
            </div>
          )}
          {/* Think while you wait: one card per research run, kept mounted from "working" to "done" */}
          {run && !failed && (
            <ThinkWhileYouWait
              target={{ kind: "research", id: run.session_id }}
              running={pending}
              evidence={view?.evidence}
              onAsk={onAsk}
              surface="composer"
              className={pending ? "mt-5" : "mt-6"}
            />
          )}
        </div>
      </div>
    </article>
  );
}

/* ───────────── The conversation, from the server ───────────── */

function turnMessages(run: ResearchRun): ChatMessage[] {
  return [
    {
      id: `q-${run.session_id}`, role: "user", text: run.research_question, status: "done",
      ...(run.based_on ? { basedOnQuestion: run.research_question } : {}),
    },
    {
      id: `a-${run.session_id}`,
      role: "assistant",
      status: run.status === "in_progress" ? "pending" : "done",
      mode: run.output_format,
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

/** A saved chat exchange as the two messages the page shows. */
function chatTurnMessages(user: ChatMessageDto, answer: ChatMessageDto | null): ChatMessage[] {
  const sessionId = user.session_id ?? answer?.session_id ?? "";
  return [
    { id: `cq-${user.id}`, role: "user", text: user.content, status: "done", chat: { sessionId, sources: [], usedWebSearch: false, createdAt: user.created_at } },
    {
      id: `ca-${user.id}`, role: "assistant", status: "done", answer: answer?.content ?? "",
      chat: answer
        ? { sessionId, sources: answer.sources ?? [], usedWebSearch: answer.used_web_search, createdAt: answer.created_at, messageId: answer.id }
        : { sessionId, sources: [], usedWebSearch: false, error: "This question wasn't answered." },
    },
  ];
}

/** The whole conversation: research runs and chat exchanges, in the order they happened. */
async function loadThread(threadId: string): Promise<ChatMessage[] | null> {
  const [thread, messages] = await Promise.all([getThread(threadId), getThreadMessages(threadId).catch(() => [] as ChatMessageDto[])]);
  if (!thread?.turns?.length) return null;
  thread.turns.filter((t) => t.status === "in_progress").forEach((t) => follow(t.session_id));
  return mergeTimeline(thread.turns, messages).flatMap((item) =>
    item.kind === "run" ? turnMessages(item.run) : chatTurnMessages(item.user, item.answer)
  );
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
  const sendingRef = useRef(false);
  const inFlight = messages.some((m) => m.role === "assistant" && (m.status === "pending" || m.status === "streaming"));
  const busy = sending || inFlight;
  const awaitingChoice = messages.some((m) => m.awaitingChoice); // a question waiting for "how should I answer?"
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("detailed"); // the answer type chosen last
  const [loadError, setLoadError] = useState<string | null>(null);
  const [composerDraft, setComposerDraft] = useState<{ text: string; n: number } | null>(null); // a suggested next question
  const voiceTalking = useVoiceBar((s) => s.owner !== null); // CogNexa is talking: the message bar is its voice

  /** Busy right now, read from the store (not the last render): a choice and its run happen in one go. */
  function busyNow() {
    return sendingRef.current || useUiStore.getState().chatHistories.research.some(
      (m) => m.role === "assistant" && (m.status === "pending" || m.status === "streaming"));
  }
  const bodyRef = useRef<HTMLDivElement>(null);

  // The conversation's thread: every follow-up joins it
  const threadId = useMemo(
    () => messages.find((m) => m.role === "assistant" && m.run?.thread_id)?.run?.thread_id ?? null,
    [messages]
  );
  // The research the chat continues from: the conversation's latest finished run
  const anchorId = useMemo(() => {
    const runs = messages.map((m) => m.run).filter((r): r is ResearchRun => !!r);
    return [...runs].reverse().find((r) => r.status !== "in_progress" && r.status !== "failed")?.session_id ?? null;
  }, [messages]);
  // Research runs with a ready paper: their chat answers can be added to it
  const papersBySession = useMemo(() => {
    const out = new Map<string, { id: string }>();
    messages.forEach((m) => {
      const doc = m.run?.document;
      if (m.run && doc && doc.status === "ready") out.set(m.run.session_id, { id: doc.id });
    });
    return out;
  }, [messages]);

  /** After "Add to paper": the run's paper card shows the new version (the conversation stays where it is). */
  function paperUpdated(sessionId: string, doc: ResearchDocument) {
    const holder = useUiStore.getState().chatHistories.research.find((m) => m.run?.session_id === sessionId && m.run.document);
    if (!holder?.run?.document) return;
    updateMessage("research", holder.id, {
      run: { ...holder.run, document: { ...holder.run.document, current_version: doc.current_version, edited: doc.edited, updated_at: doc.updated_at } },
    });
  }
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
  // (not for the first one: the page title above it stays in view)
  const prevCount = useRef(entries.length);
  useEffect(() => {
    if (entries.length > prevCount.current && entries.length > 1) {
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

  /**
   * The address decides what is shown:
   * - /research?thread=… (Recent research, History): that conversation. (The address gets the thread
   *   when a conversation starts, so a reload keeps it.)
   * - /research ("Research", "New research"): a new, empty conversation.
   * - /research?q=… (a question from the Overview): asked once, then the address becomes /research.
   */
  const previousAddress = useRef<string | null>(null);
  useEffect(() => {
    const address = threadParam ? `thread:${threadParam}` : sessionParam ? `session:${sessionParam}` : initialQuery ? "ask" : "new";
    const before = previousAddress.current;
    previousAddress.current = address;
    const current = useUiStore.getState().chatHistories.research;

    if (threadParam || sessionParam) {
      const shown = current.find((m) => m.run?.thread_id)?.run?.thread_id;
      if (threadParam && shown === threadParam) {
        // Already on screen (this conversation just started, or we came back to it): keep following it
        current.forEach((m) => m.run?.status === "in_progress" && follow(m.run.session_id));
        return;
      }
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
    }
    if (initialQuery || before === "ask") return; // the Overview's question is being asked: keep it
    // "Research" / "New research": start fresh (earlier conversations stay in Recent research and History)
    resetHistory("research", []);
    setLoadError(null);
    updateWorkspace((w) => ({ ...w, research: { format: w.research?.format, threadId: null } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadParam, sessionParam, initialQuery]);

  /** The latest finished question of this conversation (what a typed "give detailed analysis" refers to). */
  function latestQuestionTurn(): ResearchRun | null {
    const runs = useUiStore.getState().chatHistories.research.map((m) => m.run).filter((r): r is ResearchRun => !!r);
    return [...runs].reverse().find((r) => r.status !== "in_progress" && r.status !== "failed") ?? null;
  }

  /**
   * Starts a run. With basedOn, it is an earlier question again in another mode: the request carries
   * output_format + based_on (the server takes the question from that session), never typed text.
   */
  async function start(format: OutputFormat, input: { text: string } | { basedOn: string; question: string }) {
    if (busyNow()) return;
    sendingRef.current = true;
    setSending(true);
    setLoadError(null);
    const tempId = crypto.randomUUID();
    const isMode = "basedOn" in input;
    appendMessage("research", {
      id: `q-${tempId}`, role: "user", status: "done",
      text: isMode ? input.question : input.text,
      ...(isMode ? { basedOnQuestion: input.question } : {}),
    });
    appendMessage("research", { id: `a-${tempId}`, role: "assistant", status: "pending", mode: format, startedAt: Date.now() });
    try {
      const run = isMode ? await startModeRun(input.basedOn, format) : await startRun(input.text, format, threadId);
      // Swap the placeholders for the server's ids, then follow the run
      const store = useUiStore.getState();
      store.resetHistory(
        "research",
        store.chatHistories.research.map((m) =>
          m.id === `q-${tempId}` ? { ...m, id: `q-${run.session_id}` } : m.id === `a-${tempId}` ? turnMessages(run)[1] : m
        )
      );
      updateWorkspace((w) => ({ ...w, research: { ...(w.research ?? {}), threadId: run.thread_id, sessionIds: [], pending: null } }));
      // The conversation now has an address: a reload reopens it, and "Research" / "New research" leave it
      if (new URLSearchParams(window.location.search).get("thread") !== run.thread_id) {
        window.history.replaceState(null, "", `/research?thread=${run.thread_id}`);
      }
      follow(run.session_id);
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    } catch (err: any) {
      let msg = err?.message || "Network failure";
      if (err?.status === 503) msg = `The research service is unavailable right now: ${msg}`;
      updateMessage("research", `a-${tempId}`, { status: "done", answer: `**Error:** ${msg}` });
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  function runMode(basedOn: string, format: OutputFormat) {
    const turn = useUiStore.getState().chatHistories.research.find((m) => m.run?.session_id === basedOn)?.run;
    void start(format, { basedOn, question: turn?.research_question ?? "" });
  }

  /**
   * A chat message in the conversation, answered by streaming. With `reuse`, an earlier failed
   * exchange is answered again in place (nothing was saved for it).
   */
  async function sendChat(text: string, sessionId: string, reuse?: { qId: string; aId: string }) {
    if (busyNow()) return;
    setLoadError(null);
    const tempId = crypto.randomUUID();
    const qId = reuse?.qId ?? `cq-${tempId}`;
    const aId = reuse?.aId ?? `ca-${tempId}`;
    const fresh = { sessionId, sources: [], usedWebSearch: false, stageLabel: "Understanding your question" };
    if (reuse) {
      updateMessage("research", aId, { status: "pending", answer: "", chat: fresh });
    } else {
      appendMessage("research", { id: qId, role: "user", text, status: "done", chat: { sessionId, sources: [], usedWebSearch: false } });
      appendMessage("research", { id: aId, role: "assistant", status: "pending", answer: "", chat: fresh, startedAt: Date.now() });
    }
    const patchChat = (patch: Partial<NonNullable<ChatMessage["chat"]>>, more: Partial<ChatMessage> = {}) => {
      const current = useUiStore.getState().chatHistories.research.find((m) => m.id === aId);
      updateMessage("research", aId, { ...more, chat: { ...(current?.chat ?? fresh), ...patch } });
    };
    let streamed = "";
    try {
      const result = await streamChat(sessionId, text, {
        onStatus: (_stage, label) => patchChat({ stageLabel: label }),
        onSources: (sources, usedWebSearch) => patchChat({ sources, usedWebSearch }),
        onDelta: (piece) => {
          streamed += piece;
          updateMessage("research", aId, { status: "streaming", answer: streamed });
        },
      });
      // The saved answer is the final word (citations checked once more on the server)
      patchChat(
        { sources: result.answer.sources ?? [], usedWebSearch: result.answer.used_web_search, stageLabel: undefined, createdAt: result.answer.created_at, messageId: result.answer.id },
        { status: "done", answer: result.answer.content }
      );
    } catch (err: any) {
      patchChat({ error: err?.message || "The answer couldn't be completed. Please try again.", stageLabel: undefined }, { status: "done", answer: "" });
    }
  }

  function retryChat(entry: EntryData) {
    if (!entry.a?.chat || !entry.q.text) return;
    void sendChat(entry.q.text, entry.a.chat.sessionId, { qId: entry.q.id, aId: entry.a.id });
  }

  /**
   * Answers a question in the chosen way. Quick answer: once the conversation has a research result,
   * the conversational answer (it understands follow-ups, references and topic changes, and searches
   * the web when needed); before that, a quick research run. Detailed analysis and Research paper:
   * a research run in the same conversation (a follow-up is researched as the question it stands for).
   */
  function answerAs(text: string, format: OutputFormat) {
    chooseFormat(format);
    if (format === "quick" && anchorId) return void sendChat(text.trim(), anchorId);
    void start(format, { text });
  }

  /** The choice card: replaces the waiting question with the run or answer of the chosen type. */
  function choose(entry: EntryData, format: OutputFormat) {
    const text = entry.q.text ?? "";
    const store = useUiStore.getState();
    store.resetHistory("research", store.chatHistories.research.filter((m) => m.id !== entry.q.id && m.id !== entry.a?.id));
    answerAs(text, format);
  }

  function cancelChoice(entry: EntryData) {
    const store = useUiStore.getState();
    store.resetHistory("research", store.chatHistories.research.filter((m) => m.id !== entry.q.id && m.id !== entry.a?.id));
  }

  /**
   * The message box.
   * - The first question of a new conversation asks how to answer it (quick answer, detailed analysis
   *   or research paper), in the conversation.
   * - After that, every message simply continues the conversation (also when it was reopened from
   *   History). Asking for more depth is done in words: "give detailed analysis" or "generate a research
   *   paper" applies to the last question; "a research paper on quantum computing" researches what it names.
   * - "Try again" (format given) repeats the earlier choice.
   */
  function send(text: string, format?: OutputFormat, basedOn?: string | null) {
    if (!text.trim() || busy || awaitingChoice) return;
    if (basedOn) return runMode(basedOn, format ?? outputFormat); // "Try again" on a mode run
    if (format) return answerAs(text, format); // "Try again" on a question that failed
    const command = modeCommand(text);
    const last = latestQuestionTurn();
    if (command && last) {
      chooseFormat(command);
      if (requestSubject(text)) return void start(command, { text: text.trim() }); // e.g. "a research paper on X"
      return runMode(last.based_on ?? last.session_id, command);
    }
    if (anchorId) return void sendChat(text.trim(), anchorId); // an ongoing conversation: no choice to make
    const id = crypto.randomUUID();
    appendMessage("research", { id: `pq-${id}`, role: "user", text: text.trim(), status: "done", awaitingChoice: true });
    appendMessage("research", { id: `pa-${id}`, role: "assistant", status: "done", awaitingChoice: true });
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

  return (
    <div className="flex h-full flex-col">
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto">
        {loadError && (
          <p className="mx-auto mt-6 flex max-w-[760px] items-center gap-2 px-5 text-[13.5px] text-ink-soft sm:px-8">
            <AlertCircle size={14} className="text-warn" /> {loadError}
          </p>
        )}
        {!hasMessages ? (
          // A new conversation: the page title, as on Library and History; the message box stays at the bottom
          <div className="mx-auto max-w-[760px] px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
            <PageHeader
              className="animate-view-in"
              title="Research"
              description="Ask a question. CogNexa investigates it and answers with sources you can check."
            />
          </div>
        ) : (
          <div className="mx-auto flex max-w-[760px] flex-col gap-12 px-5 pb-16 pt-8 sm:px-8 sm:pt-10">
            <div className="-mb-4 flex items-center justify-between gap-3">
              <h1 className="font-display text-[24px] font-semibold leading-tight text-ink">Research</h1>
              <button
                onClick={() => {
                  resetHistory("research", []);
                  updateWorkspace((w) => ({ ...w, research: { format: w.research?.format, threadId: null } }));
                  if (threadParam || sessionParam) window.history.replaceState(null, "", "/research");
                }}
                disabled={busy}
                className="pressable flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-ink-soft hover:bg-surface2 hover:text-ink disabled:opacity-40"
              >
                <Plus size={14} /> New chat
              </button>
            </div>
            {entries.map((e) =>
              e.q.awaitingChoice ? (
                <ChoiceEntry
                  key={e.q.id}
                  entry={e}
                  inConversation={!!anchorId}
                  suggested={outputFormat}
                  onChoose={(f) => choose(e, f)}
                  onCancel={() => cancelChoice(e)}
                />
              ) : e.a?.chat || e.q.chat ? (
                <ChatEntry
                  key={e.q.id}
                  entry={e}
                  busy={busy}
                  onRetry={retryChat}
                  paper={e.a?.chat ? papersBySession.get(e.a.chat.sessionId) : null}
                  onAddedToPaper={paperUpdated}
                />
              ) : (
                <Entry key={e.q.id} entry={e} busy={busy} onRetry={send} onAction={runMode}
                  onAsk={(text) => setComposerDraft({ text, n: Date.now() })} />
              )
            )}
          </div>
        )}
      </div>

      <div className="px-4 pb-4 pt-2 sm:px-8 sm:pb-6">
        <div className="mx-auto max-w-[760px]">
          {voiceTalking ? <VoiceBar /> : <Composer
            placeholder={
              !hasMessages ? "Ask a question" : awaitingChoice ? "Choose how to answer above" : "Ask a follow-up, or something new"
            }
            disabled={busy || awaitingChoice}
            busy={busy}
            onSend={(t) => send(t)}
            draft={composerDraft}
          />}
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
