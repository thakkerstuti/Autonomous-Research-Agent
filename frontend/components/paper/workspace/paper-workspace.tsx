"use client";

/**
 * Paper Study workspace: navigation (left), reader or study section (centre),
 * research assistant (right). Only the paper summary is generated on upload;
 * every other section is generated when the reader first opens it, from the
 * navigation click itself, and never again unless they ask to regenerate.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, BookOpen, Check, FileText, Layers, Lightbulb, ListTree, Menu, MessageSquareText, PanelRightOpen, Plus, ScrollText, X,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { useOutlineQuery, usePaperQuery, useStudyStatusQuery, type OutlinePage } from "@/lib/queries";
import { sectionState, type KitStatus, type OutputKind, type SectionState } from "@/lib/study-logic";
import { focusedPanel, initialLayout, restoreLayout, selectedPages, showPage, type ReaderLayout } from "@/lib/reader-layout";
import { readWorkspace, updateWorkspace } from "@/lib/workspace";
import { ThinkingMark } from "@/components/research/thinking-mark";
import { OverviewView } from "@/components/paper/study/overview-view";
import { QuestionsView } from "@/components/paper/study/questions-view";
import { InsightsView } from "@/components/paper/study/highlights-view";
import { FlashcardsView } from "@/components/paper/study/flashcards-view";
import { useStudyActions } from "@/components/paper/study/study-shared";
import { PageSummariesView } from "./page-summaries-view";
import { AssistantPanel, useAssistant, type AssistantHandle } from "./assistant";
import { cn } from "@/lib/utils";

const Reader = dynamic(() => import("./reader").then((m) => m.Reader), {
  ssr: false,
  loading: () => <div className="m-6 h-[70%] animate-pulse rounded bg-ink/[0.04]" />,
});

type View = "reader" | "overview" | "pages" | "questions" | "insights" | "flashcards";
const VIEWS: View[] = ["reader", "overview", "pages", "questions", "insights", "flashcards"];
const KIND: Partial<Record<View, OutputKind>> = { overview: "summary", questions: "questions", insights: "highlights", flashcards: "flashcards" };

const STUDY_ITEMS: { view: View; label: string; icon: typeof FileText }[] = [
  { view: "overview", label: "Overview", icon: ScrollText },
  { view: "pages", label: "Page summaries", icon: ListTree },
  { view: "questions", label: "Questions", icon: MessageSquareText },
  { view: "insights", label: "Key insights", icon: Lightbulb },
  { view: "flashcards", label: "Flashcards", icon: Layers },
];

function StatusTag({ state, text }: { state: SectionState | "progress"; text?: string }) {
  if (state === "ready") return <Check size={13} className="text-ok" aria-label="Generated" />;
  if (state === "generating" || state === "waiting" || state === "progress")
    return <span className="flex items-center gap-1.5 text-[11.5px] text-ink-faint"><ThinkingMark active size={11} />{text ?? (state === "waiting" ? "Queued" : "Writing")}</span>;
  if (state === "failed") return <span className="flex items-center gap-1 text-[11.5px] text-bad"><AlertCircle size={12} />Failed</span>;
  return <span className="text-[11.5px] text-ink-faint" title="Not generated yet: opening it generates it">Not yet</span>;
}

export function PaperWorkspace({ paperId, onStudyAnother }: { paperId: string; onStudyAnother: () => void }) {
  const queryClient = useQueryClient();
  const paperQuery = usePaperQuery(paperId);
  const outline = useOutlineQuery(paperId);
  const kit = useStudyStatusQuery(paperId).data;
  const actions = useStudyActions(paperId);
  const assistant = useAssistant(paperId);
  const assistantRef = useRef<AssistantHandle>(null);
  const paper = paperQuery.data;

  // Restore this paper's workspace (section, reader layout, assistant) once
  const saved = useMemo(() => {
    const w = readWorkspace().paper;
    return w?.id === paperId ? w : null;
  }, [paperId]);
  const [view, setView] = useState<View>(() => (VIEWS.includes(saved?.view as View) ? (saved!.view as View) : "overview"));
  const [layout, setLayoutState] = useState<ReaderLayout | null>(null);
  const [summaryPage, setSummaryPage] = useState<number | null>(saved?.page ?? null);
  const [assistantOpen, setAssistantOpen] = useState<boolean>(() =>
    typeof saved?.assistant === "boolean" ? saved.assistant : typeof window !== "undefined" && window.innerWidth >= 1280
  );
  const [navOpen, setNavOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!layout && paper?.page_count) setLayoutState(restoreLayout(saved?.reader, paper.page_count) ?? initialLayout(1));
  }, [layout, paper?.page_count, saved]);

  useEffect(() => {
    updateWorkspace((w) => ({
      ...w,
      paper: {
        ...(w.paper?.id === paperId ? w.paper : {}),
        id: paperId,
        view,
        page: summaryPage ?? undefined,
        reader: layout ?? (w.paper?.id === paperId ? w.paper.reader : undefined),
        assistant: assistantOpen,
      },
    }));
  }, [paperId, view, layout, assistantOpen, summaryPage]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const setLayout = useCallback((update: (l: ReaderLayout) => ReaderLayout) => setLayoutState((l) => (l ? update(l) : l)), []);

  const hasTextMap = useMemo(() => new Map((outline.data?.pages ?? []).map((p) => [p.page_number, p.has_text])), [outline.data]);
  const hasText = useCallback((p: number) => hasTextMap.get(p) ?? true, [hasTextMap]);

  /** Citations, findings and the page grid all land here. */
  const openPage = (page: number) => {
    setView("reader");
    setNavOpen(false);
    const base = layout ?? initialLayout(page);
    const result = showPage(base, page);
    if (result.how === "replaced") setNotice(`Five pages are open, so page ${page} is now shown in the focused panel.`);
    setLayoutState(result.layout);
  };

  const requestExplanations = async () => {
    await apiClient(`/papers/${paperId}/explain`, { method: "POST" });
    await Promise.all(["paper-outline", "paper-status", "paper-pages", "paper"].map((k) => queryClient.invalidateQueries({ queryKey: [k, paperId] })));
  };

  /** Opening a section is what generates it, the first time only. */
  const openSection = async (next: View) => {
    setView(next);
    setNavOpen(false);
    if (paper?.status === "needs_ocr") return; // nothing can be generated from a scan
    const kind = KIND[next];
    // Decide from real data even if it hasn't loaded yet (e.g. clicked right after upload)
    if (kind) {
      const status = kit ?? (await queryClient.fetchQuery({ queryKey: ["study-status", paperId], queryFn: () => apiClient<KitStatus>(`/papers/${paperId}/study`) }).catch(() => null));
      if (status && sectionState(status, kind) === "not_started") await actions.generate(kind);
    }
    const pagesInfo = next === "pages"
      ? outline.data ?? (await queryClient.fetchQuery({ queryKey: ["paper-outline", paperId], queryFn: () => apiClient<{ paper_id: string; level: string; pages: OutlinePage[] }>(`/papers/${paperId}/outline`) }).catch(() => null))
      : null;
    if (pagesInfo && pagesInfo.pages.some((p) => p.has_text) && !pagesInfo.pages.some((p) => p.explanation)) {
      try {
        await requestExplanations();
      } catch (err) {
        setNotice(err instanceof ApiError ? err.message : "Couldn't start the page summaries.");
      }
    }
  };

  const runCompare = (pages: number[]) => {
    if (pages.length < 2) return;
    setAssistantOpen(true);
    void assistant.run({ action: "compare_pages", pages }, `Comparing pages ${pages.join(", ")}…`);
  };
  const explainPage = (page: number) => {
    setAssistantOpen(true);
    void assistant.run({ action: "explain_page", pages: [page] }, `Explaining page ${page}…`);
  };
  const explainSelection = (page: number, text: string) => {
    setAssistantOpen(true);
    void assistant.run({ action: "explain_selection", pages: [page], selection: text }, `Explaining a passage on page ${page}…`);
  };

  // Workspace-wide shortcuts: A toggles the assistant, / jumps to its question box
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "a" || e.key === "A") setAssistantOpen((o) => !o);
      else if (e.key === "/") {
        e.preventDefault();
        setAssistantOpen(true);
        setTimeout(() => assistantRef.current?.focusInput(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (paperQuery.error instanceof ApiError && paperQuery.error.status === 404) {
    return (
      <div className="flex h-full items-center justify-center px-5">
        <div className="max-w-[420px] text-center">
          <h1 className="font-display text-title font-semibold text-ink">This paper isn&rsquo;t available</h1>
          <p className="mt-2 text-[14.5px] text-ink-soft">It may have been removed. Upload it again to keep studying.</p>
          <button onClick={onStudyAnother} className="pressable mt-6 font-medium text-ink underline decoration-accent/60 underline-offset-4">Study a paper</button>
        </div>
      </div>
    );
  }

  const pages = outline.data?.pages ?? [];
  const textCount = pages.filter((p) => p.has_text).length;
  const requested = pages.filter((p) => p.explanation);
  const explainedState = (): { state: SectionState | "progress"; text?: string } => {
    if (!requested.length) return { state: "not_started" };
    const done = requested.filter((p) => p.explanation === "ready").length;
    const failed = requested.filter((p) => p.explanation === "failed").length;
    if (requested.some((p) => p.explanation === "pending" || p.explanation === "processing")) return { state: "progress", text: `${done}/${requested.length}` };
    return failed ? { state: "failed" } : { state: "ready" };
  };
  const openPages = new Set(layout?.panels.map((p) => p.page) ?? []);
  const focus = layout ? focusedPanel(layout) : undefined;
  const ticked = layout ? selectedPages(layout) : [];

  const nav = (
    <nav aria-label="Paper" className="flex h-full min-h-0 flex-col bg-bg">
      <div className="border-b border-line px-4 pb-3.5 pt-4">
        <div className="flex items-start gap-2.5">
          <FileText size={15} className="mt-0.5 flex-shrink-0 text-ink-faint" />
          <div className="min-w-0">
            <h2 className="line-clamp-3 text-[13.5px] font-semibold leading-snug text-ink" title={paper?.title}>{paper?.title ?? "Loading…"}</h2>
            {paper && <p className="mono mt-1 text-[11.5px] text-ink-faint">{paper.page_count} pages{pages.length > 0 && textCount < (paper.page_count ?? 0) ? ` · ${textCount} with text` : ""}</p>}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul className="px-2 py-2">
          <li>
            <button
              onClick={() => { setView("reader"); setNavOpen(false); }}
              aria-current={view === "reader" ? "page" : undefined}
              className={cn("pressable flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13.5px] transition-colors", view === "reader" ? "bg-ink/[0.06] font-medium text-ink" : "text-ink-soft hover:bg-ink/[0.04] hover:text-ink")}
            >
              <BookOpen size={15} className="flex-shrink-0" />
              <span className="flex-1">Reader</span>
              <span className="mono text-[11.5px] text-ink-faint">{layout?.panels.length ?? 0} open</span>
            </button>
          </li>
        </ul>
        <p className="px-5 pb-1 pt-2 text-[11px] uppercase tracking-[0.08em] text-ink-faint">Study</p>
        <ul className="px-2 pb-2">
          {STUDY_ITEMS.map(({ view: v, label, icon: Icon }) => {
            const kind = KIND[v];
            const st = paper?.status === "needs_ocr" ? { state: "not_started" as SectionState } : v === "pages" ? explainedState() : { state: sectionState(kit, kind!) };
            return (
              <li key={v}>
                <button
                  onClick={() => openSection(v)}
                  aria-current={view === v ? "page" : undefined}
                  className={cn("pressable flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13.5px] transition-colors", view === v ? "bg-ink/[0.06] font-medium text-ink" : "text-ink-soft hover:bg-ink/[0.04] hover:text-ink")}
                >
                  <Icon size={15} className="flex-shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  <StatusTag state={st.state} text={"text" in st ? st.text : undefined} />
                </button>
              </li>
            );
          })}
        </ul>

        <div className="border-t border-line px-4 pb-4 pt-3">
          <p className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">Pages</p>
          <div className="mt-2 grid grid-cols-6 gap-1" role="list" aria-label="Pages">
            {pages.map((p) => {
              const open = openPages.has(p.page_number);
              const isFocus = focus?.page === p.page_number && view === "reader";
              return (
                <button
                  key={p.page_number}
                  role="listitem"
                  onClick={() => openPage(p.page_number)}
                  title={`Page ${p.page_number}${!p.has_text ? " · no selectable text" : ""}${p.explanation === "ready" ? " · explained" : ""}${open ? " · open" : ""}`}
                  aria-label={`Open page ${p.page_number}`}
                  className={cn(
                    "mono relative flex h-7 items-center justify-center rounded-[5px] text-[11.5px] transition-colors",
                    isFocus ? "bg-primary text-on-primary" : open ? "bg-accent-soft text-ink ring-1 ring-inset ring-accent/40" : "text-ink-soft hover:bg-ink/[0.06] hover:text-ink",
                    !p.has_text && !open && "text-ink-faint/60"
                  )}
                >
                  {p.page_number}
                  {p.explanation === "ready" && !isFocus && <span aria-hidden className="absolute bottom-[3px] h-[2px] w-2.5 rounded-full bg-ok/70" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="border-t border-line px-3 py-2.5">
        <button onClick={onStudyAnother} className="pressable flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] text-ink-soft hover:bg-ink/[0.04] hover:text-ink">
          <Plus size={14} /> Study another paper
        </button>
      </div>
    </nav>
  );

  const center = (() => {
    if (view === "reader") {
      if (!layout || !paper) return <div className="m-6 h-[70%] animate-pulse rounded bg-ink/[0.04]" />;
      return (
        <Reader
          paperId={paperId}
          pageCount={paper.page_count ?? 1}
          hasText={hasText}
          layout={layout}
          setLayout={setLayout}
          onExplainPage={explainPage}
          onExplainSelection={explainSelection}
          onCompare={runCompare}
        />
      );
    }
    if (paper?.status === "needs_ocr") {
      // Scanned PDF: nothing to summarise or explain, and saying so beats an offer that cannot work
      return (
        <div className="h-full overflow-y-auto">
          <div className="mx-auto max-w-[620px] px-6 pt-16 sm:px-10">
            <h1 className="font-display text-[24px] font-semibold tracking-[-0.02em] text-ink">No selectable text in this PDF</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">It looks like a scanned document, so CogNexa can&rsquo;t summarise or explain it. Run OCR on the file (most PDF tools can), then upload it again. You can still look at the pages in the reader.</p>
            <button onClick={() => setView("reader")} className="pressable mt-5 font-medium text-ink underline decoration-accent/60 underline-offset-4">Open the reader</button>
          </div>
        </div>
      );
    }
    return (
      <div className="h-full overflow-y-auto">
        {view === "overview" && <OverviewView paperId={paperId} title={paper?.title ?? "Overview"} onOpenPage={openPage} />}
        {view === "pages" && (
          <PageSummariesView paperId={paperId} page={summaryPage} onPageChange={setSummaryPage} onOpenInReader={openPage} onRequest={requestExplanations} />
        )}
        {view === "questions" && <QuestionsView paperId={paperId} onOpenPage={openPage} />}
        {view === "insights" && <InsightsView paperId={paperId} onOpenPage={openPage} />}
        {view === "flashcards" && <FlashcardsView paperId={paperId} onOpenPage={openPage} />}
      </div>
    );
  })();

  const assistantPanel = (
    <AssistantPanel
      ref={assistantRef}
      paperId={paperId}
      assistant={assistant}
      focusedPage={focus?.page ?? null}
      focusedHasText={focus ? hasText(focus.page) : false}
      selectedPages={ticked}
      onOpenPage={openPage}
      onClose={() => setAssistantOpen(false)}
    />
  );

  return (
    <div className="relative flex h-full min-h-0 bg-bg">
      {/* Navigation: a column on desktop, a drawer below */}
      <div className="hidden w-[248px] flex-shrink-0 border-r border-line lg:block">{nav}</div>
      {navOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-label="Paper navigation">
          <button className="absolute inset-0 bg-black/40" aria-label="Close navigation" onClick={() => setNavOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[280px] border-r border-line shadow-xl">{nav}</div>
        </div>
      )}

      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 flex-shrink-0 items-center gap-2 border-b border-line px-3 lg:hidden">
          <button onClick={() => setNavOpen(true)} className="pressable flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-ink-soft hover:text-ink" aria-label="Open paper navigation">
            <Menu size={15} /> Contents
          </button>
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{paper?.title}</span>
        </div>
        <div className="relative min-h-0 flex-1">{center}</div>
        {!assistantOpen && (
          <button
            onClick={() => setAssistantOpen(true)}
            title="Show the assistant (A)"
            className="pressable absolute bottom-4 right-4 z-20 flex h-9 items-center gap-2 rounded-full border border-line bg-surface px-3.5 text-[13px] font-medium text-ink shadow-panel hover:border-line-hover"
          >
            <PanelRightOpen size={14} /> Assistant
          </button>
        )}
        {notice && (
          <div role="status" className="absolute bottom-4 left-1/2 z-30 flex max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-[12.5px] text-on-primary shadow-lg">
            {notice}
            <button onClick={() => setNotice(null)} aria-label="Dismiss" className="opacity-70 hover:opacity-100"><X size={13} /></button>
          </div>
        )}
      </main>

      {assistantOpen && (
        // One instance: a column on wide screens, a drawer over the page below that
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-[400px] flex-shrink-0 border-l border-line shadow-xl xl:static xl:z-auto xl:w-[340px] xl:max-w-none xl:shadow-none">
          {assistantPanel}
        </div>
      )}
    </div>
  );
}
