// Run with: npm test   (node --test, no extra dependencies; Node strips the TS types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { linkCitations, mergeTimeline, parseSSE } from "../lib/chat-stream.ts";

test("SSE: events split across network chunks are reassembled", () => {
  const stream = 'event: status\ndata: {"stage":"thinking","label":"Understanding your question"}\n\n'
    + 'event: delta\ndata: {"text":"Multi-agent "}\n\nevent: delta\ndata: {"text":"systems [1]."}\n\n'
    + 'event: done\ndata: {"assistant_message":{"id":"a1"}}\n\n';
  const chunks = [stream.slice(0, 17), stream.slice(17, 70), stream.slice(70, 101), stream.slice(101)];
  let buffer = "";
  const events = [];
  for (const chunk of chunks) {
    const parsed = parseSSE(buffer + chunk);
    buffer = parsed.rest;
    events.push(...parsed.events);
  }
  assert.deepEqual(events.map((e) => e.event), ["status", "delta", "delta", "done"]);
  assert.equal(events.filter((e) => e.event === "delta").map((e) => e.data.text).join(""), "Multi-agent systems [1].");
  assert.equal(buffer, "");
});

test("SSE: CRLF line endings, comments and malformed data don't break the stream", () => {
  const { events, rest } = parseSSE(': keep-alive\r\n\r\nevent: delta\r\ndata: {"text":"ok"}\r\n\r\nevent: delta\ndata: {not json}\n\nevent: delta\ndata: {"te');
  assert.deepEqual(events, [{ event: "delta", data: { text: "ok" } }]);
  assert.equal(rest, 'event: delta\ndata: {"te'); // unfinished: kept for the next chunk
});

test("citations become links only for this answer's sources, never inside code", () => {
  const sources = [{ n: 1 }, { n: 2 }];
  assert.equal(linkCitations("Agents coordinate [1] and specialise [1, 2].", sources),
    "Agents coordinate [1](#cite-1) and specialise [1](#cite-1)[2](#cite-2).");
  assert.equal(linkCitations("Unknown [7] stays plain; [x] too.", sources), "Unknown [7] stays plain; [x] too.");
  assert.equal(linkCitations("Code `arr[1]` and\n```\nx = y[2]\n```\nafter [2]", sources),
    "Code `arr[1]` and\n```\nx = y[2]\n```\nafter [2](#cite-2)");
  assert.equal(linkCitations("A markdown link [1](https://x.org) is left alone", sources), "A markdown link [1](https://x.org) is left alone");
});

test("one conversation: research runs and chat exchanges in the order they happened", () => {
  const runs = [
    { session_id: "r1", created_at: "2026-11-19T10:00:00" },
    { session_id: "r2", created_at: "2026-11-19T10:30:00" },
  ];
  const msg = (id, role, at, content = id) => ({ id, role, content, sources: [], used_web_search: false, created_at: at, session_id: "r1" });
  const messages = [
    msg("a2", "assistant", "2026-11-19T10:40:00.000002Z"),
    msg("u1", "user", "2026-11-19T10:05:00.000001Z", "How is this different from autonomous AI?"),
    msg("a1", "assistant", "2026-11-19T10:05:00.000002Z"),
    msg("u2", "user", "2026-11-19T10:40:00.000001Z", "Explain quantum computing."),
    msg("u3", "user", "2026-11-19T10:50:00Z", "An unanswered question"),
  ];
  const timeline = mergeTimeline(runs, messages);
  assert.deepEqual(timeline.map((t) => (t.kind === "run" ? t.run.session_id : `${t.user.id}/${t.answer?.id ?? "-"}`)),
    ["r1", "u1/a1", "r2", "u2/a2", "u3/-"]);
});

test("zone-less server times are read as UTC, the same as times with Z", () => {
  const timeline = mergeTimeline(
    [{ session_id: "r1", created_at: "2026-11-19T10:00:00" }],
    [{ id: "u", role: "user", content: "q", sources: [], used_web_search: false, created_at: "2026-11-19T09:59:59Z" }]
  );
  assert.equal(timeline[0].kind, "chat"); // 09:59:59Z is before 10:00:00 UTC, not shifted by the local zone
});
