/**
 * The conversation's chat: pure helpers (no imports, so they run under node --test).
 * - parseSSE: Server-Sent Events from a streamed response body, chunk by chunk
 * - linkCitations: [n] citations as links the Markdown renderer turns into source chips
 * - mergeTimeline: research runs and chat messages as one conversation, in time order
 */

export interface ChatSource {
  n: number;
  title: string;
  url: string;
  excerpt: string;
  origin: "research" | "web";
}

export interface ChatMessageDto {
  id: string;
  session_id?: string;
  role: "user" | "assistant";
  content: string;
  sources: ChatSource[];
  used_web_search: boolean;
  created_at: string | null;
}

export interface SSEEvent {
  event: string;
  data: any;
}

/**
 * Splits a growing buffer into complete events. Returns the events and the unfinished remainder,
 * which the caller prepends to the next chunk (an event can arrive split across chunks).
 */
export function parseSSE(buffer: string): { events: SSEEvent[]; rest: string } {
  const normalised = buffer.replace(/\r\n/g, "\n");
  const blocks = normalised.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: SSEEvent[] = [];
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (!data.length) continue;
    try {
      events.push({ event, data: JSON.parse(data.join("\n")) });
    } catch {
      // a malformed event is skipped rather than breaking the stream
    }
  }
  return { events, rest };
}

/**
 * "[1, 3]" -> "[1](#cite-1)[3](#cite-3)" for numbers that are sources of this answer, outside code
 * (fenced blocks and inline code are left exactly as written). Unknown numbers stay plain text.
 */
export function linkCitations(markdown: string, sources: { n: number }[]): string {
  const known = new Set(sources.map((s) => s.n));
  const parts = (markdown || "").split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // code: untouched
      return part.replace(/\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g, (whole, nums: string) => {
        const list = nums.split(",").map((n) => parseInt(n.trim(), 10));
        if (!list.every((n) => known.has(n))) return whole;
        return list.map((n) => `[${n}](#cite-${n})`).join("");
      });
    })
    .join("");
}

/** The UTC ms of a server timestamp (zone-less times are UTC). */
export function serverTime(iso: string | null | undefined): number {
  if (!iso) return NaN;
  return Date.parse(/([zZ]|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
}

export type TimelineItem<R> = { kind: "run"; at: number; run: R } | { kind: "chat"; at: number; user: ChatMessageDto; answer: ChatMessageDto | null };

/**
 * One conversation: research runs and chat exchanges, in the order they happened. A chat question
 * is paired with the answer that follows it; a question without a saved answer is kept alone.
 */
export function mergeTimeline<R extends { created_at: string | null }>(runs: R[], messages: ChatMessageDto[]): TimelineItem<R>[] {
  const items: TimelineItem<R>[] = runs.map((run) => ({ kind: "run" as const, at: serverTime(run.created_at), run }));
  const sorted = [...messages].sort((a, b) => serverTime(a.created_at) - serverTime(b.created_at) || (a.role === "user" ? -1 : 1));
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    if (m.role !== "user") continue;
    const next = sorted[i + 1];
    const answer = next && next.role === "assistant" ? next : null;
    items.push({ kind: "chat", at: serverTime(m.created_at), user: m, answer });
    if (answer) i++;
  }
  return items.sort((a, b) => (Number.isNaN(a.at) ? 0 : a.at) - (Number.isNaN(b.at) ? 0 : b.at));
}
