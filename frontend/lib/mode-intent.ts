/**
 * A typed instruction such as "give detailed analysis" or "generate a research paper" is a request
 * for a different output mode of the question already asked, not a new research question. It is
 * sent to the server as structured data (output_format + based_on), like the answer's mode buttons.
 * Pure, no imports, so it can be unit-tested with node --test.
 */
export type ModeChoice = "quick" | "detailed" | "full";

const COMMAND_START =
  /^(?:(?:please|can you|could you|now)\s+)*(?:give|write|generate|make|create|produce|provide|prepare|draft|turn|convert|expand|go|show|do|need|want|i want|i need)\b/;
const BARE = /^(?:a\s+)?(?:quick answer|detailed analysis|research paper|full research paper|full paper|in more detail|more detail|go deeper|deeper|in depth|full report)$/;
const PAPER = /\b(?:research paper|full paper|paper|full report|report|pdf)\b/;
const DETAILED = /\b(?:detailed|detail|details|in[- ]depth|deeper|elaborate|expand|thorough|comprehensive)\b/;
const QUICK = /\b(?:quick|short|shorter|brief|briefly|summary|summari[sz]e|tl;?dr)\b/;

/** The request body for a run: the chosen mode always travels as structured data (output_format). */
export function runRequestBody(
  output_format: ModeChoice,
  target: { question: string; thread_id?: string | null } | { based_on: string }
): Record<string, string> {
  if ("based_on" in target) return { output_format, based_on: target.based_on };
  return { question: target.question, output_format, ...(target.thread_id ? { thread_id: target.thread_id } : {}) };
}

export function modeCommand(text: string): ModeChoice | null {
  const t = (text || "").trim().toLowerCase().replace(/[.!?\s]+$/, "");
  if (!t || t.split(/\s+/).length > 12) return null; // a real question, not an instruction
  if (!COMMAND_START.test(t) && !BARE.test(t)) return null;
  if (PAPER.test(t)) return "full";
  if (DETAILED.test(t)) return "detailed";
  if (QUICK.test(t)) return "quick";
  return null;
}

// Words that only phrase the request itself ("please give me a detailed analysis of this")
const REQUEST_WORDS = new Set(`please can could would you now give write generate make create produce provide prepare draft
turn convert expand go show do need want i me us my a an the this that these those it its into as in more full detailed detail
details in-depth depth deeper elaborate thorough comprehensive analysis analyse analyze research paper report pdf quick short
shorter brief briefly summary summarise summarize answer version one same above previous last on about of for regarding
question topic again`.split(/\s+/));

/**
 * The subject a mode request names, if any: "research paper on quantum computing" -> "quantum computing",
 * "give me a detailed analysis of its applications" -> "its applications". A plain request
 * ("give detailed analysis", "turn this into a research paper") names none: it is about the last question.
 */
export function requestSubject(text: string): string {
  const t = (text || "").trim().replace(/[.!?\s]+$/, "");
  const m = /\b(?:on|about|of|regarding|for)\s+(.+)$/i.exec(t);
  if (!m) return "";
  const words = m[1].toLowerCase().split(/\s+/).filter(Boolean);
  return words.some((w) => !REQUEST_WORDS.has(w.replace(/[^a-z0-9-]/g, ""))) ? m[1].trim() : "";
}
