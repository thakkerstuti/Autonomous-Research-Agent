"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, Circle, MessageSquareText, RotateCcw, Sparkles } from "lucide-react";
import { apiClient } from "@/lib/api";
import { useStudyStatusQuery } from "@/lib/queries";
import {
  formatPages, kitProgress, OUTPUT_KINDS, SECTION_LABEL, sectionState, type KitStatus, type OutputKind, type SectionState,
} from "@/lib/study-logic";
import { Button } from "@/components/ui/button";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { cn } from "@/lib/utils";

/** Clickable page references: open that page in the Read tab. */
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
          title={`Open page ${p} in Read`}
          className="pressable mono rounded-md bg-ink/[0.05] px-1.5 py-0.5 text-[11.5px] text-ink-soft transition-colors hover:bg-accent-soft hover:text-ink"
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
    start: () => run("start", `/papers/${paperId}/study`),
    retry: () => run("retry", `/papers/${paperId}/study/retry`),
    regenerate: (kind: OutputKind) => run(`regen-${kind}`, `/papers/${paperId}/study/${kind}/regenerate`),
  };
}

const STATE_TEXT: Record<SectionState, string> = {
  not_started: "Not started",
  waiting: "Waiting",
  generating: "Generating",
  ready: "Ready",
  failed: "Failed",
};

function StateIcon({ state }: { state: SectionState }) {
  if (state === "ready") return <Check size={13} strokeWidth={2.4} className="text-ok" />;
  if (state === "failed") return <AlertCircle size={13} className="text-bad" />;
  if (state === "generating") return <ThinkingMark active size={13} />;
  return <Circle size={11} className="text-ink-faint" />;
}

/**
 * A compact line under the study tabs while the kit is being built (or if a
 * part failed): each section's own state plus overall progress. It never
 * blocks the workspace; it disappears once everything is ready.
 */
export function StudyStatusStrip({ paperId }: { paperId: string }) {
  const { data: kit } = useStudyStatusQuery(paperId);
  const actions = useStudyActions(paperId);
  if (!kit || kit.status === "not_started" || kit.status === "ready") return null;
  const progress = kitProgress(kit);
  const anyFailed = OUTPUT_KINDS.some((k) => sectionState(kit, k) === "failed") || kit.chunks.failed > 0;
  const reading = kit.chunks.pending + kit.chunks.processing > 0;

  return (
    <div className="mt-3 rounded-xl bg-ink/[0.035] px-3 py-2.5" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px]">
        <span className="font-medium text-ink">
          {kit.status === "processing" ? "Building study kit" : "Study kit"}
          {reading && <span className="font-normal text-ink-soft"> · reading part {Math.min(kit.chunks.ready + kit.chunks.failed + 1, kit.chunks.total)} of {kit.chunks.total}</span>}
        </span>
        {OUTPUT_KINDS.map((k) => {
          const st = sectionState(kit, k);
          return (
            <span key={k} className="flex items-center gap-1.5 text-ink-soft" title={kit.outputs[k]?.error || undefined}>
              <StateIcon state={st} />
              {SECTION_LABEL[k]}
              <span className={cn("text-ink-faint", st === "failed" && "text-bad", st === "ready" && "text-ok")}>{STATE_TEXT[st]}</span>
            </span>
          );
        })}
        {anyFailed && kit.status !== "processing" && (
          <Button size="sm" variant="outline" className="ml-auto h-7" onClick={actions.retry} disabled={actions.busy !== null}>
            {actions.busy === "retry" ? <ThinkingMark active size={13} /> : <RotateCcw size={13} />} Retry failed
          </Button>
        )}
      </div>
      {kit.status === "processing" && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink/[0.07]" role="progressbar" aria-label="Study kit progress" aria-valuenow={progress.pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${Math.max(progress.pct, 3)}%` }} />
        </div>
      )}
      {actions.error && <p role="alert" className="mt-1.5 text-[12.5px] text-bad">{actions.error}</p>}
    </div>
  );
}

