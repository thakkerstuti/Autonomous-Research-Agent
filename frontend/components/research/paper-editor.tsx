"use client";

import { Fragment, ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle, ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, Download, Eye, History, Loader2, MessageSquare, PenLine, Plus, Trash2,
} from "lucide-react";
import { PaperContent, PaperSection, ResearchDocument, VERSION_LABEL, downloadPaperPdf, getDocument, saveDocument } from "@/lib/research-runs";
import { numberSections, paperWordCount, splitBlocks, splitInline } from "@/lib/paper-format";
import { cn } from "@/lib/utils";
import { ConversationPanel } from "./conversation-panel";

/* ───────────── small pieces ───────────── */

function AutoTextarea({
  value, onChange, className, placeholder, ariaLabel, readOnly,
}: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string; ariaLabel: string; readOnly?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      el.style.height = "0px";
      el.style.height = `${el.scrollHeight}px`;
    });
    ro.observe(el.parentElement ?? el);
    return () => ro.disconnect();
  }, []);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      readOnly={readOnly}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "block w-full resize-none overflow-hidden rounded-md bg-transparent outline-none transition-[background-color,box-shadow] duration-150",
        "placeholder:text-ink-faint/70 hover:bg-ink/[0.025] focus:bg-ink/[0.03] focus:shadow-[0_0_0_1px_var(--accent-line)]",
        className
      )}
    />
  );
}

/** Body text with [n] citations as links to the references. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {splitInline(text).map((part, i) =>
        part.type === "cite" ? (
          <span key={i} className="whitespace-nowrap">
            [{part.numbers.map((n, j) => (
              <Fragment key={n}>
                {j > 0 && ", "}
                <a href={`#ref-${n}`} className="text-accent no-underline hover:underline">{n}</a>
              </Fragment>
            ))}]
          </span>
        ) : part.type === "bold" ? (
          <strong key={i} className="font-semibold text-ink">{part.text}</strong>
        ) : part.type === "italic" ? (
          <em key={i}>{part.text}</em>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        )
      )}
    </>
  );
}

function Body({ text }: { text: string }) {
  return (
    <>
      {splitBlocks(text).map((b, i) =>
        b.type === "list" ? (
          <ul key={i} className="my-3 list-disc space-y-1.5 pl-6 marker:text-ink-faint">
            {b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}
          </ul>
        ) : (
          <p key={i} className="my-3 text-justify [hyphens:auto]"><Inline text={b.text} /></p>
        )
      )}
    </>
  );
}

function Sheet({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-[820px] rounded-[4px] bg-surface shadow-panel", "px-6 py-10 sm:px-[72px] sm:py-[76px]", className)}>
      {children}
    </div>
  );
}

function longDate(iso: string) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

function shortTime(iso: string | null) {
  if (!iso) return "";
  const t = Date.parse(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

const newId = () => Math.random().toString(36).slice(2, 12);

/* ───────────── references (read-only) ───────────── */

