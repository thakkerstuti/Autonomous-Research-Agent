"use client";

import { useQuery } from "@tanstack/react-query";
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
