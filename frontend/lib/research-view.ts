import { CritiqueResult } from "./types";
import { buildHighlightedUrl } from "./adapters";

/**
 * A presentation view of a backend research response.
 * Built from the same payload the existing adapter reads — no new requests,
 * no new fields — so the UI can render hypotheses, evidence and the audit
 * as structured components instead of one markdown string.
 */

export type Stance = "supports" | "refutes" | "neutral";
export type HypothesisStatus = "supported" | "refuted" | "mixed" | "untested" | string;
export type Verification = "verified" | "snippet_only" | "unverified";

export interface ViewHypothesis {
  id: string;
  statement: string;
  status: HypothesisStatus;
  subquestions: string[];
  supports: number;
  refutes: number;
  neutral: number;
  contradiction: string | null;
}

export interface ViewEvidence {
  id: string;
  hypothesisId: string;
  round: number;
  query: string;
  title: string;
  url: string;
  highlightUrl: string;
  domain: string;
  stance: Stance;
  confidence: number; // 0–100
  quote: string;
  snippet: string;
  study: string;
  verification: Verification;
}

export interface ViewSource {
  domain: string;
  title: string;
  url: string;
  highlightUrl: string;
  count: number;
  confidence: number; // best confidence among its evidence, 0–100
  verified: boolean;
  stances: Record<Stance, number>;
  evidenceIds: string[];
}

export interface ResearchView {
  sessionId?: string;
  question: string;
  format?: string;
  status?: string;
  report: string | null;
  reportError?: string | null;
  hypotheses: ViewHypothesis[];
  evidence: ViewEvidence[];
  sources: ViewSource[];
  critique: CritiqueResult | null;
  queries: string[];
  rounds: number | null;
  stats: { duration?: number; llmCalls?: number; searches?: number };
  verification: { verified: number; snippet: number; unverified: number };
}

function domainOf(url: string) {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url || "source";
  }
}

const toStance = (s: unknown): Stance => (s === "supports" || s === "refutes" ? s : "neutral");
const toVerification = (v: unknown): Verification =>
  v === "verified" || v === "snippet_only" ? v : "unverified";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildResearchView(data: any): ResearchView | undefined {
  if (!data || typeof data !== "object") return undefined;
  const log: any[] = Array.isArray(data.evidence_log) ? data.evidence_log : [];
  const hyps: any[] = Array.isArray(data.hypotheses) ? data.hypotheses : [];

  const evidence: ViewEvidence[] = log.map((e, i) => {
    const url = String(e.source_url ?? "");
    const conf = Number(e.confidence ?? 0);
    return {
      id: String(e.id ?? `E${i + 1}`),
      hypothesisId: String(e.hypothesis_id ?? ""),
      round: Number(e.round ?? 1),
      query: String(e.query ?? ""),
      title: String(e.source_title || domainOf(url)),
      url,
      highlightUrl: buildHighlightedUrl(url, e.quote, e.snippet) || url,
      domain: domainOf(url),
      stance: toStance(e.stance),
      confidence: Math.round(conf <= 1 ? conf * 100 : conf),
      quote: String(e.quote ?? ""),
      snippet: String(e.snippet ?? ""),
      study: String(e.study ?? ""),
      verification: toVerification(e.verification_status),
    };
  });

  const hypotheses: ViewHypothesis[] = hyps.map((h, i) => {
    const id = String(h.id ?? `H${i + 1}`);
    const mine = evidence.filter((e) => e.hypothesisId === id);
    return {
      id,
      statement: String(h.statement ?? ""),
      status: String(h.status ?? "untested"),
      subquestions: Array.isArray(h.subquestions) ? h.subquestions.map(String) : [],
      supports: mine.filter((e) => e.stance === "supports").length,
      refutes: mine.filter((e) => e.stance === "refutes").length,
      neutral: mine.filter((e) => e.stance === "neutral").length,
      contradiction: h.evidence_summary?.has_contradiction ? String(h.evidence_summary?.contradiction_note ?? "") : null,
    };
  });

  const byDomain = new Map<string, ViewSource>();
  for (const e of evidence) {
    const s = byDomain.get(e.domain);
    if (!s) {
      byDomain.set(e.domain, {
        domain: e.domain,
        title: e.title,
        url: e.url,
        highlightUrl: e.highlightUrl,
        count: 1,
        confidence: e.confidence,
        verified: e.verification === "verified",
        stances: { supports: 0, refutes: 0, neutral: 0, [e.stance]: 1 } as Record<Stance, number>,
        evidenceIds: [e.id],
      });
    } else {
      s.count += 1;
      s.confidence = Math.max(s.confidence, e.confidence);
      s.verified = s.verified || e.verification === "verified";
      s.stances[e.stance] += 1;
      s.evidenceIds.push(e.id);
    }
  }
  const sources = Array.from(byDomain.values()).sort((a, b) => b.count - a.count || b.confidence - a.confidence);

  const stats = data.stats ?? {};
  const critique = data.critique && typeof data.critique === "object" && data.critique.status ? (data.critique as CritiqueResult) : null;

  return {
    sessionId: data.session_id,
    question: String(data.research_question ?? ""),
    format: data.output_format,
    status: data.status,
    report: typeof data.report === "string" && data.report.trim() ? data.report : null,
    reportError: data.report_error ?? null,
    hypotheses,
    evidence,
    sources,
    critique,
    queries: Array.from(new Set(evidence.map((e) => e.query).filter(Boolean))),
    rounds: typeof data.rounds_used === "number" ? data.rounds_used : evidence.length ? Math.max(...evidence.map((e) => e.round)) : null,
    stats: {
      duration: typeof stats.duration_seconds === "number" ? stats.duration_seconds : undefined,
      llmCalls: typeof stats.gemini_calls === "number" ? stats.gemini_calls : undefined,
      searches: typeof stats.tavily_calls === "number" ? stats.tavily_calls : undefined,
    },
    verification: {
      verified: evidence.filter((e) => e.verification === "verified").length,
      snippet: evidence.filter((e) => e.verification === "snippet_only").length,
      unverified: evidence.filter((e) => e.verification === "unverified").length,
    },
  };
}

export const STATUS_TONE: Record<string, { label: string; cls: string; dot: string }> = {
  supported: { label: "Supported", cls: "text-ok", dot: "bg-ok" },
  refuted:   { label: "Refuted",   cls: "text-bad", dot: "bg-bad" },
  mixed:     { label: "Mixed",     cls: "text-warn", dot: "bg-warn" },
  untested:  { label: "Untested",  cls: "text-ink-faint", dot: "bg-ink-faint" },
};

export const STANCE_TONE: Record<Stance, { label: string; cls: string; bar: string }> = {
  supports: { label: "Supports", cls: "text-ok", bar: "bg-ok" },
  refutes:  { label: "Refutes",  cls: "text-bad", bar: "bg-bad" },
  neutral:  { label: "Context",  cls: "text-ink-faint", bar: "bg-ink-faint/50" },
};
