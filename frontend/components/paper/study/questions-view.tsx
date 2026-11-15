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

function QuestionItem({ q, onOpenPage }: { q: BankQuestion; onOpenPage: (p: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-line">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-3 py-3.5 text-left">
        <span className="flex-1 text-[15px] leading-snug text-ink">{q.question}</span>
        <span className="flex flex-shrink-0 items-center gap-1 pt-0.5 text-[12.5px] text-ink-faint">
          {open ? "Hide" : "Answer"}
          <ChevronDown size={14} className={cn("transition-transform duration-200", open && "rotate-180")} />
        </span>
      </button>
      {open && (
        <div className="animate-view-in pb-5 pr-6">
          <div className="report-prose chat-prose"><ReactMarkdown>{q.answer}</ReactMarkdown></div>
          <PageRefs pages={q.pages} onOpenPage={onOpenPage} className="mt-2" />
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

  return (
    <div className="animate-view-in">
      <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-[13px]" role="radiogroup" aria-label="Question type">
        {[{ key: "all", label: "All" }, ...groups.map((g) => ({ key: g.key, label: g.label }))].map((o) => (
          <button
            key={o.key}
            role="radio"
            aria-checked={filter === o.key}
            onClick={() => setFilter(o.key)}
            className={cn("pressable border-b pb-1 transition-colors", filter === o.key ? "border-accent font-medium text-ink" : "border-transparent text-ink-soft hover:text-ink")}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="mt-6 grid gap-9">
        {shown.map((g) => (
          <section key={g.key} aria-label={g.label}>
            <h2 className="col-label">{g.label}</h2>
            <ul className="mt-2 border-t border-line">
              {g.items.map((item) => <QuestionItem key={item.id} q={item} onOpenPage={onOpenPage} />)}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

export function QuestionsView({ paperId, onOpenPage }: { paperId: string; onOpenPage: (p: number) => void }) {
  return (
    <SectionShell title="Questions" meta="From basic understanding to critical thinking. Reveal each answer when you're ready.">
      <KitGate paperId={paperId} kind="questions" title="Questions">
        {({ version }) => <Bank paperId={paperId} version={version} onOpenPage={onOpenPage} />}
      </KitGate>
    </SectionShell>
  );
}
