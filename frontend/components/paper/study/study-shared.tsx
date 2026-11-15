"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, RotateCcw } from "lucide-react";
import { apiClient } from "@/lib/api";
import { useStudyStatusQuery } from "@/lib/queries";
import { formatPages, kitProgress, sectionState, type KitStatus, type OutputKind } from "@/lib/study-logic";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { cn } from "@/lib/utils";

/** Clickable page references: open (or focus) that page in the reader. */
export function PageRefs({ pages, onOpenPage, className }: { pages: number[]; onOpenPage: (page: number) => void; className?: string }) {
  if (!pages?.length) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-0.5", className)}>
      <span className="sr-only">{formatPages(pages)}</span>
      {pages.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onOpenPage(p)}
          title={`Open page ${p} in the reader`}
          className="page-ref"
        >
          p.{p}
        </button>
      ))}
    </span>
  );
}

export function useStudyActions(paperId: string) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, path: string) => {
    setBusy(key);
    setError(null);
    try {
      const status = await apiClient<KitStatus>(path, { method: "POST" });
      queryClient.setQueryData(["study-status", paperId], status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return {
    busy,
    error,
    generate: (kind: OutputKind) => run(`gen-${kind}`, `/papers/${paperId}/study/${kind}/generate`),
    retry: () => run("retry", `/papers/${paperId}/study/retry`),
    regenerate: (kind: OutputKind) => run(`regen-${kind}`, `/papers/${paperId}/study/${kind}/regenerate`),
  };
}

/** A calm placeholder in the shape of text, while a section is written. */
export function TextSkeleton({ lines = 6, still = false }: { lines?: number; still?: boolean }) {
  return (
    <div className="mt-6 grid max-w-[68ch] gap-3" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={cn("h-2.5 rounded-full bg-ink/[0.06]", !still && "animate-pulse")} style={{ width: `${[92, 84, 96, 70, 88, 60, 80][i % 7]}%` }} />
      ))}
    </div>
  );
}

/**
 * One line of status above a section: working, partial or failed. It informs
 * without taking over the page; the action sits at the end of the line.
 */
