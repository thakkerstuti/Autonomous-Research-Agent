"use client";

/**
 * The explanation level of a paper's page notes, always visible in the top bar:
 * switch it at any time, and stop notes while they are being written. Switching
 * or stopping never adds a paper; written notes are kept.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Square } from "lucide-react";
import { apiClient } from "@/lib/api";
import { useOutlineQuery, usePaperQuery } from "@/lib/queries";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const LEVELS = [
  { level: "Beginner", desc: "Plain language, every term explained, simple analogies." },
  { level: "Medium", desc: "Assumes the basics. Focuses on the why." },
  { level: "Pro", desc: "Concise and technical. Contribution and results." },
] as const;
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

  const current = paper.level ?? "Medium";
  const changeLevel = (next: string) => {
    if (next === current || busy) return;
    const form = new FormData();
    form.append("level", next);
    void act("level", () => apiClient(`/papers/${paperId}`, { method: "PATCH", body: form }));
  };

  return (
    <div className="flex flex-shrink-0 items-center gap-2.5 text-[12.5px] sm:gap-3">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={busy !== null}
          aria-label={`Explanation level: ${current}. Change level`}
          className="group flex h-8 items-center gap-1.5 rounded-[3px] border border-line bg-bg pl-2 pr-1.5 text-ink transition-colors hover:border-line-hover focus-visible:border-accent/60 focus-visible:outline-none disabled:opacity-60 data-[state=open]:border-accent/60 sm:pl-2.5 sm:pr-2"
        >
          <span className="hidden text-ink-soft sm:inline">Level</span>
          <span className="font-medium">{current}</span>
          <ChevronDown size={13} className="text-ink-soft transition-transform duration-150 group-data-[state=open]:rotate-180" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="studio w-[264px] !bg-surface p-1.5">
          <p className="px-2.5 pb-1.5 pt-1 text-[11.5px] leading-snug text-ink-faint">
            How page notes are explained. Pages already written at a level are kept.
          </p>
          {LEVELS.map(({ level: l, desc }) => (
            <DropdownMenuItem
              key={l}
              onSelect={() => changeLevel(l)}
              className={cn("items-start gap-2.5 py-2.5", l === current && "bg-accent-soft text-ink")}
            >
              <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center text-accent">
                {l === current && <Check size={14} />}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">{l}</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-ink-soft">{desc}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

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
