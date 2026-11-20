"use client";

/**
 * The paper explained page by page: the main view of Paper Study. Every content page's explanation
 * in order, at the paper's level; front and back matter (title page, abstract, contents, references)
 * are listed as skipped, in one line. Explanations are written on their own after upload; this view
 * only reads them (GET /papers/{id}/explanations) and follows their progress.
 */
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowUpRight, RotateCcw } from "lucide-react";
import { apiClient } from "@/lib/api";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { TextSkeleton } from "@/components/paper/study/study-shared";

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

/** Consecutive pages with the same skip reason become one line: "Pages 1–2 · Title page and abstract". */
type Block = { kind: "page"; page: PageExplanation } | { kind: "skipped"; from: number; to: number; reason: string };
function blocks(pages: PageExplanation[]): Block[] {
  const out: Block[] = [];
  for (const p of pages) {
    if (p.status === "skipped" || p.status === "no_text") {
      const reason = p.status === "no_text" ? "No selectable text (a figure or a scan)" : p.reason || "Not needed";
      const last = out[out.length - 1];
      if (last?.kind === "skipped" && last.reason === reason && last.to === p.page_number - 1) last.to = p.page_number;
      else out.push({ kind: "skipped", from: p.page_number, to: p.page_number, reason });
    } else if (p.status) {
      out.push({ kind: "page", page: p });
    }
  }
  return out;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h4 className="t-subheading mb-2">{title}</h4>
      {children}
    </section>
  );
}

