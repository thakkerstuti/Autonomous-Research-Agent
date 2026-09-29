"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname === "/login" || pathname === "/signup";

  if (isAuthPage) {
    return <main className="min-h-screen w-full overflow-x-hidden bg-bg text-ink">{children}</main>;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-ink">
      <Sidebar />
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}

