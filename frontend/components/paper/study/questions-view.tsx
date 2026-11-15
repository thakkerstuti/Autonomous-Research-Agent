"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronDown } from "lucide-react";
import { useStudyOutputQuery } from "@/lib/queries";
import { groupByCategory, QUESTION_CATEGORIES } from "@/lib/study-logic";
import { cn } from "@/lib/utils";
import { EmptyOutput, KitGate, PageRefs, SectionShell, TextSkeleton } from "./study-shared";

interface BankQuestion {
  id: string;
  category: string;
  question: string;
  answer: string;
  pages: number[];
}

function QuestionItem({ q, n, onOpenPage }: { q: BankQuestion; n: number; onOpenPage: (p: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-line">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group grid w-full grid-cols-[30px_minmax(0,1fr)_auto] items-baseline gap-x-3 py-4 text-left"
      >
        <span className="t-meta">{String(n).padStart(2, "0")}</span>
        <span className="text-[15.5px] font-medium leading-[1.5] text-ink transition-colors group-hover:text-accent">{q.question}</span>
        <span className="flex items-center gap-1 text-[12.5px] text-ink-faint transition-colors group-hover:text-ink">
          {open ? "Hide" : "Answer"}
          <ChevronDown size={14} className={cn("transition-transform duration-200", open && "rotate-180")} />
        </span>
      </button>
      {open && (
        <div className="animate-view-in grid grid-cols-[30px_minmax(0,1fr)] gap-x-3 pb-6">
          <div className="col-start-2 max-w-[68ch]">
            <div className="report-prose !text-[16.5px]"><ReactMarkdown>{q.answer}</ReactMarkdown></div>
            <PageRefs pages={q.pages} onOpenPage={onOpenPage} className="-ml-1 mt-2" />
          </div>
        </div>
      )}
    </li>
  );
}

function Bank({ paperId, version, onOpenPage }: { paperId: string; version: string | null; onOpenPage: (p: number) => void }) {
  const q = useStudyOutputQuery<{ questions: BankQuestion[] }>(paperId, "questions", version, true);
  const [filter, setFilter] = useState("all");
  if (!q.data?.content) return <TextSkeleton />;
  const groups = groupByCategory(q.data.content.questions, QUESTION_CATEGORIES);
  if (!groups.length) return <EmptyOutput text="No questions could be made from this paper." />;
  const shown = filter === "all" ? groups : groups.filter((g) => g.key === filter);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  let n = 0;

  return (
    <div className="split-index">
      <nav aria-label="Question type" className="split-side min-w-0">
        <div role="radiogroup" aria-label="Question type" className="index-list -mx-1 flex flex-wrap gap-1">
          {[{ key: "all", label: "All questions", count: total }, ...groups.map((g) => ({ key: g.key, label: g.label, count: g.items.length }))].map((o) => (
            <button
              key={o.key}
              role="radio"
              aria-checked={filter === o.key}
              onClick={() => setFilter(o.key)}
              className={cn(
                "flex flex-shrink-0 items-baseline justify-between gap-3 whitespace-nowrap rounded-[6px] px-2.5 py-1.5 text-left text-[13.5px] transition-colors",
                filter === o.key ? "bg-ink/[0.06] font-medium text-ink" : "text-ink-soft hover:bg-ink/[0.03] hover:text-ink"
              )}
            >
              {o.label}
              <span className="t-meta">{o.count}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="min-w-0">
        {shown.map((g, gi) => (
          <section key={g.key} aria-label={g.label} className={gi > 0 ? "mt-12" : ""}>
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="t-heading">{g.label}</h2>
              <span className="t-meta">{g.items.length} question{g.items.length > 1 ? "s" : ""}</span>
            </div>
            <ul className="mt-3 border-t border-line">
              {g.items.map((item) => <QuestionItem key={item.id} q={item} n={++n} onOpenPage={onOpenPage} />)}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

export function QuestionsView({ paperId, onOpenPage }: { paperId: string; onOpenPage: (p: number) => void }) {
  return (
    <SectionShell title="Questions" meta="From basic understanding to critical thinking. Try each one, then reveal the answer and the page it comes from.">
      <KitGate paperId={paperId} kind="questions" title="Questions">
        {({ version }) => <Bank paperId={paperId} version={version} onOpenPage={onOpenPage} />}
      </KitGate>
    </SectionShell>
  );
}
