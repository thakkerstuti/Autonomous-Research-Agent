"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Search, BookOpen, FileBarChart,
  Library, History, Settings, LogOut, LogIn, Sun, Moon,
  Sparkles,
} from "lucide-react";
import { useUiStore } from "@/lib/store";

const links = [
  { href: "/dashboard",   label: "Dashboard",       icon: LayoutDashboard },
  { href: "/research",    label: "Research",         icon: Search },
  { href: "/paper-study", label: "Paper Study",      icon: BookOpen },
  { href: "/report",      label: "Report",           icon: FileBarChart },
  { href: "/library",     label: "Library",          icon: Library },
  { href: "/history",     label: "History",          icon: History },
];

export function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const { user, isAuthenticated, logout, theme, toggleTheme } = useUiStore();

  const handleLogout = () => { logout(); router.push("/login"); };

  return (
    <aside
      className="flex h-screen w-[64px] flex-shrink-0 flex-col items-center gap-1 border-r border-line bg-surface/80 py-4 backdrop-blur-xl"
      style={{ zIndex: 50 }}
    >
      {/* Logo */}
      <Link
        href="/dashboard"
        className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-rose to-lavender shadow-sm"
        title="CogNexa"
      >
        <Sparkles size={18} className="text-white" />
      </Link>

      {/* Nav */}
      <nav className="flex flex-1 flex-col items-center gap-1">
        {links.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              title={label}
              aria-current={active ? "page" : undefined}
              className={`group relative flex h-10 w-10 items-center justify-center rounded-xl transition-all ${
                active
                  ? "bg-blush text-rose shadow-sm"
                  : "text-ink-faint hover:bg-surface2 hover:text-ink-soft"
              }`}
            >
              <Icon size={17} />
              {/* Tooltip */}
              <span className="pointer-events-none absolute left-[52px] z-50 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink shadow-panel opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom controls */}
      <div className="flex flex-col items-center gap-2 pt-2 border-t border-line w-full px-2">
        {/* Theme toggle */}
        <button
          id="theme-toggle-btn"
          onClick={toggleTheme}
          title={theme === "light" ? "Switch to Dark mode" : "Switch to Light mode"}
          className="group relative flex h-10 w-10 items-center justify-center rounded-xl text-ink-faint transition-all hover:bg-surface2 hover:text-ink-soft"
        >
          {theme === "light"
            ? <Moon size={16} />
            : <Sun size={16} className="text-warn" />
          }
          <span className="pointer-events-none absolute left-[52px] z-50 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink shadow-panel opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            {theme === "light" ? "Dark mode" : "Light mode"}
          </span>
        </button>

        {/* Settings */}
        <Link
          href="/settings"
          title="Settings"
          className="group relative flex h-10 w-10 items-center justify-center rounded-xl text-ink-faint transition-all hover:bg-surface2 hover:text-ink-soft"
        >
          <Settings size={16} />
          <span className="pointer-events-none absolute left-[52px] z-50 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink shadow-panel opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            Settings
          </span>
        </Link>

        {/* User avatar / login */}
        {isAuthenticated && user ? (
          <button
            onClick={handleLogout}
            title={`Sign out (${user.name})`}
            className="group relative mt-1 h-8 w-8 overflow-hidden rounded-full border-2 border-line transition-all hover:border-rose"
          >
            {user.avatar
              ? <img src={user.avatar} alt={user.name} className="h-full w-full object-cover" />
              : <div className="flex h-full w-full items-center justify-center bg-blush text-xs font-bold text-rose">{user.name.charAt(0)}</div>
            }
            <span className="pointer-events-none absolute left-[46px] z-50 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink shadow-panel opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              Sign out
            </span>
          </button>
        ) : (
          <Link
            href="/login"
            title="Sign In"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-faint hover:bg-blush hover:text-rose"
          >
            <LogIn size={16} />
          </Link>
        )}
      </div>
    </aside>
  );
}
