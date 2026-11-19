export type Mode = "research" | "paper";

export type OutputFormat = "quick" | "detailed" | "full";

export interface CritiqueCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface CritiqueResult {
  passed: boolean;
  status: "passed" | "passed_with_revisions" | "flagged_issues" | "skipped_on_failure" | "incomplete";
  checks: CritiqueCheck[];
  issues: string[];
  needs_review?: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role?: string;
  institution?: string;
  hasPassword?: boolean;
  providers?: string[];
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
  /** Structured view of the same backend response, for presentation only. */
  view?: import("./research-view").ResearchView;
  /** When the request started, for the live run timer. */
  startedAt?: number;
  /** The server's research run behind this answer (Working Flow, result, paper). */
  run?: import("./research-runs").ResearchRun;
  /** The output mode requested, known before the server answers (for the label and Working Flow). */
  mode?: OutputFormat;
  /** A mode button's run: the question it re-runs, shown instead of a typed message. */
  basedOnQuestion?: string;
  /** A sent message waiting for the user to choose how it should be answered. */
  awaitingChoice?: boolean;
  /** A conversation turn answered by the chat (not a research run). */
  chat?: {
    sessionId: string;
    sources: import("./chat-stream").ChatSource[];
    usedWebSearch: boolean;
    stageLabel?: string;
    error?: string;
    createdAt?: string | null;
    /** The saved answer's id (what "Add to paper" refers to). */
    messageId?: string;
  };
}

export interface SessionSummary {
  id: string;
  title: string;
  mode: Mode;
  status: "ready" | "in_progress" | "review";
  updated: string;
  output_format?: OutputFormat;
  thread_id?: string;
  has_paper?: boolean;
  paper_edited?: boolean;
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
  url?: string;
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
