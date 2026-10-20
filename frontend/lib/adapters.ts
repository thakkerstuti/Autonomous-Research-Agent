import { AgentStepEvent, EvidenceSource } from "./types";

interface BackendResearchResponse {
  research_question: string;
  hypotheses: {
    id: string;
    statement: string;
    subquestions: string[];
    status: string;
  }[];
  evidence_log: {
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
  }[];
  rounds_used: number;
  report?: string | null;
  report_error?: string | null;
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

  let answerText = ``;

  // Prefer the polished Gemini-generated report from the backend
  if (data.report) {
    answerText = data.report;
    if (data.report_error) {
      answerText += `\n\n> ⚠️ ${data.report_error}`;
    }
  } else {
    // Fallback: build answer from raw hypotheses/evidence when report is missing
    answerText = `### Research Results\n\n`;
    if (data.report_error) {
      answerText += `> ⚠️ Report generation failed: ${data.report_error}\n\n`;
    }
    data.hypotheses.forEach((h) => {
      answerText += `**Hypothesis:** ${h.statement}\n`;
      answerText += `**Status:** ${h.status.toUpperCase()}\n`;
      const evs = data.evidence_log.filter((e) => e.hypothesis_id === h.id);
      if (evs.length > 0) {
        answerText += `**Evidence:**\n`;
        evs.forEach((e) => {
          answerText += `- [${e.stance.toUpperCase()}] ${e.source_title || e.source_url} (${Math.round(e.confidence * 100)}% confidence)\n`;
        });
      } else {
        answerText += `*No direct evidence found.*\n`;
      }
      answerText += `\n`;
    });
  }

  answerText += `\n\n*Stats: completed in ${data.stats.duration_seconds}s with ${data.stats.gemini_calls} LLM calls and ${data.stats.tavily_calls} searches.*`;

  steps.push({
    type: "done",
    answer: answerText,
  });

  return steps;
}
