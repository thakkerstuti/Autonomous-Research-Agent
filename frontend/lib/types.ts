export type Mode = "research" | "paper";

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role?: string;
  institution?: string;
}

export interface EvidenceSource {
  name: string;
  domain: string;
  confidence: number; // 0-100
  color: string;
}

export interface AgentStepEvent {
  type: "step" | "sources" | "done";
  label?: string;
  detail?: string;
  sources?: EvidenceSource[];
  answer?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text?: string;
  steps?: { label: string; detail: string }[];
  sources?: EvidenceSource[];
  answer?: string;
  status: "pending" | "streaming" | "done";
}

export interface SessionSummary {
  id: string;
  title: string;
  mode: Mode;
  status: "ready" | "in_progress" | "review";
  updated: string;
}

export interface PaperItem {
  id: string;
  title: string;
  authors: string;
  pages: number;
  uploaded: string;
  status: "ready" | "processing" | "failed";
  progress?: number; // 0-100, only while processing
}

export interface ReportFinding {
  id: string;
  text: string;
  confidence: number; // 0-100
  citationIds: string[];
}

export interface ReportCitation {
  id: string;
  title: string;
  domain: string;
  note: string;
}

export interface ResearchReport {
  id: string;
  question: string;
  summary: string;
  updated: string;
  findings: ReportFinding[];
  sources: EvidenceSource[];
  citations: ReportCitation[];
}

export interface UsageMeter {
  label: string;
  used: number;
  limit: number;
}

export type ModelPreference = "fast" | "balanced" | "deep";
