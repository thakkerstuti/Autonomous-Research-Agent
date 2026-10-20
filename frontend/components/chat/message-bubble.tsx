"use client";

import ReactMarkdown from "react-markdown";
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
          {message.answer && (
            <div className="prose prose-sm prose-invert max-w-none text-sm leading-relaxed text-ink-soft [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-ink [&_h1]:mt-2 [&_h1]:mb-3 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-ink [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-ink [&_h3]:mt-3 [&_h3]:mb-1 [&_p]:mb-2 [&_ul]:my-1 [&_ul]:pl-4 [&_li]:mb-1 [&_strong]:text-ink [&_blockquote]:border-l-2 [&_blockquote]:border-rose/50 [&_blockquote]:pl-3 [&_blockquote]:text-ink-faint [&_blockquote]:italic">
              <ReactMarkdown>{message.answer}</ReactMarkdown>
            </div>
          )}
        </>
      )}
    </div>
  );
}
