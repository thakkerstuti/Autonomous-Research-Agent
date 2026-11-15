"use client";

/**
 * "Ask this paper": the research assistant for the open paper. A message is
 * first read as a workspace command ("show pages 2 and 3 together", "zoom in"):
 * those are applied to the real reader and reported here. Anything else is a
 * question, answered only from the paper (or from the attached page), with
 * citations checked against the page text.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeftRight, ArrowUp, ArrowUpRight, Check, Plus, X } from "lucide-react";
import { apiClient } from "@/lib/api";
import { useAsksQuery, type AskEntry, type AssistantAction } from "@/lib/queries";
import { listPages } from "@/lib/workspace-commands";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { cn } from "@/lib/utils";

export interface AssistantRequest {
  action: AssistantAction;
  pages?: number[];
  question?: string;
  selection?: string;
}

/** A workspace command and what came of it (kept in this tab, not sent anywhere). */
export interface CommandNote {
  id: string;
  text: string;
  message: string;
  ok: boolean;
  at: string;
}

/** Shared by the reader (compare, explain selection), page notes and the panel itself. */
export function useAssistant(paperId: string) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<CommandNote[]>([]);

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
  const note = (text: string, message: string, ok: boolean) =>
    setNotes((n) => [...n, { id: `c${Date.now()}${n.length}`, text, message, ok, at: new Date().toISOString() }].slice(-40));
  return { running, error, run, notes, note };
}

export type Assistant = ReturnType<typeof useAssistant>;

