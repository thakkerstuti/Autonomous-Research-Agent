"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertCircle, ArrowUpRight, Check, ChevronDown, FilePlus2, Globe, Loader2, RotateCcw } from "lucide-react";
import { ChatSource, linkCitations } from "@/lib/chat-stream";
import { ResearchDocument, appendChatToPaper, getDocument } from "@/lib/research-runs";
import { cn } from "@/lib/utils";

/**
 * Adds this answer (and its question) to the conversation's research paper as a new version.
 * The latest version is fetched first; one automatic retry covers a paper saved in between.
 * Clicks while it works are ignored, and the server never appends the same answer twice.
 */
export function AddToPaperButton({
  documentId, messageId, beforeAdd, onAdded, showOpenLink = true,
}: {
  documentId: string;
  messageId: string;
  /** A reason not to add right now (e.g. unsaved edits in the editor), or null. */
  beforeAdd?: () => string | null;
  onAdded?: (doc: ResearchDocument) => void;
  showOpenLink?: boolean;
}) {
  const [state, setState] = useState<{ kind: "idle" } | { kind: "adding" } | { kind: "added"; version: number; already: boolean } | { kind: "error"; message: string }>({ kind: "idle" });
  const working = useRef(false);

  async function add() {
    if (working.current) return; // a second click while adding does nothing
    const blocked = beforeAdd?.();
    if (blocked) return setState({ kind: "error", message: blocked });
    working.current = true;
    setState({ kind: "adding" });
    try {
      let result: ResearchDocument & { already_added: boolean };
      try {
        result = await appendChatToPaper(documentId, messageId, (await getDocument(documentId)).current_version);
      } catch (e: any) {
        if (e?.status !== 409) throw e;
        result = await appendChatToPaper(documentId, messageId, (await getDocument(documentId)).current_version); // saved in between
      }
      setState({ kind: "added", version: result.current_version, already: result.already_added });
      onAdded?.(result);
    } catch (e: any) {
      setState({ kind: "error", message: e?.message || "The answer couldn't be added to the paper." });
    } finally {
      working.current = false;
    }
  }

  if (state.kind === "added") {
    return (
      <span className="inline-flex h-8 items-center gap-1.5 text-[13px] text-ok" role="status">
        <Check size={14} /> {state.already ? "Already in the paper" : `Added to paper · v${state.version}`}
        {showOpenLink && (
          <Link href={`/research/paper/${documentId}`} className="ml-1 text-accent hover:underline">Open paper</Link>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <button
        onClick={add}
        disabled={state.kind === "adding"}
        aria-busy={state.kind === "adding"}
        className="pressable -ml-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] text-ink-soft hover:bg-surface2 hover:text-ink disabled:opacity-60"
        title="Add this question and answer to the research paper as a new section"
      >
        {state.kind === "adding" ? <Loader2 size={14} className="animate-spin" /> : <FilePlus2 size={14} />}
        {state.kind === "adding" ? "Adding to paper…" : "Add to paper"}
      </button>
      {state.kind === "error" && <span className="text-[12.5px] text-bad" role="alert">{state.message}</span>}
    </span>
  );
}

function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** [n] in a chat answer: a chip that opens the source, with a preview on hover. */
function SourceChip({ source }: { source?: ChatSource; n: string }) {
  if (!source) return null;
  return (
    <span className="group/cite relative inline-block align-baseline">
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Source ${source.n}: ${source.title}`}
        className="mono relative -top-[0.35em] ml-0.5 inline-flex h-[18px] min-w-[20px] items-center justify-center rounded-[5px] bg-accent-soft px-1 text-[10.5px] font-medium leading-none text-accent no-underline transition-colors hover:bg-accent hover:text-on-primary"
      >
        {source.n}
      </a>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-[calc(100%+6px)] left-1/2 z-40 w-[280px] -translate-x-1/2 translate-y-1 scale-[0.97] rounded-xl bg-surface p-3.5 font-sans text-[12.5px] leading-snug opacity-0 shadow-panel transition-[opacity,transform,visibility] duration-150 ease-out group-hover/cite:visible group-hover/cite:translate-y-0 group-hover/cite:scale-100 group-hover/cite:opacity-100 group-hover/cite:delay-200"
      >
        <span className="flex items-center justify-between gap-3 text-[11px] text-ink-faint">
          <span className="truncate">{domainOf(source.url)}</span>
          <span className="flex-shrink-0">{source.origin === "web" ? "Web search" : "From the research"}</span>
        </span>
        <span className="mt-1.5 block font-medium text-ink">{source.title}</span>
        {source.excerpt && <span className="mt-1.5 block text-ink-soft">“{source.excerpt.slice(0, 200)}{source.excerpt.length > 200 ? "…" : ""}”</span>}
      </span>
    </span>
  );
}

/** A chat answer: Markdown (lists, tables, code) with clickable numbered citations. */
export function ChatMarkdown({ text, sources }: { text: string; sources: ChatSource[] }) {
  const byNumber = useMemo(() => new Map(sources.map((s) => [String(s.n), s])), [sources]);
  const prepared = useMemo(() => linkCitations(text, sources), [text, sources]);
  return (
    <div className="report-prose chat-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, href, children, ...props }) => {
            if (href?.startsWith("#cite-")) return <SourceChip source={byNumber.get(href.slice(6))} n={href.slice(6)} />;
            return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
          },
          pre: ({ node, children }) => (
            <pre className="overflow-x-auto rounded-xl bg-surface2 px-4 py-3 font-mono text-[13px] leading-relaxed text-ink [&>code]:bg-transparent [&>code]:p-0">
              {children}
            </pre>
          ),
          table: ({ node, children }) => (
            <div className="-mx-1 overflow-x-auto px-1"><table>{children}</table></div>
          ),
        }}
      >
        {prepared}
      </ReactMarkdown>
    </div>
  );
}

/** The sources an answer cites, numbered as in the text; web results are marked. */
export function ChatSources({ sources, usedWebSearch }: { sources: ChatSource[]; usedWebSearch: boolean }) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;
  const web = sources.filter((s) => s.origin === "web").length;
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg py-1 text-[13px] text-ink-soft transition-colors hover:text-ink"
      >
        {usedWebSearch && <Globe size={13} className="text-ink-faint" />}
        {sources.length} {sources.length === 1 ? "source" : "sources"}
        {web > 0 && <span className="text-ink-faint">· {web} from the web</span>}
        <ChevronDown size={14} className={cn("text-ink-faint transition-transform duration-200 ease-out", open && "rotate-180")} />
      </button>
      <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-out", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
        <ol className="overflow-hidden">
          {sources.map((s) => (
            <li key={s.n}>
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group -mx-2 grid grid-cols-[26px_1fr_auto] items-start gap-2 rounded-xl px-2 py-2.5 transition-colors hover:bg-surface2"
              >
                <span className="mono pt-0.5 text-[12px] text-ink-faint">[{s.n}]</span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-ink">{s.title}</span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-ink-faint">
                    {domainOf(s.url)} · {s.origin === "web" ? "web search" : "from the research"}
                  </span>
                </span>
                <ArrowUpRight size={13} className="mt-0.5 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" />
              </a>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** An answer that failed: the server's message and a retry (nothing was saved, so retrying is safe). */
export function ChatError({ message, onRetry, busy }: { message: string; onRetry?: () => void; busy?: boolean }) {
  return (
    <div className="animate-msg-in">
      <p className="flex items-start gap-2 text-[14.5px] text-ink">
        <AlertCircle size={15} className="mt-0.5 flex-shrink-0 text-warn" /> {message}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          disabled={busy}
          className="pressable ml-[23px] mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-medium text-ink hover:border-line-hover disabled:opacity-40"
        >
          <RotateCcw size={13} /> Try again
        </button>
      )}
    </div>
  );
}
