"use client";

import { useState } from "react";
import { ArrowUp } from "lucide-react";
import { Input } from "@/components/ui/input";

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

  function submit() {
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue("");
  }

  return (
    <div className="border-t border-line px-7 py-5">
      <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-full border border-line bg-surface py-1.5 pl-4 pr-1.5 focus-within:border-grad2 focus-within:ring-2 focus-within:ring-grad2/20">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={placeholder}
          className="border-none bg-transparent px-0 focus:ring-0"
        />
        <button
          onClick={submit}
          disabled={disabled}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-grad1 to-grad2 text-[#0A0A0C] transition-transform active:scale-90 disabled:opacity-40"
        >
          <ArrowUp size={16} />
        </button>
      </div>
    </div>
  );
}
