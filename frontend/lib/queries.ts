"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { PaperItem, ResearchReport, SessionSummary, UsageMeter } from "./types";
import { apiClient } from "./api";
import type { CardState, KitStatus, OutputKind } from "./study-logic";

async function fetchSessions(): Promise<SessionSummary[]> {
  try {
    const sessions = await apiClient<SessionSummary[]>("/research/sessions");
    return sessions || [];
  } catch (err) {
    console.warn("fetchSessions failed:", err);
    return [];
  }
}

async function fetchPapers(): Promise<PaperItem[]> {
  try {
    const papers = await apiClient<PaperItem[]>("/papers");
    return papers || [];
  } catch (err) {
    console.warn("fetchPapers failed:", err);
    return [];
  }
}

async function fetchReport(): Promise<ResearchReport | null> {
  try {
    const report = await apiClient<ResearchReport | null>("/research/latest-report");
    return report || null;
  } catch (err) {
    console.warn("fetchReport failed:", err);
    return null;
  }
}

async function fetchUsage(): Promise<UsageMeter[]> {
  return [
    { label: "Search credits", used: 12, limit: 100 },
    { label: "Research sessions", used: 3, limit: 25 },
  ];
}


export const useSessionsQuery = () => useQuery({ queryKey: ["sessions"], queryFn: fetchSessions, staleTime: 30_000 });
/** Research conversations with their output mode and paper state (History). */
export const useThreadsQuery = () =>
  useQuery({
    queryKey: ["threads"],
    queryFn: () => import("./research-runs").then((m) => m.listThreads()),
    staleTime: 15_000,
    refetchInterval: (q) => (q.state.data?.some((t) => t.status === "in_progress" || t.paper_status === "generating") ? 5000 : false),
  });
export const usePapersQuery = () => useQuery({ queryKey: ["papers"], queryFn: fetchPapers, staleTime: 30_000 });
export const useReportQuery = () => useQuery({ queryKey: ["report"], queryFn: fetchReport, staleTime: 30_000 });
export const useUsageQuery = () => useQuery({ queryKey: ["usage"], queryFn: fetchUsage, staleTime: 30_000 });

/* ── Read-only detail queries used by the dashboard (existing endpoints) ── */

export interface PaperPagesProgress {
  paperId: string;
  pages: { page_number: number; status: string }[];
}

async function fetchPaperPages(paperId: string): Promise<PaperPagesProgress | null> {
  try {
    const data = await apiClient<{ pages: { page_number: number; status: string }[] }>(`/papers/${paperId}/pages`);
    return { paperId, pages: data?.pages ?? [] };
  } catch (err) {
    console.warn("fetchPaperPages failed:", err);
    return null;
  }
}

export async function fetchSessionDetail(sessionId: string): Promise<any | null> {
  try {
    return await apiClient<any>(`/research/sessions/${sessionId}`);
  } catch (err) {
    console.warn("fetchSessionDetail failed:", err);
    return null;
  }
}

export const usePaperPagesQueries = (ids: string[]) =>
  useQueries({
    queries: ids.map((id) => ({ queryKey: ["paper-pages", id], queryFn: () => fetchPaperPages(id), staleTime: 30_000 })),
  });

/* ── One paper, for the Paper Study workspace (same keys as above, so caches are shared) ── */

export interface PaperDetail {
  id: string;
  title: string;
  page_count: number | null;
  level: string | null;
  status: string | null;
  overview: string | null;
}

export interface PageExplanation {
  page_number: number;
  level: string;
  status: string;
  summary: string | null;
  key_points: string[] | null;
  terms: Record<string, string> | null;
  figures: Record<string, string> | null;
  error: string | null;
}

export const usePaperQuery = (id: string | null) =>
  useQuery({
    queryKey: ["paper", id],
    queryFn: () => apiClient<PaperDetail>(`/papers/${id}`),
    enabled: !!id,
    retry: (count, err: any) => err?.status !== 404 && count < 2,
    staleTime: 30_000,
  });

/** Page statuses; keeps polling while any page is still being explained. */
export const usePaperPagesQuery = (id: string | null) =>
  useQuery({
    queryKey: ["paper-pages", id],
    queryFn: () => fetchPaperPages(id!),
    enabled: !!id,
    staleTime: 2_000,
    refetchInterval: (query) => {
      const pages = (query.state.data as PaperPagesProgress | null | undefined)?.pages;
      return !pages || pages.some((p) => p.status === "pending" || p.status === "processing") ? 3_000 : false;
    },
  });

