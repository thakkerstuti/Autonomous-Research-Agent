"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutGrid, Search, BookOpen, FileText, Library, History, Settings,
  LogIn, Sun, Moon, LogOut, PanelLeftClose, PanelLeftOpen, Plus, ChevronsUpDown,
} from "lucide-react";
import { useUiStore } from "@/lib/store";
import { useSessionsQuery } from "@/lib/queries";
import { modeHref } from "@/lib/nav";
import { toggleThemeWithReveal } from "@/lib/theme-transition";
import { BrandMark } from "@/components/ui/brand-mark";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const links = [
  { href: "/dashboard",   label: "Overview",    icon: LayoutGrid },
  { href: "/research",    label: "Research",    icon: Search },
  { href: "/paper-study", label: "Paper study", icon: BookOpen },
  { href: "/library",     label: "Library",     icon: Library },
  { href: "/report",      label: "Report",      icon: FileText },
  { href: "/history",     label: "History",     icon: History },
];

const STORAGE_KEY = "cognexa-sidebar";

function Tip({ show, children }: { show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-[calc(100%+12px)] top-1/2 z-50 origin-left -translate-y-1/2 scale-[0.97] whitespace-nowrap rounded-lg bg-primary px-2.5 py-1.5 text-[12px] font-medium text-on-primary opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover:scale-100 group-hover:opacity-100 group-hover:delay-300"
    >
      {children}
    </span>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAuthenticated, logout, theme, toggleTheme } = useUiStore();
  const { data: sessions } = useSessionsQuery();
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {}
    // Enable width transitions only after the stored state is applied
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      try { localStorage.setItem(STORAGE_KEY, c ? "0" : "1"); } catch {}
      return !c;
    });
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  // Sliding active indicator
  const navRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ y: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    setIndicator(el ? { y: el.offsetTop, h: el.offsetHeight } : null);
  }, [pathname, collapsed]);

  const recent = (sessions ?? []).slice(0, 5);

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  return (
    <>
      <aside
        className={cn(
          "relative z-50 hidden h-[100dvh] flex-shrink-0 flex-col border-r border-line bg-bg sm:flex",
          ready && "transition-[width] duration-300 ease-out",
          collapsed ? "w-[68px]" : "w-[248px]"
        )}
      >
        {/* Brand + collapse */}
        <div className={cn("flex h-16 items-center", collapsed ? "justify-center px-0" : "justify-between px-4")}>
          <Link href="/dashboard" aria-label="CogNexa overview" className="flex min-w-0 items-center gap-2.5">
            <span className="pressable flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-primary text-on-primary">
              <BrandMark size={17} />
            </span>
            {!collapsed && <span className="truncate font-serif text-[19px] font-medium tracking-[-0.02em] text-ink">CogNexa</span>}
          </Link>
          {!collapsed && (
            <button
              onClick={toggle}
              aria-label="Collapse sidebar"
              className="pressable flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint hover:bg-surface2 hover:text-ink"
            >
              <PanelLeftClose size={16} strokeWidth={1.75} />
            </button>
          )}
        </div>

        <div className={cn("flex flex-1 flex-col overflow-y-auto overflow-x-hidden pb-3", collapsed ? "px-3" : "px-3")}>
          {/* Primary action */}
          <Link
            href="/research"
            className={cn(
              "pressable group relative mb-5 mt-1 flex h-10 items-center gap-2 rounded-[11px] bg-primary text-[13px] font-medium text-on-primary hover:bg-primary/90",
              collapsed ? "w-10 justify-center self-center" : "px-3"
            )}
            aria-label="New research"
          >
            <Plus size={16} />
            {!collapsed && "New research"}
            <Tip show={collapsed}>New research</Tip>
          </Link>

          {/* Navigation */}
          <nav ref={navRef} aria-label="Main" className="relative flex flex-col gap-0.5">
            {indicator && (
              <span
                aria-hidden
                className="absolute left-0 right-0 rounded-[10px] bg-surface shadow-sm transition-[transform,height] duration-300 ease-out"
                style={{ transform: `translateY(${indicator.y}px)`, height: indicator.h, top: 0 }}
              />
            )}
            {links.map(({ href, label, icon: Icon }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  aria-label={collapsed ? label : undefined}
                  className={cn(
                    "group relative z-10 flex h-9 items-center gap-3 rounded-[10px] text-[13.5px] transition-colors duration-150",
                    collapsed ? "w-10 justify-center self-center" : "px-3",
                    active ? "font-medium text-ink" : "text-ink-soft hover:bg-surface2/70 hover:text-ink"
                  )}
                >
                  <Icon size={16} strokeWidth={active ? 2 : 1.75} className="flex-shrink-0" />
                  {!collapsed && <span className="truncate">{label}</span>}
                  <Tip show={collapsed}>{label}</Tip>
                </Link>
              );
            })}
          </nav>

          {/* Recent threads — real sessions */}
          {!collapsed && (
            <div className="mt-8">
              <div className="col-label mb-2 px-3">Recent research</div>
              {recent.length === 0 ? (
                <p className="px-3 text-meta text-ink-faint">Threads you start will appear here.</p>
              ) : (
                <ul className="flex flex-col">
                  {recent.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={modeHref(s.mode, s.id)}
                        title={s.title}
                        className="block truncate rounded-lg px-3 py-1.5 text-meta text-ink-soft transition-colors duration-150 hover:bg-surface2/70 hover:text-ink"
                      >
                        {s.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Footer: expand, theme, account */}
        <div className={cn("flex flex-col gap-1 border-t border-line p-3", collapsed && "items-center")}>
          {collapsed && (
            <button
              onClick={toggle}
              aria-label="Expand sidebar"
              className="pressable group relative flex h-9 w-10 items-center justify-center rounded-[10px] text-ink-faint hover:bg-surface2 hover:text-ink"
            >
              <PanelLeftOpen size={16} strokeWidth={1.75} />
              <Tip show>Expand</Tip>
            </button>
          )}

          {isAuthenticated && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "pressable flex items-center gap-2.5 rounded-[10px] text-left outline-none hover:bg-surface2 data-[state=open]:bg-surface2",
                  collapsed ? "h-10 w-10 justify-center" : "h-12 w-full px-2"
                )}
                aria-label="Account menu"
              >
                {user.avatar ? (
                  <img src={user.avatar} alt="" className="h-7 w-7 flex-shrink-0 rounded-full object-cover ring-1 ring-line" />
                ) : (
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">
                    {user.name.charAt(0)}
                  </span>
                )}
                {!collapsed && (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{user.name}</span>
                      <span className="block truncate text-[11.5px] text-ink-faint">{user.role || user.email}</span>
                    </span>
                    <ChevronsUpDown size={14} className="flex-shrink-0 text-ink-faint" />
                  </>
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-[220px]">
                <DropdownMenuItem onSelect={() => router.push("/settings")}>
                  <Settings size={14} /> Settings
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    toggleThemeWithReveal(e as unknown as React.MouseEvent, toggleTheme);
                  }}
                >
                  {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
                  {theme === "light" ? "Dark mode" : "Light mode"}
                </DropdownMenuItem>
                <div className="my-1 h-px bg-line" />
                <DropdownMenuItem onSelect={handleLogout} className="data-[highlighted]:bg-bad/10 data-[highlighted]:text-bad">
                  <LogOut size={14} /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link
              href="/login"
              className={cn(
                "pressable flex h-9 items-center gap-3 rounded-[10px] text-[13.5px] text-ink-soft hover:bg-surface2 hover:text-ink",
                collapsed ? "w-10 justify-center" : "px-3"
              )}
            >
              <LogIn size={16} strokeWidth={1.75} />
              {!collapsed && "Sign in"}
            </Link>
          )}
        </div>
      </aside>

      {/* Phone tab bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-around border-t border-line bg-bg/90 px-2 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5 backdrop-blur-xl sm:hidden"
      >
        {links.slice(0, 5).map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "pressable flex min-w-[56px] flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[10.5px] font-medium",
                active ? "text-ink" : "text-ink-faint"
              )}
            >
              <Icon size={19} strokeWidth={active ? 2 : 1.75} />
              {label.split(" ")[0]}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
