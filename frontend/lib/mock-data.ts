import { PaperItem, ResearchReport, SessionSummary, UsageMeter } from "./types";

// Sample data only — swap the matching fetchers in lib/queries.ts for real endpoints.

export const mockSessions: SessionSummary[] = [
  { id: "s1", title: "Does remote work reduce long-term productivity?", mode: "research", status: "ready", updated: "2 hours ago" },
  { id: "s2", title: "Attention Is All You Need", mode: "paper", status: "in_progress", updated: "yesterday" },
  { id: "s3", title: "Compare battery chemistries for grid storage", mode: "research", status: "review", updated: "3 days ago" },
  { id: "s4", title: "Chain-of-Thought Prompting Elicits Reasoning", mode: "paper", status: "ready", updated: "last week" },
];

export const mockPapers: PaperItem[] = [
  { id: "p1", title: "Attention Is All You Need", authors: "Vaswani et al.", pages: 15, uploaded: "yesterday", status: "ready" },
  { id: "p2", title: "Chain-of-Thought Prompting Elicits Reasoning", authors: "Wei et al.", pages: 43, uploaded: "last week", status: "ready" },
  { id: "p3", title: "Scaling Laws for Neural Language Models", authors: "Kaplan et al.", pages: 30, uploaded: "just now", status: "processing", progress: 62 },
  { id: "p4", title: "scan_0042.pdf", authors: "Unknown", pages: 0, uploaded: "2 weeks ago", status: "failed" },
];

export const mockReport: ResearchReport = {
  id: "s1",
  question: "Does remote work reduce long-term productivity?",
  summary:
    "Evidence is mixed but leans neutral-to-positive for fully remote roles with clear output metrics, and more negative for tasks that depend on spontaneous collaboration and for junior employees.",
  updated: "2 hours ago",
  findings: [
    { id: "f1", text: "Hybrid schedules show little to no productivity loss in randomized field studies.", confidence: 86, citationIds: ["c1", "c2"] },
    { id: "f2", text: "Fully remote work shows small declines in innovation-heavy and mentoring-heavy tasks.", confidence: 71, citationIds: ["c3"] },
    { id: "f3", text: "Self-reported productivity runs higher than measured output in several surveys.", confidence: 58, citationIds: ["c4"] },
  ],
  sources: [
    { name: "Field experiment", domain: "nber.org", confidence: 88, color: "#6e8cff" },
    { name: "Meta-analysis", domain: "sciencedirect.com", confidence: 79, color: "#b879ff" },
    { name: "Industry survey", domain: "hbr.org", confidence: 61, color: "#ff8ad4" },
    { name: "Working paper", domain: "ssrn.com", confidence: 54, color: "#59c9a5" },
  ],
  citations: [
    { id: "c1", title: "Sample citation — hybrid work field experiment", domain: "nber.org", note: "Randomized trial, hybrid vs. in-office." },
    { id: "c2", title: "Sample citation — hybrid work and retention", domain: "sciencedirect.com", note: "Meta-analysis across multiple firms." },
    { id: "c3", title: "Sample citation — remote work and innovation", domain: "ssrn.com", note: "Patent and code-review based measures." },
    { id: "c4", title: "Sample citation — perceived vs. measured output", domain: "hbr.org", note: "Survey compared against manager ratings." },
  ],
};

export const mockUsage: UsageMeter[] = [
  { label: "Research runs this month", used: 18, limit: 50 },
  { label: "Papers processed", used: 4, limit: 20 },
  { label: "Storage (MB)", used: 38, limit: 200 },
];
