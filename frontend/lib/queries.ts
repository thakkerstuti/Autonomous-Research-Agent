"use client";

import { useQuery } from "@tanstack/react-query";
import { mockPapers, mockReport, mockSessions, mockUsage } from "./mock-data";
import { PaperItem, ResearchReport, SessionSummary, UsageMeter } from "./types";

const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// Swap each of these for a real fetch("/api/...") call once the backend exists.
async function fetchSessions(): Promise<SessionSummary[]> {
  await delay();
  return mockSessions;
}
async function fetchPapers(): Promise<PaperItem[]> {
  await delay();
  return mockPapers;
}
async function fetchReport(): Promise<ResearchReport> {
  await delay();
  return mockReport;
}
async function fetchUsage(): Promise<UsageMeter[]> {
  await delay();
  return mockUsage;
}

export const useSessionsQuery = () => useQuery({ queryKey: ["sessions"], queryFn: fetchSessions, staleTime: 30_000 });
export const usePapersQuery = () => useQuery({ queryKey: ["papers"], queryFn: fetchPapers, staleTime: 30_000 });
export const useReportQuery = () => useQuery({ queryKey: ["report"], queryFn: fetchReport, staleTime: 30_000 });
export const useUsageQuery = () => useQuery({ queryKey: ["usage"], queryFn: fetchUsage, staleTime: 30_000 });
