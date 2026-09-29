"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Search, BookOpen, FileBarChart, Library, History, Settings, Info, LogOut, LogIn } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { useUiStore } from "@/lib/store";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/research", label: "Research Mode", icon: Search },
  { href: "/paper-study", label: "Paper Study Mode", icon: BookOpen },
  { href: "/report", label: "Research Report", icon: FileBarChart },
  { href: "/library", label: "Paper Library", icon: Library },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAuthenticated, logout } = useUiStore();

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  return (
    <aside className="flex h-screen w-56 flex-shrink-0 flex-col gap-5 border-r border-line bg-surface p-4">
      <Link href="/dashboard" className="flex items-center gap-2 px-1">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-surface2 text-gradient font-bold">
          ✦
        </div>
        <span className="font-serif text-lg font-semibold">
          Cog<span className="text-gradient">Nexa</span>
        </span>
      </Link>

      <nav className="flex flex-col gap-1">
        {links.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                active ? "border border-line bg-surface2 text-ink font-medium" : "text-ink-soft hover:bg-surface2 hover:text-ink"
              }`}
            >
              <Icon size={15} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-3 pt-4 border-t border-line/60">
        {isAuthenticated && user ? (
          <div className="flex items-center justify-between rounded-xl border border-line/80 bg-surface2/60 p-2.5">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-full border border-line bg-surface2">
                {user.avatar ? (
                  <img src={user.avatar} alt={user.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs font-bold text-grad1">
                    {user.name.charAt(0)}
                  </div>
                )}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="truncate text-xs font-semibold text-ink">{user.name}</span>
                <span className="truncate text-[10px] text-ink-faint">{user.role || user.email}</span>
              </div>
            </div>
            <button
              onClick={handleLogout}
              title="Sign Out"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-bad/15 hover:text-bad"
            >
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className="flex items-center justify-center gap-2 rounded-xl border border-line bg-gradient-to-r from-grad1/10 to-grad2/10 px-3 py-2 text-xs font-medium text-ink hover:border-grad2/40"
          >
            <LogIn size={14} className="text-grad1" /> Sign In / Account
          </Link>
        )}

        <Dialog>
          <DialogTrigger className="flex items-center gap-2 text-xs text-ink-faint hover:text-ink-soft px-1">
            <Info size={13} /> About CogNexa
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>About CogNexa</DialogTitle>
            <DialogDescription className="mt-2 text-sm text-ink-soft">
              CogNexa investigates open questions and studies research papers using one
              shared, evidence-tracked, self-critiquing reasoning loop.
            </DialogDescription>
          </DialogContent>
        </Dialog>
      </div>
    </aside>
  );
}

