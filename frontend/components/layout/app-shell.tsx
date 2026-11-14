"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { useUiStore } from "@/lib/store";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const initTheme = useUiStore((s) => s.initTheme);

  useEffect(() => {
    initTheme();
  }, [initTheme]);

  // The landing page brings its own layout (its sticky 3D stage needs an unclipped scroll)
  if (pathname === "/") return <>{children}</>;

  // Pages that stand alone, without the app sidebar
  const isAuthPage = pathname === "/login" || pathname === "/signup";

  if (isAuthPage) {
    return (
      <main key={pathname} className="page-enter min-h-screen w-full overflow-x-hidden bg-bg text-ink">
        {children}
      </main>
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
