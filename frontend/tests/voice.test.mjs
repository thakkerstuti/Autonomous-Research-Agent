// Run with: npm test   (node --test, no extra dependencies; Node strips the TS types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { END_OF_ANSWER_MS, FATAL_ERRORS, joinTranscript, voiceSupported } from "../lib/voice.ts";

test("voice: transcript pieces join into one tidy answer", () => {
  assert.equal(joinTranscript(["because there", " might be ", "water ice "]), "because there might be water ice");
  assert.equal(joinTranscript(["", "  "]), "");
});

test("voice: a short pause ends the answer; blocked or missing microphones fall back to typing", () => {
  assert.ok(END_OF_ANSWER_MS >= 1500 && END_OF_ANSWER_MS <= 4000);
  for (const code of ["not-allowed", "service-not-allowed", "audio-capture", "network"]) assert.ok(FATAL_ERRORS.has(code), code);
  assert.equal(FATAL_ERRORS.has("no-speech"), false); // silence is not an error: it keeps listening
});

test("voice: not available outside a browser (server rendering)", () => {
  assert.equal(voiceSupported(), false);
});
