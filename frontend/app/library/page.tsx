"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, MoreHorizontal, Upload, BookOpen, Trash2 } from "lucide-react";
import { usePapersQuery, usePaperPagesQueries } from "@/lib/queries";
import { PageStrip } from "@/components/viz/progress";
import { PaperItem } from "@/lib/types";
import { paperStatus } from "@/lib/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

export default function LibraryPage() {
  const router = useRouter();
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
  const serverIds = (papers ?? []).map((p) => p.id);
  const pageQueries = usePaperPagesQueries(serverIds);
  const pagesById = new Map(pageQueries.flatMap((q) => (q.data ? [[q.data.paperId, q.data.pages] as const] : [])));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1040px] px-5 pb-20 pt-10 sm:px-10 sm:pt-14">
        <PageHeader
          className="animate-view-in"
          title="Library"
          description="Every paper you've uploaded, with how much of it has been summarised, page by page."
          actions={
            <>
              <Button onClick={() => fileRef.current?.click()}>
                <Upload size={15} /> Upload PDF
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                multiple
                className="sr-only"
                onChange={(e) => onFiles(e.target.files)}
              />
            </>
          }
        />

        <div className="animate-view-in mt-12 border-t border-line" style={{ animationDelay: "70ms" }}>
          {isLoading &&
            [0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-4 border-b border-line py-5">
                <div className="h-10 w-10 animate-pulse rounded-xl bg-surface3" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-2/5 animate-pulse rounded bg-surface3" />
                  <div className="h-3 w-1/4 animate-pulse rounded bg-surface3" />
                </div>
              </div>
            ))}

          {all.map((p) => (
            <div key={p.id} className="group flex items-center gap-5 border-b border-line py-5">
              <span className="flex h-14 w-11 flex-shrink-0 items-end rounded-[6px] border border-line bg-surface p-1.5 shadow-sm">
                <FileText size={15} strokeWidth={1.5} className="text-ink-faint" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-serif text-[18px] leading-snug text-ink">{p.title}</div>
                <div className="mt-0.5 text-[12.5px] text-ink-faint">
                  {p.authors}
                  {p.pages > 0 && <> · <span className="mono">{p.pages}</span> pages</>} · uploaded {p.uploaded}
                </div>
                {pagesById.get(p.id)?.length ? (
                  <div className="mt-3 flex max-w-[520px] items-center gap-3">
                    <PageStrip pages={pagesById.get(p.id)!} />
                    <span className="mono flex-shrink-0 text-[11.5px] text-ink-faint">
                      {pagesById.get(p.id)!.filter((x) => x.status === "ready").length}/{pagesById.get(p.id)!.length}
                    </span>
                  </div>
                ) : p.status === "processing" ? (
                  <div className="scan mt-3 h-1 w-48 overflow-hidden rounded-full bg-ink/[0.07]" />
                ) : null}
              </div>
              <Badge variant={paperStatus[p.status].variant}>{paperStatus[p.status].label}</Badge>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`Actions for ${p.title}`}
                  className="pressable flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint hover:bg-surface2 hover:text-ink data-[state=open]:bg-surface2 data-[state=open]:text-ink"
                >
                  <MoreHorizontal size={16} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {p.status === "ready" && (
                    <DropdownMenuItem onSelect={() => router.push("/paper-study")}>
                      <BookOpen size={14} /> Study
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem className="data-[highlighted]:bg-bad/10 data-[highlighted]:text-bad" onSelect={() => setRemoved((r) => [...r, p.id])}>
                    <Trash2 size={14} /> Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}

          {!isLoading && all.length === 0 && (
            <div className="py-16 text-center">
              <p className="font-serif text-title-sm text-ink">Your library is empty</p>
              <p className="mt-1 text-[13.5px] text-ink-soft">Upload a PDF and it will appear here, ready to study.</p>
              <Button variant="outline" className="mt-5" onClick={() => fileRef.current?.click()}>
                <Upload size={15} /> Upload PDF
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
