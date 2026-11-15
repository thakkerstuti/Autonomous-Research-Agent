/**
 * Small pieces of reader state shared with the workspace without importing the
 * reader itself (which pulls in pdf.js and only runs in the browser).
 */

/** The scale each panel is currently drawn at, so zoom in/out (toolbar or assistant) steps from what's on screen. */
export const renderedScale = new Map<string, number>();

/** Keyboard shortcuts never fire while the reader is typing. */
export function isTyping(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}
