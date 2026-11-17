"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { OutputFormat } from "@/lib/types";
import { RunProgress, RunStatus, StageKey, stageStates } from "@/lib/research-runs";
import { cn } from "@/lib/utils";

/**
 * What CogNexa is doing, in plain stages. Driven by the server's progress for
 * this run; it never shows the engine's internal reasoning, prompts or queries.
 */

const LABEL: Record<StageKey, string> = {
  understanding: "Understanding the research question",
  discovering: "Discovering relevant sources",
  gathering: "Gathering supporting evidence",
  evaluating: "Evaluating source credibility",
  comparing: "Comparing findings and perspectives",
  preparing: "Preparing the research output",
};

const PREPARING: Record<OutputFormat, string> = {
  quick: "Writing the answer",
  detailed: "Writing the detailed analysis",
  full: "Writing the research paper",
};

const PAPER_STEP: Record<string, string> = {
  "paper:outline": "Planning the paper's structure",
  "paper:introduction": "Drafting the introduction and methodology",
  "paper:analysis": "Writing the analysis and findings",
  "paper:conclusions": "Writing the discussion and conclusions",
  "paper:checking": "Checking each claim against its source",
};

function useElapsed(since: string | null | undefined, until: string | null | undefined) {
  const start = since ? Date.parse(since) : NaN;
  const end = until ? Date.parse(until) : NaN;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!Number.isNaN(end)) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [end]);
  if (Number.isNaN(start)) return null;
  return Math.max(0, Math.round(((Number.isNaN(end) ? now : end) - start) / 1000));
}

export function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function StageIcon({ state, failed }: { state: string; failed?: boolean }) {
  if (failed) {
    return (
      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-bad/15 text-bad">
        <X size={11} strokeWidth={2.6} />
      </span>
    );
  }
  if (state === "completed") {
    return (
      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-ok/15 text-ok">
        <Check size={11} strokeWidth={2.8} />
      </span>
    );
  }
  if (state === "in_progress") {
    return (
      <span className="relative flex h-[18px] w-[18px] items-center justify-center">
        <span className="absolute inset-0 animate-spin rounded-full border-[1.5px] border-accent/25 border-t-accent" />
        <span className="h-[6px] w-[6px] rounded-full bg-accent" />
      </span>
    );
  }
  return <span className="h-[18px] w-[18px] rounded-full border-[1.5px] border-line" />;
}

const STATE_TEXT: Record<string, string> = { pending: "Pending", in_progress: "In progress", completed: "Completed" };

export function WorkingFlow({
  progress,
  status,
  mode,
  collapsible = false,
}: {
  progress: RunProgress | null | undefined;
  status: RunStatus;
  mode: OutputFormat;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  const stages = stageStates(progress, status);
  const elapsed = useElapsed(progress?.started_at, progress?.finished_at);
  const failed = status === "failed";
  const failedAt = failed ? stages.find((s) => s.state === "in_progress")?.key ?? null : null;
  const doneCount = stages.filter((s) => s.state === "completed").length;
  const running = status === "in_progress";

  const header = running
    ? <><span className="thinking-text">Working</span>{elapsed !== null && <span className="mono text-[12px] text-ink-faint">{formatDuration(elapsed)}</span>}</>
    : failed
    ? <span>Stopped at step {Math.min(doneCount + 1, stages.length)} of {stages.length}</span>
    : <span>Working flow · {stages.length} steps completed{elapsed ? ` in ${formatDuration(elapsed)}` : ""}</span>;

  return (
    <div role="status" aria-live="polite" aria-label="Research progress">
      {collapsible ? (
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-2 rounded-lg py-1 text-[13px] text-ink-soft transition-colors hover:text-ink"
        >
          {header}
          <ChevronDown size={14} className={cn("text-ink-faint transition-transform duration-200 ease-out", open && "rotate-180")} />
        </button>
      ) : (
        <div className="flex items-center gap-2 text-[15px] text-ink-soft">{header}</div>
      )}

      <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-out", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
        <div className="overflow-hidden">
          <ol className="mt-3 grid gap-0.5">
            {stages.map(({ key, state }, i) => {
              const isFailed = failedAt === key;
              const label = key === "preparing" ? PREPARING[mode] ?? LABEL.preparing : LABEL[key];
              const detail = key === "preparing" && state === "in_progress" && progress?.detail ? PAPER_STEP[progress.detail] : null;
              return (
                <li key={key} className="relative flex items-start gap-3 py-1.5">
                  {i < stages.length - 1 && (
                    <span
                      aria-hidden
                      className={cn("absolute left-[8.5px] top-[26px] h-[calc(100%-18px)] w-px", state === "completed" ? "bg-ok/30" : "bg-line")}
                    />
                  )}
                  <StageIcon state={state} failed={isFailed} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className={cn("text-[13.5px]", state === "pending" ? "text-ink-faint" : "text-ink", state === "in_progress" && "font-medium")}>
                        {label}
                      </span>
                      <span className={cn("text-[11.5px]", isFailed ? "text-bad" : state === "in_progress" ? "text-accent" : "text-ink-faint")}>
                        {isFailed ? "Stopped" : STATE_TEXT[state]}
                      </span>
                    </div>
                    {detail && <p className="mt-0.5 text-[12.5px] text-ink-soft">{detail}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          {running && elapsed !== null && elapsed > 40 && (
            <p className="mt-2 text-[12.5px] text-ink-faint">
              {mode === "full"
                ? "A full research paper runs a thorough investigation and is written section by section. This usually takes a few minutes; you can leave this page and come back."
                : "Thorough research takes a minute or two. You can leave this page and come back."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
