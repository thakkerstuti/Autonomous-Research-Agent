"use client";

import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ChevronLeft, ChevronRight } from "lucide-react";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

// `fileUrl` should point at the uploaded paper once the backend serves it
// (e.g. `/api/papers/${paperId}/file`). A sample is used here as a placeholder.
export function PdfViewer({ fileUrl }: { fileUrl: string }) {
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex-1 overflow-auto p-3">
        <Document
          file={fileUrl}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          loading={<p className="p-4 text-sm text-ink-faint">Loading paper…</p>}
        >
          <Page pageNumber={page} width={420} />
        </Document>
      </div>
      <div className="flex items-center justify-center gap-3 border-t border-line py-2 text-sm text-ink-soft">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="rounded-md p-1 hover:bg-surface2 disabled:opacity-30"
          disabled={page <= 1}
        >
          <ChevronLeft size={16} />
        </button>
        Page {page} of {numPages || "…"}
        <button
          onClick={() => setPage((p) => Math.min(numPages, p + 1))}
          className="rounded-md p-1 hover:bg-surface2 disabled:opacity-30"
          disabled={page >= numPages}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
