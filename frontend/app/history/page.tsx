"use client";

import { useState } from "react";
import Link from "next/link";
import { useSessionsQuery } from "@/lib/queries";
import { modeHref } from "@/lib/nav";
import { sessionStatus } from "@/lib/status";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function HistoryPage() {
  const { data: sessions, isLoading } = useSessionsQuery();
  const [filter, setFilter] = useState<"all" | "research" | "paper">("all");
  const [query, setQuery] = useState("");

  const visible = sessions?.filter(
    (s) => (filter === "all" || s.mode === filter) && s.title.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="animate-view-in h-full overflow-y-auto px-10 py-10">
      <h1 className="font-serif text-2xl font-semibold">History</h1>
      <p className="mb-6 mt-1 max-w-lg text-ink-soft">Reopen any previous research or paper study session.</p>

      <div className="mb-6 flex items-center gap-4">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="research">Research</TabsTrigger>
            <TabsTrigger value="paper">Paper study</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sessions…"
          className="max-w-xs"
        />
      </div>

      {isLoading && <p className="text-sm text-ink-faint">Loading sessions…</p>}

      <div className="divide-y divide-line border-t border-line">
        {visible?.map((s) => (
          <Link key={s.id} href={modeHref(s.mode, s.id)} className="flex items-center gap-4 py-4 hover:bg-surface2/40">
            <span className={`h-2 w-2 rounded-full ${s.mode === "research" ? "bg-grad2" : "bg-warn"}`} />
            <div className="flex-1">
              <div className="text-sm font-medium">{s.title}</div>
              <div className="text-xs text-ink-faint">
                {s.mode === "research" ? "Research" : "Paper study"} · updated {s.updated}
              </div>
            </div>
            <Badge variant={sessionStatus[s.status].variant}>{sessionStatus[s.status].label}</Badge>
          </Link>
        ))}
        {visible && visible.length === 0 && <p className="py-8 text-sm text-ink-faint">No sessions match.</p>}
      </div>
    </div>
  );
}