function References({ content }: { content: PaperContent }) {
  if (!content.references.length) return null;
  return (
    <section aria-labelledby="refs-h">
      <h2 id="refs-h" className="font-serif text-[23px] font-semibold text-ink">References</h2>
      <ol className="mt-5 space-y-3">
        {content.references.map((r) => (
          <li key={r.n} id={`ref-${r.n}`} className="grid scroll-mt-24 grid-cols-[34px_1fr] gap-1 rounded-md text-[14.5px] leading-[1.55] text-ink/85 target:bg-accent-soft">
            <span className="mono pt-[3px] text-[12px] text-ink-faint">[{r.n}]</span>
            <span className="min-w-0 break-words">
              {r.title}.{r.site && <> <span className="text-ink-soft">{r.site}.</span></>}{" "}
              {r.url && (
                <>Available at: <a href={r.url} target="_blank" rel="noopener noreferrer" className="break-all text-accent hover:underline">{r.url}</a></>
              )}
              {r.accessed && <span className="text-ink-soft"> (accessed {longDate(r.accessed)})</span>}.
              {r.added_from === "chat" && (
                <span className="ml-1.5 whitespace-nowrap rounded-full bg-surface3 px-1.5 py-0.5 font-sans text-[11px] text-ink-faint">added from chat</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ───────────── preview (reading view) ───────────── */

function Preview({ content }: { content: PaperContent }) {
  const numbered = numberSections(content.sections);
  return (
    <div className="flex flex-col gap-8 font-serif">
      <Sheet className="flex min-h-[640px] flex-col justify-center text-center">
        <p className="text-[11px] font-medium tracking-[0.22em] text-ink-faint">RESEARCH PAPER</p>
        <h1 className="mx-auto mt-6 max-w-[22ch] text-[34px] font-semibold leading-[1.18] text-ink">{content.title || "Untitled research paper"}</h1>
        {content.question && <p className="mx-auto mt-6 max-w-[48ch] text-[16px] italic text-ink-soft">Research question: {content.question}</p>}
        <div className="mt-10 space-y-1 text-[16px] text-ink">
          {content.author && <p>{content.author}</p>}
          <p>{longDate(content.date)}</p>
        </div>
      </Sheet>

      <Sheet className="text-[17px] leading-[1.75] text-ink/90">
        {content.abstract.trim() && (
          <section className="mx-auto max-w-[62ch]">
            <h2 className="text-center text-[18px] font-semibold text-ink">Abstract</h2>
            <div className="text-[16px]"><Body text={content.abstract} /></div>
            {content.keywords.length > 0 && (
              <p className="mt-3 text-[15px]"><span className="font-semibold text-ink">Keywords:</span> {content.keywords.join(", ")}</p>
            )}
          </section>
        )}
        {numbered.map(({ num, section: s }) => (
          <section key={s.id} className={s.level === 1 ? "mt-10" : "mt-7"}>
            {s.level === 1 ? (
              <h2 className="text-[23px] font-semibold leading-snug text-ink">{num} {s.heading}</h2>
            ) : (
              <h3 className="text-[19px] font-semibold italic leading-snug text-ink">{num} {s.heading}</h3>
            )}
            <Body text={s.body} />
          </section>
        ))}
      </Sheet>

      {content.references.length > 0 && (
        <Sheet><References content={content} /></Sheet>
      )}
    </div>
  );
}

/* ───────────── editor ───────────── */

function SectionEditor({
  section, num, first, last, onChange, onMove, onRemove, onAdd,
}: {
  section: PaperSection; num: string; first: boolean; last: boolean;
  onChange: (s: PaperSection) => void; onMove: (d: -1 | 1) => void; onRemove: () => void; onAdd: () => void;
}) {
  const tool = "pressable flex h-7 w-7 items-center justify-center rounded-md text-ink-faint hover:bg-surface2 hover:text-ink disabled:opacity-30";
  return (
    <section className={cn("group/section relative", section.level === 1 ? "mt-10" : "mt-7")}>
      <div className="absolute -top-8 right-0 z-10 flex items-center gap-0.5 rounded-lg bg-surface px-1 py-0.5 opacity-0 shadow-sm transition-opacity duration-150 focus-within:opacity-100 group-hover/section:opacity-100 sm:-right-2">
        <button
          type="button"
          onClick={() => onChange({ ...section, level: section.level === 1 ? 2 : 1 })}
          className="pressable h-7 rounded-md px-2 font-sans text-[11.5px] font-medium text-ink-soft hover:bg-surface2 hover:text-ink"
          title="Switch between section and subsection"
        >
          {section.level === 1 ? "Section" : "Subsection"}
        </button>
        <button type="button" className={tool} onClick={() => onMove(-1)} disabled={first} aria-label="Move section up"><ArrowUp size={14} /></button>
        <button type="button" className={tool} onClick={() => onMove(1)} disabled={last} aria-label="Move section down"><ArrowDown size={14} /></button>
        <button type="button" className={tool} onClick={onAdd} aria-label="Add a section below"><Plus size={14} /></button>
        <button
          type="button"
          className={cn(tool, "hover:text-bad")}
          aria-label="Delete section"
          onClick={() => {
            if (!section.body.trim() || window.confirm(`Delete the section “${section.heading || "Untitled"}”? You can undo this by not saving.`)) onRemove();
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={cn("flex-shrink-0 font-semibold text-ink-faint", section.level === 1 ? "text-[23px]" : "text-[19px] italic")}>{num}</span>
        <AutoTextarea
          ariaLabel={`Heading of section ${num}`}
          value={section.heading}
          onChange={(heading) => onChange({ ...section, heading: heading.replace(/\n/g, " ") })}
          placeholder="Section heading"
          className={cn("-mx-1 px-1 py-0.5 font-semibold leading-snug text-ink", section.level === 1 ? "text-[23px]" : "text-[19px] italic")}
        />
      </div>
      <AutoTextarea
        ariaLabel={`Text of section ${num}`}
        value={section.body}
        onChange={(body) => onChange({ ...section, body })}
        placeholder="Write this section. Leave a blank line between paragraphs; start a line with “- ” for a list."
        className="-mx-2 mt-2 px-2 py-1 text-[17px] leading-[1.75] text-ink/90"
      />
    </section>
  );
}

function Editor({ draft, setDraft }: { draft: PaperContent; setDraft: (f: (d: PaperContent) => PaperContent) => void }) {
  const numbered = numberSections(draft.sections);
  const update = (i: number, s: PaperSection) => setDraft((d) => ({ ...d, sections: d.sections.map((x, j) => (j === i ? s : x)) }));
  const move = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const s = [...d.sections];
      const j = i + dir;
      if (j < 0 || j >= s.length) return d;
      [s[i], s[j]] = [s[j], s[i]];
      return { ...d, sections: s };
    });
  const remove = (i: number) => setDraft((d) => ({ ...d, sections: d.sections.filter((_, j) => j !== i) }));
  const add = (i: number) =>
    setDraft((d) => {
      const s = [...d.sections];
      s.splice(i + 1, 0, { id: newId(), level: 1, heading: "New section", body: "" });
      return { ...d, sections: s };
    });

  return (
    <div className="flex flex-col gap-8 font-serif">
      <Sheet className="text-center">
        <p className="font-sans text-[11px] font-medium tracking-[0.22em] text-ink-faint">RESEARCH PAPER</p>
        <AutoTextarea
          ariaLabel="Title"
          value={draft.title}
          onChange={(title) => setDraft((d) => ({ ...d, title: title.replace(/\n/g, " ") }))}
          placeholder="Title of the paper"
          className="mt-5 px-2 py-1 text-center text-[34px] font-semibold leading-[1.18] text-ink"
        />
        {draft.question && <p className="mx-auto mt-5 max-w-[48ch] text-[16px] italic text-ink-soft">Research question: {draft.question}</p>}
        <div className="mx-auto mt-8 grid max-w-[420px] gap-1 text-[16px]">
          <AutoTextarea
            ariaLabel="Author"
            value={draft.author}
            onChange={(author) => setDraft((d) => ({ ...d, author: author.replace(/\n/g, " ") }))}
            placeholder="Author"
            className="px-2 py-0.5 text-center text-ink"
          />
          <AutoTextarea
            ariaLabel="Date"
            value={draft.date}
            onChange={(date) => setDraft((d) => ({ ...d, date: date.replace(/\n/g, " ") }))}
            placeholder="Date (YYYY-MM-DD)"
            className="px-2 py-0.5 text-center text-ink-soft"
          />
        </div>
      </Sheet>

      <Sheet>
        <section className="mx-auto max-w-[62ch]">
          <h2 className="text-center text-[18px] font-semibold text-ink">Abstract</h2>
          <AutoTextarea
            ariaLabel="Abstract"
            value={draft.abstract}
            onChange={(abstract) => setDraft((d) => ({ ...d, abstract }))}
            placeholder="A summary of the purpose, scope, approach and main findings."
            className="-mx-2 mt-3 px-2 py-1 text-[16px] leading-[1.75] text-ink/90"
          />
          <div className="mt-2 flex items-baseline gap-2 text-[15px]">
            <span className="flex-shrink-0 font-semibold text-ink">Keywords:</span>
            <AutoTextarea
              ariaLabel="Keywords, separated by commas"
              value={draft.keywords.join(", ")}
              onChange={(v) => setDraft((d) => ({ ...d, keywords: v.replace(/\n/g, " ").split(",").map((k) => k.trimStart()).filter((k, i, a) => k || i === a.length - 1) }))}
              placeholder="keyword, keyword"
              className="px-1 py-0.5 text-ink/90"
            />
          </div>
        </section>

        {numbered.map(({ num, section }, i) => (
          <SectionEditor
            key={section.id}
            section={section}
            num={num}
            first={i === 0}
            last={i === numbered.length - 1}
            onChange={(s) => update(i, s)}
            onMove={(d) => move(i, d)}
            onRemove={() => remove(i)}
            onAdd={() => add(i)}
          />
        ))}
        <button
          type="button"
          onClick={() => add(draft.sections.length - 1)}
          className="pressable mt-10 inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-line px-3 font-sans text-[13px] font-medium text-ink-soft hover:border-line-hover hover:text-ink"
        >
          <Plus size={14} /> Add a section
        </button>
      </Sheet>

      {draft.references.length > 0 && (
        <Sheet>
          <References content={draft} />
          <p className="mt-6 border-t border-line pt-4 font-sans text-[12.5px] leading-relaxed text-ink-faint">
            References come from the sources this research actually retrieved, so they can&apos;t be edited here. Citations such as [3] in the text
            point to them; removing a citation from the text is fine.
          </p>
        </Sheet>
      )}
    </div>
  );
}

/* ───────────── the workspace ───────────── */

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string; conflict?: boolean };

/** Keep keyword list clean for saving (the editor allows a trailing empty one while typing). */
function forSave(c: PaperContent): PaperContent {
  return { ...c, keywords: c.keywords.map((k) => k.trim()).filter(Boolean) };
}

export function PaperWorkspace({ documentId }: { documentId: string }) {
  const [doc, setDoc] = useState<ResearchDocument | null>(null);
  const [draft, setDraftState] = useState<PaperContent | null>(null);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false); // the research conversation, beside the paper
  const [viewing, setViewing] = useState<ResearchDocument | null>(null); // an older version, read-only

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const d = await getDocument(documentId);
      setDoc(d);
      setDraftState(d.content);
      setViewing(null);
      setSave({ kind: "idle" });
    } catch (e: any) {
      setLoadError(e?.status === 404 ? "This research paper couldn't be found." : e?.message || "Couldn't load the paper.");
    }
  }, [documentId]);

  useEffect(() => { load(); }, [load]);

  const setDraft = useCallback((f: (d: PaperContent) => PaperContent) => {
    setDraftState((d) => (d ? f(d) : d));
    setSave((s) => (s.kind === "saved" ? { kind: "idle" } : s));
  }, []);

  const dirty = useMemo(
    () => !!doc?.content && !!draft && JSON.stringify(forSave(draft)) !== JSON.stringify(doc.content),
    [doc, draft]
  );

  const doSave = useCallback(async (): Promise<boolean> => {
    if (!doc || !draft || !doc.current_version) return false;
    if (!dirty) return true;
    setSave({ kind: "saving" });
    try {
      const saved = await saveDocument(doc.id, forSave(draft), doc.current_version);
      setDoc(saved);
      setDraftState(saved.content);
      setSave({ kind: "saved" });
      return true;
    } catch (e: any) {
      setSave({ kind: "error", message: e?.message || "Couldn't save.", conflict: e?.status === 409 });
      return false;
    }
  }, [doc, draft, dirty]);

  // Ctrl/Cmd + S saves; leaving with unsaved changes asks first
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void doSave();
      }
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [doSave, dirty]);

  async function download() {
    if (!doc) return;
    setDownloading(true);
    try {
      if (dirty && !(await doSave())) return; // the PDF is always of a saved version
      await downloadPaperPdf(doc.id);
    } catch (e: any) {
      setSave({ kind: "error", message: e?.message || "Couldn't make the PDF." });
    } finally {
      setDownloading(false);
    }
  }

  async function openVersion(v: number) {
    setVersionsOpen(false);
    if (!doc || v === doc.current_version) return setViewing(null);
    try {
      setViewing(await getDocument(doc.id, v));
    } catch (e: any) {
      setSave({ kind: "error", message: e?.message || "Couldn't open that version." });
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto flex h-full max-w-[520px] flex-col justify-center px-5">
        <p className="flex items-center gap-2 text-[15px] text-ink"><AlertCircle size={16} className="text-warn" /> {loadError}</p>
        <div className="mt-5 flex gap-2">
          <button onClick={load} className="pressable h-9 rounded-[10px] border border-line px-3.5 text-[13px] font-medium text-ink hover:border-line-hover">Try again</button>
          <Link href="/history" className="pressable inline-flex h-9 items-center rounded-[10px] px-3.5 text-[13px] font-medium text-ink-soft hover:bg-surface2 hover:text-ink">Go to History</Link>
        </div>
      </div>
    );
  }

  if (!doc || (!draft && doc.status === "ready")) {
    return (
      <div className="mx-auto max-w-[820px] px-5 pt-20">
        <div className="h-3 w-32 animate-pulse rounded bg-ink/[0.06]" />
        <div className="mt-6 h-9 w-4/5 animate-pulse rounded bg-ink/[0.06]" />
        <div className="mt-3 h-9 w-3/5 animate-pulse rounded bg-ink/[0.06]" />
      </div>
    );
  }

  if (doc.status !== "ready" || !draft) {
    return (
      <div className="mx-auto flex h-full max-w-[520px] flex-col justify-center px-5 text-center">
        {doc.status === "generating" ? (
          <>
            <Loader2 size={20} className="mx-auto animate-spin text-accent" />
            <p className="mt-4 text-[15px] text-ink">This research paper is still being written.</p>
            <button onClick={load} className="pressable mx-auto mt-5 h-9 rounded-[10px] border border-line px-3.5 text-[13px] font-medium text-ink hover:border-line-hover">Check again</button>
          </>
        ) : (
          <p className="text-[15px] text-ink">{doc.error || "This research paper couldn't be written."}</p>
        )}
        {doc.thread_id && <Link href={`/research?thread=${doc.thread_id}`} className="mt-4 text-[13px] text-accent hover:underline">Back to the conversation</Link>}
      </div>
    );
  }

  const words = paperWordCount(draft);
  const backHref = doc.thread_id ? `/research?thread=${doc.thread_id}` : "/history";
  const status =
    save.kind === "saving" ? <span className="inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Saving…</span>
    : save.kind === "error" ? <span className="text-bad">{save.message}</span>
    : dirty ? <span className="text-warn">Unsaved changes</span>
    : <span className="inline-flex items-center gap-1"><Check size={12} className="text-ok" /> {save.kind === "saved" ? "Saved" : doc.edited ? "All changes saved" : "Generated"} · v{doc.current_version}</span>;

  return (
    <div className="flex h-full flex-col">
      <header className="flex min-h-14 flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2 sm:px-6">
        <Link
          href={backHref}
          onClick={(e) => { if (dirty && !window.confirm("Leave without saving your changes?")) e.preventDefault(); }}
          className="pressable -ml-1.5 inline-flex h-8 items-center gap-1.5 rounded-lg px-1.5 text-[13px] font-medium text-ink-soft hover:bg-surface2 hover:text-ink"
        >
          <ArrowLeft size={15} /> <span className="hidden sm:inline">Conversation</span>
        </Link>
        <span className="hidden text-ink-faint sm:inline">/</span>
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">{draft.title || "Research paper"}</span>
        <span className="order-last w-full text-[12px] text-ink-faint sm:order-none sm:w-auto" aria-live="polite">
          {status}{save.kind === "error" && save.conflict && (
            <button onClick={load} className="ml-2 text-accent hover:underline">Load the latest version</button>
          )}
        </span>

        <div role="radiogroup" aria-label="View" className="inline-flex rounded-[10px] bg-ink/[0.05] p-[3px]">
          {(["edit", "preview"] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn("inline-flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-medium transition-colors",
                mode === m ? "bg-surface text-ink shadow-sm" : "text-ink-faint hover:text-ink")}
            >
              {m === "edit" ? <PenLine size={13} /> : <Eye size={13} />} {m === "edit" ? "Edit" : "Preview"}
            </button>
          ))}
        </div>

        {doc.thread_id && (
          <button
            onClick={() => setChatOpen((o) => !o)}
            aria-pressed={chatOpen}
            className={cn("pressable inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium hover:bg-surface2 hover:text-ink",
              chatOpen ? "bg-surface2 text-ink" : "text-ink-soft")}
          >
            <MessageSquare size={14} /> <span className="hidden md:inline">Conversation</span>
          </button>
        )}

        <div className="relative">
          <button
            onClick={() => setVersionsOpen((o) => !o)}
            aria-expanded={versionsOpen}
            className="pressable inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-ink-soft hover:bg-surface2 hover:text-ink"
          >
            <History size={14} /> <span className="hidden md:inline">Versions</span> <ChevronDown size={13} className="text-ink-faint" />
          </button>
          {versionsOpen && (
            <ul className="absolute right-0 top-10 z-30 max-h-[320px] w-64 overflow-y-auto rounded-xl bg-surface p-1.5 shadow-panel">
              {[...doc.versions].reverse().map((v) => (
                <li key={v.version}>
                  <button
                    onClick={() => openVersion(v.version)}
                    className={cn("flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-surface2",
                      (viewing?.version ?? doc.current_version) === v.version ? "text-ink" : "text-ink-soft")}
                  >
                    <span>
                      <span className="mono text-[11.5px] text-ink-faint">v{v.version}</span>{" "}
                      {VERSION_LABEL[v.source] ?? "Your edit"}
                      {v.version === doc.current_version && <span className="text-ink-faint"> · latest</span>}
                    </span>
                    <span className="text-[11.5px] text-ink-faint">{shortTime(v.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          onClick={() => void doSave()}
          disabled={!dirty || save.kind === "saving" || !!viewing}
          className="pressable inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[12.5px] font-medium text-ink hover:border-line-hover disabled:opacity-40"
        >
          Save
        </button>
        <button
          onClick={download}
          disabled={downloading || !!viewing}
          className="pressable inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12.5px] font-medium text-on-primary disabled:opacity-50"
          title={dirty ? "Saves your changes, then downloads the PDF" : "Download the latest saved version as a PDF"}
        >
          {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          <span className="hidden sm:inline">{dirty ? "Save & download PDF" : "Download PDF"}</span>
          <span className="sm:hidden">PDF</span>
        </button>
      </header>

      {viewing?.content && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-accent-soft px-4 py-2.5 text-[13px] text-ink sm:px-6">
          <span>
            Viewing <span className="mono">v{viewing.version}</span> ({(VERSION_LABEL[viewing.versions.find((v) => v.version === viewing.version)?.source ?? "edit"] ?? "Your edit").toLowerCase()}). Read-only.
          </span>
          <button
            onClick={() => {
              setDraft(() => ({ ...viewing.content!, references: doc.content?.references ?? viewing.content!.references }));
              setViewing(null);
              setMode("edit");
            }}
            className="font-medium text-accent hover:underline"
          >
            Restore this version
          </button>
          <button onClick={() => setViewing(null)} className="text-ink-soft hover:text-ink">Back to the latest</button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
      <div className="min-h-0 flex-1 overflow-y-auto bg-desk/60 px-3 py-8 sm:px-8 sm:py-12">
        {viewing?.content ? <Preview content={viewing.content} /> : mode === "preview" ? <Preview content={draft} /> : <Editor draft={draft} setDraft={setDraft} />}
        <p className="mono mx-auto mt-6 max-w-[820px] text-center text-[11.5px] text-ink-faint">
          {words.toLocaleString()} words · {draft.sections.filter((s) => s.level === 1).length} sections · {draft.references.length} references
        </p>
      </div>
      {chatOpen && doc.thread_id && (
        // Beside the paper on wide screens; over it on narrow ones
        <div className="fixed inset-0 z-40 flex sm:static sm:z-auto sm:w-[400px] sm:flex-shrink-0 sm:border-l sm:border-line xl:w-[440px]">
          <ConversationPanel
            threadId={doc.thread_id}
            sessionId={doc.session_id}
            onClose={() => setChatOpen(false)}
            documentId={doc.id}
            // Adding creates a new version: unsaved edits would otherwise be lost when the paper reloads
            beforeAdd={() => (dirty ? "Save your edits first, then add this answer." : viewing ? "Go back to the latest version first." : null)}
            onAdded={() => void load()}
          />
        </div>
      )}
      </div>
    </div>
  );
}
