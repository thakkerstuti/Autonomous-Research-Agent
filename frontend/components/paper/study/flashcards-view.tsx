"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, RefreshCw, RotateCcw } from "lucide-react";
import { apiClient } from "@/lib/api";
import { useStudyOutputQuery, type StudyOutput } from "@/lib/queries";
import {
  CARD_CATEGORY_LABEL, clampIndex, deckProgress, nextCardState, visibleCards, type Card, type CardState,
} from "@/lib/study-logic";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { cn } from "@/lib/utils";
import { KitGate, PageRefs, SectionShell, TextAction, useStudyActions } from "./study-shared";

/** The deck under the top card: two sheets peeking out below, so the card reads as one of a set. */
function DeckSheets() {
  return (
    <>
      <span aria-hidden className="absolute inset-x-6 -bottom-[14px] top-6 rounded-[14px] border border-line bg-surface/60" />
      <span aria-hidden className="absolute inset-x-3 -bottom-[7px] top-3 rounded-[14px] border border-line bg-surface/80" />
    </>
  );
}

/** A card-shaped stand-in while cards load, or a quiet empty card when there's nothing to show. */
function CardPlaceholder({ still, message }: { still?: boolean; message?: string }) {
  return (
    <div className="split-deck">
      <div className="relative mx-auto w-full max-w-[720px] pb-4">
        <DeckSheets />
        <div className={cn("relative flex min-h-[360px] flex-col rounded-[14px] border bg-surface p-8", still ? "border-dashed border-line-hover" : "border-line")}>
          {message ? (
            <p className="t-body-sm m-auto max-w-[40ch] text-center">{message}</p>
          ) : (
            <div className="m-auto grid w-full max-w-[460px] gap-3" aria-hidden>
              {[70, 92, 55].map((w, i) => <div key={i} className={cn("mx-auto h-3 rounded-full bg-ink/[0.07]", !still && "animate-pulse")} style={{ width: `${w}%` }} />)}
            </div>
          )}
        </div>
      </div>
      <div className="split-side placeholder-side" aria-hidden>
        <div className="h-3 w-24 rounded-full bg-ink/[0.06]" />
        <div className="mt-4 h-1.5 rounded-full bg-ink/[0.06]" />
      </div>
    </div>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: "ok" | "warn" | "none" }) {
  return (
    <div>
      <p className="figure text-[30px] text-ink">{value}</p>
      <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-ink-soft">
        <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : "bg-ink/20")} />
        {label}
      </p>
    </div>
  );
}

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

  if (q.isLoading || !q.data) return <CardPlaceholder />;
  if (!cards.length) return <CardPlaceholder still message="No flashcards could be made from this paper." />;

  const cardState = card ? states[card.id] : undefined;
  const category = card ? CARD_CATEGORY_LABEL[card.category] ?? "Card" : "";

  return (
    <div className="split-deck">
      {/* Progress, filter and deck actions: beside the card when there is room, below it otherwise (the card leads) */}
      <aside className="split-side" aria-label="Progress">
        <div className="grid max-w-[420px] grid-cols-3 gap-4">
          <Stat value={progress.known} label="Known" tone="ok" />
          <Stat value={progress.review} label="To revise" tone="warn" />
          <Stat value={progress.unseen} label="Not yet" tone="none" />
        </div>
        <div className="mt-5 flex h-1 overflow-hidden rounded-full bg-ink/[0.07]" role="img" aria-label={`${progress.known} of ${progress.total} cards known`}>
          <div className="h-full bg-ok transition-[width] duration-300 ease-out" style={{ width: `${(progress.known / progress.total) * 100}%` }} />
          <div className="h-full bg-warn/80 transition-[width] duration-300 ease-out" style={{ width: `${(progress.review / progress.total) * 100}%` }} />
        </div>
        <p className="t-meta mt-2">
          {progress.known} known · {progress.review} to revise · {progress.unseen} not yet marked
        </p>

        <div className="mt-7 inline-flex items-center rounded-[8px] border border-line p-[3px]" role="radiogroup" aria-label="Which cards">
          {[
            { v: false, label: `All ${cards.length}` },
            { v: true, label: `To revise ${progress.review}` },
          ].map((o) => (
            <button
              key={String(o.v)}
              role="radio"
              aria-checked={onlyReview === o.v}
              onClick={() => { setOnlyReview(o.v); setIndex(0); }}
              className={cn("h-7 rounded-[6px] px-3 text-[12.5px] font-medium transition-colors", onlyReview === o.v ? "bg-ink/[0.08] text-ink" : "text-ink-soft hover:text-ink")}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="mt-8 border-t border-line pt-5 text-[13px] text-ink-soft">
          {confirmRegen ? (
            <div className="grid gap-2.5">
              <p className="t-body-sm">Make a new set of cards? Marks are kept for cards that stay the same.</p>
              <div className="flex gap-4">
                <TextAction onClick={() => { setConfirmRegen(false); actions.regenerate("flashcards"); }} disabled={actions.busy !== null}>Yes, regenerate</TextAction>
                <button type="button" onClick={() => setConfirmRegen(false)} className="text-[13px] text-ink-soft hover:text-ink">Cancel</button>
              </div>
            </div>
          ) : (
            <TextAction onClick={() => setConfirmRegen(true)} disabled={actions.busy !== null} busy={actions.busy === "regen-flashcards"} icon={<RefreshCw size={13} />}>
              Regenerate flashcards
            </TextAction>
          )}
          {actions.error && <p role="alert" className="mt-2 text-bad">{actions.error}</p>}
        </div>
      </aside>

      <div className="min-w-0">
        {!card ? (
          <CardPlaceholder still message="Nothing marked to revise. Mark cards with “Need revision” to collect them here." />
        ) : (
          <div className="mx-auto w-full max-w-[720px]">
            {/* The card */}
            <div className="relative pb-4 [perspective:1800px]">
              <DeckSheets />
              <button
                type="button"
                onClick={() => setFlipped((f) => !f)}
                aria-label={flipped ? "Show the question" : "Show the answer"}
                className="group relative block h-[380px] w-full text-left sm:h-[360px]"
              >
                <div
                  className={cn(
                    "relative h-full w-full transition-transform duration-500 [transform-style:preserve-3d] motion-reduce:transition-none",
                    flipped && "[transform:rotateY(180deg)]"
                  )}
                  style={{ transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)" }}
                >
                  <div className="flashcard-face">
                    <div className="flex items-center justify-between gap-3">
                      <span className="t-label">{category}</span>
                      <span className="flex items-center gap-3">
                        {cardState && (
                          <span className={cn("flex items-center gap-1.5 text-[12px] font-medium", cardState === "known" ? "text-ok" : "text-warn")}>
                            <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", cardState === "known" ? "bg-ok" : "bg-warn")} />
                            {cardState === "known" ? "Known" : "Revising"}
                          </span>
                        )}
                        <span className="t-meta">{i + 1} / {shown.length}</span>
                      </span>
                    </div>
                    <p className="my-auto max-w-[32ch] py-6 font-display text-[27px] font-medium leading-[1.3] tracking-[-0.012em] text-ink sm:text-[30px]">{card.question}</p>
                    <span className="flex items-center gap-2 text-[12.5px] text-ink-faint">
                      <kbd className="kbd">Space</kbd> or click to reveal the answer
                    </span>
                  </div>
                  <div className="flashcard-face [transform:rotateY(180deg)]">
                    <div className="flex items-center justify-between gap-3">
                      <span className="t-label">Answer</span>
                      <span className="t-meta">{i + 1} / {shown.length}</span>
                    </div>
                    <div className="my-auto py-6">
                      <p className="mb-4 font-display text-[15px] italic leading-snug text-ink-soft">{card.question}</p>
                      <p className="max-w-[60ch] text-[17px] leading-[1.7] text-ink">{card.answer}</p>
                    </div>
                    <span className="text-[12.5px] text-ink-faint">Click to see the question again</span>
                  </div>
                </div>
              </button>
            </div>

            <div className="mt-3 flex min-h-[24px] items-center justify-between gap-3">
              <span className="flex items-center gap-1.5">
                {card.pages.length > 0 && <span className="text-[12.5px] text-ink-faint">From</span>}
                <PageRefs pages={card.pages} onOpenPage={onOpenPage} />
              </span>
            </div>

            {/* Controls */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => go(-1)} disabled={i === 0} aria-label="Previous card" title="Previous card (←)" className="flex h-9 w-9 items-center justify-center rounded-[8px] text-ink-soft transition-colors hover:bg-ink/[0.05] hover:text-ink disabled:opacity-30">
                  <ArrowLeft size={16} />
                </button>
                <span className="t-meta w-16 text-center">{i + 1} of {shown.length}</span>
                <button type="button" onClick={() => go(1)} disabled={i >= shown.length - 1} aria-label="Next card" title="Next card (→)" className="flex h-9 w-9 items-center justify-center rounded-[8px] text-ink-soft transition-colors hover:bg-ink/[0.05] hover:text-ink disabled:opacity-30">
                  <ArrowRight size={16} />
                </button>
              </div>
              <div className="flex w-full items-center gap-2.5 sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none">
                <button
                  type="button"
                  onClick={() => mark("review")}
                  disabled={saving !== null}
                  aria-pressed={cardState === "review"}
                  className={cn("mark-btn mark-btn--review", cardState === "review" && "is-on")}
                >
                  {saving === "review" ? <ThinkingMark active size={14} /> : <RotateCcw size={14} />} Need revision
                </button>
                <button
                  type="button"
                  onClick={() => mark("known")}
                  disabled={saving !== null}
                  aria-pressed={cardState === "known"}
                  className={cn("mark-btn mark-btn--known", cardState === "known" && "is-on")}
                >
                  {saving === "known" ? <ThinkingMark active size={14} /> : <Check size={14} />} Known
                </button>
              </div>
            </div>
            {saveError && <p role="alert" className="mt-3 text-[13px] text-bad">{saveError}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

export function FlashcardsView({ paperId, onOpenPage }: { paperId: string; onOpenPage: (p: number) => void }) {
  return (
    <SectionShell title="Flashcards" meta="Read the question, answer it in your head, then flip the card and mark how it went. Your progress is saved.">
      <KitGate paperId={paperId} kind="flashcards" title="Flashcards" placeholder={(still) => <CardPlaceholder still={still} message={still ? "Cards appear here once they're written." : undefined} />}>
        {({ version }) => <Deck key={version ?? "v"} paperId={paperId} version={version} onOpenPage={onOpenPage} />}
      </KitGate>
    </SectionShell>
  );
}
