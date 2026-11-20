// Run with: npm test   (node --test, no extra dependencies; Node strips the TS types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { END_OF_ANSWER_MS, FATAL_ERRORS, joinTranscript, rankVoice, speechChunks, voiceSupported } from "../lib/voice.ts";

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

test("voice: the clearest voice in the user's language wins; robotic and other-language voices lose", () => {
  const voices = [
    { name: "Microsoft David - English (United States)", lang: "en-US", localService: true },
    { name: "Google UK English Female", lang: "en-GB", localService: false },
    { name: "Microsoft Neerja Online (Natural) - English (India)", lang: "en-IN", localService: false },
    { name: "Google हिन्दी", lang: "hi-IN", localService: false },
    { name: "Zarvox", lang: "en-US", localService: true },
  ];
  const best = (lang) => [...voices].sort((a, b) => rankVoice(b, lang) - rankVoice(a, lang))[0].name;
  assert.equal(best("en-IN"), "Microsoft Neerja Online (Natural) - English (India)");
  assert.equal(best("en-US"), "Microsoft Neerja Online (Natural) - English (India)"); // natural beats the old built-in voice
  assert.equal(rankVoice(voices[3], "en-IN"), -100); // Hindi voice would read English badly
  assert.ok(rankVoice(voices[4], "en-US") < rankVoice(voices[0], "en-US"));
});

test("voice: long messages are read sentence by sentence", () => {
  assert.deepEqual(speechChunks("You already knew this. The research confirms it! Keep going?"),
    ["You already knew this.", "The research confirms it!", "Keep going?"]);
  assert.deepEqual(speechChunks("No full stop at the end"), ["No full stop at the end"]);
});
