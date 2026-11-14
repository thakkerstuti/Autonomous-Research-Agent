"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { Lightbulb, Eye, Flag, ArrowUpRight, ShieldCheck } from "lucide-react";
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
        blockquote: ({ node, children }) => (
          <aside className="not-prose my-6 flex gap-3 rounded-xl bg-warn/[0.07] px-5 py-4 font-sans text-[14.5px] leading-relaxed text-ink-soft [&_p]:m-0">
            <Eye size={16} className="mt-1 flex-shrink-0 text-warn" />
            <div className="min-w-0">{children}</div>
          </aside>
        ),
      }}
    >
      {prepared}
    </ReactMarkdown>
  );
}

const SECTION_ICON: Partial<Record<Kind, React.ElementType>> = { insight: Lightbulb, observation: Eye, conclusion: Flag };

export function ReportBody({ markdown, view }: { markdown: string; view?: ResearchView }) {
  const evidence = useMemo(() => new Map((view?.evidence ?? []).map((e) => [e.id, e])), [view]);
  const sections = useMemo(() => {
    const all = splitSections(markdown);
    // The evidence rail lists sources, so the report's own reference list is folded away
    return view ? all.filter((s) => s.kind !== "references") : all;
  }, [markdown, view]);

  return (
    <div className="flex flex-col gap-9">
      {sections.map((s, i) => {
        const Icon = SECTION_ICON[s.kind];
        const heading = s.heading ? (
          <h3
            className={cn(
              "mb-3 flex items-center gap-2 font-sans font-semibold tracking-[-0.012em] text-ink",
              s.level === 1 ? "text-[19px]" : "text-[16px]"
            )}
          >
            {Icon && <Icon size={16} className={cn(s.kind === "observation" ? "text-warn" : "text-accent")} />}
            {s.heading}
          </h3>
        ) : null;

        if (s.kind === "summary") {
          return (
            <section key={i}>
              {heading}
              <div className="report-prose !text-[20px] !leading-[1.6] !text-ink sm:!text-[21px]">
                <Markdown text={s.body} evidence={evidence} />
              </div>
            </section>
          );
        }
        if (s.kind === "insight") {
          return (
            <section key={i} className="rounded-2xl bg-accent-soft px-6 py-5 sm:px-7 sm:py-6">
              {heading}
              <div className="report-prose !text-[17px]">
                <Markdown text={s.body} evidence={evidence} />
              </div>
            </section>
          );
        }
        if (s.kind === "observation") {
          return (
            <section key={i} className="rounded-2xl bg-warn/[0.06] px-6 py-5 sm:px-7 sm:py-6">
              {heading}
              <div className="report-prose !text-[16.5px]">
                <Markdown text={s.body} evidence={evidence} />
              </div>
            </section>
          );
        }
        if (s.kind === "conclusion") {
          return (
            <section key={i} className="border-t border-ink/80 pt-6">
              {heading}
              <div className="report-prose !text-[19px] !text-ink">
                <Markdown text={s.body} evidence={evidence} />
              </div>
            </section>
          );
        }
        return (
          <section key={i} className={cn(s.kind === "findings" && "[&_.report-prose_ol]:pl-0")}>
            {heading && <div className={cn(i > 0 && "border-t border-line pt-7")}>{heading}</div>}
            <div className="report-prose">
              <Markdown text={s.body} evidence={evidence} />
            </div>
          </section>
        );
      })}
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
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface3 font-serif text-[14px] uppercase text-ink-soft">
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
