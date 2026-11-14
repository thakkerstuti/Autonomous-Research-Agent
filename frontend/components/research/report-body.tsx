"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { ResearchView, ViewEvidence, STANCE_TONE } from "@/lib/research-view";
import { cn } from "@/lib/utils";

type Kind = "summary" | "findings" | "insight" | "observation" | "conclusion" | "references" | "body";

function classify(heading: string): Kind {
  const h = heading.toLowerCase();
  if (/reference|^sources|cited sources|citation|bibliograph/.test(h)) return "references";
  if (/conclusion|verdict|recommendation|final answer|bottom line/.test(h)) return "conclusion";
  if (/insight|implication|takeaway|key point|what this means/.test(h)) return "insight";
  if (/limitation|caveat|uncertaint|observation|contradict|conflict|gap|risk|note/.test(h)) return "observation";
  if (/summary|overview|short answer|tl;?dr|abstract|executive|answer/.test(h)) return "summary";
  if (/finding|result|evidence|analysis/.test(h)) return "findings";
  return "body";
}

interface Section { kind: Kind; heading: string | null; level: number; body: string }

function splitSections(md: string): Section[] {
  const lines = md.split("\n");
  const out: Section[] = [];
  let cur: Section = { kind: "body", heading: null, level: 0, body: "" };
  for (const line of lines) {
    const m = line.match(/^(#{1,2})\s+(.*)$/);
    if (m) {
      if (cur.heading || cur.body.trim()) out.push(cur);
      cur = { kind: classify(m[2]), heading: m[2].replace(/[*_`]/g, "").trim(), level: m[1].length, body: "" };
    } else {
      cur.body += line + "\n";
    }
  }
  if (cur.heading || cur.body.trim()) out.push(cur);
  return out;
}

/* Inline citation chip with a hover preview of the quoted evidence */
function CitationChip({ ev, label }: { ev?: ViewEvidence; label: string }) {
  if (!ev) return <span className="mono text-[0.72em] text-ink-faint">[{label}]</span>;
  const tone = STANCE_TONE[ev.stance];
  return (
    <span className="group/cite relative inline-block align-baseline">
      <a
        href={ev.highlightUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mono relative -top-[0.35em] ml-0.5 inline-flex h-[18px] min-w-[22px] items-center justify-center rounded-[5px] bg-accent-soft px-1 text-[10.5px] font-medium leading-none text-accent no-underline transition-colors hover:bg-accent hover:text-on-primary"
        aria-label={`Source ${label}: ${ev.title}`}
      >
        {label.replace(/^E/, "")}
      </a>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-[calc(100%+6px)] left-1/2 z-40 w-[300px] origin-bottom -translate-x-1/2 translate-y-1 scale-[0.97] rounded-xl bg-surface p-4 font-sans text-[12.5px] leading-snug opacity-0 shadow-panel transition-[opacity,transform,visibility] duration-150 ease-out group-hover/cite:visible group-hover/cite:translate-y-0 group-hover/cite:scale-100 group-hover/cite:opacity-100 group-hover/cite:delay-200"
      >
        <span className="flex items-center justify-between gap-3 text-[11px] text-ink-faint">
          <span className="truncate">{ev.domain}</span>
          <span className={cn("flex-shrink-0 font-medium", tone.cls)}>{tone.label}</span>
        </span>
        <span className="mt-1.5 block font-medium text-ink">{ev.title}</span>
        {(ev.quote || ev.snippet) && (
          <span className="mt-2 block font-serif text-[13.5px] italic leading-relaxed text-ink-soft">
            “{(ev.quote || ev.snippet).slice(0, 220)}{(ev.quote || ev.snippet).length > 220 ? "…" : ""}”
          </span>
        )}
        <span className="mt-2.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
          {ev.verification === "verified" && <><ShieldCheck size={12} className="text-ok" /> Quote verified in source ·</>}
          <span className="mono">{ev.confidence}% confidence</span>
        </span>
      </span>
    </span>
  );
}

function Markdown({ text, evidence }: { text: string; evidence: Map<string, ViewEvidence> }) {
  // [E12] → a link the renderer turns into a citation chip
  const prepared = useMemo(() => text.replace(/\[(E\d+)\]/g, "[$1](#cite-$1)"), [text]);
  return (
    <ReactMarkdown
      components={{
        a: ({ node, href, children, ...props }) => {
          if (href?.startsWith("#cite-")) {
            const id = href.slice(6);
            return <CitationChip ev={evidence.get(id)} label={id} />;
          }
          return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
        },
      }}
    >
      {prepared}
    </ReactMarkdown>
  );
}

export function ReportBody({ markdown, view }: { markdown: string; view?: ResearchView }) {
  const evidence = useMemo(() => new Map((view?.evidence ?? []).map((e) => [e.id, e])), [view]);
  const text = useMemo(() => {
    const sections = splitSections(markdown);
    // Sources are listed under the answer, so the report's own reference list is dropped
    const kept = view ? sections.filter((s) => s.kind !== "references") : sections;
    return kept
      .map((s) => (s.heading ? `${"#".repeat(s.level)} ${s.heading}\n${s.body}` : s.body))
      .join("\n");
  }, [markdown, view]);

  return (
    <div className="report-prose chat-prose">
      <Markdown text={text} evidence={evidence} />
    </div>
  );
}

/* Compact source line used under reports on narrow screens and in the rail */
export function SourceRow({ s, index }: { s: ResearchView["sources"][number]; index: number }) {
  const lead = s.stances.supports >= s.stances.refutes ? (s.stances.supports ? "supports" : "neutral") : "refutes";
  return (
    <a
      href={s.highlightUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group grid grid-cols-[28px_1fr_auto] items-start gap-3 rounded-xl px-2 py-3 transition-colors duration-150 hover:bg-surface2"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface3 text-[12px] font-semibold uppercase text-ink-soft">
        {s.domain.charAt(0)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-ink">{s.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-faint">
          <span className="truncate">{s.domain}</span>
          {s.verified && <ShieldCheck size={11} className="flex-shrink-0 text-ok" aria-label="Quote verified" />}
          <span className={cn("flex-shrink-0", STANCE_TONE[lead as keyof typeof STANCE_TONE].cls)}>
            · {STANCE_TONE[lead as keyof typeof STANCE_TONE].label}
          </span>
        </span>
      </span>
      <span className="flex items-center gap-1.5 pt-0.5">
        <span className="mono text-[11.5px] text-ink-soft">{s.confidence}%</span>
        <ArrowUpRight size={13} className="text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
      <span className="sr-only">Source {index + 1}</span>
    </a>
  );
}
