"use client";

import Link from "next/link";
import {
  Search, BookOpen, Upload, FileBarChart, ArrowRight,
  FileText, Sparkles, Clock, TrendingUp, Zap,
} from "lucide-react";
import { usePapersQuery, useSessionsQuery } from "@/lib/queries";
import { modeHref } from "@/lib/nav";
import { Badge } from "@/components/ui/badge";
import { paperStatus, sessionStatus } from "@/lib/status";
import { useUiStore } from "@/lib/store";

// ── Quick Action Card ────────────────────
function QuickCard({
  href, icon: Icon, title, body, accent,
}: {
  href: string;
  icon: React.ElementType;
  title: string;
  body: string;
  accent: string; // css color var string
}) {
  return (
    <Link href={href} className="group block">
      <div
        className="relative h-full overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-panel-hover active:scale-[0.98]"
      >
        {/* Hover blush gradient fill */}
        <div
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 rounded-2xl"
          style={{ background: `radial-gradient(circle at 20% 20%, ${accent}18 0%, transparent 70%)` }}
        />
        <div
          className="mb-3.5 inline-flex h-9 w-9 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${accent}18`, color: accent }}
        >
          <Icon size={17} />
        </div>
        <h3 className="mb-1 font-serif text-[15px] font-semibold text-ink leading-snug">{title}</h3>
        <p className="text-[13px] text-ink-soft leading-relaxed">{body}</p>
      </div>
    </Link>
  );
}

// ── Section Header ───────────────────────
function SectionHeader({ title, href }: { title: string; href: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="font-serif text-[15px] font-semibold text-ink">{title}</h2>
      <Link
        href={href}
        className="flex items-center gap-1 text-[12px] text-ink-faint transition-colors hover:text-rose"
      >
        View all <ArrowRight size={11} />
      </Link>
    </div>
  );
}

// ── Recent Item ──────────────────────────
function RecentRow({
  icon: Icon,
  title,
  meta,
  badge,
  href,
}: {
  icon: React.ElementType;
  title: string;
  meta: string;
  badge?: React.ReactNode;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 py-3 transition-colors hover:bg-blush/30 rounded-xl px-2 -mx-2"
    >
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface2 text-ink-faint group-hover:bg-blush group-hover:text-rose transition-colors">
        <Icon size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="truncate text-[13px] font-medium text-ink leading-snug">{title}</div>
        <div className="text-[11px] text-ink-faint">{meta}</div>
      </div>
      {badge}
    </Link>
  );
}

// ── Stat Pill ────────────────────────────
function StatPill({ icon: Icon, value, label, color }: { icon: React.ElementType; value: string; label: string; color: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-sm">
      <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ backgroundColor: `${color}18`, color }}>
        <Icon size={15} />
      </div>
      <div>
        <div className="text-base font-semibold text-ink leading-none">{value}</div>
        <div className="text-[11px] text-ink-faint mt-0.5">{label}</div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────
