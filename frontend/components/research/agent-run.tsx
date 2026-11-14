"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Check, X, ShieldCheck } from "lucide-react";
import { ResearchView, STATUS_TONE } from "@/lib/research-view";
import { StanceBar } from "@/components/viz/progress";
import { ThinkingMark } from "./thinking-mark";
import { cn } from "@/lib/utils";

/* ───────────── Thinking: a single quiet line ───────────── */

const PLAN = [
  "Planning testable hypotheses",
  "Searching across several rounds",
  "Reading sources and weighing evidence",
  "Verifying quotes against the originals",
  "Critiquing its own draft",
  "Writing the cited answer",
];

function useElapsed(since: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return Math.max(0, Math.floor((now - since) / 1000));
}

export function ThinkingLine({ startedAt }: { startedAt?: number }) {
  const [t0] = useState(() => startedAt ?? Date.now());
  const s = useElapsed(t0);
  const [open, setOpen] = useState(false);

  return (
    <div role="status" aria-live="polite">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group flex items-center gap-2 text-[15px] text-ink-soft transition-colors hover:text-ink"
      >
        <span className="thinking-text">Researching</span>
        <span className="mono text-[12px] text-ink-faint">{s}s</span>
        <ChevronRight size={14} className={cn("text-ink-faint transition-transform duration-200 ease-out", open && "rotate-90")} />
      </button>
      <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-out", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
        <div className="overflow-hidden">
          <ul className="mt-3 grid gap-1.5 border-l border-line pl-4 text-[13.5px] text-ink-faint">
            {PLAN.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>
      </div>
      {s > 25 && (
        <p className="mt-2 text-[13px] text-ink-faint">Full reports run several search rounds and usually take a minute or two.</p>
      )}
    </div>
  );
}

export { ThinkingMark };

/* ───────────── After the answer: how the agent worked ───────────── */

function Step({ title, children, warn }: { title: React.ReactNode; children?: React.ReactNode; warn?: boolean }) {
  return (
    <li className="relative pb-5 last:pb-0">
      <span className={cn("absolute -left-[21px] top-[5px] h-[9px] w-[9px] rounded-full ring-[3px] ring-bg", warn ? "bg-warn" : "bg-ink/70")} />
      <div className="text-[13.5px] font-medium text-ink">{title}</div>
      {children}
    </li>
  );
}

export function AgentRun({ view }: { view: ResearchView }) {
  const [open, setOpen] = useState(false);
  const ev = view.evidence;
  const supports = ev.filter((e) => e.stance === "supports").length;
  const refutes = ev.filter((e) => e.stance === "refutes").length;
  const neutral = ev.length - supports - refutes;
  const critiqueOk = !view.critique || view.critique.status === "passed" || view.critique.status === "passed_with_revisions";

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg py-1 text-[13px] text-ink-soft transition-colors hover:text-ink"
      >
        How the agent worked
        <span className="text-ink-faint">· {view.hypotheses.length} hypotheses</span>
        <ChevronDown size={14} className={cn("text-ink-faint transition-transform duration-200 ease-out", open && "rotate-180")} />
      </button>

      <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-out", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
        <div className="overflow-hidden">
          {view.hypotheses.length > 0 && (
            <ul className="mt-4 grid gap-3">
              {view.hypotheses.map((h) => {
                const tone = STATUS_TONE[h.status] ?? STATUS_TONE.untested;
                return (
                  <li key={h.id} className="grid grid-cols-[88px_1fr] gap-3 text-[14px]">
                    <span className={cn("flex items-center gap-1.5 pt-0.5 text-[12.5px] font-medium", tone.cls)}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} /> {tone.label}
                    </span>
                    <span className="min-w-0">
                      <span className="text-ink">{h.statement}</span>
                      <StanceBar supports={h.supports} refutes={h.refutes} neutral={h.neutral} className="mt-2 max-w-[220px]" />
                      {h.contradiction && <span className="mt-1.5 block text-[12.5px] text-warn">Conflicting evidence: {h.contradiction}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <ol className="ml-[5px] mt-6 border-l border-line pl-4">
            <Step title={<>Searched {view.rounds ? `over ${view.rounds} ${view.rounds === 1 ? "round" : "rounds"}` : "the literature"}{view.stats.searches !== undefined && <span className="font-normal text-ink-soft"> · {view.stats.searches} searches</span>}</>}>
              {view.queries.length > 0 && (
                <p className="mt-1 text-[12.5px] text-ink-faint">{view.queries.slice(0, 6).join(" · ")}{view.queries.length > 6 ? ` · +${view.queries.length - 6} more` : ""}</p>
              )}
            </Step>
            <Step title={`Weighed ${ev.length} pieces of evidence from ${view.sources.length} sources`}>
              <p className="mt-1 text-[12.5px] text-ink-faint">{supports} support · {refutes} refute · {neutral} context</p>
            </Step>
            <Step title="Verified quotes against their sources">
              <p className="mt-1 text-[12.5px] text-ink-faint">
                <ShieldCheck size={12} className="mr-1 inline text-ok" />
                {view.verification.verified} verified · {view.verification.snippet} from snippets · {view.verification.unverified} unverified
              </p>
            </Step>
            <Step warn={!critiqueOk} title={<>Self-critique{view.critique ? <span className={cn("font-normal", critiqueOk ? "text-ok" : "text-warn")}> · {view.critique.status.replace(/_/g, " ")}</span> : <span className="font-normal text-ink-soft"> · not recorded</span>}</>}>
              {view.critique?.checks?.length ? (
                <ul className="mt-1.5 grid gap-1">
                  {view.critique.checks.map((c) => (
                    <li key={c.name} className="flex items-start gap-1.5 text-[12.5px] text-ink-faint">
                      {c.passed ? <Check size={12} className="mt-0.5 flex-shrink-0 text-ok" /> : <X size={12} className="mt-0.5 flex-shrink-0 text-bad" />}
                      <span><span className="text-ink-soft">{c.name}</span> — {c.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Step>
            <Step title={`Wrote the ${view.format ? `${view.format} ` : ""}answer`}>
              <p className="mt-1 text-[12.5px] text-ink-faint">
                {[
                  view.stats.duration !== undefined ? `${Math.round(view.stats.duration)} seconds` : null,
                  view.stats.llmCalls !== undefined ? `${view.stats.llmCalls} model calls` : null,
                ].filter(Boolean).join(" · ") || "Run statistics not recorded"}
              </p>
            </Step>
          </ol>
        </div>
      </div>
    </div>
  );
}
