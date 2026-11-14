"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ArrowUpRight } from "lucide-react";
import { useSessionsQuery } from "@/lib/queries";
import { modeHref } from "@/lib/nav";
import { sessionStatus } from "@/lib/status";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SessionSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

function monthKey(s: string) {
  const t = Date.parse(s);
  if (Number.isNaN(t)) return { key: "earlier", label: "Earlier", day: "" };
  const d = new Date(t);
  return {
    key: `${d.getFullYear()}-${d.getMonth()}`,
    label: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    day: d.toLocaleDateString(undefined, { day: "numeric" }),
  };
}

export default function HistoryPage() {
  const { data: sessions, isLoading } = useSessionsQuery();
  const [filter, setFilter] = useState<"all" | "research" | "paper">("all");
  const [query, setQuery] = useState("");

  const visible = sessions?.filter(
    (s) => (filter === "all" || s.mode === filter) && s.title.toLowerCase().includes(query.toLowerCase())
  );

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: (SessionSummary & { day: string })[] }[] = [];
    (visible ?? []).forEach((s) => {
      const m = monthKey(s.updated);
      let g = out.find((x) => x.key === m.key);
      if (!g) { g = { key: m.key, label: m.label, items: [] }; out.push(g); }
      g.items.push({ ...s, day: m.day });
    });
    return out;
  }, [visible]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1040px] px-5 pb-20 pt-10 sm:px-10 sm:pt-14">
        <PageHeader
          className="animate-view-in"
          title="History"
          description="Every investigation and study session, in the order you worked on them."
        />

        <div className="animate-view-in sticky top-0 z-20 -mx-5 mt-10 flex flex-wrap items-center justify-between gap-3 bg-bg/90 px-5 py-3 backdrop-blur-md sm:-mx-10 sm:px-10" style={{ animationDelay: "70ms" }}>
          <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="research">Research</TabsTrigger>
              <TabsTrigger value="paper">Paper study</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative w-full sm:w-72">
            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by question" aria-label="Search sessions" className="pl-10" />
          </div>
        </div>

        <div className="animate-view-in mt-6" style={{ animationDelay: "120ms" }}>
          {isLoading &&
            [0, 1, 2].map((i) => (
              <div key={i} className="grid grid-cols-[120px_1fr] gap-6 border-t border-line py-6">
                <div className="h-4 w-20 animate-pulse rounded bg-ink/[0.06]" />
                <div className="h-5 w-3/4 animate-pulse rounded bg-ink/[0.06]" />
              </div>
            ))}

          {groups.map((g) => (
            <section key={g.key} className="grid gap-x-10 border-t border-line pt-6 md:grid-cols-[180px_1fr]">
              <div className="mb-3 md:sticky md:top-20 md:mb-0 md:self-start">
                <h2 className="font-display text-title-sm font-semibold text-ink">{g.label}</h2>
                <p className="mt-1 text-meta text-ink-faint">{g.items.length} {g.items.length === 1 ? "session" : "sessions"}</p>
              </div>
              <ol className="pb-8">
                {g.items.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={modeHref(s.mode, s.id)}
                      className="group grid grid-cols-[36px_1fr_auto] items-start gap-4 rounded-xl px-3 py-4 transition-colors duration-150 hover:bg-surface2 md:-mx-3"
                    >
                      <span className="figure pt-0.5 text-[22px] text-ink-faint">{s.day}</span>
                      <span className="min-w-0">
                        <span className="block text-[15px] font-medium leading-snug text-ink">{s.title}</span>
                        <span className="mt-1.5 flex items-center gap-2 text-meta text-ink-faint">
                          <span className={cn("h-1.5 w-1.5 rounded-full", s.mode === "research" ? "bg-accent" : "bg-steel")} />
                          {s.mode === "research" ? "Research" : "Paper study"}
                          {s.status !== "ready" && <Badge variant={sessionStatus[s.status].variant}>{sessionStatus[s.status].label}</Badge>}
                        </span>
                      </span>
                      <ArrowUpRight
                        size={16}
                        className="mt-1 text-ink-faint transition-[transform,color] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink"
                      />
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          ))}

          {visible && visible.length === 0 && (
            <div className="border-t border-line py-20 text-center">
              <p className="font-display text-title-sm font-semibold text-ink">{query ? "Nothing matches that search" : "No sessions yet"}</p>
              <p className="mt-2 text-body text-ink-soft">
                {query ? "Try a shorter phrase, or switch to All." : "Your investigations and paper studies will collect here."}
              </p>
              {!query && (
                <Link href="/research" className="pressable mt-6 inline-flex h-10 items-center rounded-[11px] bg-primary px-4 text-[13px] font-medium text-on-primary">
                  Start an investigation
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
