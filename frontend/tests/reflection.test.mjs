// Run with: npm test   (node --test, no extra dependencies; Node strips the TS types)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FINISH_THOUGHT_MS, IDLE_BASE_MS, IDLE_PER_WORD_MS, PREFETCH_WHEN_LEFT, createAutosaver, isMidThought, firstQuestionIndex, idleTimeoutMs,
  isOpen, nextQuestionIndex, remainingAfter, shouldRequestNextBatch, wordCount,
} from "../lib/reflection-logic.ts";

const q = (id, answer = null, skipped = false) => ({ id, text: `Question ${id}?`, kind: "prior", batch: 1, answer, skipped });
const state = (questions, extra = {}) => ({
  questions, status: "active", exhausted: false, limit_reached: false, generating: false, run_done: false, ...extra,
});

test("idle time: 10 s plus 0.3 s per word of the question", () => {
  assert.equal(IDLE_BASE_MS, 10_000);
  assert.equal(IDLE_PER_WORD_MS, 300);
  const twenty = Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ");
  assert.equal(idleTimeoutMs(twenty), 16_000);
  assert.equal(idleTimeoutMs({ text: "  Why   the south pole?  " }), 10_000 + 4 * 300); // 4 words
  assert.equal(idleTimeoutMs(""), 10_000);
  assert.equal(wordCount(" a  b\nc "), 3);
});

test("result ready mid-answer: wait while the box has focus or a draft is unsaved", () => {
  assert.equal(FINISH_THOUGHT_MS, 20_000);
  assert.equal(isMidThought({ focused: true, hasPending: false }), true);
  assert.equal(isMidThought({ focused: false, hasPending: true }), true);
  assert.equal(isMidThought({ focused: false, hasPending: false }), false);
});

test("open questions: an empty answer counts as unanswered, a skip does not", () => {
  assert.equal(isOpen(q("a")), true);
  assert.equal(isOpen(q("a", "   ")), true);
  assert.equal(isOpen(q("a", "My view")), false);
  assert.equal(isOpen(q("a", null, true)), false);
});

test("next batch: requested when 2 or fewer open questions remain after the current one", () => {
  const five = [q("1"), q("2"), q("3"), q("4"), q("5")];
  assert.equal(PREFETCH_WHEN_LEFT, 2);
  assert.equal(remainingAfter(five, 0), 4);
  assert.equal(shouldRequestNextBatch(state(five), 0), false);
  assert.equal(shouldRequestNextBatch(state(five), 1), false); // 3 left
  assert.equal(shouldRequestNextBatch(state(five), 2), true);  // 2 left
  // answered or skipped ones after the current one don't count as left
  const mixed = [q("1"), q("2", "yes"), q("3", null, true), q("4"), q("5")];
  assert.equal(shouldRequestNextBatch(state(mixed), 0), true);
});

test("next batch: never when paused, finished, exhausted, at the cap, already generating or the run is done", () => {
  const two = [q("1"), q("2")];
  assert.equal(shouldRequestNextBatch(state(two), 0), true);
  for (const extra of [{ status: "paused" }, { status: "finished" }, { status: "failed" }, { exhausted: true },
    { limit_reached: true }, { generating: true }, { run_done: true }]) {
    assert.equal(shouldRequestNextBatch(state(two, extra), 0), false, JSON.stringify(extra));
  }
});

test("next question: forward to the next open one, then back to an earlier open one, else none", () => {
  const qs = [q("1"), q("2", "done"), q("3"), q("4", null, true)];
  assert.equal(firstQuestionIndex(qs), 0);
  assert.equal(nextQuestionIndex(qs, 0), 2);
  assert.equal(nextQuestionIndex(qs, 2), 0);   // wraps to the first, still open
  assert.equal(nextQuestionIndex([q("1", "a"), q("2", "b")], 1), null);
  assert.equal(firstQuestionIndex([]), null);
});

// A scheduler we drive by hand: no real timers
function fakeTimers() {
  let n = 0;
  const timers = new Map();
  return {
    setTimer: (fn) => { const id = ++n; timers.set(id, fn); return id; },
    clearTimer: (id) => timers.delete(id),
    runAll: () => { const fns = [...timers.values()]; timers.clear(); fns.forEach((f) => f()); },
    count: () => timers.size,
  };
}
const tick = () => new Promise((r) => setImmediate(r));

