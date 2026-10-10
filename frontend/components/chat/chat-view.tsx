"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useUiStore } from "@/lib/store";
import { ChatMessage, Mode } from "@/lib/types";
import { ChatEmptyState } from "@/components/chat/chat-empty-state";
import { MessageBubble } from "@/components/chat/message-bubble";
import { ChatInputBar } from "@/components/chat/chat-input-bar";

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

  const { chatHistories, appendMessage, updateMessage } = useUiStore();
  const messages = chatHistories[mode];
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", text, status: "done" };
    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = { id: assistantId, role: "assistant", status: "pending" };

    appendMessage(mode, userMsg);
    appendMessage(mode, assistantMsg);

    updateMessage(mode, assistantId, { 
      status: "pending", 
      steps: [{ label: "Starting", detail: "Initializing connection..." }] 
    });
      
      const wakeTimer = setTimeout(() => {
        updateMessage(mode, assistantId, { 
          status: "pending", 
          steps: [{ label: "Waking the server", detail: "This can take up to a minute..." }] 
        });
      }, 4000);

      try {
        const { apiClient, ApiError } = await import("@/lib/api");
        const res = await apiClient<any>("/research", {
          method: "POST",
          body: JSON.stringify({ question: text }),
        });
        clearTimeout(wakeTimer);

        const { adaptResearchResponseToSteps } = await import("@/lib/adapters");
        const events = adaptResearchResponseToSteps(res);
        
        let finalSteps: { label: string; detail: string }[] = [];
        let finalSources;
        let finalAnswer = "";

        events.forEach((ev) => {
          if (ev.type === "step" && ev.label && ev.detail) {
            finalSteps.push({ label: ev.label, detail: ev.detail });
          } else if (ev.type === "sources" && ev.sources) {
            finalSteps.push({ label: ev.label ?? "Reviewing sources", detail: `${ev.sources.length} sources reviewed` });
            finalSources = ev.sources;
          } else if (ev.type === "done") {
            finalAnswer = ev.answer ?? "";
          }
        });

        updateMessage(mode, assistantId, { 
          status: "done", 
          steps: finalSteps, 
          sources: finalSources, 
          answer: finalAnswer 
        });
      } catch (err: any) {
        clearTimeout(wakeTimer);
        let errorMsg = err.message || "Network failure";
        if (err.status === 400) {
          errorMsg = `Invalid research question: ${err.message}`;
        } else if (err.status === 503) {
          errorMsg = `Service unavailable (Gemini quota or rate limit): ${err.message}`;
        }
        updateMessage(mode, assistantId, { 
          status: "done", 
          answer: `🚨 **Error:** ${errorMsg} \n\n[ Retry ] (click to send again)`, 
        });
      }
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
      </div>

      <ChatInputBar placeholder={c.placeholder} onSend={(text) => send(text)} />
    </div>
  );
}
