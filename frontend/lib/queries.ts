"use client";

import { useQuery } from "@tanstack/react-query";
import { PaperItem, ResearchReport, SessionSummary, UsageMeter } from "./types";

async function fetchSessions(): Promise<SessionSummary[]> {
  return [];
}
async function fetchPapers(): Promise<PaperItem[]> {
  return [];
}
async function fetchReport(): Promise<ResearchReport | null> {
  return null;
}
async function fetchUsage(): Promise<UsageMeter[]> {
  return [];
}

export const useSessionsQuery = () => useQuery({ queryKey: ["sessions"], queryFn: fetchSessions, staleTime: 30_000 });
export const usePapersQuery = () => useQuery({ queryKey: ["papers"], queryFn: fetchPapers, staleTime: 30_000 });
export const useReportQuery = () => useQuery({ queryKey: ["report"], queryFn: fetchReport, staleTime: 30_000 });
export const useUsageQuery = () => useQuery({ queryKey: ["usage"], queryFn: fetchUsage, staleTime: 30_000 });
