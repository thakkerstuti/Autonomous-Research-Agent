"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useUiStore } from "@/lib/store";
import { useAgentStream } from "@/lib/use-agent-stream";
import { ChatMessage, Mode } from "@/lib/types";
import { ChatEmptyState } from "@/components/chat/chat-empty-state";
import { MessageBubble } from "@/components/chat/message-bubble";
import { ChatInputBar } from "@/components/chat/chat-input-bar";
import { PdfViewer } from "@/components/paper/pdf-viewer";

const SAMPLE_PDF_URL = "https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/basicapi.pdf";

const copy: Record<Mode, { title: string; heading: string; placeholder: string; chips: string[] }> = {
  research: {
    title: "Research Mode",
    heading: "Where should we start?",
    placeholder: "Ask an open-ended question…",
    chips: ["Compare two technologies", "Is a claim actually true?", "What does the evidence say about X?"],
  },
  paper: {
    title: "Paper Study Mode",
    heading: "What paper should we study?",
    placeholder: "Paste a title, link, or drop a PDF…",
    chips: ["Attention Is All You Need", "A paper I'm stuck on", "Summarize the methodology first"],
  },
};

export function ChatView({ mode }: { mode: Mode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const resumeQuestion = searchParams.get("session") ? "Resumed session" : null;

  const { chatHistories, appendMessage, updateMessage, resetHistory } = useUiStore();
  const messages = chatHistories[mode];
  const { start } = useAgentStream();
  const bodyRef = useRef<HTMLDivElement>(null);
  const resumedRef = useRef(false);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // History/Dashboard "resume" links land here with ?session=<id> — show that
  // conversation immediately instead of the empty state.
  useEffect(() => {
    if (resumeQuestion && !resumedRef.current && messages.length === 0) {
      resumedRef.current = true;
      send(resumeQuestion, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeQuestion]);

  function send(text: string, isResume = false) {
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", text, status: "done" };
    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = { id: assistantId, role: "assistant", status: "pending" };

    if (isResume) {
      resetHistory(mode, [userMsg, assistantMsg]);
    } else {
      appendMessage(mode, userMsg);
      appendMessage(mode, assistantMsg);
    }

    const steps: { label: string; detail: string }[] = [];

    start(mode, text, {
      onEvent: (event) => {
        if (event.type === "step" && event.label && event.detail) {
          steps.push({ label: event.label, detail: event.detail });
          updateMessage(mode, assistantId, { status: "streaming", steps: [...steps] });
        }
        if (event.type === "sources" && event.sources) {
          steps.push({ label: event.label ?? "Reviewing sources", detail: `${event.sources.length} sources reviewed` });
          updateMessage(mode, assistantId, { status: "streaming", steps: [...steps], sources: event.sources });
        }
        if (event.type === "done") {
          updateMessage(mode, assistantId, { status: "done", answer: event.answer });
        }
      },
      onDone: () => {},
    });
  }

  const c = copy[mode];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line px-6 py-4">
        <button
          onClick={() => router.push("/dashboard")}
          aria-label="Back to dashboard"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-ink-soft hover:text-ink active:scale-90"
        >
          <ArrowLeft size={15} />
        </button>
        <span className="text-sm font-medium">{c.title}</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div ref={bodyRef} className="flex-1 overflow-y-auto px-7 py-7">
          {messages.length === 0 ? (
            <ChatEmptyState heading={c.heading} chips={c.chips} onPick={(text) => send(text)} />
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-6">
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
            </div>
          )}
        </div>

        {mode === "paper" && messages.some((m) => m.answer) && (
          <div className="w-[360px] flex-shrink-0 border-l border-line p-4">
            <PdfViewer fileUrl={SAMPLE_PDF_URL} />
          </div>
        )}
      </div>

      <ChatInputBar placeholder={c.placeholder} onSend={(text) => send(text)} />
    </div>
  );
}
