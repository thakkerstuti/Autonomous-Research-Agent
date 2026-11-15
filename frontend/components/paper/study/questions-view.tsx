"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ChevronDown, CircleHelp, Quote, ShieldCheck, ShieldQuestion } from "lucide-react";
import { apiClient } from "@/lib/api";
import { useAsksQuery, useStudyOutputQuery, type AskEntry } from "@/lib/queries";
import { groupByCategory, QUESTION_CATEGORIES } from "@/lib/study-logic";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { cn } from "@/lib/utils";
import { EmptyOutput, KitGate, PageRefs } from "./study-shared";

interface BankQuestion {
  id: string;
  category: string;
  question: string;
  answer: string;
  pages: number[];
}

function AskAnswerCard({ entry, onOpenPage }: { entry: AskEntry; onOpenPage: (p: number) => void }) {
  return (
    <article className="animate-view-in rounded-2xl bg-surface p-5 shadow-sm">
      <p className="text-[14.5px] font-medium text-ink">{entry.question}</p>
      <div className={cn("report-prose chat-prose mt-2.5", !entry.found && "text-ink-soft")}>
        <ReactMarkdown>{entry.answer}</ReactMarkdown>
      </div>
      {entry.found && entry.citations.length > 0 && (
        <ul className="mt-4 grid gap-2">
          {entry.citations.map((c, i) => (
            <li key={i} className="flex items-start gap-2.5 rounded-xl bg-ink/[0.035] px-3 py-2.5 text-[13px]">
              <Quote size={13} className="mt-0.5 flex-shrink-0 text-ink-faint" />
              <span className="min-w-0 flex-1 italic text-ink-soft">&ldquo;{c.quote}&rdquo;</span>
              <span className="flex flex-shrink-0 items-center gap-2">
                <span
                  className={cn("flex items-center gap-1 text-[11.5px] font-medium", c.verified ? "text-ok" : "text-warn")}
                  title={c.verified ? "This exact text appears on that page" : "This quote couldn't be matched to the page text"}
                >
                  {c.verified ? <ShieldCheck size={12} /> : <ShieldQuestion size={12} />}
                  {c.verified ? "Quoted" : "Unverified"}
                </span>
                <PageRefs pages={[c.page]} onOpenPage={onOpenPage} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {entry.found && !entry.grounded && (
        <p className="mt-3 text-[12.5px] text-warn">None of the quotes could be matched to the page text; check the pages before relying on this answer.</p>
      )}
    </article>
  );
}

function AskPanel({ paperId, onOpenPage }: { paperId: string; onOpenPage: (p: number) => void }) {
  const queryClient = useQueryClient();
  const history = useAsksQuery(paperId);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = [...(history.data?.items ?? [])].reverse();
  const tooShort = question.trim().length < 3;

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tooShort || asking) return;
    setAsking(true);
    setError(null);
    try {
      const entry = await apiClient<AskEntry>(`/papers/${paperId}/ask`, { method: "POST", body: JSON.stringify({ question: question.trim() }) });
      queryClient.setQueryData<{ items: AskEntry[] }>(["paper-asks", paperId], (old) => ({ items: [...(old?.items ?? []), entry] }));
      setQuestion("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't answer that. Please try again.");
    } finally {
      setAsking(false);
    }
  };

  return (
    <section aria-labelledby="ask-title">
      <h2 id="ask-title" className="font-display text-[19px] font-semibold tracking-[-0.02em] text-ink">Ask this paper</h2>
      <p className="mt-1 text-[13.5px] text-ink-soft">Answers come only from this paper, with the pages they quote. If it isn&rsquo;t in the paper, CogNexa says so.</p>
      <form onSubmit={ask} className="mt-4 flex items-end gap-2 rounded-2xl bg-surface p-2 shadow-sm focus-within:shadow-[0_0_0_1.5px_rgb(var(--accent)/0.5)]">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void ask(e as unknown as React.FormEvent);
            }
          }}
          rows={1}
          maxLength={500}
          placeholder="e.g. What dataset did the authors use?"
          aria-label="Your question about this paper"
          className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-3 py-2.5 text-[14.5px] text-ink outline-none placeholder:text-ink-faint"
        />
        <button
          type="submit"
          disabled={tooShort || asking}
          aria-label="Ask"
          className="pressable flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary disabled:opacity-40"
        >
          {asking ? <ThinkingMark active size={16} /> : <ArrowUp size={17} />}
        </button>
      </form>
      {asking && <p role="status" className="mt-2 text-[12.5px] text-ink-faint">Finding the relevant pages and reading them…</p>}
      {error && <p role="alert" className="mt-2 text-[13px] text-bad">{error}</p>}
      {items.length > 0 && (
        <div className="mt-5 grid gap-3">
          {items.map((entry) => <AskAnswerCard key={entry.id} entry={entry} onOpenPage={onOpenPage} />)}
        </div>
      )}
    </section>
  );
}

