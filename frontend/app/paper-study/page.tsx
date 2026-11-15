"use client";

import { useCallback, useEffect, useState } from "react";
import { UploadCloud, FileText, AlertCircle, Loader2, Check, ArrowLeft } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { PaperReader } from "@/components/paper/paper-reader";
import { usePapersQuery } from "@/lib/queries";
import { readWorkspace, updateWorkspace } from "@/lib/workspace";
import { MAX_PDF_MB, MAX_PDF_PAGES, UploadPhase, uploadPaper } from "@/lib/paper-upload";
import { cn } from "@/lib/utils";

type Step = "upload" | "level" | "study";
type Level = "Beginner" | "Medium" | "Pro";

function UploadStep({ onFile, error }: { onFile: (f: File, pages: number) => void; error: string | null }) {
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
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-[640px] flex-col justify-center px-5 py-12 sm:px-7">
        <div className="animate-view-in">
          <h1 className="font-display text-display-xl font-semibold text-ink">
            Study a paper, page by page.
          </h1>
          <p className="mt-4 max-w-[50ch] text-[15px] leading-relaxed text-ink-soft">
            Upload a PDF and CogNexa explains every page at the depth you choose: a summary, the key points, the terms and the figures.
          </p>
        </div>

        <label
          className={cn(
            "animate-view-in group relative mt-10 flex cursor-pointer flex-col items-center gap-4 overflow-hidden rounded-[22px] border border-dashed px-6 py-14 text-center transition-[border-color,background-color,transform] duration-200 ease-out",
            dragOver ? "scale-[1.01] border-accent bg-accent-soft" : "border-line-hover bg-surface hover:border-ink-faint/50"
          )}
          style={{ animationDelay: "80ms" }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) read(f);
          }}
        >
          <span
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-2xl transition-colors duration-200",
              dragOver ? "bg-accent text-on-primary" : "bg-surface3 text-ink-soft group-hover:text-ink"
            )}
          >
            {reading ? <Loader2 size={20} className="animate-spin" /> : <UploadCloud size={20} strokeWidth={1.75} />}
          </span>
          <span>
            <span className="block text-[15px] font-medium text-ink">
              {reading ? "Reading the PDF…" : dragOver ? "Drop to open" : "Drop a PDF here, or click to choose"}
            </span>
            <span className="mt-1 block text-[13px] text-ink-faint">
              Up to {MAX_PDF_MB} MB and {MAX_PDF_PAGES} pages · needs selectable text (scanned PDFs need OCR first)
            </span>
          </span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ""; }}
          />
        </label>

        {shownError && (
          <div role="alert" className="mt-4 flex items-center gap-2 rounded-xl bg-bad/10 px-4 py-3 text-[13px] text-bad">
            <AlertCircle size={15} className="flex-shrink-0" /> {shownError}
          </div>
        )}
      </div>
    </div>
  );
}

function LevelCard({
  title, desc, selected, onClick, disabled,
}: { title: string; desc: string; selected: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      className={cn(
        "pressable relative rounded-2xl bg-surface p-5 text-left disabled:opacity-60",
        selected ? "shadow-[0_0_0_1.5px_rgb(var(--accent))]" : "shadow-sm hover:shadow-panel"
      )}
    >
      <span
        className={cn(
          "absolute right-4 top-4 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-on-primary transition-[transform,opacity] duration-200 ease-out",
          selected ? "scale-100 opacity-100" : "scale-75 opacity-0"
        )}
      >
        <Check size={12} strokeWidth={2.5} />
      </span>
      <div className="mb-1.5 text-[14px] font-semibold text-ink">{title}</div>
      <p className="text-[13px] leading-relaxed text-ink-soft">{desc}</p>
    </button>
  );
}

