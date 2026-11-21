"use client";

/**
 * The paper explained page by page: the main view of Paper Study. One page at a time, the same page
 * as the page stepper (moving to page 2 or 3 shows only that page's explanation), and two pages side
 * by side to compare them (2 and 3, 4 and 5...). Front and back matter (title page, abstract, contents,
 * references) say they were skipped. Explanations are written on their own after upload; this view only
 * reads them (GET /papers/{id}/explanations) and follows their progress.
 */
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowUpRight, ChevronLeft, ChevronRight, Columns2, RotateCcw, X } from "lucide-react";
import { apiClient } from "@/lib/api";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { TextSkeleton } from "@/components/paper/study/study-shared";
import { cn } from "@/lib/utils";

interface PageExplanation {
  page_number: number;
  status: "pending" | "processing" | "ready" | "failed" | "skipped" | "no_text" | null;
  reason: string | null;
  summary: string | null;
  key_points: string[];
  terms: Record<string, string>;
  figures: Record<string, string>;
  error: string | null;
}
interface Explanations { paper_id: string; level: string; pages: PageExplanation[] }

const WORKING = new Set(["pending", "processing"]);
const isContent = (p?: PageExplanation) => !!p && !!p.status && p.status !== "skipped" && p.status !== "no_text";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h4 className="t-subheading mb-2">{title}</h4>
      {children}
    </section>
  );
}

