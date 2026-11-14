"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import { OutputFormat } from "@/lib/types";
import { cn } from "@/lib/utils";

const FORMATS: { value: OutputFormat; label: string; hint: string }[] = [
  { value: "quick", label: "Quick", hint: "A short, direct answer" },
  { value: "detailed", label: "Detailed", hint: "A fuller explanation" },
  { value: "full", label: "Full report", hint: "A complete cited report" },
];

/** Segmented control whose indicator slides to the selection. */
export function DepthSelector({
  value,
  onChange,
  disabled,
}: {
  value: OutputFormat;
  onChange: (f: OutputFormat) => void;
  disabled?: boolean;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const el = refs.current[value];
    if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
  }, [value]);

  return (
    <div role="radiogroup" aria-label="Answer depth" className="relative inline-flex items-center rounded-[10px] bg-ink/[0.05] p-[3px]">
      {pill && (
        <span
          aria-hidden
          className="absolute left-0 top-[3px] h-[calc(100%-6px)] rounded-[8px] bg-surface shadow-sm transition-[transform,width] duration-300 ease-out"
          style={{ transform: `translateX(${pill.x}px)`, width: pill.w }}
        />
      )}
      {FORMATS.map((f) => (
        <button
          key={f.value}
          ref={(el) => { refs.current[f.value] = el; }}
          type="button"
          role="radio"
          aria-checked={value === f.value}
          title={f.hint}
          disabled={disabled}
          onClick={() => onChange(f.value)}
          className={cn(
            "relative z-10 rounded-[8px] px-2.5 py-1 text-[12px] font-medium transition-colors duration-150 disabled:opacity-50",
            value === f.value ? "text-ink" : "text-ink-faint hover:text-ink"
          )}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

export function Composer({
  placeholder,
  disabled,
  busy,
  onSend,
  format,
  onFormatChange,
}: {
  placeholder: string;
  disabled?: boolean;
  busy?: boolean;
  onSend: (text: string) => void;
  format: OutputFormat;
  onFormatChange: (f: OutputFormat) => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const tooShort = value.trim().length > 0 && value.trim().length < 10;
  const canSend = value.trim().length > 0 && !disabled;

  function submit() {
    if (!canSend) return;
    onSend(value.trim());
    setValue("");
  }

  return (
    <div className="rounded-[18px] bg-surface shadow-panel transition-shadow duration-200 focus-within:shadow-panel-hover">
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="block max-h-[200px] min-h-[52px] w-full resize-none bg-transparent px-4 pb-1 pt-4 text-[15.5px] leading-[1.5] text-ink outline-none placeholder:text-ink-faint"
      />
      <div className="flex items-center justify-between gap-3 px-2.5 pb-2.5 pt-1">
        <DepthSelector value={format} onChange={onFormatChange} disabled={busy} />
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "hidden text-[11.5px] transition-opacity duration-150 sm:block",
              tooShort ? "text-warn opacity-100" : "text-ink-faint opacity-100"
            )}
          >
            {tooShort ? "Questions need at least 10 characters" : "Enter to send · Shift + Enter for a new line"}
          </span>
          <button
            onClick={submit}
            disabled={!canSend}
            aria-label="Send"
            className="pressable flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] bg-primary text-on-primary disabled:opacity-25"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
