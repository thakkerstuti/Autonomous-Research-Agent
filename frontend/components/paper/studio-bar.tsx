"use client";

/**
 * The top bar of the Paper Study space (upload and reading): the wordmark,
 * a way back to the paper list, optional actions, and the theme switch.
 */
import Link from "next/link";
import { ArrowLeft, Contrast } from "lucide-react";
import { useUiStore } from "@/lib/store";
import { toggleThemeWithReveal } from "@/lib/theme-transition";

export function StudioBar({ onBack, children }: {
  /** Inside a paper: "← My papers" returns to the paper list. Without it, "My papers" opens the library. */
  onBack?: () => void;
  children?: React.ReactNode;
}) {
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  return (
    <header className="flex h-[52px] flex-shrink-0 items-center gap-6 border-b border-line bg-bg px-5 sm:px-7">
      <Link href="/dashboard" className="font-heading text-[23px] leading-none tracking-[-0.01em] text-ink" title="CogNexa home">
        cognexa
      </Link>
      {onBack ? (
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-[12.5px] text-ink-soft transition-colors hover:text-ink">
          <ArrowLeft size={13} /> My papers
        </button>
      ) : (
        <Link href="/library" className="text-[12.5px] text-ink-soft transition-colors hover:text-ink">My papers</Link>
      )}
      <span className="flex-1" />
      {children}
      <button
        type="button"
        onClick={(e) => toggleThemeWithReveal(e, toggleTheme)}
        title={theme === "light" ? "Switch to dark" : "Switch to light"}
        className="flex items-center gap-1.5 text-[12px] text-ink-soft transition-colors hover:text-ink"
      >
        {theme === "light" ? "Light" : "Dark"}
        <Contrast size={12} />
      </button>
    </header>
  );
}