export function ExplanationView({ paperId, onOpenPage }: { paperId: string; onOpenPage: (page: number) => void }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["paper-explanations", paperId],
    queryFn: () => apiClient<Explanations>(`/papers/${paperId}/explanations`),
    staleTime: 2_000,
    refetchInterval: (q) => ((q.state.data as Explanations | undefined)?.pages.some((p) => WORKING.has(p.status ?? "")) ? 3_000 : false),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = query.data;
  const list = useMemo(() => blocks(data?.pages ?? []), [data]);

  const refresh = () =>
    Promise.all(["paper-explanations", "paper-outline", "paper-status", "paper"].map((k) => queryClient.invalidateQueries({ queryKey: [k, paperId] })));
  const run = async (key: string, path: string) => {
    setBusy(key);
    setError(null);
    try {
      await apiClient(path, { method: "POST" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  if (query.isLoading) {
    return <div className="mx-auto max-w-[720px] px-5 py-10 sm:px-8"><TextSkeleton lines={8} /></div>;
  }
  if (query.error || !data) {
    return (
      <div className="mx-auto max-w-[720px] px-5 py-10 sm:px-8 text-[14px] text-ink-soft">
        The explanations couldn&rsquo;t be loaded. <button onClick={() => void query.refetch()} className="font-medium text-ink underline underline-offset-4">Try again</button>
      </div>
    );
  }

  const content = data.pages.filter((p) => p.status && p.status !== "skipped" && p.status !== "no_text");
  const ready = content.filter((p) => p.status === "ready").length;
  const working = content.some((p) => WORKING.has(p.status ?? ""));
  const notStarted = !data.pages.some((p) => p.status && p.status !== "no_text");

  return (
    <div className="mx-auto max-w-[720px] px-5 pb-16 pt-8 sm:px-8">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-heading text-[27px] leading-tight text-ink">Explained page by page</h2>
        {!notStarted && (
          <span className="t-meta flex items-center gap-2" aria-live="polite">
            {working && <ThinkingMark active size={12} />}
            {data.level} · {ready} of {content.length} pages explained
          </span>
        )}
      </header>

      {notStarted ? (
        <div className="mt-6">
          <p className="text-[14.5px] leading-[1.65] text-ink-soft">
            Each page explained in plain language, at your level: what it says, its key points and the terms it uses. The title page, abstract and references are left out.
          </p>
          <button
            type="button"
            onClick={() => void run("start", `/papers/${paperId}/explain`)}
            disabled={busy !== null}
            className="mt-5 inline-flex h-9 items-center gap-2 rounded-[7px] bg-primary px-4 text-[13.5px] font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy === "start" && <ThinkingMark active size={13} />} Explain every page
          </button>
        </div>
      ) : (
        <div className="mt-6 grid gap-8">
          {list.map((b) =>
            b.kind === "skipped" ? (
              <p key={`s${b.from}`} className="flex flex-wrap items-center gap-x-2 border-y border-line py-2.5 text-[13px] text-ink-faint">
                <span className="mono">{b.from === b.to ? `Page ${b.from}` : `Pages ${b.from}–${b.to}`}</span>
                <span aria-hidden>·</span>
                <span>{b.reason}, not explained</span>
                <button type="button" onClick={() => onOpenPage(b.from)} className="ml-auto inline-flex items-center gap-1 text-ink-soft hover:text-ink">
                  View <ArrowUpRight size={12} />
                </button>
              </p>
            ) : (
              <article key={b.page.page_number} aria-label={`Page ${b.page.page_number}`} className="scroll-mt-6">
                <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
                  <h3 className="t-heading !text-[21px]">Page {b.page.page_number}</h3>
                  <button type="button" onClick={() => onOpenPage(b.page.page_number)} className="inline-flex items-center gap-1 text-[12.5px] text-ink-soft hover:text-ink">
                    Original page <ArrowUpRight size={12} />
                  </button>
                </div>
                {b.page.status === "ready" ? (
                  <div className="animate-view-in">
                    <div className="notes-prose mt-4 text-[15px] leading-[1.75] text-ink">
                      <ReactMarkdown>{b.page.summary || ""}</ReactMarkdown>
                    </div>
                    {b.page.key_points.length > 0 && (
                      <Section title="Key points">
                        <ul className="grid gap-2">
                          {b.page.key_points.map((k, i) => (
                            <li key={i} className="grid grid-cols-[12px_1fr] gap-2 text-[14px] leading-[1.6] text-ink">
                              <span aria-hidden className="mt-[0.7em] h-px w-2 bg-accent" />
                              <span>{k}</span>
                            </li>
                          ))}
                        </ul>
                      </Section>
                    )}
                    {Object.keys(b.page.terms).length > 0 && (
                      <Section title="Terms">
                        <dl className="grid gap-2.5">
                          {Object.entries(b.page.terms).map(([term, def]) => (
                            <div key={term}>
                              <dt className="text-[13.5px] font-semibold text-ink">{term}</dt>
                              <dd className="mt-0.5 text-[13.5px] leading-[1.6] text-ink-soft">{def}</dd>
                            </div>
                          ))}
                        </dl>
                      </Section>
                    )}
                    {Object.keys(b.page.figures).length > 0 && (
                      <Section title="Figures and equations">
                        <dl className="grid gap-2.5">
                          {Object.entries(b.page.figures).map(([fig, desc]) => (
                            <div key={fig}>
                              <dt className="text-[13.5px] font-semibold text-ink">{fig}</dt>
                              <dd className="mt-0.5 text-[13.5px] leading-[1.6] text-ink-soft">{desc}</dd>
                            </div>
                          ))}
                        </dl>
                      </Section>
                    )}
                  </div>
                ) : b.page.status === "failed" ? (
                  <div role="alert" className="mt-4 text-[14px]">
                    <p className="flex items-start gap-2 text-ink"><AlertCircle size={15} className="mt-0.5 flex-shrink-0 text-bad" />{b.page.error || "This page couldn't be explained."}</p>
                    <button
                      type="button"
                      onClick={() => void run(`p${b.page.page_number}`, `/papers/${paperId}/pages/${b.page.page_number}/regenerate?level=${encodeURIComponent(data.level)}`)}
                      disabled={busy !== null}
                      className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink underline decoration-accent/50 underline-offset-4 hover:decoration-accent disabled:opacity-50"
                    >
                      {busy === `p${b.page.page_number}` ? <ThinkingMark active size={12} /> : <RotateCcw size={13} />} Try this page again
                    </button>
                  </div>
                ) : (
                  <div role="status" className="mt-4">
                    <p className="flex items-center gap-2 text-[13px] text-ink-soft">
                      <ThinkingMark active size={12} /> {b.page.status === "processing" ? "Explaining this page…" : "Waiting its turn…"}
                    </p>
                    <div className="mt-3"><TextSkeleton lines={3} /></div>
                  </div>
                )}
              </article>
            ),
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-4 text-[13px] text-bad">{error}</p>}
    </div>
  );
}