export interface PaperStatus {
  paper_id: string;
  status: "processing" | "ready" | "partial" | "failed" | "needs_ocr" | string;
  level: string;
  page_count: number | null;
  text_pages: number;
  skipped_pages: number;
  total: number;
  pending: number;
  processing: number;
  ready: number;
  failed: number;
  message: string;
}

/** Paper-level progress; polls while pages are still being explained. */
export const usePaperStatusQuery = (id: string | null) =>
  useQuery({
    queryKey: ["paper-status", id],
    queryFn: () => apiClient<PaperStatus>(`/papers/${id}/status`),
    enabled: !!id,
    staleTime: 2_000,
    refetchInterval: (query) => ((query.state.data as PaperStatus | undefined)?.status === "processing" || !query.state.data ? 3_000 : false),
  });

/* ── Paper workspace: page outline and extracted text (read-only) ── */

export interface OutlinePage {
  page_number: number;
  has_text: boolean;
  /** Explanation status at the paper's level; null when not requested yet. */
  explanation: string | null;
}

export const useOutlineQuery = (id: string | null) =>
  useQuery({
    queryKey: ["paper-outline", id],
    queryFn: () => apiClient<{ paper_id: string; level: string; pages: OutlinePage[] }>(`/papers/${id}/outline`),
    enabled: !!id,
    staleTime: 2_000,
    refetchInterval: (query) => {
      const pages = (query.state.data as { pages: OutlinePage[] } | undefined)?.pages;
      return pages?.some((p) => p.explanation === "pending" || p.explanation === "processing") ? 3_000 : false;
    },
  });

export const usePageTextQuery = (id: string | null, page: number, enabled: boolean) =>
  useQuery({
    queryKey: ["page-text", id, page],
    queryFn: () => apiClient<{ page_number: number; status: string; text: string }>(`/papers/${id}/pages/${page}/text`),
    enabled: !!id && enabled,
    staleTime: Infinity,
  });

/* ── Study kit (summary, flashcards, questions, highlights, ask) ── */

/** Kit progress; polls only while something is being generated. */
export const useStudyStatusQuery = (id: string | null) =>
  useQuery({
    queryKey: ["study-status", id],
    queryFn: () => apiClient<KitStatus>(`/papers/${id}/study`),
    enabled: !!id,
    staleTime: 2_000,
    refetchInterval: (query) => ((query.state.data as KitStatus | undefined)?.status === "processing" ? 3_000 : false),
  });

export interface StudyOutput<T> {
  kind: OutputKind;
  status: string;
  error: string | null;
  content: T | null;
  progress?: Record<string, CardState>;
}

/** One generated section, keyed by its version: fetched once, and again only after a regenerate. */
export const useStudyOutputQuery = <T>(id: string | null, kind: OutputKind, version: string | null, ready: boolean) =>
  useQuery({
    queryKey: ["study-output", id, kind, version],
    queryFn: () => apiClient<StudyOutput<T>>(`/papers/${id}/study/${kind}`),
    enabled: !!id && ready,
    staleTime: Infinity,
  });

export type AssistantAction = "ask" | "explain_page" | "summarize_pages" | "compare_pages" | "explain_selection";

export interface AskEntry {
  id: string;
  action?: AssistantAction;
  pages_requested?: number[];
  question: string;
  answer: string;
  found: boolean;
  grounded: boolean;
  citations: { page: number; quote: string; verified: boolean }[];
  pages_considered: number[];
  asked_at: string;
}

export const useAsksQuery = (id: string | null) =>
  useQuery({
    queryKey: ["paper-asks", id],
    queryFn: () => apiClient<{ items: AskEntry[] }>(`/papers/${id}/asks`),
    enabled: !!id,
    staleTime: Infinity,
  });

/** A settled page (ready or failed). Reading never triggers AI processing. */
export const usePageExplanationQuery = (id: string | null, page: number | null, level: string | null, settled: string | null) =>
  useQuery({
    queryKey: ["paper-page", id, page, level, settled],
    queryFn: () => apiClient<PageExplanation>(`/papers/${id}/pages/${page}?level=${encodeURIComponent(level || "Medium")}`),
    enabled: !!id && page != null && !!level && (settled === "ready" || settled === "failed"),
    staleTime: Infinity,
    // Statuses and level can briefly disagree after a level switch: if the record
    // fetched isn't in the state the page list reports yet, fetch it again
    refetchInterval: (query) => {
      const data = query.state.data as PageExplanation | undefined;
      return data && data.status !== settled ? 2_000 : false;
    },
  });

export const useSessionDetailQueries = (ids: string[]) =>
  useQueries({
    queries: ids.map((id) => ({ queryKey: ["session-detail", id], queryFn: () => fetchSessionDetail(id), staleTime: 60_000 })),
  });