test("autosave: debounced per question; only the last draft is sent", async () => {
  const t = fakeTimers();
  const sent = [];
  const saver = createAutosaver({ save: async (id, text) => sent.push([id, text]), ...t });
  saver.change("a", "W");
  saver.change("a", "Wa");
  saver.change("a", "Water");
  saver.change("b", "Cost");
  assert.equal(t.count(), 2);
  t.runAll();
  await tick();
  assert.deepEqual(sent, [["a", "Water"], ["b", "Cost"]]);
});

test("autosave: flush sends waiting drafts at once (Next, Skip, busy, unmount, pagehide)", async () => {
  const t = fakeTimers();
  const sent = [];
  const saver = createAutosaver({ save: async (id, text, o) => sent.push([id, text, o.keepalive]), ...t });
  saver.change("a", "Water ice");
  assert.equal(saver.hasPending(), true);
  assert.equal(await saver.flush({ keepalive: true }), true);
  assert.deepEqual(sent, [["a", "Water ice", true]]);
  assert.equal(saver.hasPending(), false);
  t.runAll(); // the cancelled timer sends nothing more
  await tick();
  assert.equal(sent.length, 1);
});

test("autosave: a failed save is retried once, then kept as 'not saved' until retried", async () => {
  const t = fakeTimers();
  let fail = 2;
  const calls = [];
  const states = [];
  const saver = createAutosaver({
    save: async (id, text) => { calls.push(text); if (fail-- > 0) throw new Error("offline"); },
    onState: (id, s) => states.push(s), ...t,
  });
  saver.change("a", "My answer");
  assert.equal(await saver.flush(), false);
  assert.deepEqual(calls, ["My answer", "My answer"]); // one retry
  assert.equal(states.at(-1), "error");
  assert.deepEqual(saver.failedIds(), ["a"]);
  assert.equal(await saver.retry("a"), true); // "Not saved, retry"
  assert.equal(states.at(-1), "saved");
  assert.deepEqual(saver.failedIds(), []);
});

test("autosave: a discarded draft (skipped question) is never sent", async () => {
  const t = fakeTimers();
  const sent = [];
  const saver = createAutosaver({ save: async (id, text) => sent.push([id, text]), ...t });
  saver.change("a", "half an answer");
  saver.discard("a");
  t.runAll();
  await saver.flush();
  await tick();
  assert.deepEqual(sent, []);
});

test("autosave: a retry succeeding on the second attempt reports saved", async () => {
  let fail = 1;
  const states = [];
  const saver = createAutosaver({ save: async () => { if (fail-- > 0) throw new Error("blip"); }, onState: (_, s) => states.push(s), ...fakeTimers() });
  saver.change("a", "x");
  assert.equal(await saver.flush(), true);
  assert.deepEqual(states, ["pending", "saving", "saved"]);
});

test("feedback: the message said aloud is the server's, or one made from the first strength", async () => {
  const { spokenFeedback } = await import("../lib/reflection-logic.ts");
  assert.equal(spokenFeedback({ strengths: [], gaps: [], next_questions: [], spoken: "You already knew this. Keep going!" }), "You already knew this. Keep going!");
  assert.equal(spokenFeedback({ strengths: ["You spotted the water ice [E1]."], gaps: [], next_questions: [] }), "Nice thinking. You spotted the water ice. Keep going!");
  assert.equal(spokenFeedback({ strengths: [], gaps: [], next_questions: [] }), "");
});

test("voice: saying stop or skip is understood; a real answer is not", async () => {
  const { voiceIntent } = await import("../lib/reflection-logic.ts");
  for (const t of ["Stop", "stop it", "Cancel.", "I don't want to answer", "not now", "I'm busy", "no thanks", "please stop asking"]) {
    assert.equal(voiceIntent(t), "stop", t);
  }
  for (const t of ["skip", "Skip this one", "pass", "next question please"]) assert.equal(voiceIntent(t), "skip", t);
  for (const t of ["We should stop deforestation because the trees store carbon", "Because of the water ice", "I don't know much about it", ""]) {
    assert.equal(voiceIntent(t), null, t);
  }
});
