import { cn } from "@/lib/utils";

/** CogNexa mark: a cell with three synapses. */
export function BrandMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={cn(className)} aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.4" />
      <path d="M12 4v3.2M18.9 16l-2.8-1.6M5.1 16l2.8-1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="12" r="3.4" fill="currentColor" />
      <circle cx="12" cy="4" r="1.6" fill="currentColor" />
      <circle cx="18.9" cy="16" r="1.6" fill="currentColor" />
      <circle cx="5.1" cy="16" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-[15px] font-semibold tracking-[-0.03em]", className)}>
      CogNexa
    </span>
  );
}
