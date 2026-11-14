"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight, ArrowUpRight, ArrowUp, BookOpen, FileText, Plus, Search, Upload, AlertTriangle,
} from "lucide-react";
import {
  usePapersQuery, useSessionsQuery, useReportQuery, usePaperPagesQueries, useSessionDetailQueries,
} from "@/lib/queries";
import { modeHref } from "@/lib/nav";
import { paperStatus, sessionStatus } from "@/lib/status";
import { STATUS_TONE } from "@/lib/research-view";
import { Badge } from "@/components/ui/badge";
import { ProgressRing, PageStrip } from "@/components/viz/progress";
import { PaperItem, SessionSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

/* ─────────────────────────── helpers ─────────────────────────── */

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const word = (n: number) => (n < WORDS.length ? WORDS[n] : String(n));
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function toTime(s?: string) {
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

function dayLabel(t: number) {
  if (!t) return "Earlier";
  const d = new Date(t);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function parseFinding(text: string) {
  const m = text.match(/^\[([A-Z_]+)\]\s*(.*)$/);
  return m ? { status: m[1].toLowerCase(), text: m[2] } : { status: "untested", text };
}

/* ─────────────────────────── small parts ─────────────────────────── */

function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-baseline justify-between gap-4">
      <h2 className="font-display text-title-sm font-semibold text-ink">{children}</h2>
      {aside}
    </div>
  );
}

function SeeAll({ href, children = "See all" }: { href: string; children?: React.ReactNode }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-1 text-meta text-ink-faint transition-colors hover:text-ink">
      {children}
      <ArrowRight size={12} className="transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
    </Link>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-ink/[0.06]", className)} />;
}

/* ─────────────────────────── ledger ─────────────────────────── */

function LedgerCell({
  label, value, note, loading, muted,
}: { label: string; value: string; note: string; loading?: boolean; muted?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 border-line py-5 pr-4 [&:nth-child(n+3)]:border-t sm:px-5 sm:first:pl-0 sm:border-l sm:first:border-l-0 sm:[&:nth-child(n+3)]:border-t-0">
      <span className="col-label">{label}</span>
      {loading ? (
        <Skeleton className="h-10 w-16" />
      ) : (
        <span className={cn("figure text-[44px]", muted ? "text-ink-faint/60" : "text-ink")}>{value}</span>
      )}
      <span className="truncate text-meta text-ink-soft">{loading ? " " : note}</span>
    </div>
  );
}

/* ─────────────────────────── page ─────────────────────────── */

export default function DashboardPage() {
  const router = useRouter();
  const { data: sessions, isLoading: sLoading } = useSessionsQuery();
  const { data: papers, isLoading: pLoading } = usePapersQuery();
  const { data: report, isLoading: rLoading } = useReportQuery();

  const sessionList: SessionSummary[] = sessions ?? [];
  const paperList: PaperItem[] = papers ?? [];

  // Detail fetches use existing read endpoints, limited to recent items
  const paperIds = useMemo(() => paperList.slice(0, 8).map((p) => p.id), [paperList]);
  const sessionIds = useMemo(() => sessionList.slice(0, 4).map((s) => s.id), [sessionList]);
  const pageQueries = usePaperPagesQueries(paperIds);
  const detailQueries = useSessionDetailQueries(sessionIds);

  const pagesById = useMemo(() => {
    const m = new Map<string, { page_number: number; status: string }[]>();
    pageQueries.forEach((q) => q.data && m.set(q.data.paperId, q.data.pages));
    return m;
  }, [pageQueries]);

  const detailById = useMemo(() => {
    const m = new Map<string, any>();
    detailQueries.forEach((q, i) => q.data && m.set(sessionIds[i], q.data));
    return m;
  }, [detailQueries, sessionIds]);

  const loading = sLoading || pLoading;
  const empty = !loading && sessionList.length === 0 && paperList.length === 0;

  /* ── derived, all from real data ── */
  const sReady = sessionList.filter((s) => s.status === "ready").length;
  const sRunning = sessionList.filter((s) => s.status === "in_progress").length;
  const sReview = sessionList.filter((s) => s.status === "review").length;
  const pReady = paperList.filter((p) => p.status === "ready").length;
  const pProcessing = paperList.filter((p) => p.status === "processing").length;
  const pFailed = paperList.filter((p) => p.status === "failed").length;

  const pageTotals = useMemo(() => {
    let ready = 0, total = 0;
    pagesById.forEach((pages) => {
      total += pages.length;
      ready += pages.filter((p) => p.status === "ready").length;
    });
    return { ready, total, covered: pagesById.size };
  }, [pagesById]);

  const findings = useMemo(() => (report?.findings ?? []).map((f) => ({ ...f, ...parseFinding(f.text) })), [report]);

  /* ── narrative headline ── */
  const headline = empty
    ? "Your desk is clear."
    : `${word(sessionList.length)} ${plural(sessionList.length, "investigation")} and ${lower(word(paperList.length))} ${plural(paperList.length, "paper")} on your desk.`;

  const clauses: string[] = [];
  if (sRunning) clauses.push(`${word(sRunning)} ${plural(sRunning, "investigation is", "investigations are")} still running`);
  if (pProcessing) clauses.push(`${lower(word(pProcessing))} ${plural(pProcessing, "paper is", "papers are")} being summarised`);
  if (sReview) clauses.push(`${lower(word(sReview))} ${plural(sReview, "thread needs", "threads need")} review`);
  if (pFailed) clauses.push(`${lower(word(pFailed))} ${plural(pFailed, "upload")} failed`);
  const subline = empty
    ? "Start an investigation or bring a paper to study. Your progress, activity and next steps will build up here."
    : clauses.length
      ? `${clauses.join(", ").replace(/^./, (c) => c.toUpperCase())}.`
      : "Everything is up to date.";

  /* ── continue where you left off ── */
  type Item =
    | { kind: "session"; t: number; s: SessionSummary }
    | { kind: "paper"; t: number; p: PaperItem };
  const resume: Item[] = useMemo(() => {
    const items: Item[] = [
      ...sessionList.map((s) => ({ kind: "session" as const, t: toTime(s.updated), s })),
      ...paperList.map((p) => ({ kind: "paper" as const, t: toTime(p.uploaded), p })),
    ];
    return items.sort((a, b) => b.t - a.t).slice(0, 4);
  }, [sessionList, paperList]);

  /* ── activity feed ── */
  const activity = useMemo(() => {
    const ev: { t: number; kind: "research" | "paper" | "report"; title: string; detail: string; href: string }[] = [];
    sessionList.forEach((s) =>
      ev.push({
        t: toTime(s.updated),
        kind: "research",
        title: s.title,
        detail: s.status === "ready" ? "Investigation completed" : s.status === "review" ? "Investigation needs review" : "Investigation started",
        href: modeHref(s.mode, s.id),
      })
    );
    paperList.forEach((p) =>
      ev.push({
        t: toTime(p.uploaded),
        kind: "paper",
        title: p.title,
        detail: p.status === "ready" ? `Paper processed · ${p.pages} pages` : p.status === "failed" ? "Paper upload failed" : "Paper uploaded",
        href: "/library",
      })
    );
    if (report) ev.push({ t: toTime(report.updated), kind: "report", title: report.question, detail: "Report generated", href: "/report" });
    const sorted = ev.sort((a, b) => b.t - a.t).slice(0, 9);
    const groups: { label: string; items: typeof sorted }[] = [];
    sorted.forEach((e) => {
      const label = dayLabel(e.t);
      const g = groups.find((x) => x.label === label);
      if (g) g.items.push(e);
      else groups.push({ label, items: [e] });
    });
    return groups;
  }, [sessionList, paperList, report]);

  /* ── next steps (rules over real state) ── */
  const steps = useMemo(() => {
    const out: { title: string; why: string; href: string; tone?: "warn" }[] = [];
    sessionList.filter((s) => s.status === "review").slice(0, 2).forEach((s) =>
      out.push({ title: `Review “${s.title}”`, why: "The agent flagged this investigation for review.", href: modeHref(s.mode, s.id), tone: "warn" })
    );
    paperList.filter((p) => p.status === "failed").slice(0, 1).forEach((p) =>
      out.push({ title: `Re-upload “${p.title}”`, why: "Processing failed for this paper.", href: "/library", tone: "warn" })
    );
    paperList.filter((p) => p.status === "ready").slice(0, 1).forEach((p) =>
      out.push({ title: `Study “${p.title}”`, why: "It is summarised and ready for the canvas.", href: "/paper-study" })
    );
    if (report) out.push({ title: "Read the latest report", why: `${report.findings.length} ${plural(report.findings.length, "finding")} on “${report.question}”.`, href: "/report" });
    if (!sessionList.length) out.push({ title: "Ask your first research question", why: "The agent plans hypotheses, searches and verifies sources.", href: "/research" });
    if (!paperList.length) out.push({ title: "Bring a paper to study", why: "Upload a PDF and read it page by page.", href: "/paper-study" });
    return out.slice(0, 4);
  }, [sessionList, paperList, report]);

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1240px] px-5 pb-20 pt-8 sm:px-10 sm:pt-12">
        {/* ── Header: the state of the desk, in a sentence ── */}
        <header className="stagger flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
          <div className="min-w-0 max-w-[760px]" style={{ ["--i" as string]: 0 }}>
            <p className="text-meta text-ink-faint" suppressHydrationWarning>{today}</p>
            {loading ? (
              <>
                <Skeleton className="mt-4 h-12 w-[min(560px,90%)]" />
                <Skeleton className="mt-4 h-4 w-72" />
              </>
            ) : (
              <>
                <h1 className="mt-3 font-display text-display-xl font-semibold text-ink">{headline}</h1>
                <p className="mt-4 max-w-[58ch] text-body-lg text-ink-soft">{subline}</p>
              </>
            )}
          </div>
          <div className="flex flex-shrink-0 items-center gap-2" style={{ ["--i" as string]: 1 }}>
            <Link
              href="/paper-study"
              className="pressable inline-flex h-10 items-center gap-2 rounded-[11px] border border-line bg-surface px-4 text-[13px] font-medium text-ink hover:border-line-hover"
            >
              <Upload size={15} /> Study a paper
            </Link>
            <Link
              href="/research"
              className="pressable inline-flex h-10 items-center gap-2 rounded-[11px] bg-primary px-4 text-[13px] font-medium text-on-primary hover:bg-primary/90"
            >
              <Plus size={15} /> New research
            </Link>
          </div>
        </header>

        {/* ── Ledger ── */}
        <section
          aria-label="Overview"
          className="animate-view-in mt-10 grid grid-cols-2 border-y border-line sm:grid-cols-4"
          style={{ animationDelay: "90ms" }}
        >
          <LedgerCell
            label="Investigations"
            value={String(sessionList.length)}
            note={sessionList.length ? `${sReady} complete${sRunning ? ` · ${sRunning} running` : ""}${sReview ? ` · ${sReview} to review` : ""}` : "None started yet"}
            loading={sLoading}
            muted={!sessionList.length}
          />
          <LedgerCell
            label="Papers"
            value={String(paperList.length)}
            note={paperList.length ? `${pReady} ready${pProcessing ? ` · ${pProcessing} processing` : ""}` : "Nothing uploaded"}
            loading={pLoading}
            muted={!paperList.length}
          />
          <LedgerCell
            label="Pages summarised"
            value={pageTotals.total ? String(pageTotals.ready) : "—"}
            note={
              pageTotals.total
                ? `of ${pageTotals.total} pages${paperList.length > pageTotals.covered ? " in recent papers" : ""}`
                : paperList.length ? "Checking progress…" : "No pages yet"
            }
            loading={pLoading}
            muted={!pageTotals.total}
          />
          <LedgerCell
            label="Latest report"
            value={report ? String(report.findings.length) : "—"}
            note={report ? `${plural(report.findings.length, "finding")} · ${report.citations.length} ${plural(report.citations.length, "citation")}` : "No report yet"}
            loading={rLoading}
            muted={!report}
          />
        </section>

        {empty ? (
          <EmptyDesk onAsk={(q) => router.push(`/research?q=${encodeURIComponent(q)}`)} />
        ) : (
          <div className="mt-14 grid gap-x-14 gap-y-16 lg:grid-cols-12">
            {/* ═══ Left column ═══ */}
            <div className="min-w-0 lg:col-span-8">
              {/* Continue */}
              <section className="animate-view-in" style={{ animationDelay: "140ms" }}>
                <SectionTitle aside={<SeeAll href="/history">All sessions</SeeAll>}>Continue where you left off</SectionTitle>
                {loading ? (
                  <Skeleton className="h-[188px] w-full rounded-2xl" />
                ) : (
                  <div className="grid gap-3">
                    {resume[0] && (
                      <ResumeFeature item={resume[0]} pages={resume[0].kind === "paper" ? pagesById.get(resume[0].p.id) : undefined} detail={resume[0].kind === "session" ? detailById.get(resume[0].s.id) : undefined} />
                    )}
                    {resume.length > 1 && (
                      <div className="grid gap-3 sm:grid-cols-3">
                        {resume.slice(1).map((it) => (
                          <ResumeTile
                            key={it.kind === "session" ? it.s.id : it.p.id}
                            item={it}
                            pages={it.kind === "paper" ? pagesById.get(it.p.id) : undefined}
                            detail={it.kind === "session" ? detailById.get(it.s.id) : undefined}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Progress */}
              <section className="animate-view-in mt-16" style={{ animationDelay: "200ms" }}>
                <SectionTitle>Research progress</SectionTitle>

                {paperList.length > 0 && (
                  <div className="mb-10">
                    <div className="col-label mb-3 grid grid-cols-[1fr_auto] gap-4 border-b border-line pb-2">
                      <span>Papers · summarised pages</span>
                      <span>Done</span>
                    </div>
                    <ul>
                      {paperList.slice(0, 6).map((p) => {
                        const pages = pagesById.get(p.id);
                        const ready = pages?.filter((x) => x.status === "ready").length ?? 0;
                        const pct = pages?.length ? Math.round((ready / pages.length) * 100) : null;
                        return (
                          <li key={p.id} className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 border-b border-line py-4">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-[14px] font-medium text-ink">{p.title}</span>
                                {p.status !== "ready" && <Badge variant={paperStatus[p.status].variant}>{paperStatus[p.status].label}</Badge>}
                              </div>
                              <div className="mt-2.5">
                                {pages ? (
                                  pages.length ? <PageStrip pages={pages} /> : <p className="text-meta text-ink-faint">No page summaries yet</p>
                                ) : (
                                  <Skeleton className="h-2.5 w-full" />
                                )}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="figure text-[26px] text-ink">{pct === null ? "—" : `${pct}%`}</div>
                              <div className="mono mt-1 text-[11.5px] text-ink-faint">{pages ? `${ready}/${pages.length}` : ""}</div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {sessionList.length > 0 && (
                  <div>
                    <div className="col-label mb-3 grid grid-cols-[1fr_auto] gap-4 border-b border-line pb-2">
                      <span>Investigations · hypotheses tested</span>
                      <span>Evidence</span>
                    </div>
                    <ul>
                      {sessionList.slice(0, 4).map((s) => {
                        const d = detailById.get(s.id);
                        const hyps: any[] = d?.hypotheses ?? [];
                        const evidence: number | null = d ? (d.evidence_log ?? []).length : null;
                        const counts = hyps.reduce<Record<string, number>>((acc, h) => {
                          const k = String(h.status ?? "untested");
                          acc[k] = (acc[k] ?? 0) + 1;
                          return acc;
                        }, {});
                        return (
                          <li key={s.id}>
                            <Link href={modeHref(s.mode, s.id)} className="group grid grid-cols-[1fr_auto] items-center gap-x-6 border-b border-line py-4">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="truncate text-[14px] font-medium text-ink transition-colors group-hover:text-accent">{s.title}</span>
                                  {s.status !== "ready" && <Badge variant={sessionStatus[s.status].variant}>{sessionStatus[s.status].label}</Badge>}
                                </div>
                                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                                  {!d && detailQueries.length > 0 ? (
                                    <Skeleton className="h-3 w-40" />
                                  ) : hyps.length ? (
                                    <>
                                      <span className="flex items-center gap-1.5" aria-hidden>
                                        {hyps.map((h, i) => (
                                          <span key={i} className={cn("h-2 w-2 rounded-full", STATUS_TONE[h.status]?.dot ?? "bg-ink-faint")} />
                                        ))}
                                      </span>
                                      <span className="text-meta text-ink-soft">
                                        {Object.entries(counts).map(([k, n]) => `${n} ${STATUS_TONE[k]?.label.toLowerCase() ?? k}`).join(" · ")}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-meta text-ink-faint">Updated {s.updated}</span>
                                  )}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="figure text-[26px] text-ink">{evidence ?? "—"}</div>
                                <div className="mt-1 text-[11.5px] text-ink-faint">{evidence === null ? "" : plural(evidence, "item")}</div>
                              </div>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </section>
            </div>

            {/* ═══ Right column ═══ */}
            <aside className="min-w-0 lg:col-span-4">
              {/* Next steps */}
              <section className="animate-view-in" style={{ animationDelay: "170ms" }}>
                <SectionTitle>Next steps</SectionTitle>
                <ul className="border-t border-line">
                  {steps.map((st, i) => (
                    <li key={i}>
                      <Link href={st.href} className="group flex items-start gap-3 border-b border-line py-3.5">
                        {st.tone === "warn" ? (
                          <AlertTriangle size={15} className="mt-[3px] flex-shrink-0 text-warn" />
                        ) : (
                          <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13.5px] font-medium leading-snug text-ink">{st.title}</span>
                          <span className="mt-0.5 block text-meta text-ink-soft">{st.why}</span>
                        </span>
                        <ArrowUpRight size={15} className="mt-0.5 flex-shrink-0 text-ink-faint transition-[transform,color] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>

              {/* Insights */}
              <section className="animate-view-in mt-14" style={{ animationDelay: "230ms" }}>
                <SectionTitle>Insights</SectionTitle>
                <div className="grid gap-6">
                  {pageTotals.total > 0 && (
                    <div className="flex items-center gap-4">
                      <ProgressRing value={pageTotals.ready / pageTotals.total} size={56} stroke={3.5}>
                        <span className="mono text-[11.5px] text-ink">{Math.round((pageTotals.ready / pageTotals.total) * 100)}%</span>
                      </ProgressRing>
                      <p className="text-[13.5px] leading-snug text-ink-soft">
                        <span className="font-medium text-ink">Reading coverage.</span> {pageTotals.ready} of {pageTotals.total} pages have summaries ready to read.
                      </p>
                    </div>
                  )}
                  {sessionList.length > 0 && (
                    <div className="flex items-center gap-4">
                      <ProgressRing value={sReady / sessionList.length} size={56} stroke={3.5} tone="ok">
                        <span className="mono text-[11.5px] text-ink">{sReady}/{sessionList.length}</span>
                      </ProgressRing>
                      <p className="text-[13.5px] leading-snug text-ink-soft">
                        <span className="font-medium text-ink">Investigations completed.</span>{" "}
                        {sReady === sessionList.length ? "Every thread has a finished report." : `${sessionList.length - sReady} still open.`}
                      </p>
                    </div>
                  )}
                  {findings.length > 0 && (
                    <div>
                      <p className="text-[13.5px] text-ink-soft">
                        <span className="font-medium text-ink">Latest verdicts.</span> How the hypotheses in “{report?.question}” held up.
                      </p>
                      <ul className="mt-3 grid gap-2">
                        {findings.slice(0, 4).map((f) => (
                          <li key={f.id} className="flex items-start gap-2.5 text-meta">
                            <span className={cn("mt-[5px] h-2 w-2 flex-shrink-0 rounded-full", STATUS_TONE[f.status]?.dot ?? "bg-ink-faint")} />
                            <span className="min-w-0 flex-1 text-ink-soft">
                              <span className={cn("font-medium", STATUS_TONE[f.status]?.cls)}>{STATUS_TONE[f.status]?.label ?? f.status}</span> — {f.text}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {!pageTotals.total && !sessionList.length && !findings.length && (
                    <p className="text-meta text-ink-faint">Insights appear once papers are summarised or investigations finish.</p>
                  )}
                </div>
              </section>

              {/* Activity */}
              <section className="animate-view-in mt-14" style={{ animationDelay: "290ms" }}>
                <SectionTitle>Activity</SectionTitle>
                <ol className="relative">
                  {activity.map((g) => (
                    <li key={g.label} className="mb-5 last:mb-0">
                      <div className="col-label mb-2">{g.label}</div>
                      <ul className="relative border-l border-line pl-5">
                        {g.items.map((e, i) => (
                          <li key={i} className="relative pb-3.5 last:pb-0">
                            <span
                              className={cn(
                                "absolute -left-[24.5px] top-[5px] h-[8px] w-[8px] rounded-full ring-[3px] ring-bg",
                                e.kind === "research" ? "bg-accent" : e.kind === "paper" ? "bg-steel" : "bg-ok"
                              )}
                            />
                            <Link href={e.href} className="group block">
                              <span className="block text-meta text-ink-faint">{e.detail}</span>
                              <span className="block truncate text-[13.5px] text-ink transition-colors group-hover:text-accent">{e.title}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              </section>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── continue cards ─────────────────────────── */

type ResumeItem =
  | { kind: "session"; t: number; s: SessionSummary }
  | { kind: "paper"; t: number; p: PaperItem };

function resumeMeta(item: ResumeItem, pages?: { status: string }[], detail?: any) {
  if (item.kind === "paper") {
    const ready = pages?.filter((x) => x.status === "ready").length ?? 0;
    const total = pages?.length ?? 0;
    return {
      type: "Paper",
      icon: BookOpen,
      title: item.p.title,
      status: <Badge variant={paperStatus[item.p.status].variant}>{paperStatus[item.p.status].label}</Badge>,
      progress: total ? ready / total : null,
      progressLabel: total ? `${ready} of ${total} pages summarised` : `${item.p.pages} pages · uploaded ${item.p.uploaded}`,
      href: "/paper-study",
      action: "Open study canvas",
    };
  }
  const hyps: any[] = detail?.hypotheses ?? [];
  const tested = hyps.filter((h) => h.status && h.status !== "untested").length;
  return {
    type: "Investigation",
    icon: Search,
    title: item.s.title,
    status: <Badge variant={sessionStatus[item.s.status].variant}>{sessionStatus[item.s.status].label}</Badge>,
    progress: hyps.length ? tested / hyps.length : null,
    progressLabel: hyps.length ? `${tested} of ${hyps.length} hypotheses resolved` : `Updated ${item.s.updated}`,
    href: modeHref(item.s.mode, item.s.id),
    action: "Resume thread",
  };
}

function ResumeFeature({ item, pages, detail }: { item: ResumeItem; pages?: { status: string }[]; detail?: any }) {
  const m = resumeMeta(item, pages, detail);
  const Icon = m.icon;
  return (
    <Link
      href={m.href}
      className="group relative grid overflow-hidden rounded-2xl bg-surface shadow-sm transition-shadow duration-200 hover:shadow-panel sm:grid-cols-[1fr_200px]"
    >
      <div className="atmosphere opacity-60" aria-hidden />
      <div className="relative min-w-0 p-6 sm:p-7">
        <div className="flex items-center gap-2 text-meta text-ink-faint">
          <Icon size={14} strokeWidth={1.75} /> {m.type} {m.status}
        </div>
        <h3 className="mt-4 line-clamp-2 font-display text-title font-semibold text-ink">{m.title}</h3>
        <span className="mt-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink">
          {m.action}
          <ArrowRight size={14} className="transition-transform duration-200 ease-out group-hover:translate-x-1" />
        </span>
      </div>
      <div className="relative flex items-center gap-4 border-t border-line p-6 sm:flex-col sm:justify-center sm:border-l sm:border-t-0 sm:text-center">
        {m.progress !== null ? (
          <ProgressRing value={m.progress} size={84} stroke={4}>
            <span className="figure text-[24px] text-ink">{Math.round(m.progress * 100)}<span className="text-[13px]">%</span></span>
          </ProgressRing>
        ) : (
          <span className="flex h-[84px] w-[84px] items-center justify-center rounded-full border border-dashed border-line-hover text-ink-faint">
            <Icon size={20} strokeWidth={1.5} />
          </span>
        )}
        <span className="text-meta text-ink-soft">{m.progressLabel}</span>
      </div>
    </Link>
  );
}

function ResumeTile({ item, pages, detail }: { item: ResumeItem; pages?: { status: string }[]; detail?: any }) {
  const m = resumeMeta(item, pages, detail);
  const Icon = m.icon;
  return (
    <Link
      href={m.href}
      className="group flex min-h-[150px] flex-col justify-between rounded-2xl border border-line p-5 transition-[border-color,background-color,transform] duration-200 ease-out hover:-translate-y-0.5 hover:border-line-hover hover:bg-surface"
    >
      <div>
        <div className="flex items-center gap-1.5 text-[11.5px] text-ink-faint">
          <Icon size={13} strokeWidth={1.75} /> {m.type}
        </div>
        <h3 className="mt-2.5 line-clamp-2 text-[14px] font-medium leading-snug text-ink">{m.title}</h3>
      </div>
      <div className="mt-4">
        {m.progress !== null && (
          <div className="mb-2 h-1 overflow-hidden rounded-full bg-ink/[0.07]">
            <div className="fill-grow h-full rounded-full bg-accent" style={{ width: `${Math.round(m.progress * 100)}%` }} />
          </div>
        )}
        <div className="flex items-center justify-between gap-2 text-[11.5px] text-ink-soft">
          <span className="truncate">{m.progressLabel}</span>
          <ArrowRight size={13} className="flex-shrink-0 text-ink-faint transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  );
}

/* ─────────────────────────── empty desk ─────────────────────────── */

function EmptyDesk({ onAsk }: { onAsk: (q: string) => void }) {
  const [q, setQ] = useState("");
  return (
    <div className="mt-12 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
      <section className="auth-forest animate-view-in flex min-h-[380px] flex-col justify-end overflow-hidden rounded-[22px]" style={{ animationDelay: "140ms" }}>
        <div className="relative z-10 p-7 sm:p-9">
          <h2 className="font-display text-title font-semibold text-[#EFEDE6]">Put the agent to work</h2>
          <p className="mt-2 max-w-[48ch] text-body text-[#C3CBBC]">
            It plans hypotheses, searches the literature, checks every quote against its source and writes a cited report.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) onAsk(q.trim());
            }}
            className="mt-6 flex items-center gap-2 rounded-[14px] bg-white/[0.07] p-1.5 pl-4 ring-1 ring-white/10 transition-shadow focus-within:ring-white/25"
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ask a research question"
              aria-label="Ask a research question"
              className="h-10 min-w-0 flex-1 bg-transparent text-[15px] text-[#EFEDE6] outline-none placeholder:text-[#9FAA99]"
            />
            <button
              type="submit"
              disabled={!q.trim()}
              aria-label="Start research"
              className="pressable flex h-10 w-10 items-center justify-center rounded-[11px] bg-[#EFEDE6] text-[#1B2B1F] disabled:opacity-30"
            >
              <ArrowUp size={17} />
            </button>
          </form>
        </div>
      </section>

      <section className="animate-view-in flex flex-col rounded-[22px] border border-line p-7 sm:p-9" style={{ animationDelay: "200ms" }}>
        <h2 className="font-display text-title font-semibold text-ink">Bring a paper</h2>
        <p className="mt-2 text-body text-ink-soft">Upload a PDF and CogNexa summarises it page by page, at the depth you choose.</p>
        <Link
          href="/paper-study"
          className="pressable mt-6 inline-flex h-10 w-fit items-center gap-2 rounded-[11px] border border-line bg-surface px-4 text-[13px] font-medium text-ink hover:border-line-hover"
        >
          <Upload size={15} /> Upload a PDF
        </Link>

        <div className="mt-auto pt-10">
          <div className="col-label mb-3">What builds up here</div>
          <ul className="grid gap-2.5 text-meta text-ink-soft">
            <li className="flex gap-2.5"><FileText size={14} className="mt-0.5 flex-shrink-0 text-ink-faint" /> Reading progress for every paper, page by page</li>
            <li className="flex gap-2.5"><Search size={14} className="mt-0.5 flex-shrink-0 text-ink-faint" /> Which hypotheses held up, with evidence counts</li>
            <li className="flex gap-2.5"><ArrowRight size={14} className="mt-0.5 flex-shrink-0 text-ink-faint" /> A timeline of activity and what to do next</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