function QuestionItem({ q, onOpenPage }: { q: BankQuestion; onOpenPage: (p: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-2xl bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-5 py-4 text-left"
      >
        <CircleHelp size={16} className="mt-0.5 flex-shrink-0 text-ink-faint" />
        <span className="flex-1 text-[14.5px] font-medium leading-snug text-ink">{q.question}</span>
        <span className="flex flex-shrink-0 items-center gap-1 text-[12.5px] text-ink-faint">
          {open ? "Hide" : "Show answer"}
          <ChevronDown size={14} className={cn("transition-transform duration-200", open && "rotate-180")} />
        </span>
      </button>
      {open && (
        <div className="animate-view-in border-t border-line px-5 pb-4 pt-3">
          <div className="report-prose chat-prose"><ReactMarkdown>{q.answer}</ReactMarkdown></div>
          <PageRefs pages={q.pages} onOpenPage={onOpenPage} className="mt-3" />
        </div>
      )}
    </li>
  );
}

function QuestionBankBody({ paperId, version, onOpenPage }: { paperId: string; version: string | null; onOpenPage: (p: number) => void }) {
  const q = useStudyOutputQuery<{ questions: BankQuestion[] }>(paperId, "questions", version, true);
  const [filter, setFilter] = useState<string>("all");
  if (!q.data?.content) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-ink-soft" role="status">
        <ThinkingMark active size={18} /> Loading questions…
      </div>
    );
  }
  const groups = groupByCategory(q.data.content.questions, QUESTION_CATEGORIES);
  if (!groups.length) return <EmptyOutput text="No questions could be made from this paper." />;
  const shown = filter === "all" ? groups : groups.filter((g) => g.key === filter);

  return (
    <>
      <div className="mt-4 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Question type">
        {[{ key: "all", label: "All" }, ...groups.map((g) => ({ key: g.key, label: g.label }))].map((o) => (
          <button
            key={o.key}
            role="radio"
            aria-checked={filter === o.key}
            onClick={() => setFilter(o.key)}
            className={cn(
              "pressable h-8 rounded-full px-3 text-[12.5px] font-medium transition-colors",
              filter === o.key ? "bg-primary text-on-primary" : "bg-ink/[0.05] text-ink-soft hover:text-ink"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="mt-6 grid gap-8">
        {shown.map((g) => (
          <section key={g.key} aria-label={g.label}>
            <h3 className="col-label mb-3">{g.label}</h3>
            <ul className="grid gap-2.5">
              {g.items.map((item) => <QuestionItem key={item.id} q={item} onOpenPage={onOpenPage} />)}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

export function QuestionsView({ paperId, onOpenPage }: { paperId: string; onOpenPage: (p: number) => void }) {
  return (
    <div className="mx-auto max-w-[760px] px-5 pb-20 pt-8 sm:px-8">
      <AskPanel paperId={paperId} onOpenPage={onOpenPage} />
      <div className="mt-14">
        <h2 className="font-display text-[19px] font-semibold tracking-[-0.02em] text-ink">Question bank</h2>
        <p className="mt-1 text-[13.5px] text-ink-soft">From basic understanding to critical thinking. Reveal each answer when you&rsquo;re ready.</p>
        <div className="-mx-5 sm:-mx-8">
          <KitGate paperId={paperId} kind="questions" title="Question bank">
            {({ version }) => (
              <div className="px-5 sm:px-8">
                <QuestionBankBody paperId={paperId} version={version} onOpenPage={onOpenPage} />
              </div>
            )}
          </KitGate>
        </div>
      </div>
    </div>
  );
}
