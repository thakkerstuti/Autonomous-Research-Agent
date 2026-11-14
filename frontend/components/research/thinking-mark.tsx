import { cn } from "@/lib/utils";

/**
 * The CogNexa mark used as the assistant's avatar.
 * While `active`, impulses travel out along the three synapses and the core breathes.
 */
export function ThinkingMark({ active = false, size = 22, className }: { active?: boolean; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={cn("flex-shrink-0 text-ink", active && "thinking-mark", className)}
    >
      <circle className="tm-ring" cx="12" cy="12" r="8" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.4" />
      <path d="M12 4v3.2M18.9 16l-2.8-1.6M5.1 16l2.8-1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle className="tm-core" cx="12" cy="12" r="3.4" fill="currentColor" />
      <circle className="tm-dot tm-dot-1" cx="12" cy="4" r="1.6" fill="currentColor" />
      <circle className="tm-dot tm-dot-2" cx="18.9" cy="16" r="1.6" fill="currentColor" />
      <circle className="tm-dot tm-dot-3" cx="5.1" cy="16" r="1.6" fill="currentColor" />
    </svg>
  );
}
