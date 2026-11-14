"use client";

import { useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { EvidenceChart } from "./evidence-chart";
import { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

export function AgentStepsCard({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const steps = message.steps ?? [];

  return (
    <div className="mb-5 rounded-2xl bg-surface shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ok/15 text-ok">
          <Check size={12} strokeWidth={2.5} />
        </span>
        <span className="flex-1 text-[13px] font-medium text-ink">
          {steps.length} step{steps.length === 1 ? "" : "s"}
          {message.sources ? <span className="text-ink-faint"> · {message.sources.length} sources</span> : null}
        </span>
        <ChevronDown
          size={15}
          className={cn("text-ink-faint transition-transform duration-200 ease-out", open && "rotate-180")}
        />
      </button>

      {/* grid-rows trick: animates to auto height without measuring */}
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">
          <ol className="relative mx-4 border-t border-line pb-4 pt-4">
            {steps.map((step, i) => (
              <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                {i < steps.length - 1 && <span className="absolute left-[3px] top-3 h-full w-px bg-line" />}
                <span className="mt-[7px] h-[7px] w-[7px] flex-shrink-0 rounded-full bg-ink-faint/60" />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-ink">{step.label}</div>
                  {step.detail && <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-soft">{step.detail}</div>}
                </div>
              </li>
            ))}
          </ol>

          {message.sources && message.sources.length > 0 && (
            <div className="mx-4 mb-4 rounded-xl bg-surface2 p-4">
              <div className="mb-3 text-[12px] font-semibold tracking-[0.04em] text-accent">Source confidence</div>
              <EvidenceChart sources={message.sources} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
