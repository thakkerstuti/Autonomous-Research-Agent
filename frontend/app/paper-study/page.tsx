"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowRight, FileText } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { PaperWorkspace } from "@/components/paper/workspace/paper-workspace";
import { StudioBar } from "@/components/paper/studio-bar";
import { usePaperPagesQueries, usePapersQuery } from "@/lib/queries";
import { readWorkspace, updateWorkspace } from "@/lib/workspace";
import { MAX_PDF_MB, MAX_PDF_PAGES, UploadPhase, uploadPaper } from "@/lib/paper-upload";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { cn } from "@/lib/utils";

type Step = "upload" | "level" | "study";
type Level = "Beginner" | "Medium" | "Pro";

const LEVELS: { level: Level; desc: string }[] = [
  { level: "Beginner", desc: "Plain language, every term explained, simple analogies." },
  { level: "Medium", desc: "Assumes the basics. Focuses on the why." },
  { level: "Pro", desc: "Concise and technical. Contribution and results." },
];

/** A thin progress line, as in the paper list. */
function Progress({ pct, label }: { pct: number | null; label: string }) {
  return (
    <span className={cn("relative block h-px w-full overflow-hidden bg-line", pct === null && "scan")} role="progressbar" aria-label={label} aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
      {pct !== null && <span className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-300 ease-out" style={{ width: `${Math.max(pct, 3)}%` }} />}
    </span>
  );
}

function DropZone({ onFile, error }: { onFile: (f: File, pages: number) => void; error: string | null }) {
  const [dragOver, setDragOver] = useState(false);
  const [reading, setReading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const read = async (f: File) => {
    setLocalError(null);
    if (f.type !== "application/pdf" || !f.name.toLowerCase().endsWith(".pdf")) {
      setLocalError("That file isn't a PDF. Choose a .pdf file to study.");
      return;
    }
    if (f.size > MAX_PDF_MB * 1024 * 1024) {
      setLocalError(`This PDF is larger than ${MAX_PDF_MB} MB.`);
      return;
    }
    setReading(true);
    try {
      const { pdfjs } = await import("react-pdf");
      pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;
      const buf = await f.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      if (doc.numPages > MAX_PDF_PAGES) {
        setLocalError(`This PDF has ${doc.numPages} pages; the limit is ${MAX_PDF_PAGES}.`);
        return;
      }
      onFile(f, doc.numPages);
    } catch {
      setLocalError("We couldn't read that PDF. It may be password-protected or damaged.");
    } finally {
      setReading(false);
    }
  };

  const shownError = localError ?? error;

  return (
    <>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files[0];
          if (f) read(f);
        }}
        className={cn(
          "flex min-h-[248px] flex-col items-center justify-center border border-dashed px-6 py-12 text-center transition-colors duration-200",
          dragOver ? "border-accent bg-accent-soft" : "border-line-hover bg-surface"
        )}
      >
        <p className="font-serif text-[22px] leading-tight text-ink">{reading ? "Reading the PDF…" : dragOver ? "Drop to open" : "Drop your PDF here"}</p>
        <p className="mt-2 text-[12.5px] text-ink-soft">A new perspective starts with a paper.</p>
        <label className={cn("mt-7 inline-flex h-9 cursor-pointer items-center gap-2 rounded-[3px] bg-primary px-5 text-[12.5px] font-medium text-on-primary transition-opacity hover:opacity-90", reading && "pointer-events-none opacity-60")}>
          {reading && <ThinkingMark active size={12} />}
          Browse PDF
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ""; }}
          />
        </label>
        <p className="mt-6 text-[11.5px] text-ink-faint">
          PDF files up to {MAX_PDF_MB} MB and {MAX_PDF_PAGES} pages, with selectable text (scans need OCR first)
        </p>
      </div>
      {shownError && (
        <p role="alert" className="mt-3 flex items-center gap-2 text-[13px] text-bad">
          <AlertCircle size={14} className="flex-shrink-0" /> {shownError}
        </p>
      )}
    </>
  );
}

function UploadProgress({ phase, pct }: { phase: UploadPhase; pct: number }) {
  const extracting = phase === "extracting";
  return (
    <div className="mt-7" role="status" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
        <span className="text-ink">{extracting ? "Extracting text from every page…" : "Uploading the PDF…"}</span>
        <span className="mono text-ink-faint">{extracting ? "" : `${pct}%`}</span>
      </div>
      <div className="mt-2.5"><Progress pct={extracting ? null : pct} label={extracting ? "Extracting text" : "Uploading"} /></div>
    </div>
  );
}