export function StatusNote({
  tone, children, action, progress,
}: {
  tone: "working" | "warn" | "bad" | "neutral";
  children: React.ReactNode;
  action?: React.ReactNode;
  progress?: number;
}) {
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      aria-live="polite"
      className={cn(
        "status-note",
        tone === "bad" && "status-note--bad",
        tone === "warn" && "status-note--warn"
      )}
    >
      <span className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="mt-[3px] flex-shrink-0">
          {tone === "working" ? <ThinkingMark active size={13} /> : <AlertCircle size={14} className={tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-ink-faint"} />}
        </span>
        <span className="min-w-0">{children}</span>
      </span>
      {action}
      {progress !== undefined && (
        <span className="absolute inset-x-0 bottom-0 h-px overflow-hidden" aria-hidden>
          <span className="block h-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${Math.max(progress, 2)}%` }} />
        </span>
      )}
    </div>
  );
}

/** A quiet text action used inside status lines and empty states. */
export function TextAction({ onClick, disabled, busy, icon, children }: { onClick: () => void; disabled?: boolean; busy?: boolean; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="text-action">
      {busy ? <ThinkingMark active size={12} /> : icon}
      {children}
    </button>
  );
}

/**
 * The body of one generated section: the content once it's ready, otherwise
 * a quiet inline state. Generation is started by the navigation (opening the
 * section), never by rendering; the Generate action here only appears when the
 * section was reached some other way, e.g. after a refresh.
 */
export function KitGate({
  paperId,
  kind,
  title,
  placeholder,
  children,
}: {
  paperId: string;
  kind: OutputKind;
  title: string;
  /** What the section looks like while it's being written (defaults to lines of text). */
  placeholder?: (still: boolean) => React.ReactNode;
  children: (args: { kit: KitStatus; partial: boolean; version: string | null }) => React.ReactNode;
}) {
  const statusQuery = useStudyStatusQuery(paperId);
  const actions = useStudyActions(paperId);
  const kit = statusQuery.data;
  const state = sectionState(kit, kind);
  const lower = title.toLowerCase();
  // While working: the shape of what is coming. When stopped (failed, not started): only a section that
  // can say something useful in its placeholder shows one; plain text sections show just the status line.
  const shape = (still: boolean) => (placeholder ? placeholder(still) : still ? null : <TextSkeleton />);

  if (statusQuery.isLoading) return <>{shape(false)}</>;
  if (statusQuery.error) {
    return (
      <StatusNote tone="bad">
        Couldn&rsquo;t load this section. {statusQuery.error instanceof Error ? statusQuery.error.message : ""}
      </StatusNote>
    );
  }

  if (state === "not_started") {
    return (
      <>
        <StatusNote
          tone="neutral"
          action={<TextAction onClick={() => actions.generate(kind)} disabled={actions.busy !== null} busy={actions.busy !== null}>{actions.busy ? "Starting…" : `Write the ${lower}`}</TextAction>}
        >
          The {lower} hasn&rsquo;t been written for this paper yet.
          {actions.error && <span role="alert" className="mt-1 block text-bad">{actions.error}</span>}
        </StatusNote>
        <div className="mt-8">{shape(true)}</div>
      </>
    );
  }

  if (state === "waiting" || state === "generating") {
    const progress = kitProgress(kit);
    const reading = !!kit && kit.chunks.pending + kit.chunks.processing > 0;
    return (
      <>
        <StatusNote tone="working" progress={progress.pct} action={<span className="t-meta">{progress.pct}%</span>}>
          {reading
            ? `Reading the paper (part ${Math.min((kit?.chunks.ready ?? 0) + (kit?.chunks.failed ?? 0) + 1, kit?.chunks.total ?? 1)} of ${kit?.chunks.total}), then writing the ${lower}.`
            : state === "generating" ? `Writing the ${lower}…` : `The ${lower} is queued.`}
        </StatusNote>
        <div className="mt-8">{shape(false)}</div>
      </>
    );
  }

  if (state === "failed") {
    return (
      <>
        <StatusNote
          tone="bad"
          action={<TextAction onClick={actions.retry} disabled={actions.busy !== null} busy={actions.busy === "retry"} icon={<RotateCcw size={13} />}>Retry</TextAction>}
        >
          <span className="text-ink">{kit?.outputs[kind]?.error || `The ${lower} couldn't be written.`}</span>
          <span className="mt-0.5 block text-ink-soft">Nothing else is affected: sections that are already written stay available.</span>
          {actions.error && <span role="alert" className="mt-1 block text-bad">{actions.error}</span>}
        </StatusNote>
        <div className="mt-8">{shape(true)}</div>
      </>
    );
  }

  const partial = !!kit && kit.chunks.failed > 0;
  const version = kit?.outputs[kind]?.updated_at ?? null;
  return (
    <>
      {partial && kit && (
        <StatusNote tone="warn" action={<TextAction onClick={actions.retry} disabled={actions.busy !== null} busy={actions.busy === "retry"}>Retry the missing part</TextAction>}>
          Based on {kit.pages_covered} of {kit.text_pages} pages: part of the paper couldn&rsquo;t be read.
        </StatusNote>
      )}
      {children({ kit: kit!, partial, version })}
    </>
  );
}

/** The frame every study section is written in: a title block, then the section's own layout. */
export function SectionShell({ title, meta, actions, children, aside }: {
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  /** Optional line under the title in mono (counts, page totals) */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="study-page">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-line pb-7">
        <div className="min-w-0 max-w-[760px]">
          <h1 className="t-page-title">{title}</h1>
          {meta && <p className="t-desc mt-2.5">{meta}</p>}
          {aside && <p className="t-meta mt-3">{aside}</p>}
        </div>
        {actions}
      </header>
      <div className="pt-8">{children}</div>
    </div>
  );
}

export function EmptyOutput({ text }: { text: string }) {
  return <p className="t-body-sm py-10">{text}</p>;
}