function UploadProgress({ phase, pct }: { phase: UploadPhase; pct: number }) {
  const extracting = phase === "extracting";
  return (
    <div className="animate-view-in mt-8 rounded-2xl bg-surface p-5 shadow-sm" role="status" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[14px] font-medium text-ink">
          {extracting ? "Extracting text from every page…" : "Uploading the PDF…"}
        </span>
        <span className="mono text-[12.5px] text-ink-faint">{extracting ? "" : `${pct}%`}</span>
      </div>
      <div
        className={cn("mt-3 h-1.5 overflow-hidden rounded-full bg-ink/[0.07]", extracting && "scan")}
        role="progressbar"
        aria-label={extracting ? "Extracting text" : "Uploading"}
        aria-valuenow={extracting ? undefined : pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {!extracting && <div className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out" style={{ width: `${Math.max(pct, 2)}%` }} />}
      </div>
    </div>
  );
}

export default function PaperStudyPage({ searchParams }: { searchParams: { paperId?: string } }) {
  const queryClient = useQueryClient();
  // The paper to show: the one in the URL, else the one this user had open
  const [paperId, setPaperId] = useState<string | null>(() => searchParams.paperId || readWorkspace().paper?.id || null);
  const [step, setStep] = useState<Step>(() => (searchParams.paperId || readWorkspace().paper?.id ? "study" : "upload"));
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
    if (searchParams.paperId && searchParams.paperId !== paperId) openPaper(searchParams.paperId);
    else if (paperId && step === "study" && !searchParams.paperId) openPaper(paperId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.paperId]);

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
    return <PaperReader key={paperId} paperId={paperId} onStudyAnother={studyAnother} />;
  }

  if (step === "level" && file) {
    const busy = upload !== null;
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-[680px] flex-col justify-center px-5 py-12 sm:px-7">
          <div className="animate-view-in flex items-center gap-3 rounded-2xl bg-surface p-3.5 shadow-sm">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-surface3 text-ink-soft">
              <FileText size={18} strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[14px] font-medium text-ink">{file.name}</div>
              <div className="mono text-[12px] text-ink-faint">
                {pageCount} pages · {(file.size / 1024 / 1024).toFixed(1)} MB
              </div>
            </div>
          </div>

          {existing && !busy && (
            <div className="animate-view-in mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-accent-soft px-4 py-3 text-[13.5px] text-ink">
              <span>You&rsquo;ve already uploaded this paper. Open it instead of processing it again?</span>
              <Button size="sm" variant="outline" onClick={() => openPaper(existing.id)}>
                Open existing
              </Button>
            </div>
          )}

          <h2 className="animate-view-in mt-10 font-display text-display font-semibold text-ink" style={{ animationDelay: "60ms" }}>
            How should CogNexa explain it?
          </h2>
          <p className="animate-view-in mt-2 text-[15px] text-ink-soft" style={{ animationDelay: "60ms" }}>
            Pick the depth that fits your background. You can switch later.
          </p>

          <div role="radiogroup" aria-label="Explanation level" className="animate-view-in mt-7 grid grid-cols-1 gap-3 sm:grid-cols-3" style={{ animationDelay: "120ms" }}>
            <LevelCard title="Beginner" desc="Plain language, every term explained, simple analogies." selected={level === "Beginner"} onClick={() => setLevel("Beginner")} disabled={busy} />
            <LevelCard title="Medium" desc="Assumes the basics. Focuses on the why." selected={level === "Medium"} onClick={() => setLevel("Medium")} disabled={busy} />
            <LevelCard title="Pro" desc="Concise and technical. Contribution and results." selected={level === "Pro"} onClick={() => setLevel("Pro")} disabled={busy} />
          </div>

          {upload && <UploadProgress phase={upload.phase} pct={upload.pct} />}

          <div className="mt-10 flex items-center justify-between gap-3">
            <Button variant="ghost" onClick={() => setStep("upload")} disabled={busy}>
              <ArrowLeft size={15} /> Back
            </Button>
            <Button size="lg" onClick={begin} disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : null}
              Begin study session
            </Button>
          </div>
          {error && (
            <div role="alert" className="mt-4 flex items-center gap-2 rounded-xl bg-bad/10 px-4 py-3 text-[13px] text-bad">
              <AlertCircle size={15} className="flex-shrink-0" /> {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  return <UploadStep onFile={handleFile} error={error} />;
}
