"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, BookOpenCheck, Layers, ListChecks, MessageSquareText, RotateCcw, Sparkles } from "lucide-react";
import { apiClient } from "@/lib/api";
import { useStudyStatusQuery } from "@/lib/queries";
import { formatPages, outputView, type KitStatus, type OutputKind } from "@/lib/study-logic";
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

const WHAT_YOU_GET = [
  { icon: BookOpenCheck, text: "A structured summary of the whole paper, with page references" },
  { icon: Layers, text: "Flashcards for revision, with progress you can track" },
  { icon: ListChecks, text: "A question bank, from basics to critical thinking" },
  { icon: Sparkles, text: "The highlights worth remembering: findings, numbers, formulas" },
];

/**
 * Shows what a study tab needs before its content exists: an explicit start,
 * real generation progress, or a failure with retry. Renders children once
 * this tab's output is ready.
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
  const view = outputView(kit, kind);

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

  if (view.state === "not_started") {
    return (
      <div className="mx-auto max-w-[620px] px-5 py-12 sm:px-8">
        <div className="animate-view-in">
          <h2 className="font-display text-title font-semibold text-ink">Build the study kit for this paper</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
            CogNexa reads the whole paper part by part, then writes these from what it actually says. It&rsquo;s done once and saved, so it&rsquo;s there whenever you come back.
          </p>
          <ul className="mt-6 grid gap-3">
            {WHAT_YOU_GET.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-[14.5px] text-ink">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
                  <Icon size={15} strokeWidth={1.9} />
                </span>
                {text}
              </li>
            ))}
          </ul>
          <Button className="mt-8" size="lg" onClick={actions.start} disabled={actions.busy !== null}>
            {actions.busy === "start" ? <ThinkingMark active size={16} /> : <Sparkles size={16} />} Build study kit
          </Button>
          {actions.error && <p role="alert" className="mt-3 text-[13px] text-bad">{actions.error}</p>}
        </div>
      </div>
    );
  }

  if (view.state === "working") {
    const pct = view.total ? Math.round((view.done / view.total) * 100) : 0;
    return (
      <div className="mx-auto max-w-[560px] px-5 py-14 sm:px-8" role="status" aria-live="polite">
        <div className="animate-view-in rounded-2xl bg-surface p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <ThinkingMark active size={22} />
            <div>
              <div className="text-[15px] font-medium text-ink">
                {view.step === "reading" ? "Reading the paper" : `Writing the ${title.toLowerCase()}`}
              </div>
              <div className="mt-0.5 text-[13px] text-ink-soft">
                {view.step === "reading"
                  ? `Part ${Math.min(view.done + 1, view.total)} of ${view.total} · ${kit?.text_pages ?? 0} pages in total`
                  : `${view.done} of ${view.total} study sections finished`}
              </div>
            </div>
          </div>
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-ink/[0.07]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Study kit progress">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${Math.max(pct, 3)}%` }} />
          </div>
          <p className="mt-4 text-[12.5px] text-ink-faint">You can switch to Read or leave this page; it keeps going and is saved.</p>
        </div>
      </div>
    );
  }

  if (view.state === "failed") {
    return (
      <div className="mx-auto max-w-[560px] px-5 py-14 sm:px-8">
        <div role="alert" className="animate-view-in rounded-2xl bg-surface p-6 shadow-sm">
          <div className="flex items-start gap-2 text-[14.5px] text-bad">
            <AlertCircle size={17} className="mt-0.5 flex-shrink-0" /> {view.error}
          </div>
          <Button className="mt-4" size="sm" variant="outline" onClick={actions.retry} disabled={actions.busy !== null}>
            {actions.busy === "retry" ? <ThinkingMark active size={14} /> : <RotateCcw size={14} />} Retry
          </Button>
          {actions.error && <p role="alert" className="mt-3 text-[13px] text-bad">{actions.error}</p>}
        </div>
      </div>
    );
  }

  const version = kit?.outputs[kind]?.updated_at ?? null;
  return (
    <>
      {view.partial && kit && (
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
      {children({ kit: kit!, partial: view.partial, version })}
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