export default function DashboardPage() {
  const { data: sessions, isLoading: sessionsLoading } = useSessionsQuery();
  const { data: papers,   isLoading: papersLoading   } = usePapersQuery();
  const { user } = useUiStore();

  const firstName = (() => {
    const parts = user?.name?.split(" ").filter(Boolean) ?? [];
    const skip = new Set(["Dr.", "Dr", "Prof.", "Prof", "Mr.", "Ms.", "Mrs."]);
    return parts.find((p) => !skip.has(p)) ?? "there";
  })();
  const recentResearch = sessions?.filter((s) => s.mode === "research").slice(0, 4);
  const recentPapers   = papers?.slice(0, 4);

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" :
    hour < 17 ? "Good afternoon" :
                "Good evening";

  return (
    <div className="h-full overflow-y-auto bg-bg">
      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-10">

        {/* ── Hero greeting ── */}
        <div className="mb-10 animate-view-in">
          <div className="mb-1 flex items-center gap-2">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-blush-deep to-transparent" />
            <span className="text-[11px] uppercase tracking-widest text-ink-faint">Research workspace</span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-blush-deep to-transparent" />
          </div>
          <h1 className="mt-4 font-serif text-4xl font-normal tracking-tight text-ink">
            {greeting},{" "}
            <span className="text-gradient">{firstName}.</span>
          </h1>
          <p className="mt-2 text-[15px] text-ink-soft">
            Your research canvas is ready. What would you like to explore?
          </p>
        </div>

        {/* ── Stats row ── */}
        <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3 animate-view-in" style={{ animationDelay: "0.05s" }}>
          <StatPill icon={TrendingUp} value={String(sessions?.length ?? 0)} label="Research sessions" color="var(--rose)" />
          <StatPill icon={FileText}   value={String(papers?.length ?? 0)}   label="Papers in library" color="var(--lavender)" />
          <StatPill icon={Zap}        value="Now"                            label="Canvas ready"      color="var(--teal)" />
        </div>

        {/* ── Quick actions ── */}
        <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-view-in" style={{ animationDelay: "0.1s" }}>
          <QuickCard
            href="/research"    icon={Search}      title="New research"   body="Ask an open question."    accent="var(--rose)" />
          <QuickCard
            href="/paper-study" icon={BookOpen}     title="Study a paper"  body="Read and question deeply." accent="var(--lavender)" />
          <QuickCard
            href="/library"     icon={Upload}       title="Add a paper"    body="Import PDF to library."    accent="var(--teal)" />
          <QuickCard
            href="/report"      icon={FileBarChart} title="Latest report"  body="Evidence and findings."    accent="var(--warn)" />
        </div>

        {/* ── Canvas CTA ── */}
        <Link
          href="/paper-study"
          className="group mb-10 flex items-center justify-between overflow-hidden rounded-3xl border border-blush-deep bg-gradient-to-r from-blush/50 via-surface to-lavender-soft/40 p-6 shadow-sm transition-all hover:shadow-panel animate-view-in"
          style={{ animationDelay: "0.15s" }}
        >
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={14} className="text-rose" />
              <span className="text-[11px] uppercase tracking-widest text-rose font-medium">Research Canvas</span>
            </div>
            <h2 className="font-serif text-xl font-normal text-ink">Spread five pages on one desk</h2>
            <p className="mt-1 text-[13px] text-ink-soft">Open summaries together, drag them with your hand, and resize any edge — a research canvas that stays in view.</p>
          </div>
          <div className="flex-shrink-0 ml-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose/10 text-rose transition-all group-hover:bg-rose group-hover:text-white shadow-sm">
              <ArrowRight size={20} />
            </div>
          </div>
        </Link>

        {/* ── Recent content ── */}
        <div className="grid gap-8 lg:grid-cols-2 animate-view-in" style={{ animationDelay: "0.2s" }}>
          <section>
            <SectionHeader title="Recent research" href="/history" />
            <div className="divide-y divide-line">
              {sessionsLoading && (
                <div className="py-4 text-sm text-ink-faint">Loading…</div>
              )}
              {!sessionsLoading && (!recentResearch || recentResearch.length === 0) && (
                <div className="py-6 text-center">
                  <Search size={22} className="mx-auto mb-2 text-ink-faint" />
                  <p className="text-[13px] text-ink-faint">No research sessions yet.</p>
                  <Link href="/research" className="mt-1 text-[13px] text-rose hover:underline">Start one →</Link>
                </div>
              )}
              {recentResearch?.map((s) => (
                <RecentRow
                  key={s.id}
                  icon={Search}
                  href={modeHref(s.mode, s.id)}
                  title={s.title}
                  meta={`Updated ${s.updated}`}
                  badge={<Badge variant={sessionStatus[s.status].variant}>{sessionStatus[s.status].label}</Badge>}
                />
              ))}
            </div>
          </section>

          <section>
            <SectionHeader title="Uploaded papers" href="/library" />
            <div className="divide-y divide-line">
              {papersLoading && (
                <div className="py-4 text-sm text-ink-faint">Loading…</div>
              )}
              {!papersLoading && (!recentPapers || recentPapers.length === 0) && (
                <div className="py-6 text-center">
                  <FileText size={22} className="mx-auto mb-2 text-ink-faint" />
                  <p className="text-[13px] text-ink-faint">No papers uploaded yet.</p>
                  <Link href="/library" className="mt-1 text-[13px] text-rose hover:underline">Add one →</Link>
                </div>
              )}
              {recentPapers?.map((p) => (
                <RecentRow
                  key={p.id}
                  icon={FileText}
                  href="/library"
                  title={p.title}
                  meta={`Uploaded ${p.uploaded}`}
                  badge={<Badge variant={paperStatus[p.status].variant}>{paperStatus[p.status].label}</Badge>}
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
