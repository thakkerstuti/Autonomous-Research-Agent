"use client";

/**
 * The explanation level of a paper's page notes, always visible in the top bar:
 * switch it at any time, and stop notes while they are being written. Switching
 * or stopping never adds a paper; written notes are kept.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Square } from "lucide-react";
import { apiClient } from "@/lib/api";
import { useOutlineQuery, usePaperQuery } from "@/lib/queries";
import { ThinkingMark } from "@/components/research/thinking-mark";

const LEVELS = ["Beginner", "Medium", "Pro"] as const;
const WORKING = new Set(["pending", "processing"]);

export function NotesLevel({ paperId }: { paperId: string }) {
  const queryClient = useQueryClient();
  const paper = usePaperQuery(paperId).data;
  const pages = useOutlineQuery(paperId).data?.pages ?? [];
  const [busy, setBusy] = useState<"level" | "stop" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const textPages = pages.filter((p) => p.has_text);
  if (!paper || paper.status === "needs_ocr" || !textPages.length) return null;
  const requested = textPages.filter((p) => p.explanation);
  const ready = requested.filter((p) => p.explanation === "ready").length;
  const working = requested.some((p) => WORKING.has(p.explanation!));

  const act = async (key: "level" | "stop", action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      await Promise.all(
        [["paper-outline", paperId], ["paper-status", paperId], ["paper-pages", paperId], ["paper", paperId], ["papers"]].map((k) =>
          queryClient.invalidateQueries({ queryKey: k })
        )
      );
      queryClient.removeQueries({ queryKey: ["paper-page", paperId] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const changeLevel = (next: string) => {
    if (next === (paper.level ?? "Medium") || busy) return;
    const form = new FormData();
    form.append("level", next);
    void act("level", () => apiClient(`/papers/${paperId}`, { method: "PATCH", body: form }));
  };

  return (
    <div className="flex flex-shrink-0 items-center gap-2.5 text-[12.5px] sm:gap-3">
      <label className="flex items-center gap-1.5 text-ink-soft" title="How page notes are explained. You can switch at any time.">
        <span className="hidden sm:inline">Level</span>
        <span className="relative flex items-center">
          <select
            value={paper.level ?? "Medium"}
            onChange={(e) => changeLevel(e.target.value)}
            disabled={busy !== null}
            aria-label="Explanation level"
            className="h-8 cursor-pointer appearance-none rounded-[3px] border border-line bg-bg pl-2 pr-6 sm:pl-2.5 sm:pr-7 text-[12.5px] font-medium text-ink transition-colors hover:border-line-hover focus:border-accent/60 focus:outline-none disabled:opacity-60"
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <ChevronDown size={13} className="pointer-events-none absolute right-1.5 text-ink-soft sm:right-2" />
        </span>
      </label>

      {working && (
        <>
          <span className="hidden items-center gap-1.5 text-ink-soft md:flex" aria-live="polite">
            <ThinkingMark active size={12} /> Notes {ready}/{textPages.length}
          </span>
          <button
            type="button"
            onClick={() => act("stop", () => apiClient(`/papers/${paperId}/stop`, { method: "POST" }))}
            disabled={busy !== null}
            title="Stop writing page notes. Pages already written are kept; you can continue later at any level."
            className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[3px] border border-line px-2.5 font-medium text-ink transition-colors hover:border-line-hover disabled:opacity-60"
          >
            {busy === "stop" ? <ThinkingMark active size={12} /> : <Square size={10} className="fill-current" />} Stop
          </button>
        </>
      )}
      {busy === "level" && <ThinkingMark active size={12} />}
      {error && <span role="alert" className="max-w-[220px] truncate text-bad" title={error}>{error}</span>}
    </div>
  );
}
