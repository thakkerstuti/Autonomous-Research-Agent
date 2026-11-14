"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Check, X, ShieldCheck } from "lucide-react";
import { ResearchView, STATUS_TONE } from "@/lib/research-view";
import { NeuralField } from "@/components/neural/neural-field";
import { StanceBar } from "@/components/viz/progress";
import { cn } from "@/lib/utils";

/* ───────────── Live: the agent is working ───────────── */

const PLAN = [
  "Plan testable hypotheses",
  "Search across several rounds",
  "Read sources and weigh evidence",
  "Verify quotes against originals",
  "Critique its own draft",
  "Write the cited report",
];

function useElapsed(since?: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - (since ?? now)) / 1000));
  return { s, label: `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` };
}

export function AgentLive({ startedAt }: { startedAt?: number }) {
  const [t0] = useState(() => startedAt ?? Date.now());
  const { s, label } = useElapsed(t0);

  return (
    <div className="lens overflow-hidden rounded-[20px]" role="status" aria-live="polite" aria-label="The agent is researching">
      <div className="relative h-[210px]">
        <NeuralField mode="thinking" />
        <div className="absolute left-5 top-4 z-10 flex items-center gap-2 text-[12.5px] font-medium text-[#F3F1EE]">
          <span className="live-dot !bg-[#E8A8D6]" /> Researching
        </div>
        <span className="mono absolute right-5 top-4 z-10 text-[12px] text-[#A3A09C]">{label}</span>
      </div>
      <div className="relative z-10 border-t border-white/[0.06] px-5 pb-5 pt-4">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <span className="text-[12px] text-[#A3A09C]">The agent works through each stage before it answers</span>
        </div>
        <ol className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {PLAN.map((p, i) => (
            <li key={p} className="flex items-center gap-2.5 text-[13px] text-[#D8D5D0]" style={{ animation: `rise 500ms cubic-bezier(0.23,1,0.32,1) ${i * 60}ms both` }}>
              <span className="mono w-4 text-[11px] text-[#7C7975]">{i + 1}</span>
              {p}
            </li>
          ))}
        </ol>
        <div className="scan mt-4 h-px w-full bg-white/[0.08]" />
        {s > 25 && (
          <p className="mt-3 text-[12px] text-[#A3A09C]">Still going. Full reports run several search rounds and usually take a minute or two.</p>
        )}
      </div>
    </div>
  );
}

/* ───────────── Done: what the agent actually did ───────────── */

function Node({ done = true, warn = false }: { done?: boolean; warn?: boolean }) {
  return (
    <span
      className={cn(
        "absolute -left-[27px] top-[3px] flex h-[15px] w-[15px] items-center justify-center rounded-full ring-4 ring-bg",
        warn ? "bg-warn text-bg" : done ? "bg-ink text-bg" : "bg-surface3"
      )}
    >
      {warn ? <X size={9} strokeWidth={3} /> : <Check size={9} strokeWidth={3} />}
    </span>
  );
}

