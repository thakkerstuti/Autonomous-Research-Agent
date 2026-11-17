import { useId } from "react";
import { cn } from "@/lib/utils";
import "./thinking-mark.css";

/**
 * The assistant's avatar and working indicator, in the CogNexa "Folio" style (see BrandMark).
 * At rest it is the mark. While `active`:
 * - from 16 px, the front page's lines write themselves in and the point lands in the accent colour;
 * - below 16 px (spinners in buttons), the front page lifts and settles like a page being turned.
 * Lines are cut out of the page, so it reads on any background, in currentColor.
 */
export function ThinkingMark({ active = false, size = 22, className }: { active?: boolean; size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  const lined = size >= 16;
  const r = lined ? 4 : 5;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden
      className={cn("flex-shrink-0 overflow-visible text-ink", active && "fm-active", className)}
    >
      {lined ? (
        <>
          <defs>
            <mask id={`fm-${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
              <rect x="22" y="16" width="30" height="40" rx={r} fill="white" />
              <path className="fm-line" d="M28 30h18" stroke="black" strokeWidth="4" strokeLinecap="round" />
              <path className="fm-line fm-line-2" d="M28 40h9" stroke="black" strokeWidth="4" strokeLinecap="round" />
              <circle cx="45" cy="40" r="2.8" fill="black" />
            </mask>
            <mask id={`fm-back-${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
              <rect width="64" height="64" fill="white" />
              <rect x="22" y="16" width="30" height="40" rx={r} fill="black" />
            </mask>
          </defs>
          <rect x="12" y="8" width="30" height="40" rx={r} stroke="currentColor" strokeWidth="5" mask={`url(#fm-back-${id})`} />
          <rect x="22" y="16" width="30" height="40" rx={r} fill="currentColor" mask={`url(#fm-${id})`} />
          {/* the point, lit in the accent colour as each pass of writing lands (only while working) */}
          {active && <circle className="fm-point" cx="45" cy="40" r="2.8" fill="rgb(var(--accent))" />}
        </>
      ) : (
        <>
          <rect className="fm-back" x="12" y="8" width="30" height="40" rx={r} stroke="currentColor" strokeWidth="7" />
          <rect className="fm-front" x="22" y="16" width="30" height="40" rx={r} fill="currentColor" />
        </>
      )}
    </svg>
  );
}
