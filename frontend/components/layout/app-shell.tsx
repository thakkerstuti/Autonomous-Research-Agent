"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./sidebar";
import { useUiStore } from "@/lib/store";
import { bootstrapSession, safeNext } from "@/lib/auth";
import { BrandMark } from "@/components/ui/brand-mark";

// Pages anyone may open. Everything else needs a signed-in user.
const PUBLIC_PATHS = new Set(["/", "/login", "/signup", "/reset-password"]);
const AUTH_PAGES = new Set(["/login", "/signup"]);

function SessionCheck() {
  return (
    <div className="flex h-[100dvh] items-center justify-center bg-bg text-ink-faint" role="status" aria-live="polite">
      <span className="flex items-center gap-2.5 text-[13.5px]">
        <BrandMark size={18} className="animate-pulse" />
        Checking your session…
      </span>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const initTheme = useUiStore((s) => s.initTheme);
  const authStatus = useUiStore((s) => s.authStatus);

  const isPublic = PUBLIC_PATHS.has(pathname);
  const isAuthPage = AUTH_PAGES.has(pathname);

  useEffect(() => {
    initTheme();
    bootstrapSession();
  }, [initTheme]);

  useEffect(() => {
    if (authStatus === "anonymous" && !isPublic) {
      const here = window.location.pathname + window.location.search;
      router.replace(`/login?next=${encodeURIComponent(here)}`);
    }
    if (authStatus === "authenticated" && isAuthPage) {
      router.replace(safeNext(new URLSearchParams(window.location.search).get("next")));
    }
  }, [authStatus, isPublic, isAuthPage, router]);

  // The landing page brings its own layout (its sticky 3D stage needs an unclipped scroll)
  if (pathname === "/") return <>{children}</>;

  // Pages that stand alone, without the app sidebar
  if (isPublic) {
    return (
      <main key={pathname} className="page-enter min-h-screen w-full overflow-x-hidden bg-bg text-ink">
        {children}
      </main>
    );
  }

  // Protected pages render only for a verified session; the API enforces it too
  if (authStatus !== "authenticated") return <SessionCheck />;

  // Paper Study is a focused reading space: its own top bar and palette, no app sidebar
  if (pathname === "/paper-study") {
    return (
      <div key={pathname} className="studio page-enter h-[100dvh] overflow-hidden">
        {children}
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-bg text-ink">
      <Sidebar />
      <main className="relative min-w-0 flex-1 overflow-hidden pb-[64px] sm:pb-0">
        {/* Keyed by route so each page settles in once on navigation */}
        <div key={pathname} className="page-enter h-full">
          {children}
        </div>
      </main>
    </div>
  );
}