/** One page's explanation, or what is happening with it. */
function PageCard({ p, level, busy, onRetry, onOpenPage, compact }: {
  p: PageExplanation | undefined;
  level: string;
  busy: boolean;
  onRetry: (page: number) => void;
  onOpenPage: (page: number) => void;
  compact?: boolean;
}) {
  if (!p) return <p className="mt-4 text-[14px] text-ink-soft">This page isn&rsquo;t in the paper.</p>;
  return (
    <article aria-label={`Page ${p.page_number}`} className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
        <h3 className={cn("t-heading", compact ? "!text-[19px]" : "!text-[23px]")}>Page {p.page_number}</h3>
        <button type="button" onClick={() => onOpenPage(p.page_number)} className="inline-flex items-center gap-1 text-[12.5px] text-ink-soft hover:text-ink">
          Original page <ArrowUpRight size={12} />
        </button>
      </div>
      {p.status === "ready" ? (
        <div key={`${p.page_number}-${level}`} className="animate-view-in">
          <div className="notes-prose mt-4 text-[15px] leading-[1.75] text-ink">
            <ReactMarkdown>{p.summary || ""}</ReactMarkdown>
          </div>
          {p.key_points.length > 0 && (
            <Section title="Key points">
              <ul className="grid gap-2">
                {p.key_points.map((k, i) => (
                  <li key={i} className="grid grid-cols-[12px_1fr] gap-2 text-[14px] leading-[1.6] text-ink">
                    <span aria-hidden className="mt-[0.7em] h-px w-2 bg-accent" />
                    <span>{k}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {Object.keys(p.terms).length > 0 && (
            <Section title="Terms">
              <dl className="grid gap-2.5">
                {Object.entries(p.terms).map(([term, def]) => (
                  <div key={term}>
                    <dt className="text-[13.5px] font-semibold text-ink">{term}</dt>
                    <dd className="mt-0.5 text-[13.5px] leading-[1.6] text-ink-soft">{def}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}
          {Object.keys(p.figures).length > 0 && (
            <Section title="Figures and equations">
              <dl className="grid gap-2.5">
                {Object.entries(p.figures).map(([fig, desc]) => (
                  <div key={fig}>
                    <dt className="text-[13.5px] font-semibold text-ink">{fig}</dt>
                    <dd className="mt-0.5 text-[13.5px] leading-[1.6] text-ink-soft">{desc}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}
        </div>
      ) : p.status === "skipped" ? (
        <p className="mt-4 text-[14.5px] leading-relaxed text-ink-soft">
          {p.reason || "Front or back matter"}: not explained, because it doesn&rsquo;t need it. Move to the next page for the explanation.
        </p>
      ) : p.status === "no_text" ? (
        <p className="mt-4 text-[14.5px] leading-relaxed text-ink-soft">This page has no selectable text (it may be a figure or a scan), so there is nothing to explain.</p>
      ) : p.status === "failed" ? (
        <div role="alert" className="mt-4 text-[14px]">
          <p className="flex items-start gap-2 text-ink"><AlertCircle size={15} className="mt-0.5 flex-shrink-0 text-bad" />{p.error || "This page couldn't be explained."}</p>
          <button
            type="button"
            onClick={() => onRetry(p.page_number)}
            disabled={busy}
            className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink underline decoration-accent/50 underline-offset-4 hover:decoration-accent disabled:opacity-50"
          >
            <RotateCcw size={13} /> Try this page again
          </button>
        </div>
      ) : p.status ? (
        <div role="status" className="mt-4">
          <p className="flex items-center gap-2 text-[13px] text-ink-soft">
            <ThinkingMark active size={12} /> {p.status === "processing" ? "Explaining this page…" : "Waiting its turn…"}
          </p>
          <div className="mt-3"><TextSkeleton lines={4} /></div>
        </div>
      ) : (
        <p className="mt-4 text-[14px] text-ink-soft">Not explained yet.</p>
      )}
    </article>
  );
}

export function ExplanationView({ paperId, page, pageCount, onPage, onOpenPage }: {
  paperId: string;
  /** The page being read (shared with the page stepper). */
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  onOpenPage: (page: number) => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["paper-explanations", paperId],
    queryFn: () => apiClient<Explanations>(`/papers/${paperId}/explanations`),
    staleTime: 2_000,
    refetchInterval: (q) => ((q.state.data as Explanations | undefined)?.pages.some((p) => WORKING.has(p.status ?? "")) ? 3_000 : false),
  });
  const [compare, setCompare] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = query.data;
  const byPage = new Map((data?.pages ?? []).map((p) => [p.page_number, p]));

  // Opening on the title page or abstract (skipped): start at the first page that is explained instead
  const placed = useRef(false);
  useEffect(() => {
    if (!data || placed.current) return;
    placed.current = true;
    if (page === 1 && !isContent(byPage.get(1))) {
      const first = data.pages.find(isContent);
      if (first) onPage(first.page_number);
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () =>
    Promise.all(["paper-explanations", "paper-outline", "paper-status", "paper"].map((k) => queryClient.invalidateQueries({ queryKey: [k, paperId] })));
  const post = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiClient(path, { method: "POST" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const retry = (n: number) => void post(`/papers/${paperId}/pages/${n}/regenerate?level=${encodeURIComponent(data?.level ?? "Medium")}`);

  if (query.isLoading) return <div className="mx-auto max-w-[760px] px-5 py-10 sm:px-8"><TextSkeleton lines={8} /></div>;
  if (query.error || !data) {
    return (
      <div className="mx-auto max-w-[760px] px-5 py-10 text-[14px] text-ink-soft sm:px-8">
        The explanations couldn&rsquo;t be loaded. <button onClick={() => void query.refetch()} className="font-medium text-ink underline underline-offset-4">Try again</button>
      </div>
    );
  }

  const content = data.pages.filter(isContent);
  const ready = content.filter((p) => p.status === "ready").length;
  const working = content.some((p) => WORKING.has(p.status ?? ""));
  const notStarted = !data.pages.some((p) => p.status && p.status !== "no_text");
  const other = compare && compare !== page ? compare : null;

  const navButton = (label: string, to: number, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => onPage(to)}
      disabled={to < 1 || to > pageCount}
      aria-label={label}
      title={label}
      className="pressable flex h-8 w-8 items-center justify-center rounded-[7px] border border-line text-ink-soft transition-colors hover:border-line-hover hover:text-ink disabled:opacity-30"
    >
      {icon}
    </button>
  );

  return (
    <div className={cn("mx-auto px-5 pb-16 pt-6 sm:px-8", other ? "max-w-[1180px]" : "max-w-[760px]")}>
      {/* One page at a time: move with the arrows (or the page stepper); compare two pages side by side */}
      <div className="flex flex-wrap items-center gap-2">
        {navButton("Previous page", page - 1, <ChevronLeft size={15} />)}
        <span className="mono min-w-[88px] text-center text-[13px] text-ink">Page {page} / {pageCount}</span>
        {navButton("Next page", page + 1, <ChevronRight size={15} />)}
        <span className="flex-1" />
        {other ? (
          <span className="flex items-center gap-2 text-[12.5px] text-ink-soft">
            Comparing with
            <select
              value={other}
              onChange={(e) => setCompare(Number(e.target.value))}
              aria-label="Page to compare with"
              className="h-8 rounded-[7px] border border-line bg-bg px-2 text-[12.5px] text-ink"
            >
              {Array.from({ length: pageCount }, (_, i) => i + 1).filter((n) => n !== page).map((n) => (
                <option key={n} value={n}>Page {n}</option>
              ))}
            </select>
            <button type="button" onClick={() => setCompare(null)} aria-label="Stop comparing" title="Stop comparing"
              className="flex h-8 w-8 items-center justify-center rounded-[7px] text-ink-soft hover:bg-ink/[0.06] hover:text-ink">
              <X size={14} />
            </button>
          </span>
        ) : (
          pageCount > 1 && (
            <button
              type="button"
              onClick={() => setCompare(page < pageCount ? page + 1 : page - 1)}
              className="pressable inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-line px-3 text-[12.5px] text-ink hover:border-line-hover"
            >
              <Columns2 size={14} /> Compare with page {page < pageCount ? page + 1 : page - 1}
            </button>
          )
        )}
      </div>
      {!notStarted && (
        <p className="t-meta mt-2 flex items-center gap-2" aria-live="polite">
          {working && <ThinkingMark active size={11} />}
          {data.level} · {ready} of {content.length} pages explained
        </p>
      )}

      {notStarted ? (
        <div className="mt-8">
          <p className="text-[14.5px] leading-[1.65] text-ink-soft">
            Each page explained in plain language, at your level: what it says, its key points and the terms it uses. The title page, abstract and references are left out.
          </p>
          <button
            type="button"
            onClick={() => void post(`/papers/${paperId}/explain`)}
            disabled={busy}
            className="mt-5 inline-flex h-9 items-center gap-2 rounded-[7px] bg-primary px-4 text-[13.5px] font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy && <ThinkingMark active size={13} />} Explain every page
          </button>
        </div>
      ) : (
        <div className={cn("mt-6 grid gap-8", other && "lg:grid-cols-2 lg:gap-10")}>
          <PageCard p={byPage.get(page)} level={data.level} busy={busy} onRetry={retry} onOpenPage={onOpenPage} compact={!!other} />
          {other && <PageCard p={byPage.get(other)} level={data.level} busy={busy} onRetry={retry} onOpenPage={onOpenPage} compact />}
        </div>
      )}
      {error && <p role="alert" className="mt-4 text-[13px] text-bad">{error}</p>}
    </div>
  );
}