function Answer({ entry, onOpenPage }: { entry: AskEntry; onOpenPage: (p: number) => void }) {
  const scoped = entry.action === "ask" && entry.pages_requested?.length;
  return (
    <article className="py-6" data-entry="answer">
      <h3 className="font-heading text-[23px] leading-[1.15] text-ink">{entry.question}</h3>
      {scoped ? <p className="mt-1 text-[11.5px] text-ink-faint">From page {listPages(entry.pages_requested!)}</p> : null}
      <div className={cn("notes-prose mt-3 text-[13.5px] leading-[1.65]", entry.found ? "text-ink" : "text-ink-soft")}>
        <ReactMarkdown>{entry.answer}</ReactMarkdown>
      </div>
      {entry.citations.length > 0 && (
        <ul className="mt-4 grid min-w-0 gap-1.5">
          {entry.citations.map((c, i) => (
            <li key={i} className="min-w-0">
              <button
                type="button"
                onClick={() => onOpenPage(c.page)}
                title={`Go to page ${c.page}${c.verified ? "" : " (this quote couldn't be matched to the page text)"}`}
                className="group flex w-full items-start gap-2 rounded-[3px] bg-accent-soft px-2.5 py-1.5 text-left text-[12px] leading-snug transition-colors hover:bg-accent/[0.16]"
              >
                <span className="flex-shrink-0 font-medium text-accent">Page {c.page}</span>
                <span className="min-w-0 flex-1 truncate italic text-ink-soft">&ldquo;{c.quote}&rdquo;</span>
                {!c.verified && <span className="flex-shrink-0 text-warn" aria-label="Unverified quote">?</span>}
                <ArrowUpRight size={12} className="mt-px flex-shrink-0 text-accent" />
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

function Note({ note }: { note: CommandNote }) {
  return (
    <article className="py-4" data-entry="command" data-ok={note.ok}>
      <p className="text-[13px] font-medium leading-snug text-ink">{note.text}</p>
      <p className={cn("mt-1 flex items-start gap-1.5 text-[12.5px] leading-snug", note.ok ? "text-ink-soft" : "text-ink")}>
        {note.ok ? <Check size={13} className="mt-[2px] flex-shrink-0 text-accent" /> : <AlertCircle size={13} className="mt-[2px] flex-shrink-0 text-warn" />}
        <span>{note.message}</span>
      </p>
    </article>
  );
}

export interface AssistantHandle {
  focusInput: () => void;
}

const EXAMPLES = ["show pages 2 and 3 together", "compare pages 2 and 6", "zoom in", "back to single page"];

export const AssistantPanel = forwardRef<AssistantHandle, {
  paperId: string;
  assistant: Assistant;
  focusedPage: number | null;
  focusedHasText: boolean;
  openPages: number[];
  pageCount: number;
  onOpenPage: (p: number) => void;
  onShowNotes: () => void;
  onCompare: () => void;
  /** Applies the message if it's a workspace command; otherwise asks it (about the attached page, if any). */
  onSubmit: (text: string, attachedPage?: number | null) => void;
}>(function AssistantPanel({ paperId, assistant, focusedPage, focusedHasText, openPages, pageCount, onOpenPage, onShowNotes, onCompare, onSubmit }, ref) {
  const history = useAsksQuery(paperId);
  const [text, setText] = useState("");
  const [attach, setAttach] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ focusInput: () => inputRef.current?.focus() }));
  const busy = assistant.running !== null;
  const attached = attach && focusedPage && focusedHasText ? focusedPage : null;

  const items = useMemo(() => {
    // Server times are UTC without a zone marker
    const utc = (s: string) => Date.parse(/(Z|[+-]\d\d:\d\d)$/.test(s) ? s : `${s}Z`) || 0;
    const answers = (history.data?.items ?? []).map((e) => ({ at: utc(e.asked_at), kind: "answer" as const, node: <Answer key={e.id} entry={e} onOpenPage={onOpenPage} /> }));
    const notes = assistant.notes.map((n) => ({ at: Date.parse(n.at), kind: "note" as const, node: <Note key={n.id} note={n} /> }));
    return [...answers, ...notes].sort((a, b) => a.at - b.at);
  }, [history.data, assistant.notes, onOpenPage]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [items.length, assistant.running, assistant.error]);

  const send = (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (t.length < 2 || busy) return;
    onSubmit(t, attached);
    setText("");
  };

  const action = (label: string, icon: React.ReactNode, onClick: () => void, disabled: boolean, hint: string) => (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || busy}
        title={hint}
        className="flex h-11 w-full items-center justify-between gap-3 border-b border-line text-left text-[12.5px] text-accent transition-colors hover:text-accent-strong disabled:text-ink-faint"
      >
        {label}
        {icon}
      </button>
    </li>
  );

  const last = items[items.length - 1];

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label="Research assistant" role="region">
      <ul className="flex-shrink-0 border-t border-line px-6">
        {action(
          "Explain current page",
          <ArrowUpRight size={14} />,
          () => focusedPage && assistant.run({ action: "explain_page", pages: [focusedPage] }, `Explaining page ${focusedPage}…`),
          !focusedPage || !focusedHasText,
          focusedHasText ? `Explain page ${focusedPage}` : "This page has no selectable text"
        )}
        {action(
          openPages.length > 1 ? `Compare pages ${listPages(openPages)}` : "Compare pages",
          <ArrowLeftRight size={14} />,
          onCompare,
          openPages.length < 2,
          openPages.length < 2 ? "Open a second page with + to compare" : `Compare pages ${listPages(openPages)}`
        )}
        {action(focusedPage ? `Notes for page ${focusedPage}` : "Page notes", <ArrowUpRight size={14} />, onShowNotes, false, "Plain-language notes for the page you're reading")}
      </ul>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6" aria-live="polite">
        {items.length === 0 && !busy ? (
          <div className="py-7">
            <p className="font-heading text-[23px] leading-[1.15] text-ink">Ask anything about this paper</p>
            <p className="mt-2.5 text-[13px] leading-[1.6] text-ink-soft">
              Answers come only from the paper and link back to the page they&rsquo;re from. You can also arrange the reader in plain words:
            </p>
            <ul className="mt-3 grid gap-1.5">
              {EXAMPLES.map((x) => (
                <li key={x}>
                  <button
                    type="button"
                    onClick={() => { setText(x); inputRef.current?.focus(); }}
                    className="text-left text-[13px] text-ink underline decoration-line-hover underline-offset-4 transition-colors hover:decoration-accent"
                  >
                    {x}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="divide-y divide-line">{items.map((i) => i.node)}</div>
        )}
        {assistant.running && (
          <p role="status" className="flex items-center gap-2 border-t border-line py-5 text-[13px] text-ink-soft">
            <ThinkingMark active size={13} /> {assistant.running}
          </p>
        )}
        {assistant.error && <p role="alert" className="border-t border-line py-4 text-[13px] text-bad">{assistant.error}</p>}
        {!busy && last?.kind === "answer" && <p className="pb-6 font-serif text-[13.5px] italic text-ink-faint">Ask a follow-up to go deeper.</p>}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="flex-shrink-0 px-4 pb-4 pt-3">
        <div className="rounded-[3px] border border-line-hover bg-bg transition-colors focus-within:border-accent/60">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            maxLength={500}
            placeholder="Ask about this paper…"
            aria-label="Ask about this paper"
            className="block max-h-32 min-h-[46px] w-full resize-none bg-transparent px-3 pt-2.5 text-[13px] text-ink outline-none placeholder:text-ink-faint"
          />
          <div className="flex items-center justify-between gap-2 px-2.5 pb-2">
            {attached ? (
              <span className="flex items-center gap-1 rounded-[3px] bg-surface2 px-2 py-0.5 text-[11.5px] text-ink-soft">
                Page {attached} attached
                <button type="button" onClick={() => setAttach(false)} aria-label={`Ask about the whole paper instead of page ${attached}`} title="Ask about the whole paper" className="text-ink-faint transition-colors hover:text-ink">
                  <X size={11} />
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setAttach(true)}
                disabled={!focusedPage || !focusedHasText}
                className="flex items-center gap-1 text-[11.5px] text-ink-faint transition-colors hover:text-ink disabled:opacity-50"
                title="Answer from the page you're reading only"
              >
                <Plus size={11} /> {focusedPage ? `Attach page ${focusedPage}` : "Whole paper"}
              </button>
            )}
            <button type="submit" disabled={text.trim().length < 2 || busy} aria-label="Send" title="Send (Enter)" className="flex h-7 w-7 items-center justify-center rounded-[3px] bg-primary text-on-primary transition-opacity disabled:opacity-30">
              {busy ? <ThinkingMark active size={12} /> : <ArrowUp size={14} />}
            </button>
          </div>
        </div>
        <p className="mt-2 px-1 text-[11px] text-ink-faint">Answers link back to the paper · {pageCount} pages</p>
      </form>
    </div>
  );
});
