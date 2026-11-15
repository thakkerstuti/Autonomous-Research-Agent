"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { PaperItem, ResearchReport, SessionSummary, UsageMeter } from "./types";
import { apiClient } from "./api";

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

/** A finished page explanation. Only requested once the page is ready, so it never triggers generation. */
export const usePageExplanationQuery = (id: string | null, page: number | null, level: string | null, ready: boolean) =>
  useQuery({
    queryKey: ["paper-page", id, page, level],
    queryFn: () => apiClient<PageExplanation>(`/papers/${id}/pages/${page}?level=${encodeURIComponent(level || "Medium")}`),
    enabled: !!id && page != null && ready,
    staleTime: Infinity,
  });

export const useSessionDetailQueries = (ids: string[]) =>
  useQueries({
    queries: ids.map((id) => ({ queryKey: ["session-detail", id], queryFn: () => fetchSessionDetail(id), staleTime: 60_000 })),
  });
