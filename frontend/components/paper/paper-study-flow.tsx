"use client";

import { useState, useRef, useEffect } from "react";
import { UploadCloud, FileText, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { pdfjs } from "react-pdf";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";

// Configure pdfjs worker to read page count client-side
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

type Step = "upload" | "level" | "processing" | "done";
type Level = "Beginner" | "Medium" | "Pro";

export function PaperStudyFlow({ initialPaperId }: { initialPaperId?: string }) {
  const [step, setStep] = useState<Step>(initialPaperId ? "processing" : "upload");
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>("Medium");
  const [paperId, setPaperId] = useState<string | null>(initialPaperId || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg(null);
    const selected = e.target.files?.[0];
    if (!selected) return;

    if (selected.type !== "application/pdf") {
      setErrorMsg("Must be a PDF file.");
      return;
    }
    if (selected.size > 20 * 1024 * 1024) {
      setErrorMsg("File size exceeds 20MB limit.");
      return;
    }

    try {
      const buffer = await selected.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: buffer }).promise;
      const count = pdf.numPages;
      if (count > 100) {
        setErrorMsg(`Paper exceeds maximum allowed pages (100). Found ${count}.`);
        return;
      }
      setFile(selected);
      setPageCount(count);
      setStep("level");
    } catch (err) {
      setErrorMsg("Failed to read PDF. It might be corrupt.");
    }
  };

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("level", level);
      
      return apiClient<{ id: string; message: string }>("/papers", {
        method: "POST",
        body: formData,
      });
    },
    onSuccess: (data) => {
      setPaperId(data.id);
      setStep("processing");
    },
    onError: (err: any) => {
      setErrorMsg(err.message || "Upload failed");
    }
  });

  return (
    <div className="flex h-full flex-col items-center justify-center p-6 text-center">
      {step === "upload" && (
        <div className="w-full max-w-md animate-in fade-in zoom-in-95">
          <div className="mb-8">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">Paper Study Mode</h1>
            <p className="text-ink-soft mt-2">Upload a research paper to get a guided breakdown.</p>
          </div>
          
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full flex-col items-center gap-4 rounded-xl border-2 border-dashed border-line bg-surface p-10 hover:bg-surface2 hover:border-indigo-500/50 transition-colors"
          >
            <div className="rounded-full bg-surface2 p-4 text-indigo-400">
              <UploadCloud size={32} />
            </div>
            <div>
              <span className="font-medium text-ink block">Click or Drag & Drop PDF</span>
              <span className="text-sm text-ink-faint">Max 20MB, up to 100 pages</span>
            </div>
          </button>
          
          <input 
            type="file" 
            accept="application/pdf" 
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
          />

          {errorMsg && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-red-400 bg-red-400/10 p-3 rounded-lg">
              <AlertCircle size={16} />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>
      )}

      {step === "level" && file && (
        <div className="w-full max-w-2xl animate-in slide-in-from-bottom-4">
          <div className="mb-6 flex items-center gap-4 justify-center bg-surface p-4 rounded-lg border border-line">
            <FileText className="text-indigo-400" size={24} />
            <div className="text-left">
              <p className="font-medium truncate max-w-xs">{file.name}</p>
              <p className="text-sm text-ink-soft">
                {pageCount} pages • {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          </div>

          <h2 className="text-xl font-semibold mb-2">Select Understanding Level</h2>
          <p className="text-ink-soft mb-6">How should the agent explain concepts to you?</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <LevelCard 
              title="Beginner" 
              desc="Plain language, every technical term explained, simple analogies." 
              selected={level === "Beginner"} 
              onClick={() => setLevel("Beginner")} 
            />
            <LevelCard 
              title="Medium" 
              desc="Assumes basic knowledge. Short explanations of terms. Focuses on 'why'." 
              selected={level === "Medium"} 
              onClick={() => setLevel("Medium")} 
            />
            <LevelCard 
              title="Pro" 
              desc="Concise and technical. Focuses on contribution, method, and results." 
              selected={level === "Pro"} 
              onClick={() => setLevel("Pro")} 
            />
          </div>

          <div className="flex gap-4 justify-center">
            <Button variant="ghost" onClick={() => setStep("upload")} disabled={uploadMutation.isPending}>Cancel</Button>
            <Button 
              className="bg-indigo-600 hover:bg-indigo-500 text-white min-w-[140px]" 
              onClick={() => uploadMutation.mutate()}
              disabled={uploadMutation.isPending}
            >
              {uploadMutation.isPending ? <Loader2 className="animate-spin" size={18} /> : "Confirm & Process"}
            </Button>
          </div>
          
          {errorMsg && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-red-400">
              <AlertCircle size={16} />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>
      )}

      {step === "processing" && paperId && (
        <ProcessingProgress paperId={paperId} onDone={() => setStep("done")} />
      )}

      {step === "done" && paperId && (
        <PaperOverview paperId={paperId} />
      )}
    </div>
  );
}

function LevelCard({ title, desc, selected, onClick }: { title: string, desc: string, selected: boolean, onClick: () => void }) {
  return (
    <div 
      onClick={onClick}
      className={`relative cursor-pointer rounded-xl border p-5 text-left transition-all ${
        selected ? "border-indigo-500 bg-indigo-500/10 shadow-lg shadow-indigo-500/5" : "border-line bg-surface hover:border-line-hover"
      }`}
    >
      {selected && (
        <div className="absolute right-4 top-4 text-indigo-400">
          <CheckCircle size={20} />
        </div>
      )}
      <h3 className={`font-semibold mb-2 ${selected ? "text-indigo-400" : "text-ink"}`}>{title}</h3>
      <p className="text-sm text-ink-soft leading-relaxed">{desc}</p>
    </div>
  );
}

function ProcessingProgress({ paperId, onDone }: { paperId: string, onDone: () => void }) {
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [error, setError] = useState(false);

  useEffect(() => {
    let evtSource: EventSource | null = null;
    let reconnectTimer: NodeJS.Timeout;

    const connect = () => {
      setError(false);
      const url = `${process.env.NEXT_PUBLIC_API_URL}/papers/${paperId}/progress`;
      evtSource = new EventSource(url);

      evtSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          setProgress({ done: data.done, total: data.total, failed: data.failed });
          
          if (data.total > 0 && data.done + data.failed === data.total) {
            evtSource?.close();
            onDone();
          }
        } catch (err) {}
      };

      evtSource.onerror = () => {
        evtSource?.close();
        setError(true);
        reconnectTimer = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      evtSource?.close();
      clearTimeout(reconnectTimer);
    };
  }, [paperId, onDone]);

  return (
    <div className="w-full max-w-sm animate-in fade-in">
      <div className="mb-6 inline-flex rounded-full bg-surface2 p-4 text-indigo-400">
        <Loader2 className="animate-spin" size={32} />
      </div>
      <h2 className="text-xl font-semibold mb-2">Analyzing Document</h2>
      <p className="text-ink-soft mb-6">
        {progress.total > 0 ? `Summarized ${Math.min(progress.done + progress.failed, progress.total)} of ${progress.total} pages` : "Extracting pages..."}
      </p>

      {progress.total > 0 && (
        <div className="w-full bg-surface2 rounded-full h-2 mb-2 overflow-hidden">
          <div 
            className="bg-indigo-500 h-2 rounded-full transition-all duration-500" 
            style={{ width: `${Math.min(100, ((progress.done + progress.failed) / progress.total) * 100)}%` }}
          />
        </div>
      )}

      {progress.failed > 0 && (
        <p className="text-sm text-yellow-500 mt-4 flex items-center justify-center gap-1">
          <AlertCircle size={14} /> {progress.failed} pages delayed/failed (will retry)
        </p>
      )}

      {error && (
        <p className="text-sm text-red-400 mt-4 flex items-center justify-center gap-1">
          <AlertCircle size={14} /> Reconnecting to server...
        </p>
      )}
    </div>
  );
}

function PaperOverview({ paperId }: { paperId: string }) {
  const { data: paper, isLoading, isError } = useQuery({
    queryKey: ["paper", paperId],
    queryFn: () => apiClient<any>(`/papers/${paperId}`)
  });

  if (isLoading) {
    return <div className="flex animate-pulse flex-col items-center"><Loader2 className="animate-spin text-indigo-400 mb-4" /> Loading overview...</div>;
  }

  if (isError || !paper) {
    return <div className="text-red-400">Failed to load paper overview.</div>;
  }

  return (
    <div className="w-full max-w-2xl text-left animate-in slide-in-from-bottom-4">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 bg-indigo-500/20 text-indigo-400 rounded-lg">
          <FileText size={24} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-ink truncate">{paper.title}</h2>
          <p className="text-ink-soft text-sm">
            {paper.level} Level • {paper.page_count} pages • {(paper.file_size / 1024 / 1024).toFixed(2)} MB
          </p>
        </div>
      </div>

      <div className="bg-surface border border-line rounded-xl p-6 mb-8 shadow-sm">
        <h3 className="font-semibold text-ink mb-4">Paper Overview</h3>
        {paper.overview ? (
          <div className="text-ink-soft leading-relaxed whitespace-pre-wrap">{paper.overview}</div>
        ) : (
          <p className="text-ink-faint italic">No overview generated.</p>
        )}
      </div>

      <div className="flex justify-center">
        <Button className="bg-indigo-600 hover:bg-indigo-500 text-white min-w-[200px]" onClick={() => alert("Pages panel placeholder")}>
          Open Pages Panel
        </Button>
      </div>
    </div>
  );
}
