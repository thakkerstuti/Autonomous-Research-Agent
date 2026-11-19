"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, ArrowUpRight, Loader2, X } from "lucide-react";
import { ChatSource, mergeTimeline } from "@/lib/chat-stream";
import { MODE_LABEL, ResearchDocument, ResearchRun, getThread, getThreadMessages, streamChat } from "@/lib/research-runs";
import { ThinkingMark } from "./thinking-mark";
import { AddToPaperButton, ChatError, ChatMarkdown, ChatSources } from "./chat-answer";

/**
 * The research conversation, beside the paper. It is the same conversation as on the Research page
 * (same thread, same saved messages): ask about the paper, ask for explanations, or move to a related
 * topic. Messages are answered with this paper's research run as context.
 */

type Item =
  | { kind: "run"; key: string; run: ResearchRun }
  | { kind: "chat"; key: string; question: string; answer: string; sources: ChatSource[]; usedWebSearch: boolean;
      state: "pending" | "streaming" | "done" | "error"; stage?: string; error?: string;
      messageId?: string; sessionId?: string };

export function ConversationPanel({ threadId, sessionId, onClose, documentId, beforeAdd, onAdded }: {
  threadId: string;
  sessionId: string;
  onClose: () => void;
  /** This paper: answers from its research session can be added to it. */
  documentId?: string;
  beforeAdd?: () => string | null;
  onAdded?: (doc: ResearchDocument) => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = !!items?.some((i) => i.kind === "chat" && (i.state === "pending" || i.state === "streaming"));

  useEffect(() => {
    let active = true;
    Promise.all([getThread(threadId), getThreadMessages(threadId)])
      .then(([thread, messages]) => {
        if (!active) return;
        setItems(mergeTimeline(thread.turns, messages).map((t): Item =>
          t.kind === "run"
            ? { kind: "run", key: t.run.session_id, run: t.run }
            : { kind: "chat", key: t.user.id, question: t.user.content, answer: t.answer?.content ?? "", sources: t.answer?.sources ?? [],
                usedWebSearch: !!t.answer?.used_web_search, state: t.answer ? "done" : "error", error: t.answer ? undefined : "This question wasn't answered.",
                messageId: t.answer?.id, sessionId: t.answer?.session_id ?? t.user.session_id }
        ));
      })
      .catch(() => active && setLoadError("Couldn't load the conversation."));
    return () => { active = false; };
  }, [threadId]);

  // Keep the newest message in view
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  function patch(key: string, change: Partial<Extract<Item, { kind: "chat" }>>) {
    setItems((list) => list?.map((i) => (i.key === key && i.kind === "chat" ? { ...i, ...change } : i)) ?? list);
  }

  async function ask(question: string, key = crypto.randomUUID(), retry = false) {
    if (!question.trim() || busy) return;
    const fresh = { answer: "", sources: [] as ChatSource[], usedWebSearch: false, state: "pending" as const, stage: "Understanding your question", error: undefined };
    if (retry) patch(key, fresh);
    else setItems((list) => [...(list ?? []), { kind: "chat", key, question, ...fresh }]);
    let streamed = "";
    try {
      const result = await streamChat(sessionId, question, {
        onStatus: (_s, label) => patch(key, { stage: label }),
        onSources: (sources, usedWebSearch) => patch(key, { sources, usedWebSearch }),
        onDelta: (piece) => {
          streamed += piece;
          patch(key, { answer: streamed, state: "streaming" });
        },
      });
      patch(key, { answer: result.answer.content, sources: result.answer.sources ?? [], usedWebSearch: result.answer.used_web_search,
                   state: "done", stage: undefined, messageId: result.answer.id, sessionId });
    } catch (e: any) {
      patch(key, { state: "error", error: e?.message || "The answer couldn't be completed.", stage: undefined });
    }
  }

  function submit() {
    const q = value.trim();
    if (!q || busy) return;
    setValue("");
    void ask(q);
  }

  return (
    <aside className="flex h-full min-h-0 flex-col bg-bg" aria-label="Research conversation">
      <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-line px-4">
        <span className="text-[13.5px] font-semibold text-ink">Conversation</span>
        <Link href={`/research?thread=${threadId}`} className="ml-1 inline-flex items-center gap-0.5 text-[12px] text-ink-faint hover:text-accent">
          Open in Research <ArrowUpRight size={12} />
        </Link>
        <div className="flex-1" />
        <button onClick={onClose} aria-label="Close the conversation" className="pressable flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint hover:bg-surface2 hover:text-ink">
          <X size={16} />
        </button>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {loadError && <p className="text-[13.5px] text-ink-soft">{loadError}</p>}
        {!items && !loadError && (
          <div className="space-y-3" aria-hidden>
            <div className="ml-auto h-9 w-3/4 animate-pulse rounded-2xl bg-ink/[0.06]" />
            <div className="h-20 animate-pulse rounded-xl bg-ink/[0.06]" />
          </div>
        )}
        <div className="flex flex-col gap-7">
          {items?.map((i) =>
            i.kind === "run" ? (
              <div key={i.key} className="rounded-xl border border-line px-3.5 py-3">
                <p className="text-[11.5px] text-ink-faint">{MODE_LABEL[i.run.output_format] ?? "Research"}</p>
                <p className="mt-0.5 text-[13.5px] font-medium leading-snug text-ink">{i.run.research_question}</p>
              </div>
            ) : (
              <div key={i.key} className="flex flex-col gap-3">
                <div className="ml-auto max-w-[88%] whitespace-pre-wrap rounded-[16px] bg-surface3 px-3.5 py-2 text-[14px] leading-relaxed text-ink">{i.question}</div>
                <div className="flex gap-2.5">
                  <ThinkingMark size={18} active={i.state === "pending" || i.state === "streaming"} className="mt-[3px]" />
                  <div className="min-w-0 flex-1 text-[14px] [&_.chat-prose]:text-[15px]">
                    {i.state === "error" ? (
                      <ChatError message={i.error || "The answer couldn't be completed."} onRetry={() => ask(i.question, i.key, true)} busy={busy} />
                    ) : (
                      <>
                        {!i.answer && <p className="thinking-text text-[14px] text-ink-soft">{i.stage || "Thinking"}</p>}
                        {i.answer && <ChatMarkdown text={i.answer} sources={i.sources} />}
                        {i.state === "done" && documentId && i.messageId && i.sessionId === sessionId && i.answer && (
                          <div className="mt-1.5">
                            <AddToPaperButton documentId={documentId} messageId={i.messageId} beforeAdd={beforeAdd} onAdded={onAdded} showOpenLink={false} />
                          </div>
                        )}
                        {i.state === "done" && <ChatSources sources={i.sources} usedWebSearch={i.usedWebSearch} />}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          )}
        </div>
        {items && !items.some((i) => i.kind === "chat") && (
          <p className="mt-6 text-[13px] leading-relaxed text-ink-faint">
            Ask about this paper (“explain the methodology more simply”, “what are the main limitations?”) or explore a related topic.
          </p>
        )}
      </div>

      <div className="flex-shrink-0 border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-[14px] bg-surface px-3 py-2 shadow-sm focus-within:shadow-panel">
          <textarea
            ref={inputRef}
            rows={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask about the paper, or a related topic"
            aria-label="Ask about the paper, or a related topic"
            className="block max-h-[160px] min-h-[36px] flex-1 resize-none bg-transparent py-1.5 text-[14px] leading-[1.5] text-ink outline-none placeholder:text-ink-faint"
          />
          <button
            onClick={submit}
            disabled={!value.trim() || busy}
            aria-label="Send"
            className="pressable mb-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-primary text-on-primary disabled:opacity-25"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={15} />}
          </button>
        </div>
      </div>
    </aside>
  );
}
