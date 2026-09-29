"use client";

import { useCallback, useRef, useState } from "react";
import { AgentStepEvent, Mode } from "./types";

interface StreamCallbacks {
  onEvent: (event: AgentStepEvent) => void;
  onDone: () => void;
}

// Wraps the browser's native EventSource against our SSE route handler
// (app/api/agent-stream/route.ts) so components just get parsed events.
export function useAgentStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  const start = useCallback((mode: Mode, query: string, cb: StreamCallbacks) => {
    sourceRef.current?.close();
    setIsStreaming(true);

    const url = `/api/agent-stream?mode=${encodeURIComponent(mode)}&q=${encodeURIComponent(query)}`;
    const es = new EventSource(url);
    sourceRef.current = es;

    es.onmessage = (e) => {
      const parsed: AgentStepEvent = JSON.parse(e.data);
      cb.onEvent(parsed);
      if (parsed.type === "done") {
        es.close();
        setIsStreaming(false);
        cb.onDone();
      }
    };

    es.onerror = () => {
      es.close();
      setIsStreaming(false);
      cb.onDone();
    };
  }, []);

  const stop = useCallback(() => {
    sourceRef.current?.close();
    setIsStreaming(false);
  }, []);

  return { start, stop, isStreaming };
}
