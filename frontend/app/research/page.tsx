"use client";

import { Suspense, useState, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Search, Lightbulb, RotateCcw } from "lucide-react";
import { useUiStore } from "@/lib/store";
import { ChatMessage, OutputFormat } from "@/lib/types";
import { MessageBubble } from "@/components/chat/message-bubble";
import { ChatInputBar } from "@/components/chat/chat-input-bar";

const CHIPS = [
  "Does AI actually help developers work faster?",
  "Compare attention mechanisms vs CNNs",
  "What does the evidence say about spaced repetition?",
  "Is there a replication crisis in psychology?",
];

const FORMATS: { value: OutputFormat; label: string }[] = [
  { value: "quick", label: "Quick answer" },
  { value: "detailed", label: "Detailed explanation" },
  { value: "full", label: "Full report" },
];

function FormatSelector({
  value,
  onChange,
}: {
  value: OutputFormat;
  onChange: (f: OutputFormat) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-line bg-surface/90 p-1 shadow-sm backdrop-blur-sm">
      {FORMATS.map((f) => (
        <button
          key={f.value}
          type="button"
          onClick={() => onChange(f.value)}
          className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
            value === f.value
              ? "bg-rose text-white shadow-sm"
              : "text-ink-soft hover:text-ink hover:bg-surface2"
          }`}
        >
          {f.label}
        </button>
      ))}
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
          Ask a question and CogNexa will search, verify sources and answer right here in the chat.
        </p>

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
            Follow-up questions continue in the same conversation. Change the report depth any time from the header.
          </p>
        </div>
      </div>
    </div>
  );
}

function ResearchPage() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");

  const { chatHistories, appendMessage, updateMessage, resetHistory } = useUiStore();
  const messages = chatHistories["research"];
  const [sending, setSending] = useState(false);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("full");
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest message
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Reopen an existing session into the chat if ?session= is present
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
          {
            id: `${sessionId}-q`,
            role: "user",
            text: data.research_question || "Saved session",
            status: "done",
          },
          {
            id: data.session_id || sessionId!,
            role: "assistant",
            status: "done",
            steps,
            sources,
            answer: answer || data.report || "No report found.",
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

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface/70 px-5 py-3 backdrop-blur-md">
        <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-blush">
          <Search size={14} className="text-rose" />
        </div>
        <span className="text-[14px] font-medium text-ink">Research</span>
        <div className="flex-1" />
        {hasMessages && <FormatSelector value={outputFormat} onChange={setOutputFormat} />}
        {hasMessages && (
          <button
            onClick={() => resetHistory("research", [])}
            disabled={sending}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-ink-soft hover:text-ink disabled:opacity-40"
          >
            <RotateCcw size={12} /> New chat
          </button>
        )}
      </div>

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto">
        {!hasMessages ? (
          <EmptyState onPick={send} outputFormat={outputFormat} onFormatChange={setOutputFormat} />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-7 sm:px-7">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </div>
        )}
      </div>

      <ChatInputBar
        placeholder={hasMessages ? "Ask a follow-up question…" : "Ask an open-ended research question…"}
        disabled={sending}
        onSend={send}
      />
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