export function AgentRun({ view }: { view: ResearchView }) {
  const [open, setOpen] = useState(false);
  const ev = view.evidence;
  const supports = ev.filter((e) => e.stance === "supports").length;
  const refutes = ev.filter((e) => e.stance === "refutes").length;
  const neutral = ev.length - supports - refutes;
  const critiqueOk = !view.critique || view.critique.status === "passed" || view.critique.status === "passed_with_revisions";

  const summaryBits = [
    `${view.hypotheses.length} hypotheses`,
    `${view.sources.length} sources`,
    view.stats.searches !== undefined ? `${view.stats.searches} searches` : null,
    view.stats.duration !== undefined ? `${Math.round(view.stats.duration)}s` : null,
  ].filter(Boolean);

  return (
    <div className="rounded-2xl border border-line">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface2/60"
      >
        <span className="flex items-center gap-[3px]" aria-hidden>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className={cn("h-[3px] w-2.5 rounded-full", i === 4 && !critiqueOk ? "bg-warn" : "bg-ink/70")} />
          ))}
        </span>
        <span className="flex-1 text-[13px] text-ink-soft">
          <span className="font-medium text-ink">Agent run</span> · {summaryBits.join(" · ")}
        </span>
        <ChevronDown size={15} className={cn("text-ink-faint transition-transform duration-200 ease-out", open && "rotate-180")} />
      </button>

      <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-out", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
        <div className="overflow-hidden">
          <ol className="relative ml-[30px] border-l border-line py-5 pl-5 pr-5">
            <li className="relative pb-6">
              <Node />
              <div className="text-[13.5px] font-medium text-ink">Planned {view.hypotheses.length} testable hypotheses</div>
              <ul className="mt-2.5 grid gap-2">
                {view.hypotheses.map((h) => (
                  <li key={h.id} className="flex items-start gap-2.5 text-meta text-ink-soft">
                    <span className="mono mt-px w-6 flex-shrink-0 text-[11px] text-ink-faint">{h.id}</span>
                    <span className="min-w-0 flex-1">{h.statement}</span>
                  </li>
                ))}
              </ul>
            </li>

            <li className="relative pb-6">
              <Node />
              <div className="text-[13.5px] font-medium text-ink">
                Searched {view.rounds ? `over ${view.rounds} ${view.rounds === 1 ? "round" : "rounds"}` : "the literature"}
                {view.stats.searches !== undefined && <span className="font-normal text-ink-soft"> · {view.stats.searches} searches</span>}
              </div>
              {view.queries.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {view.queries.slice(0, 8).map((q) => (
                    <span key={q} className="max-w-full truncate rounded-md bg-surface3/70 px-2 py-1 text-[11.5px] text-ink-soft">{q}</span>
                  ))}
                  {view.queries.length > 8 && <span className="px-1 py-1 text-[11.5px] text-ink-faint">+{view.queries.length - 8} more</span>}
                </div>
              )}
            </li>

            <li className="relative pb-6">
              <Node />
              <div className="text-[13.5px] font-medium text-ink">
                Weighed {ev.length} pieces of evidence from {view.sources.length} sources
              </div>
              <StanceBar supports={supports} refutes={refutes} neutral={neutral} className="mt-3 max-w-[360px]" />
              <div className="mt-2 flex gap-4 text-[11.5px] text-ink-faint">
                <span><span className="text-ok">●</span> {supports} support</span>
                <span><span className="text-bad">●</span> {refutes} refute</span>
                <span><span className="text-ink-faint">●</span> {neutral} context</span>
              </div>
            </li>

            <li className="relative pb-6">
              <Node />
              <div className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
                Verified quotes against their sources
              </div>
              <p className="mt-1.5 text-meta text-ink-soft">
                <ShieldCheck size={13} className="mr-1 inline text-ok" />
                {view.verification.verified} verified in the original · {view.verification.snippet} in search snippets · {view.verification.unverified} unverified
              </p>
            </li>

            <li className="relative pb-6">
              <Node warn={!critiqueOk} />
              <div className="text-[13.5px] font-medium text-ink">
                Self-critique{view.critique ? <span className={cn("font-normal", critiqueOk ? "text-ok" : "text-warn")}> · {view.critique.status.replace(/_/g, " ")}</span> : <span className="font-normal text-ink-soft"> · not recorded</span>}
              </div>
              {view.critique?.checks?.length ? (
                <ul className="mt-2.5 grid gap-1.5">
                  {view.critique.checks.map((c) => (
                    <li key={c.name} className="flex items-start gap-2 text-meta">
                      {c.passed ? <Check size={13} className="mt-0.5 flex-shrink-0 text-ok" /> : <X size={13} className="mt-0.5 flex-shrink-0 text-bad" />}
                      <span className="text-ink-soft"><span className="text-ink">{c.name}</span> — {c.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {view.critique?.issues?.length ? (
                <ul className="mt-2.5 grid gap-1 text-meta text-ink-soft">
                  {view.critique.issues.map((iss, i) => <li key={i}>· {iss}</li>)}
                </ul>
              ) : null}
            </li>

            <li className="relative">
              <Node />
              <div className="text-[13.5px] font-medium text-ink">
                Wrote the {view.format ? `${view.format} ` : ""}report
              </div>
              <p className="mt-1 text-meta text-ink-soft">
                {[
                  view.stats.duration !== undefined ? `${Math.round(view.stats.duration)} seconds` : null,
                  view.stats.llmCalls !== undefined ? `${view.stats.llmCalls} model calls` : null,
                ].filter(Boolean).join(" · ") || "Run statistics not recorded"}
              </p>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}

/* ───────────── Findings: hypothesis verdicts ───────────── */

export function Verdicts({ view }: { view: ResearchView }) {
  if (!view.hypotheses.length) return null;
  return (
    <section>
      <h3 className="mb-4 font-sans text-[16px] font-semibold tracking-[-0.012em] text-ink">Hypothesis verdicts</h3>
      <ol className="border-t border-line">
        {view.hypotheses.map((h) => {
          const tone = STATUS_TONE[h.status] ?? STATUS_TONE.untested;
          return (
            <li key={h.id} className="grid grid-cols-[auto_1fr] gap-x-4 border-b border-line py-5 sm:grid-cols-[110px_1fr_120px]">
              <div className="flex items-center gap-2 sm:items-start sm:pt-1">
                <span className={cn("h-2 w-2 rounded-full", tone.dot)} />
                <span className={cn("text-[12.5px] font-medium", tone.cls)}>{tone.label}</span>
              </div>
              <div className="col-span-2 mt-2 min-w-0 sm:col-span-1 sm:mt-0">
                <p className="font-serif text-[17.5px] leading-[1.5] text-ink">{h.statement}</p>
                {h.contradiction && (
                  <p className="mt-2 text-meta text-warn">Conflicting evidence: {h.contradiction}</p>
                )}
              </div>
              <div className="col-span-2 mt-3 sm:col-span-1 sm:mt-1.5">
                <StanceBar supports={h.supports} refutes={h.refutes} neutral={h.neutral} />
                <div className="mono mt-1.5 text-[11px] text-ink-faint">
                  {h.supports}+ · {h.refutes}− · {h.neutral}○
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
