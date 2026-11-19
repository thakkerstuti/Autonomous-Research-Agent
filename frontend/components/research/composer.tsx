"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The message box. It only takes the message: how to answer it (quick answer, detailed analysis or
 * research paper) is asked in the conversation once the message is sent.
 */
export function Composer({
  placeholder,
  disabled,
  busy,
  onSend,
}: {
  placeholder: string;
  disabled?: boolean;
  busy?: boolean;
  onSend: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const canSend = value.trim().length > 0 && !disabled;

  function submit() {
    if (!canSend) return;
    onSend(value.trim());
    setValue("");
  }

  return (
    <div className="flex items-end gap-2 rounded-[18px] bg-surface py-2 pl-4 pr-2 shadow-panel transition-shadow duration-200 focus-within:shadow-panel-hover">
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
        className="block max-h-[200px] min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[15.5px] leading-[1.5] text-ink outline-none placeholder:text-ink-faint"
      />
      <button
        onClick={submit}
        disabled={!canSend}
        aria-label="Send"
        className={cn("pressable mb-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] bg-primary text-on-primary disabled:opacity-25")}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={16} />}
      </button>
    </div>
  );
}
