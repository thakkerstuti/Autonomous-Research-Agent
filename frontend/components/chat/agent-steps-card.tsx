"use client";

import { useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EvidenceChart } from "./evidence-chart";
import { ChatMessage } from "@/lib/types";

export function AgentStepsCard({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(true);

  return (
    <Card className="mb-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between border-y border-line py-2 text-sm font-medium text-ink-soft"
      >
        Steps taken
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="mt-4 flex flex-col gap-4">
          {message.steps?.map((step, i) => (
            <div key={i} className="flex gap-3">
              <div className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-ink-faint" />
              <div>
                <div className="text-sm font-medium">{step.label}</div>
                <div className="mt-1 rounded-md border border-line bg-surface2 px-3 py-2 text-xs text-ink-soft">
                  {step.detail}
                </div>
              </div>
            </div>
          ))}

          {message.sources && (
            <div className="rounded-lg border border-line bg-surface2 p-3">
              <div className="mb-2 text-xs font-medium text-ink-soft">
                Reviewing sources <span className="ml-1 rounded-full border border-line px-2 text-[11px]">{message.sources.length}</span>
              </div>
              <EvidenceChart sources={message.sources} />
            </div>
          )}

          {message.status === "done" && (
            <div className="flex gap-3">
              <div className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-ok" />
              <div className="text-sm font-medium">Finished</div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
