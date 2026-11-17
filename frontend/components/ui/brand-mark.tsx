import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * CogNexa mark, "Folio": two pages read side by side; the front page's last line ends in a point,
 * where understanding lands. Drawn in currentColor, with the text lines cut out of the page so it
 * reads on any background. Detail follows the size, as in the approved concept:
 * full (three lines and the point) from 28 px, two lines from 16 px, plain pages below that.
 */
export function BrandMark({ size = 20, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  const detail = size >= 28 ? "full" : size >= 16 ? "medium" : "small";
  const backStroke = detail === "full" ? 4 : detail === "medium" ? 5 : 7;
  const radius = detail === "small" ? 5 : 4;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={cn(className)} aria-hidden>
      <defs>
        <mask id={`folio-${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect x="22" y="16" width="30" height="40" rx={radius} fill="white" />
          {detail === "full" && (
            <>
              <path d="M28 28h18M28 36h18M28 44h10" stroke="black" strokeWidth="3" strokeLinecap="round" />
              <circle cx="44" cy="44" r="2.6" fill="black" />
            </>
          )}
          {detail === "medium" && <path d="M28 30h18M28 40h12" stroke="black" strokeWidth="4" strokeLinecap="round" />}
        </mask>
        {/* the back page is hidden behind the front one, so nothing shows through the cut-out lines */}
        <mask id={`folio-back-${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect width="64" height="64" fill="white" />
          <rect x="22" y="16" width="30" height="40" rx={radius} fill="black" />
        </mask>
      </defs>
      <rect x="12" y="8" width="30" height="40" rx={radius} stroke="currentColor" strokeWidth={backStroke} mask={`url(#folio-back-${id})`} />
      <rect x="22" y="16" width="30" height="40" rx={radius} fill="currentColor" mask={`url(#folio-${id})`} />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-[15px] font-semibold tracking-[-0.015em]", className)}>
      CogNexa
    </span>
  );
}