/** The papers this person studied most recently, from their library, with live progress. */
function RecentPapers({ uploading, onOpen }: { uploading: { name: string; phase: UploadPhase; pct: number } | null; onOpen: (id: string) => void }) {
  const { data: papers } = usePapersQuery();
  const recent = (papers ?? []).slice(0, 5);
  const processing = recent.filter((p) => p.status === "processing").map((p) => p.id);
  const progress = usePaperPagesQueries(processing);
  const saved = useMemo(() => readWorkspace().paper, []);
  if (!recent.length && !uploading) return null;

  const savedPage = (() => {
    const layout = saved?.reader as { panels?: { id: string; page: number }[]; focusedId?: string } | undefined;
    return layout?.panels?.find((p) => p.id === layout.focusedId)?.page ?? layout?.panels?.[0]?.page;
  })();

  return (
    <section className="mt-16" aria-labelledby="recent-heading">
      <div className="flex items-baseline justify-between">
        <h2 id="recent-heading" className="font-heading text-[25px] leading-tight text-ink">Recently uploaded</h2>
        {(papers?.length ?? 0) > 5 && (
          <Link href="/library" className="text-[12.5px] text-ink-soft transition-colors hover:text-ink">All papers</Link>
        )}
      </div>
      <ul className="mt-4 border-t border-line">
        {uploading && (
          <li className="grid grid-cols-[minmax(0,1fr)_minmax(120px,176px)] items-center gap-6 border-b border-line py-4">
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-medium text-ink">{uploading.name}</p>
              <p className="mt-0.5 text-[12px] text-accent">{uploading.phase === "extracting" ? "Extracting text…" : "Uploading…"}</p>
            </div>
            <Progress pct={uploading.phase === "extracting" ? null : uploading.pct} label={`Uploading ${uploading.name}`} />
          </li>
        )}
        {recent.map((p) => {
          const i = processing.indexOf(p.id);
          const pages = i >= 0 ? progress[i]?.data?.pages : undefined;
          const done = pages?.filter((x) => x.status === "ready" || x.status === "failed").length ?? 0;
          const pct = pages?.length ? Math.round((done / pages.length) * 100) : null;
          const sub =
            p.status === "processing" ? "Writing page notes…"
            : p.status === "failed" ? "Needs attention: open it to see why"
            : saved?.id === p.id && savedPage ? `Continue reading · Page ${savedPage}`
            : `${p.pages} ${p.pages === 1 ? "page" : "pages"} · ${p.uploaded}`;
          return (
            <li key={p.id} className="group border-b border-line">
              <button type="button" onClick={() => onOpen(p.id)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-6 py-4 text-left">
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-medium text-ink transition-colors group-hover:text-accent">{p.title}</span>
                  <span className={cn("mt-0.5 block text-[12px]", p.status === "processing" ? "text-accent" : p.status === "failed" ? "text-bad" : "text-ink-faint")}>{sub}</span>
                </span>
                {p.status === "processing" ? (
                  <span className="block w-[clamp(120px,24vw,176px)]"><Progress pct={pct} label={`Page notes for ${p.title}`} /></span>
                ) : (
                  <span className="flex items-center gap-1.5 text-[12.5px] text-ink-soft transition-colors group-hover:text-ink">
                    Open <ArrowRight size={13} />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The page is prerendered as static, so the URL is read on the client (the searchParams prop would be empty). */
export default function PaperStudyPage() {
  return (
    <Suspense fallback={null}>
      <PaperStudy />
    </Suspense>
  );
}

function PaperStudy() {
  const queryClient = useQueryClient();
  const urlPaperId = useSearchParams().get("paperId") || undefined;
  // The paper to show: the one in the URL, else the one this user had open
  const [paperId, setPaperId] = useState<string | null>(() => urlPaperId || readWorkspace().paper?.id || null);
  const [step, setStep] = useState<Step>(() => (urlPaperId || readWorkspace().paper?.id ? "study" : "upload"));
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>("Medium");
  const [upload, setUpload] = useState<{ phase: UploadPhase; pct: number } | null>(null);
  const { data: papers } = usePapersQuery();

  const openPaper = useCallback((id: string) => {
    setPaperId(id);
    setStep("study");
    updateWorkspace((w) => ({ ...w, paper: w.paper?.id === id ? w.paper : { id } }));
    // Keep the address shareable and refresh-safe
    if (window.location.search !== `?paperId=${id}`) window.history.replaceState(null, "", `/paper-study?paperId=${encodeURIComponent(id)}`);
  }, []);

  // Opening a specific paper from the library or dashboard
  useEffect(() => {
    if (urlPaperId && urlPaperId !== paperId) openPaper(urlPaperId);
    else if (paperId && step === "study" && !urlPaperId) openPaper(paperId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlPaperId]);

  const studyAnother = useCallback(() => {
    updateWorkspace((w) => ({ ...w, paper: null }));
    window.history.replaceState(null, "", "/paper-study");
    setPaperId(null);
    setFile(null);
    setError(null);
    setUpload(null);
    setStep("upload");
  }, []);

  // Same file name and page count as a paper already in the library
  const existing = file && papers ? papers.find((p) => p.title === file.name && p.pages === pageCount) : undefined;

  const begin = async () => {
    if (!file || upload) return;
    setError(null);
    try {
      const result = await uploadPaper(file, level, (phase, pct) => setUpload({ phase, pct }));
      queryClient.invalidateQueries({ queryKey: ["papers"] });
      // The same PDF again opens the paper already there (the server doesn't store it twice)
      queryClient.invalidateQueries({ queryKey: ["paper", result.id] });
      openPaper(result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setUpload(null);
    }
  };

  const handleFile = (f: File, pages: number) => {
    setError(null);
    setFile(f);
    setPageCount(pages);
    setStep("level");
  };

  if (step === "study" && paperId) {
    return <PaperWorkspace key={paperId} paperId={paperId} onStudyAnother={studyAnother} />;
  }

  const busy = upload !== null;

  return (
    <div className="flex h-full flex-col">
      <StudioBar />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-5 pb-14 pt-[clamp(48px,10vh,104px)] sm:px-6">
          <header className="text-center">
            <h1 className="font-heading text-[clamp(34px,4.2vw,46px)] leading-[1.08] text-ink">What are you curious about?</h1>
            <p className="mt-3 text-[13.5px] text-ink-soft">Bring a paper. Make sense of it.</p>
          </header>

          <div className="mt-12">
            {step === "level" && file ? (
              <div className="border border-line-hover bg-surface px-6 py-8 sm:px-9">
                <div className="flex items-center gap-3">
                  <FileText size={18} strokeWidth={1.6} className="flex-shrink-0 text-ink-soft" />
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium text-ink">{file.name}</p>
                    <p className="mono text-[11.5px] text-ink-faint">{pageCount} pages · {(file.size / 1024 / 1024).toFixed(1)} MB</p>
                  </div>
                </div>

                {existing && !busy && (
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 bg-accent-soft px-4 py-3 text-[13px] text-ink">
                    <span>You&rsquo;ve already uploaded this paper. It won&rsquo;t be added again: beginning opens the one you have.</span>
                    <button type="button" onClick={() => openPaper(existing.id)} className="font-medium text-ink underline decoration-accent-line underline-offset-4 hover:decoration-accent">
                      Open existing
                    </button>
                  </div>
                )}

                <h2 className="mt-8 font-serif text-[21px] leading-tight text-ink">How should CogNexa explain it?</h2>
                <p className="mt-1.5 text-[13px] text-ink-soft">Pick the depth that fits your background. You can switch later.</p>

                <div role="radiogroup" aria-label="Explanation level" className="mt-5 grid gap-2 sm:grid-cols-3">
                  {LEVELS.map(({ level: l, desc }) => (
                    <button
                      key={l}
                      type="button"
                      role="radio"
                      aria-checked={level === l}
                      disabled={busy}
                      onClick={() => setLevel(l)}
                      className={cn(
                        "border px-4 py-3.5 text-left transition-colors disabled:opacity-60",
                        level === l ? "border-accent bg-accent-soft" : "border-line hover:border-line-hover"
                      )}
                    >
                      <span className="block text-[13.5px] font-medium text-ink">{l}</span>
                      <span className="mt-1 block text-[12px] leading-snug text-ink-soft">{desc}</span>
                    </button>
                  ))}
                </div>

                {upload && <UploadProgress phase={upload.phase} pct={upload.pct} />}

                <div className="mt-8 flex items-center justify-between gap-3">
                  <button type="button" onClick={() => setStep("upload")} disabled={busy} className="text-[12.5px] text-ink-soft transition-colors hover:text-ink disabled:opacity-40">
                    Back
                  </button>
                  <button type="button" onClick={begin} disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-[3px] bg-primary px-5 text-[12.5px] font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-60">
                    {busy && <ThinkingMark active size={12} />}
                    Begin study session
                  </button>
                </div>
                {error && (
                  <p role="alert" className="mt-4 flex items-center gap-2 text-[13px] text-bad">
                    <AlertCircle size={14} className="flex-shrink-0" /> {error}
                  </p>
                )}
              </div>
            ) : (
              <DropZone onFile={handleFile} error={error} />
            )}
          </div>

          <RecentPapers uploading={upload && file ? { name: file.name, ...upload } : null} onOpen={openPaper} />

          <p className="mt-20 text-center font-serif text-[14px] italic text-ink-faint">A quieter place for deeper thinking.</p>
        </div>
      </div>
    </div>
  );
}
