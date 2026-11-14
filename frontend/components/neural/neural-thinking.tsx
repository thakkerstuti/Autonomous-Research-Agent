"use client";

import { useEffect, useState } from "react";
import { NeuralField } from "./neural-field";
import { cn } from "@/lib/utils";

function useElapsed() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = window.setInterval(() => setS(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** The thinking state: a live neuron in a dark lens with an honest elapsed timer. */
export function NeuralThinking({
  label = "Thinking",
  detail = "Searching, reading and cross-checking sources",
  className,
  height = 232,
}: {
  label?: string;
  detail?: string;
  className?: string;
  height?: number;
}) {
  const elapsed = useElapsed();

  return (
    <div
      className={cn("lens rounded-2xl", className)}
      style={{ height }}
      role="status"
      aria-live="polite"
      aria-label={`${label}. ${detail}.`}
    >
      <NeuralField mode="thinking" />
      <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-4 px-5 pb-4 pt-10 [background:linear-gradient(to_top,rgb(5_5_6/0.85),transparent)]">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-medium text-[#F3F1EE]">
            <span className="live-dot !bg-[#E8A8D6]" />
            {label}
          </div>
          <p className="mt-0.5 truncate text-[12px] text-[#A3A09C]">{detail}</p>
        </div>
        <span className="mono flex-shrink-0 text-[12px] text-[#A3A09C]">{elapsed}</span>
      </div>
    </div>
  );
}
