"use client";

import Link from "next/link";
import { Search, BookOpen, Upload, FileBarChart, ArrowRight, FileText } from "lucide-react";
import { usePapersQuery, useSessionsQuery } from "@/lib/queries";
import { modeHref } from "@/lib/nav";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { paperStatus, sessionStatus } from "@/lib/status";

const shortcuts = [
  { href: "/research", icon: Search, title: "New research", body: "Ask an open-ended question." },
  { href: "/paper-study", icon: BookOpen, title: "Study a paper", body: "Read, question, and generate notes." },
  { href: "/library", icon: Upload, title: "Upload a paper", body: "Add a PDF to your library." },
  { href: "/report", icon: FileBarChart, title: "Latest report", body: "Evidence, citations, findings." },
];

function SectionHeader({ title, href }: { title: string; href: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="font-serif text-base font-semibold">{title}</h2>
      <Link href={href} className="flex items-center gap-1 text-xs text-ink-faint hover:text-ink-soft">
        View all <ArrowRight size={12} />
      </Link>
    </div>
  );
}

export default function DashboardPage() {
  const { data: sessions, isLoading: sessionsLoading } = useSessionsQuery();
  const { data: papers, isLoading: papersLoading } = usePapersQuery();

  const recentResearch = sessions?.filter((s) => s.mode === "research").slice(0, 3);
  const recentPapers = papers?.slice(0, 3);

  return (
    <div className="animate-view-in h-full overflow-y-auto px-10 py-10">
      <h1 className="font-serif text-2xl font-semibold">Dashboard</h1>
      <p className="mb-8 mt-1 max-w-lg text-ink-soft">Pick up where you left off, or start something new.</p>

      <div className="mb-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {shortcuts.map(({ href, icon: Icon, title, body }) => (
          <Link key={href} href={href}>
            <Card className="h-full cursor-pointer transition-transform hover:-translate-y-0.5 hover:border-grad2 active:scale-[0.98]">
              <Icon size={18} className="mb-3 text-ink-soft" />
              <h3 className="mb-1 font-serif text-base font-semibold">{title}</h3>
              <p className="text-sm text-ink-soft">{body}</p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-10 lg:grid-cols-2">
        <section>
          <SectionHeader title="Recent research" href="/history" />
          {sessionsLoading && <p className="text-sm text-ink-faint">Loading…</p>}
          <div className="divide-y divide-line border-t border-line">
            {recentResearch?.map((s) => (
              <Link key={s.id} href={modeHref(s.mode, s.id)} className="flex items-center gap-3 py-3.5 hover:bg-surface2/40">
                <div className="flex-1">
                  <div className="text-sm font-medium">{s.title}</div>
                  <div className="text-xs text-ink-faint">Updated {s.updated}</div>
                </div>
                <Badge variant={sessionStatus[s.status].variant}>{sessionStatus[s.status].label}</Badge>
              </Link>
            ))}
          </div>
        </section>

        <section>
          <SectionHeader title="Uploaded papers" href="/library" />
          {papersLoading && <p className="text-sm text-ink-faint">Loading…</p>}
          <div className="divide-y divide-line border-t border-line">
            {recentPapers?.map((p) => (
              <Link key={p.id} href="/library" className="flex items-center gap-3 py-3.5 hover:bg-surface2/40">
                <FileText size={16} className="text-ink-faint" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{p.title}</div>
                  <div className="text-xs text-ink-faint">Uploaded {p.uploaded}</div>
                </div>
                <Badge variant={paperStatus[p.status].variant}>{paperStatus[p.status].label}</Badge>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
