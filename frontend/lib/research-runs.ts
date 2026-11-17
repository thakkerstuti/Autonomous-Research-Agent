/**
 * Research runs, threads and research papers (the /research/runs, /threads and
 * /documents API). Everything lives on the server; the browser only keeps ids.
 */
import { API_BASE, apiClient } from "./api";
import { ApiError } from "./api-error";
import { getAccessToken, recoverFromUnauthorized } from "./auth";
import { OutputFormat } from "./types";
import type { RunProgress, RunStatus } from "./run-stages";
import { runRequestBody } from "./mode-intent";

export { STAGE_ORDER, stageStates, runSeconds, parseServerTime } from "./run-stages";
export type { RunProgress, RunStatus, StageKey, StageState } from "./run-stages";

export interface DocumentSummary {
  id: string;
  title: string | null;
  status: "generating" | "ready" | "failed";
  error: string | null;
  current_version: number;
  edited: boolean;
  pdf_stored?: boolean;
  updated_at: string | null;
}

export interface PublicEvidence {
  id: string;
  source_url: string;
  source_title: string;
  snippet: string;
  quote: string;
  stance: "supports" | "refutes" | "neutral";
  confidence: number;
  verification_status: string;
  source_type: string;
  retrieved_at: string;
}

export interface ResearchRun {
  session_id: string;
  thread_id: string;
  research_question: string;
  output_format: OutputFormat;
  /** Set when this run is another mode of an earlier question (the answer's mode buttons). */
  based_on: string | null;
  status: RunStatus;
  progress: RunProgress;
  /** The answer for Quick and Detailed; null for a Research paper turn, whose result is the document. */
  report: string | null;
  note: string | null;
  error: string | null;
  needs_review: boolean;
  evidence_log: PublicEvidence[];
  stats: { duration_seconds?: number };
  created_at: string | null;
  updated_at: string | null;
  document: DocumentSummary | null;
}

export interface ThreadSummary {
  thread_id: string;
  title: string;
  output_format: OutputFormat;
  modes: OutputFormat[];
  latest_mode: OutputFormat;
  created_at: string | null;
  updated_at: string | null;
  turns: number;
  status: RunStatus;
  has_paper: boolean;
  paper_status: DocumentSummary["status"] | null;
  paper_edited: boolean;
  paper_saved_at: string | null;
  document_id: string | null;
}

export interface PaperSection {
  id: string;
  level: 1 | 2;
  heading: string;
  body: string;
}

export interface PaperReference {
  n: number;
  title: string;
  site: string;
  url: string;
  accessed: string;
  source_type?: string;
}

export interface PaperContent {
  schema?: number;
  title: string;
  author: string;
  date: string;
  question: string;
  abstract: string;
  keywords: string[];
  sections: PaperSection[];
  references: PaperReference[];
}

export interface ResearchDocument extends DocumentSummary {
  session_id: string;
  thread_id: string | null;
  version: number | null;
  content: PaperContent | null;
  pdf: { version: number | null; stored: boolean };
  versions: { version: number; source: "generated" | "edit"; created_at: string | null }[];
}

export const MODE_LABEL: Record<OutputFormat, string> = {
  quick: "Quick answer",
  detailed: "Detailed analysis",
  full: "Research paper",
};

export const isFinished = (s: RunStatus) => s !== "in_progress";

/** A new question (optionally a follow-up in a conversation). */
export const startRun = (question: string, output_format: OutputFormat, thread_id?: string | null) =>
  apiClient<ResearchRun>("/research/runs", {
    method: "POST",
    body: JSON.stringify(runRequestBody(output_format, { question, thread_id })),
  });

/** The same question again in another mode (Detailed analysis, Research paper); the server takes the question from that session. */
export const startModeRun = (basedOn: string, output_format: OutputFormat) =>
  apiClient<ResearchRun>("/research/runs", {
    method: "POST",
    body: JSON.stringify(runRequestBody(output_format, { based_on: basedOn })),
  });

export const getRun = (sessionId: string) => apiClient<ResearchRun>(`/research/runs/${sessionId}`);

export const getThread = (threadId: string) =>
  apiClient<{ thread_id: string; title: string; turns: ResearchRun[] }>(`/research/threads/${threadId}`);

export const listThreads = () => apiClient<ThreadSummary[]>("/research/threads");

export const requestPaper = (sessionId: string) =>
  apiClient<DocumentSummary>(`/research/sessions/${sessionId}/paper`, { method: "POST" });

export const getDocument = (documentId: string, version?: number) =>
  apiClient<ResearchDocument>(`/research/documents/${documentId}${version ? `?version=${version}` : ""}`);

export const saveDocument = (documentId: string, content: PaperContent, baseVersion: number) =>
  apiClient<ResearchDocument>(`/research/documents/${documentId}`, {
    method: "PUT",
    body: JSON.stringify({ content, base_version: baseVersion }),
  });

/** The PDF of the latest saved version, fetched with the user's token and handed to the browser as a download. */
export async function downloadPaperPdf(documentId: string, fallbackName = "research-paper.pdf"): Promise<void> {
  const url = `${API_BASE}/research/documents/${documentId}/pdf`;
  const get = (token: string | null) =>
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => {
      throw new ApiError(0, "Couldn't reach the CogNexa server to make the PDF.");
    });
  let res = await get(await getAccessToken());
  if (res.status === 401) {
    const renewed = await recoverFromUnauthorized();
    if (renewed) res = await get(renewed);
  }
  if (!res.ok) throw new ApiError(res.status, res.status === 404 ? "This paper couldn't be found." : `Couldn't make the PDF (HTTP ${res.status}).`);
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] || fallbackName;
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
