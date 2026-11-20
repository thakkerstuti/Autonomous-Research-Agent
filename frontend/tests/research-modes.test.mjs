// Run with: npm test   (node --test, no extra dependencies; Node strips the TS types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { modeCommand, requestSubject, runRequestBody } from "../lib/mode-intent.ts";
import { parseServerTime, runSeconds } from "../lib/run-stages.ts";

test("a mode button sends output_format and based_on as structured data, never typed text", () => {
  assert.deepEqual(runRequestBody("detailed", { based_on: "s1" }), { output_format: "detailed", based_on: "s1" });
  assert.deepEqual(runRequestBody("full", { based_on: "s1" }), { output_format: "full", based_on: "s1" });
  assert.equal("question" in runRequestBody("full", { based_on: "s1" }), false);
});

test("a new question and a follow-up carry the selected mode", () => {
  assert.deepEqual(runRequestBody("quick", { question: "Does spacing help?" }), { question: "Does spacing help?", output_format: "quick" });
  assert.deepEqual(runRequestBody("detailed", { question: "And in children?", thread_id: "t1" }),
    { question: "And in children?", output_format: "detailed", thread_id: "t1" });
  assert.deepEqual(runRequestBody("full", { question: "New topic", thread_id: null }), { question: "New topic", output_format: "full" });
});

test("typed mode instructions become a mode request for the last question", () => {
  assert.equal(modeCommand("give detailed analysis"), "detailed");
  assert.equal(modeCommand("Give Detailed Analysis."), "detailed");
  assert.equal(modeCommand("generate a research paper"), "full");
  assert.equal(modeCommand("Generate Research Paper"), "full");
  assert.equal(modeCommand("please write a full report"), "full");
  assert.equal(modeCommand("go deeper"), "detailed");
  assert.equal(modeCommand("detailed analysis"), "detailed");
  assert.equal(modeCommand("research paper"), "full");
  assert.equal(modeCommand("make it shorter"), "quick");
});

test("real research questions are never mistaken for mode instructions", () => {
  assert.equal(modeCommand("Is there a replication crisis in psychology?"), null);
  assert.equal(modeCommand("What does the evidence say about spaced repetition?"), null);
  assert.equal(modeCommand("How detailed are clinical trial reports in oncology journals?"), null);
  assert.equal(modeCommand("Generate hypotheses about sleep and memory"), null); // a request, but not for a mode
  assert.equal(modeCommand("Does writing a research paper by hand improve retention compared with typing it on a laptop?"), null);
  assert.equal(modeCommand(""), null);
});

test("a mode request with a subject is about that subject; a plain one is about the last question", () => {
  assert.equal(modeCommand("write a research paper on quantum computing"), "full");
  assert.equal(requestSubject("write a research paper on quantum computing"), "quantum computing");
  assert.equal(requestSubject("Give me a detailed analysis of its applications."), "its applications");
  assert.equal(requestSubject("generate a research paper"), "");
  assert.equal(requestSubject("give detailed analysis"), "");
  assert.equal(requestSubject("turn this into a research paper"), "");
  assert.equal(requestSubject("give me a detailed analysis of this"), "");
  assert.equal(requestSubject("a research paper on the same topic"), "");
});

test("a conversational message is never taken for a mode request", () => {
  assert.equal(modeCommand("i think u told me answer was incorrect just check once"), null);
  assert.equal(modeCommand("Can you check that again?"), null);
  assert.equal(modeCommand("why is that important?"), null);
});

test("server times without a zone are UTC, not local time (the 336-minute bug)", () => {
  assert.equal(parseServerTime("2026-11-17T05:27:36.011870"), Date.parse("2026-11-17T05:27:36.011870Z"));
  assert.equal(parseServerTime("2026-11-17T05:27:36Z"), Date.parse("2026-11-17T05:27:36Z"));
  assert.equal(parseServerTime("2026-11-17T10:57:36+05:30"), Date.parse("2026-11-17T05:27:36Z"));
  assert.ok(Number.isNaN(parseServerTime(null)));
});

test("Working Flow duration comes from the run's own start and finish", () => {
  const p = (started_at, finished_at) => ({ stage: null, stages: {}, detail: null, started_at, finished_at });
  // the real runs: 44 s and 1 min 32 s
  assert.equal(runSeconds(p("2026-11-17T05:27:36.011870", "2026-11-17T05:28:20.030000"), "ready"), 44);
  assert.equal(runSeconds(p("2026-11-17T05:32:23.244Z", "2026-11-17T05:33:55.394Z"), "ready"), 92);
  // while running, measured to now, whatever the browser's time zone
  const now = Date.parse("2026-11-17T05:28:00Z");
  assert.equal(runSeconds(p("2026-11-17T05:27:36", null), "in_progress", now), 24);
  // unknown or implausible: no figure rather than a misleading one
  assert.equal(runSeconds(p("2026-11-17T05:27:36", null), "ready"), null);
  assert.equal(runSeconds(p(null, null), "ready"), null);
  assert.equal(runSeconds(p("2026-11-17T05:27:36", "2026-11-16T05:27:36"), "ready"), null);
  assert.equal(runSeconds(p("2026-11-10T05:27:36", "2026-11-17T05:27:36"), "ready"), null);
});
