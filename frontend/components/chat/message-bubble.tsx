"use client";

import { ChatMessage } from "@/lib/types";
import { AgentStepsCard } from "./agent-steps-card";

export function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="animate-msg-in ml-auto max-w-[80%] rounded-2xl rounded-tr-sm border border-line bg-surface2 px-4 py-2.5 text-sm">
        {message.text}
      </div>
    );
  }

  return (
    <div className="animate-msg-in w-full">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-soft">
        <span className="text-gradient">✦</span> CogNexa
      </div>

      {message.status === "pending" ? (
        <div className="flex w-fit gap-1 rounded-2xl border border-line bg-surface px-4 py-3.5">
          <span className="animate-dot h-1.5 w-1.5 rounded-full bg-ink-faint" />
          <span className="animate-dot h-1.5 w-1.5 rounded-full bg-ink-faint" style={{ animationDelay: "0.15s" }} />
          <span className="animate-dot h-1.5 w-1.5 rounded-full bg-ink-faint" style={{ animationDelay: "0.3s" }} />
        </div>
      ) : (
        <>
          <AgentStepsCard message={message} />
          {message.answer && <p className="text-sm leading-relaxed text-ink-soft">{message.answer}</p>}
        </>
      )}
    </div>
  );
}
