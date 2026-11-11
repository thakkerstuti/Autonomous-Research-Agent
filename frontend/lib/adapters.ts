import { AgentStepEvent, EvidenceSource, CritiqueResult } from "./types";

interface BackendResearchResponse {
  session_id?: string;
  research_question: string;
  output_format?: string;
  status?: string;
  hypotheses: {
    id: string;
    statement: string;
    subquestions: string[];
    status: string;
    evidence_summary?: {
      supporting: string[];
      refuting: string[];
      neutral: string[];
      has_contradiction: boolean;
      contradiction_note?: string | null;
    };
  }[];
  evidence_log: {
    id?: string;
    hypothesis_id: string;
    round: number;
    query: string;
    source_url: string;
    source_title: string;
    snippet: string;
    stance: string;
    confidence: number;
    quote: string;
    study: string;
    weight: number;
    verification_status?: "verified" | "snippet_only" | "unverified";
    verification_detail?: string;
  }[];
  rounds_used: number;
  report?: string | null;
  critique?: CritiqueResult | null;
  report_error?: string | null;
  partial_errors?: string[];
  invalid_citations?: string[];
  stats: {
    gemini_calls: number;
    tavily_calls: number;
    duration_seconds: number;
  };
}


const DOMAIN_COLORS: Record<string, string> = {
  "nature.com": "#4C6EF5",
  "nih.gov": "#E8590C",
  "pubmed": "#E8590C",
  "springer.com": "#2F9E44",
  "sciencedirect.com": "#9C36B5",
};

const DEFAULT_COLORS = ["#4C6EF5", "#E8590C", "#2F9E44", "#9C36B5", "#F03E3E", "#20C997", "#FD7E14"];

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function getDomainColor(domain: string): string {
  if (DOMAIN_COLORS[domain]) return DOMAIN_COLORS[domain];
  let h = 0;
  for (let i = 0; i < domain.length; i++) {
    h = (h << 5) - h + domain.charCodeAt(i);
  }
  return DEFAULT_COLORS[Math.abs(h) % DEFAULT_COLORS.length];
}

