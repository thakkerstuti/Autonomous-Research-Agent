import { flushSync } from "react-dom";

/**
 * Toggle the theme with a circular reveal that grows from the pointer.
 * Falls back to an instant switch where View Transitions or motion aren't available.
 */
export function toggleThemeWithReveal(e: React.MouseEvent, toggle: () => void) {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { ready: Promise<void> };
  };
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!doc.startViewTransition || reduce) {
    toggle();
    return;
  }
  const el = ((e?.currentTarget as HTMLElement | null) ?? (e?.target as HTMLElement | null)) || null;
  const rect = el?.getBoundingClientRect?.();
  const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
  const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

  const vt = doc.startViewTransition(() => {
    flushSync(() => toggle());
  });
  vt.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 560, easing: "cubic-bezier(0.23, 1, 0.32, 1)", pseudoElement: "::view-transition-new(root)" }
    );
  });
}
