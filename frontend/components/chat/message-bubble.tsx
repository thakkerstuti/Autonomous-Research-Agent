"use client";

import ReactMarkdown from "react-markdown";
import { ChatMessage } from "@/lib/types";
import { AgentStepsCard } from "./agent-steps-card";
import { NeuralThinking } from "@/components/neural/neural-thinking";
import { BrandMark } from "@/components/ui/brand-mark";

export function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="animate-msg-in ml-auto max-w-[min(80%,560px)] whitespace-pre-wrap rounded-[20px] rounded-br-md bg-surface3 px-4 py-3 text-[15px] leading-relaxed text-ink">
        {message.text}
      </div>
    );
  }

  const isError = message.answer?.startsWith("**Error:**");

  return (
    <div className="animate-msg-in w-full">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-ink">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary text-on-primary">
          <BrandMark size={14} />
        </span>
        CogNexa
      </div>

      {message.status === "pending" ? (
        <NeuralThinking />
      ) : (
        <>
          {!!message.steps?.length && <AgentStepsCard message={message} />}
          {message.answer && (
            <div className={isError ? "rounded-xl bg-bad/10 px-4 py-3 text-[14px] text-bad [&_strong]:text-bad" : "answer"}>
              <ReactMarkdown
                components={{
                  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
                }}
              >
                {message.answer}
              </ReactMarkdown>
            </div>
          )}
        </>
      )}
    </div>
  );
}
