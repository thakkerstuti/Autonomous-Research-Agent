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
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      <span className="sr-only">{formatPages(pages)}</span>
      {pages.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onOpenPage(p)}
          title={`Open page ${p} in the reader`}
          className="mono rounded-[5px] px-1.5 py-px text-[11.5px] text-ink-soft underline decoration-line-hover underline-offset-2 transition-colors hover:bg-accent-soft hover:text-ink hover:no-underline"
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
export function TextSkeleton({ lines = 6 }: { lines?: number }) {
  return (
    <div className="mt-6 grid gap-3" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-3 animate-pulse rounded-full bg-ink/[0.06]" style={{ width: `${[92, 84, 96, 70, 88, 60, 80][i % 7]}%` }} />
      ))}
    </div>
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
  children,
}: {
  paperId: string;
  kind: OutputKind;
  title: string;
  children: (args: { kit: KitStatus; partial: boolean; version: string | null }) => React.ReactNode;
}) {
  const statusQuery = useStudyStatusQuery(paperId);
  const actions = useStudyActions(paperId);
  const kit = statusQuery.data;
  const state = sectionState(kit, kind);
  const lower = title.toLowerCase();

  if (statusQuery.isLoading) return <TextSkeleton />;
  if (statusQuery.error) {
    return (
      <p role="alert" className="mt-6 text-[14px] text-bad">
        Couldn&rsquo;t load this section. {statusQuery.error instanceof Error ? statusQuery.error.message : ""}
      </p>
    );
  }

  if (state === "not_started") {
    return (
      <div className="mt-6 flex flex-wrap items-center gap-3 border-y border-line py-4 text-[14px] text-ink-soft">
        <span>{title} hasn&rsquo;t been generated for this paper yet.</span>
        <button
          onClick={() => actions.generate(kind)}
          disabled={actions.busy !== null}
          className="pressable font-medium text-ink underline decoration-accent/60 underline-offset-4 hover:decoration-accent disabled:opacity-50"
        >
          {actions.busy ? "Starting…" : `Generate ${lower}`}
        </button>
        {actions.error && <span role="alert" className="w-full text-[13px] text-bad">{actions.error}</span>}
      </div>
    );
  }

  if (state === "waiting" || state === "generating") {
    const progress = kitProgress(kit);
    const reading = !!kit && kit.chunks.pending + kit.chunks.processing > 0;
    return (
      <div role="status" aria-live="polite">
        <div className="mt-6 flex items-center gap-2.5 text-[13.5px] text-ink-soft">
          <ThinkingMark active size={15} />
          {reading
            ? `Reading the paper (part ${Math.min((kit?.chunks.ready ?? 0) + (kit?.chunks.failed ?? 0) + 1, kit?.chunks.total ?? 1)} of ${kit?.chunks.total}), then writing the ${lower}`
            : state === "generating" ? `Writing the ${lower}…` : `The ${lower} is queued`}
          <span className="mono ml-auto text-[12px] text-ink-faint">{progress.pct}%</span>
        </div>
        <div className="mt-2 h-px overflow-hidden bg-line">
          <div className="h-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${Math.max(progress.pct, 2)}%` }} />
        </div>
        <TextSkeleton />
      </div>
    );
  }

  if (state === "failed") {
    return (
      <div role="alert" className="mt-6 flex flex-wrap items-center gap-3 border-y border-bad/25 py-4 text-[14px]">
        <AlertCircle size={16} className="flex-shrink-0 text-bad" />
        <span className="text-ink">{kit?.outputs[kind]?.error || `The ${lower} couldn't be generated.`}</span>
        <button
          onClick={actions.retry}
          disabled={actions.busy !== null}
          className="pressable ml-auto flex items-center gap-1.5 font-medium text-ink hover:text-accent disabled:opacity-50"
        >
          {actions.busy === "retry" ? <ThinkingMark active size={13} /> : <RotateCcw size={13} />} Retry
        </button>
        {actions.error && <span role="alert" className="w-full text-[13px] text-bad">{actions.error}</span>}
      </div>
    );
  }

  const partial = !!kit && kit.chunks.failed > 0;
  const version = kit?.outputs[kind]?.updated_at ?? null;
  return (
    <>
      {partial && kit && (
        <div role="status" className="mt-4 flex flex-wrap items-center gap-3 border-y border-warn/30 py-2.5 text-[13px] text-ink-soft">
          <AlertCircle size={14} className="flex-shrink-0 text-warn" />
          Based on {kit.pages_covered} of {kit.text_pages} pages: part of the paper couldn&rsquo;t be read.
          <button onClick={actions.retry} disabled={actions.busy !== null} className="pressable ml-auto font-medium text-ink hover:text-accent">
            Retry the missing part
          </button>
        </div>
      )}
      {children({ kit: kit!, partial, version })}
    </>
  );
}

/** The column every study section is written in. */
export function SectionShell({ title, meta, actions, children }: { title: string; meta?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[780px] px-6 pb-24 pt-10 sm:px-10">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line pb-4">
        <div>
          <h1 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.025em] text-ink">{title}</h1>
          {meta && <div className="mt-1.5 text-[13px] text-ink-soft">{meta}</div>}
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}

export function EmptyOutput({ text }: { text: string }) {
  return <p className="mt-8 text-[14px] text-ink-soft">{text}</p>;
}