export function buildHighlightedUrl(baseUrl: string, quote?: string, snippet?: string): string {
  if (!baseUrl) return "";
  let text = (quote && quote.trim()) || "";
  if (!text && snippet) {
    // Take first sentence of snippet if quote is absent
    const match = snippet.split(/[.!?]\s+/)[0];
    text = (match && match.trim()) || snippet.trim();
  }
  const clean = text
    .replace(/[*_~`"\'“”‘’\[\]\(\)]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return baseUrl;

  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0) return baseUrl;

  const enc = (s: string) => encodeURIComponent(s).replace(/-/g, "%2D");
  let directive = "";
  if (words.length <= 7) {
    directive = enc(words.join(" "));
  } else {
    // Start phrase: first 4 words, stripped of trailing punctuation
    const start = words.slice(0, 4).join(" ").replace(/[.,;:!?]+$/, "");
    // End phrase: last 4 words, stripped of leading/trailing punctuation
    const end = words.slice(-4).join(" ").replace(/^[.,;:!?]+|[.,;:!?]+$/g, "");
    directive = `${enc(start)},${enc(end)}`;
  }

  // Strip existing text fragment if any
  let url = baseUrl.split(":~:text=")[0].replace(/[#&]+$/, "");
  const sep = url.includes("#") ? ":~:text=" : "#:~:text=";
  return `${url}${sep}${directive}`;
}

export function adaptResearchResponseToSteps(data: BackendResearchResponse): AgentStepEvent[] {
  const sourcesMap = new Map<string, EvidenceSource>();
  let totalConfidence = 0;
  let sourceCount = 0;

  data.evidence_log.forEach((ev) => {
    const domain = getDomain(ev.source_url);
    if (!sourcesMap.has(domain)) {
      sourcesMap.set(domain, {
        name: ev.source_title || domain,
        domain,
        confidence: Math.round(ev.confidence * 100),
        color: getDomainColor(domain),
      });
    }
  });

  const sources = Array.from(sourcesMap.values());
  const formattedSourcesCount = Array.from(new Set(data.evidence_log.map(e => e.source_url))).length;

  const steps: AgentStepEvent[] = [];

  steps.push({
    type: "step",
    label: "Analyzing hypotheses",
    detail: `Generated ${data.hypotheses.length} hypotheses to test across ${data.rounds_used} search rounds.`,
  });

  steps.push({
    type: "sources",
    label: "Reviewing evidence",
    sources: sources,
  });

  // Source Verification step
  const verifiedCount = data.evidence_log.filter(e => e.verification_status === "verified").length;
  const snippetOnlyCount = data.evidence_log.filter(e => e.verification_status === "snippet_only").length;
  steps.push({
    type: "step",
    label: "Source traceability & verification",
    detail: `${verifiedCount} quote(s) verified in original documents, ${snippetOnlyCount} verified in snippet, ${data.evidence_log.length - verifiedCount - snippetOnlyCount} unverified.`,
  });

  // Self-critique step
  if (data.critique) {
    const cStatus = data.critique.status;
    const label =
      cStatus === "passed"
        ? "Self-critique: Verified"
        : cStatus === "passed_with_revisions"
        ? "Self-critique: Revisions applied"
        : cStatus === "flagged_issues"
        ? "Self-critique: Issues flagged"
        : "Self-critique completed";
    const detail = data.critique.issues && data.critique.issues.length > 0
      ? `${data.critique.issues.length} audit issue(s) addressed.`
      : "Claims and citations verified against evidence log.";
    steps.push({
      type: "step",
      label,
      detail,
    });
  }

  let answerText = ``;

  // Output format header tag
  const formatTag = data.output_format ? `**Format:** *${data.output_format.charAt(0).toUpperCase() + data.output_format.slice(1)}*\n\n` : "";
  answerText += formatTag;

  // Surface Contradictions callout if detected on any hypothesis
  const contradictoryHyps = data.hypotheses.filter(h => h.evidence_summary?.has_contradiction);
  if (contradictoryHyps.length > 0) {
    answerText += `> ⚖️ **Conflicting Evidence Alert:** Contradictions detected across ${contradictoryHyps.length} hypothesis(es):\n`;
    contradictoryHyps.forEach(ch => {
      answerText += `> - **[${ch.id}]** ${ch.statement}: ${ch.evidence_summary?.contradiction_note}\n`;
    });
    answerText += `\n`;
  }

  // Prefer the polished Gemini-generated report from the backend
  if (data.report) {
    answerText += data.report;
    if (data.report_error) {
      answerText += `\n\n> ⚠️ ${data.report_error}`;
    }
  } else {
    // Fallback: build answer from raw hypotheses/evidence when report is missing
    answerText += `### Research Results\n\n`;
    if (data.report_error) {
      answerText += `> ⚠️ Report generation failed: ${data.report_error}\n\n`;
    }
    data.hypotheses.forEach((h) => {
      answerText += `**Hypothesis:** ${h.statement}\n`;
      answerText += `**Status:** ${h.status.toUpperCase()}\n`;
      if (h.evidence_summary?.has_contradiction) {
        answerText += `⚠️ *${h.evidence_summary.contradiction_note}*\n`;
      }
      const evs = data.evidence_log.filter((e) => e.hypothesis_id === h.id);
      if (evs.length > 0) {
        answerText += `**Evidence:**\n`;
        evs.forEach((e) => {
          const vLabel = e.verification_status === "verified" ? " [Verified in Source]" : "";
          const hUrl = buildHighlightedUrl(e.source_url, e.quote, e.snippet);
          answerText += `- [${e.stance.toUpperCase()}] [${e.source_title || e.source_url}](${hUrl}) (${Math.round(e.confidence * 100)}% confidence)${vLabel}\n`;
        });
      } else {
        answerText += `*No direct evidence found.*\n`;
      }
      answerText += `\n`;
    });
  }

  // Map evidence by ID for linking and citations
  const evMap = new Map<string, (typeof data.evidence_log)[0]>();
  data.evidence_log.forEach((ev) => {
    if (ev.id) evMap.set(ev.id, ev);
  });

  // Turn inline citation badges [E1] into clickable markdown links pointing to original source URL with highlight
  answerText = answerText.replace(/\[E(\d+)\]/g, (match, num) => {
    const eid = `E${num}`;
    const ev = evMap.get(eid);
    if (ev && ev.source_url) {
      const highlightedUrl = buildHighlightedUrl(ev.source_url, ev.quote, ev.snippet);
      return `[**[${eid}]**](${highlightedUrl})`;
    }
    return match;
  });

  // Self-critique summary banner at end
  if (data.critique) {
    const c = data.critique;
    const cStatusIcon = c.status === "passed" ? "✅" : c.status === "passed_with_revisions" ? "🛠️" : "⚠️";
    answerText += `\n\n---\n${cStatusIcon} **Self-Critique Audit:** \`${c.status.toUpperCase()}\``;
    if (c.checks && c.checks.length > 0) {
      c.checks.forEach(chk => {
        answerText += `\n- ${chk.passed ? "✓" : "✗"} **${chk.name}:** ${chk.detail}`;
      });
    }
    if (c.issues && c.issues.length > 0) {
      answerText += `\n**Audit Notes:**\n`;
      c.issues.forEach(iss => {
        answerText += `- ${iss}\n`;
      });
    }
  }

  // Add Sources & References section with clickable URLs (highlighting original quote on source page)
  const citedMatches = Array.from(answerText.matchAll(/\[\*\*\[E(\d+)\]\*\*\]/g));
  const citedIds = Array.from(new Set(citedMatches.map(m => `E${m[1]}`)));
  if (citedIds.length > 0) {
    answerText += `\n\n---\n### 🔗 Cited Sources & Evidence\n`;
    citedIds.forEach(cid => {
      const ev = evMap.get(cid);
      if (ev) {
        const vTag = ev.verification_status === "verified" ? "✅ *Verified in source document*" : "ℹ️ *Verified in snippet*";
        const title = ev.source_title || ev.source_url;
        const highlightedUrl = buildHighlightedUrl(ev.source_url, ev.quote, ev.snippet);
        answerText += `- **[${cid}]** [${title}](${highlightedUrl}) — *${ev.stance.toUpperCase()}* (${Math.round(ev.confidence * 100)}% conf) · ${vTag}\n`;
      }
    });
  }

  answerText += `\n\n*Stats: completed in ${data.stats.duration_seconds}s with ${data.stats.gemini_calls} LLM calls and ${data.stats.tavily_calls} searches.*`;



  steps.push({
    type: "done",
    answer: answerText,
  });

  return steps;
}
