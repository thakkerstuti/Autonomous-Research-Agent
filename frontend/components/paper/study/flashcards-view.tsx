"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, RefreshCw, RotateCcw } from "lucide-react";
import { apiClient } from "@/lib/api";
import { useStudyOutputQuery, type StudyOutput } from "@/lib/queries";
import {
  CARD_CATEGORY_LABEL, clampIndex, deckProgress, nextCardState, visibleCards, type Card, type CardState,
} from "@/lib/study-logic";
import { Button } from "@/components/ui/button";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { cn } from "@/lib/utils";
import { EmptyOutput, KitGate, PageRefs, SectionShell, useStudyActions } from "./study-shared";

function Deck({ paperId, version, onOpenPage }: { paperId: string; version: string | null; onOpenPage: (p: number) => void }) {
  const queryClient = useQueryClient();
  const q = useStudyOutputQuery<{ cards: Card[] }>(paperId, "flashcards", version, true);
  const actions = useStudyActions(paperId);
  const cards = useMemo(() => q.data?.content?.cards ?? [], [q.data]);
  const [states, setStates] = useState<Record<string, CardState>>({});
  const [onlyReview, setOnlyReview] = useState(false);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => setStates(q.data?.progress ?? {}), [q.data]);

  const shown = visibleCards(cards, states, onlyReview);
  const i = clampIndex(index, shown.length);
  const card = shown[i];
  const progress = deckProgress(cards, states);

  useEffect(() => setFlipped(false), [i, onlyReview]);

  const go = (delta: number) => setIndex(clampIndex(i + delta, shown.length));

  // The card on screen right now, for deciding whether to advance after a save
  const currentCardId = useRef<string | undefined>(undefined);
  currentCardId.current = card?.id;
  const [saving, setSaving] = useState<CardState | null>(null);

  /** Saves first; the mark only appears once the server has stored it. */
  const mark = async (chosen: CardState) => {
    if (!card || saving) return;
    const cardId = card.id;
    const next = nextCardState(states[cardId], chosen);
    setSaving(chosen);
    setSaveError(null);
    try {
      const res = await apiClient<{ states: Record<string, CardState> }>(`/papers/${paperId}/study/flashcards/progress`, {
        method: "PUT",
        body: JSON.stringify({ card_id: cardId, state: next }),
      });
      setStates(res.states);
      queryClient.setQueryData<StudyOutput<{ cards: Card[] }>>(["study-output", paperId, "flashcards", version], (old) =>
        old ? { ...old, progress: res.states } : old
      );
      // Move on only if the reader is still on the card they marked
      if (!onlyReview && next && currentCardId.current === cardId) {
        setIndex((prev) => clampIndex(clampIndex(prev, cards.length) + 1, cards.length));
      }
    } catch (err) {
      setSaveError(`Not saved: ${err instanceof Error ? err.message : "please try again."}`);
    } finally {
      setSaving(null);
    }
  };

  // Keyboard: Space/Enter flips, arrows move
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " ") {
        e.preventDefault();
        setFlipped((f) => !f);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (q.isLoading || !q.data) {
    return (
      <div className="flex items-center gap-3 px-6 py-16 text-[14px] text-ink-soft" role="status">
        <ThinkingMark active size={18} /> Loading flashcards…
      </div>
    );
  }
  if (!cards.length) return <SectionShell><EmptyOutput text="No flashcards could be made from this paper." /></SectionShell>;

  return (
    <SectionShell>
      {/* Progress */}
      <div className="animate-view-in flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-[220px] flex-1">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="text-ink-soft">
              <span className="font-semibold text-ink">{progress.known}</span> known · {progress.review} to revise · {progress.unseen} not yet marked
            </span>
            <span className="mono text-[12px] text-ink-faint">{progress.pctKnown}%</span>
          </div>
          <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-ink/[0.07]" role="img" aria-label={`${progress.known} of ${progress.total} cards known`}>
            <div className="h-full bg-ok transition-[width] duration-300 ease-out" style={{ width: `${(progress.known / progress.total) * 100}%` }} />
            <div className="h-full bg-warn/70 transition-[width] duration-300 ease-out" style={{ width: `${(progress.review / progress.total) * 100}%` }} />
          </div>
        </div>
        <div className="inline-flex items-center rounded-[10px] bg-ink/[0.05] p-[3px]" role="radiogroup" aria-label="Which cards">
          {[
            { v: false, label: `All ${cards.length}` },
            { v: true, label: `To revise ${progress.review}` },
          ].map((o) => (
            <button
              key={String(o.v)}
              role="radio"
              aria-checked={onlyReview === o.v}
              onClick={() => { setOnlyReview(o.v); setIndex(0); }}
              className={cn("pressable h-7 rounded-[8px] px-2.5 text-[12.5px] font-medium transition-colors", onlyReview === o.v ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink")}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {!card ? (
        <div className="mt-8"><EmptyOutput text="Nothing marked to revise. Mark cards with “Need revision” to collect them here." /></div>
      ) : (
        <>
          {/* The card */}
          <div className="mt-8 [perspective:1600px]">
            <button
              type="button"
              onClick={() => setFlipped((f) => !f)}
              aria-label={flipped ? "Show the question" : "Show the answer"}
              className="group relative block h-[300px] w-full text-left sm:h-[280px]"
            >
              <div
                className={cn(
                  "relative h-full w-full transition-transform duration-500 [transform-style:preserve-3d] motion-reduce:transition-none",
                  flipped && "[transform:rotateY(180deg)]"
                )}
                style={{ transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)" }}
              >
                <div className="absolute inset-0 flex flex-col rounded-[22px] bg-surface p-7 shadow-panel [backface-visibility:hidden] sm:p-8">
                  <div className="flex items-center justify-between">
                    <span className="col-label">{CARD_CATEGORY_LABEL[card.category] ?? "Card"} · Question</span>
                    {states[card.id] && (
                      <span className={cn("text-[12px] font-medium", states[card.id] === "known" ? "text-ok" : "text-warn")}>
                        {states[card.id] === "known" ? "Known" : "Revising"}
                      </span>
                    )}
                  </div>
                  <p className="my-auto font-display text-[22px] font-semibold leading-snug tracking-[-0.02em] text-ink">{card.question}</p>
                  <span className="text-[12.5px] text-ink-faint">Click or press Space to reveal the answer</span>
                </div>
                <div className="absolute inset-0 flex flex-col rounded-[22px] bg-surface p-7 shadow-panel [backface-visibility:hidden] [transform:rotateY(180deg)] sm:p-8">
                  <span className="col-label">Answer</span>
                  <p className="my-auto font-serif text-[18px] leading-[1.6] text-ink">{card.answer}</p>
                  <span className="text-[12.5px] text-ink-faint">Click to see the question again</span>
                </div>
              </div>
            </button>
          </div>

          <div className="mt-3 flex min-h-[26px] items-center justify-between gap-3">
            <PageRefs pages={card.pages} onOpenPage={onOpenPage} />
            <span className="mono ml-auto text-[12px] text-ink-faint">{i + 1} / {shown.length}</span>
          </div>

          {/* Controls */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" size="sm" onClick={() => go(-1)} disabled={i === 0}>
              <ArrowLeft size={14} /> Previous
            </Button>
            {/* On phones the marking buttons take their own row above Previous / Next */}
            <div className="order-first flex w-full items-center gap-2 sm:order-none sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none">
              <Button
                size="sm"
                variant="outline"
                onClick={() => mark("review")}
                disabled={saving !== null}
                aria-pressed={states[card.id] === "review"}
                className={cn(states[card.id] === "review" && "border-warn/60 text-warn")}
              >
                {saving === "review" ? <ThinkingMark active size={14} /> : <RotateCcw size={14} />} Need revision
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => mark("known")}
                disabled={saving !== null}
                aria-pressed={states[card.id] === "known"}
                className={cn(states[card.id] === "known" && "border-ok/60 text-ok")}
              >
                {saving === "known" ? <ThinkingMark active size={14} /> : <Check size={14} />} Known
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={() => go(1)} disabled={i >= shown.length - 1}>
              Next <ArrowRight size={14} />
            </Button>
          </div>
          {saveError && <p role="alert" className="mt-3 text-[13px] text-bad">{saveError}</p>}
        </>
      )}

      <div className="mt-12 flex flex-wrap items-center gap-3 border-t border-line pt-5 text-[13px] text-ink-soft">
        {confirmRegen ? (
          <>
            <span>Make a new set of cards? Marks are kept for cards that stay the same.</span>
            <Button size="sm" variant="outline" onClick={() => { setConfirmRegen(false); actions.regenerate("flashcards"); }} disabled={actions.busy !== null}>
              Yes, regenerate
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmRegen(false)}>Cancel</Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmRegen(true)} disabled={actions.busy !== null}>
            {actions.busy === "regen-flashcards" ? <ThinkingMark active size={14} /> : <RefreshCw size={14} />} Regenerate flashcards
          </Button>
        )}
        {actions.error && <span role="alert" className="text-bad">{actions.error}</span>}
      </div>
    </SectionShell>
  );
}

export function FlashcardsView({ paperId, onOpenPage }: { paperId: string; onOpenPage: (p: number) => void }) {
  return (
    <KitGate paperId={paperId} kind="flashcards" title="Flashcards">
      {({ version }) => <Deck key={version ?? "v"} paperId={paperId} version={version} onOpenPage={onOpenPage} />}
    </KitGate>
  );
}
