"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { FileText, MoreHorizontal, Upload, BookOpen, Trash2 } from "lucide-react";
import { usePapersQuery } from "@/lib/queries";
import { PaperItem } from "@/lib/types";
import { paperStatus } from "@/lib/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

export default function LibraryPage() {
  const { data: papers, isLoading } = usePapersQuery();
  const [added, setAdded] = useState<PaperItem[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Local-only until the upload endpoint exists: new files show up as "processing".
  function onFiles(files: FileList | null) {
    if (!files) return;
    const items: PaperItem[] = Array.from(files).map((f) => ({
      id: crypto.randomUUID(),
      title: f.name,
      authors: "Unknown",
      pages: 0,
      uploaded: "just now",
      status: "processing",
      progress: 5,
    }));
    setAdded((a) => [...items, ...a]);
    if (fileRef.current) fileRef.current.value = "";
  }

  const all = [...added, ...(papers ?? [])].filter((p) => !removed.includes(p.id));

  return (
    <div className="animate-view-in h-full overflow-y-auto px-10 py-10">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Paper Library</h1>
          <p className="mt-1 max-w-lg text-ink-soft">Manage uploaded papers and check their processing status.</p>
        </div>
        <Button onClick={() => fileRef.current?.click()}>
          <Upload size={15} /> Upload PDF
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>

      {isLoading && <p className="text-sm text-ink-faint">Loading papers…</p>}

      <div className="divide-y divide-line border-t border-line">
        {all.map((p) => (
          <div key={p.id} className="flex items-center gap-4 py-4">
            <FileText size={18} className="text-ink-faint" />
            <div className="flex-1">
              <div className="text-sm font-medium">{p.title}</div>
              <div className="text-xs text-ink-faint">
                {p.authors}
                {p.pages > 0 && ` · ${p.pages} pages`} · uploaded {p.uploaded}
              </div>
              {p.status === "processing" && (
                <div className="mt-2 h-1 w-48 overflow-hidden rounded-full bg-surface2">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-grad1 to-grad2"
                    style={{ width: `${p.progress ?? 0}%` }}
                  />
                </div>
              )}
            </div>
            <Badge variant={paperStatus[p.status].variant}>{paperStatus[p.status].label}</Badge>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Paper actions"
                className="rounded-md p-1.5 text-ink-faint hover:bg-surface2 hover:text-ink"
              >
                <MoreHorizontal size={16} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {p.status === "ready" && (
                  <DropdownMenuItem asChild>
                    <Link href="/paper-study" className="flex items-center gap-2">
                      <BookOpen size={13} /> Study
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="flex items-center gap-2" onSelect={() => setRemoved((r) => [...r, p.id])}>
                  <Trash2 size={13} /> Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
        {!isLoading && all.length === 0 && (
          <p className="py-8 text-sm text-ink-faint">No papers yet. Upload a PDF to get started.</p>
        )}
      </div>
    </div>
  );
}