/**
 * The content area of one study tab: the section itself once it's ready,
 * otherwise its own state (waiting, generating, failed). The kit starts by
 * itself after upload; only papers from before that need a manual start.
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

  if (statusQuery.isLoading) {
    return (
      <div className="flex items-center gap-3 px-6 py-16 text-[14px] text-ink-soft" role="status">
        <ThinkingMark active size={18} /> Loading…
      </div>
    );
  }
  if (statusQuery.error) {
    return (
      <div role="alert" className="mx-auto mt-10 max-w-[560px] rounded-2xl bg-surface p-5 text-[14px] text-bad shadow-sm">
        Couldn&rsquo;t load the study kit. {statusQuery.error instanceof Error ? statusQuery.error.message : ""}
      </div>
    );
  }

  if (state === "not_started") {
    // Only papers uploaded before study kits were built automatically
    return (
      <div className="mx-auto max-w-[560px] px-5 py-14 sm:px-8">
        <div className="animate-view-in rounded-2xl bg-surface p-6 shadow-sm">
          <p className="text-[14.5px] leading-relaxed text-ink">
            This paper was added before study kits were made automatically, so it doesn&rsquo;t have a summary, flashcards, Q&amp;A or highlights yet.
          </p>
          <Button className="mt-4" size="sm" variant="outline" onClick={actions.start} disabled={actions.busy !== null}>
            {actions.busy === "start" ? <ThinkingMark active size={14} /> : <Sparkles size={14} />} Generate study kit
          </Button>
          {actions.error && <p role="alert" className="mt-3 text-[13px] text-bad">{actions.error}</p>}
        </div>
      </div>
    );
  }

  if (state === "waiting" || state === "generating") {
    const progress = kitProgress(kit);
    const reading = !!kit && kit.chunks.pending + kit.chunks.processing > 0;
    return (
      <div className="mx-auto max-w-[560px] px-5 py-14 sm:px-8" role="status" aria-live="polite">
        <div className="animate-view-in flex items-start gap-3 rounded-2xl bg-surface p-6 shadow-sm">
          <ThinkingMark active size={22} />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium text-ink">
              {state === "generating" ? `Writing the ${title.toLowerCase()}` : reading ? "Reading the paper first" : `The ${title.toLowerCase()} is next`}
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
              {reading
                ? `Part ${Math.min((kit?.chunks.ready ?? 0) + (kit?.chunks.failed ?? 0) + 1, kit?.chunks.total ?? 1)} of ${kit?.chunks.total} · it appears here by itself. You can keep reading the pages meanwhile.`
                : "It appears here by itself. You can keep reading the pages meanwhile."}
            </p>
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-ink/[0.07]" role="progressbar" aria-label="Study kit progress" aria-valuenow={progress.pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${Math.max(progress.pct, 3)}%` }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (state === "failed") {
    return (
      <div className="mx-auto max-w-[560px] px-5 py-14 sm:px-8">
        <div role="alert" className="animate-view-in rounded-2xl bg-surface p-6 shadow-sm">
          <div className="flex items-start gap-2 text-[14.5px] text-bad">
            <AlertCircle size={17} className="mt-0.5 flex-shrink-0" /> {kit?.outputs[kind]?.error || `The ${title.toLowerCase()} couldn't be generated.`}
          </div>
          <Button className="mt-4" size="sm" variant="outline" onClick={actions.retry} disabled={actions.busy !== null}>
            {actions.busy === "retry" ? <ThinkingMark active size={14} /> : <RotateCcw size={14} />} Retry
          </Button>
          {actions.error && <p role="alert" className="mt-3 text-[13px] text-bad">{actions.error}</p>}
        </div>
      </div>
    );
  }

  const partial = !!kit && kit.chunks.failed > 0;
  const version = kit?.outputs[kind]?.updated_at ?? null;
  return (
    <>
      {partial && kit && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-warn/[0.07] px-4 py-2.5 text-[13px] text-ink sm:px-6">
          <span className="flex items-center gap-2">
            <AlertCircle size={15} className="flex-shrink-0 text-warn" />
            Based on {kit.pages_covered} of {kit.text_pages} pages: part of the paper couldn&rsquo;t be read.
          </span>
          <Button size="sm" variant="outline" onClick={actions.retry} disabled={actions.busy !== null}>
            {actions.busy === "retry" ? <ThinkingMark active size={14} /> : <RotateCcw size={14} />} Retry the missing part
          </Button>
        </div>
      )}
      {children({ kit: kit!, partial, version })}
    </>
  );
}

export function SectionShell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[760px] px-5 pb-20 pt-8 sm:px-8">{children}</div>;
}

export function EmptyOutput({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-surface p-5 text-[14px] text-ink-soft shadow-sm">
      <MessageSquareText size={16} className="text-ink-faint" /> {text}
    </div>
  );
}
