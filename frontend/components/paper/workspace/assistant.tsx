"use client";

/**
 * The research assistant for the open paper. Free questions search the whole
 * paper; quick actions work on exactly the pages the reader has open or ticked.
 * Every answer carries page citations whose quotes are checked against the text.
 */
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, BookOpenText, GitCompare, ListCollapse, PanelRightClose, ShieldCheck, ShieldQuestion, Sparkles } from "lucide-react";
import { apiClient } from "@/lib/api";
import { useAsksQuery, type AskEntry, type AssistantAction } from "@/lib/queries";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { cn } from "@/lib/utils";

export interface AssistantRequest {
  action: AssistantAction;
  pages?: number[];
  question?: string;
  selection?: string;
}

/** Shared by the reader (compare, explain selection) and the panel itself. */
export function useAssistant(paperId: string) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (req: AssistantRequest, label: string) => {
    if (running) return;
    setRunning(label);
    setError(null);
    try {
      const entry = await apiClient<AskEntry>(`/papers/${paperId}/ask`, {
        method: "POST",
        body: JSON.stringify({ action: req.action, pages: req.pages ?? [], question: req.question ?? "", selection: req.selection }),
      });
      queryClient.setQueryData<{ items: AskEntry[] }>(["paper-asks", paperId], (old) => ({ items: [...(old?.items ?? []), entry] }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The assistant couldn't answer. Please try again.");
    } finally {
      setRunning(null);
    }
  };
  return { running, error, run };
}

export type Assistant = ReturnType<typeof useAssistant>;

function Answer({ entry, onOpenPage }: { entry: AskEntry; onOpenPage: (p: number) => void }) {
  return (
    <article className="border-b border-line py-4">
      <p className="text-[13.5px] font-medium text-ink">{entry.question}</p>
      <div className={cn("report-prose chat-prose mt-1.5 text-[14px]", !entry.found && "text-ink-soft")}>
        <ReactMarkdown>{entry.answer}</ReactMarkdown>
      </div>
      {entry.citations.length > 0 && (
        <ul className="mt-2.5 grid gap-1.5">
          {entry.citations.map((c, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => onOpenPage(c.page)}
                title={`Open page ${c.page}`}
                className="group grid w-full grid-cols-[auto_1fr_auto] items-start gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] hover:bg-ink/[0.04]"
              >
                <span className="mono pt-px text-ink-soft group-hover:text-accent">p.{c.page}</span>
                <span className="italic leading-snug text-ink-soft">&ldquo;{c.quote}&rdquo;</span>
                <span title={c.verified ? "This exact text is on that page" : "This quote couldn't be matched to the page text"}>
                  {c.verified ? <ShieldCheck size={13} className="text-ok" /> : <ShieldQuestion size={13} className="text-warn" />}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {entry.found && !entry.grounded && (
        <p className="mt-2 text-[12px] text-warn">No quote could be matched to the page text: check the pages before relying on this.</p>
      )}
    </article>
  );
}

export interface AssistantHandle {
  focusInput: () => void;
}

export const AssistantPanel = forwardRef<AssistantHandle, {
  paperId: string;
  assistant: Assistant;
  focusedPage: number | null;
  focusedHasText: boolean;
  selectedPages: number[];
  onOpenPage: (p: number) => void;
  onClose: () => void;
}>(function AssistantPanel({ paperId, assistant, focusedPage, focusedHasText, selectedPages, onOpenPage, onClose }, ref) {
  const history = useAsksQuery(paperId);
  const [question, setQuestion] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focusInput: () => inputRef.current?.focus() }));
  const items = [...(history.data?.items ?? [])].reverse();
  const scope = selectedPages.length ? selectedPages : focusedPage ? [focusedPage] : [];
  const busy = assistant.running !== null;

  const ask = (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = question.trim();
    if (q.length < 3 || busy) return;
    void assistant.run({ action: "ask", question: q }, "Searching the paper…");
    setQuestion("");
  };

  const action = (label: string, icon: React.ReactNode, onClick: () => void, disabled: boolean, hint: string) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={hint}
      className="pressable flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-ink-soft transition-colors hover:bg-ink/[0.05] hover:text-ink disabled:opacity-40"
    >
      {icon}
      {label}
    </button>
  );

  return (
    <aside aria-label="Research assistant" className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex h-11 flex-shrink-0 items-center gap-2 border-b border-line px-4">
        <span className="text-[13px] font-medium text-ink">Assistant</span>
        <span className="flex-1" />
        <button type="button" onClick={onClose} title="Hide the assistant (A)" aria-label="Hide the assistant" className="pressable flex h-7 w-7 items-center justify-center rounded-md text-ink-soft hover:bg-ink/[0.05] hover:text-ink">
          <PanelRightClose size={15} />
        </button>
      </header>

      <div className="flex-shrink-0 border-b border-line px-3 py-3">
        <p className="px-2 text-[11.5px] uppercase tracking-[0.08em] text-ink-faint">
          {selectedPages.length ? `Ticked: page${selectedPages.length > 1 ? "s" : ""} ${selectedPages.join(", ")}` : focusedPage ? `Reading: page ${focusedPage}` : "No page open"}
        </p>
        <div className="mt-1.5 grid">
          {action(`Explain page ${focusedPage ?? ""}`.trim(), <BookOpenText size={14} />, () => focusedPage && assistant.run({ action: "explain_page", pages: [focusedPage] }, `Explaining page ${focusedPage}…`), !focusedPage || !focusedHasText, focusedHasText ? "Explain the page in the focused panel" : "This page has no selectable text")}
          {action(scope.length > 1 ? `Summarize pages ${scope.join(", ")}` : `Summarize page ${scope[0] ?? ""}`.trim(), <ListCollapse size={14} />, () => scope.length && assistant.run({ action: "summarize_pages", pages: scope }, "Summarizing…"), !scope.length, "Summarize the ticked pages, or the focused one")}
          {action(selectedPages.length >= 2 ? `Compare pages ${selectedPages.join(", ")}` : "Compare pages", <GitCompare size={14} />, () => assistant.run({ action: "compare_pages", pages: selectedPages }, `Comparing pages ${selectedPages.join(", ")}…`), selectedPages.length < 2, "Tick two or more open pages in the reader to compare them")}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        {assistant.running && (
          <p role="status" className="flex items-center gap-2 border-b border-line py-4 text-[13px] text-ink-soft">
            <ThinkingMark active size={14} /> {assistant.running}
          </p>
        )}
        {assistant.error && <p role="alert" className="border-b border-line py-3 text-[13px] text-bad">{assistant.error}</p>}
        {items.length === 0 && !assistant.running ? (
          <p className="py-6 text-[13px] leading-relaxed text-ink-faint">
            Ask anything about this paper. Answers come only from its pages and cite them; if it isn&rsquo;t in the paper, the assistant says so.
            Select text in a page to have it explained.
          </p>
        ) : (
          items.map((entry) => <Answer key={entry.id} entry={entry} onOpenPage={onOpenPage} />)
        )}
      </div>

      <form onSubmit={ask} className="flex-shrink-0 border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-lg border border-line bg-bg px-2 py-1.5 focus-within:border-accent/50">
          <textarea
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                ask();
              }
            }}
            rows={2}
            maxLength={500}
            placeholder="Ask this paper…"
            aria-label="Ask this paper"
            className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent px-1 py-1 text-[13.5px] text-ink outline-none placeholder:text-ink-faint"
          />
          <button type="submit" disabled={question.trim().length < 3 || busy} aria-label="Ask" title="Ask (Enter)" className="pressable mb-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-primary text-on-primary disabled:opacity-30">
            {busy ? <ThinkingMark active size={14} /> : <ArrowUp size={15} />}
          </button>
        </div>
        <p className="mt-1.5 px-1 text-[11.5px] text-ink-faint"><Sparkles size={11} className="mr-1 inline" />Searches the whole paper · cites pages</p>
      </form>
    </aside>
  );
});
