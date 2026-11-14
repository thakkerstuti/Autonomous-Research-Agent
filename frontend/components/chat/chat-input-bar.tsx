"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";

export function ChatInputBar({
  placeholder,
  disabled,
  onSend,
}: {
  placeholder: string;
  disabled?: boolean;
  onSend: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  function submit() {
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue("");
  }

  const canSend = !!value.trim() && !disabled;

  return (
    <div className="px-4 pb-4 pt-2 sm:px-7 sm:pb-6">
      <div className="mx-auto max-w-[760px]">
        <div className="flex items-end gap-2 rounded-[20px] bg-surface p-2 pl-4 shadow-panel transition-shadow duration-200 focus-within:shadow-panel-hover">
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
            className="max-h-[180px] min-h-[40px] flex-1 resize-none bg-transparent py-2.5 text-[15px] leading-[1.45] text-ink outline-none placeholder:text-ink-faint"
          />
          <button
            onClick={submit}
            disabled={!canSend}
            aria-label="Send"
            className="pressable flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[14px] bg-primary text-on-primary disabled:opacity-25"
          >
            <ArrowUp size={17} />
          </button>
        </div>
        <p className="mt-2 hidden text-center text-[11.5px] text-ink-faint sm:block">
          <kbd className="font-sans">Enter</kbd> to send · <kbd className="font-sans">Shift + Enter</kbd> for a new line
        </p>
      </div>
    </div>
  );
}
