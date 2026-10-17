export interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Spread n panels so 4–5 page summaries can be read together. */
export function spreadLayout(
  count: number,
  canvasW: number,
  canvasH: number,
  inset: { left?: number; right?: number; top?: number; bottom?: number } = {}
): LayoutRect[] {
  const n = Math.max(1, count);
  const cols = n <= 2 ? n : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const gap = 18;
  const padX = 28;
  const padY = 64;
  const dock = 96;
  const left = inset.left ?? 100;
  const right = inset.right ?? padX;
  const top = inset.top ?? padY;
  const bottom = inset.bottom ?? dock;
  const availW = Math.max(320, canvasW - left - right);
  const availH = Math.max(240, canvasH - top - bottom);
  const w = Math.max(240, Math.min(440, Math.floor((availW - gap * (cols - 1)) / cols)));
  const h = Math.max(190, Math.min(400, Math.floor((availH - gap * (rows - 1)) / rows)));
  const totalW = cols * w + (cols - 1) * gap;
  const startX = left + Math.max(0, Math.floor((availW - totalW) / 2));
  const totalH = rows * h + (rows - 1) * gap;
  const startY = top + Math.max(0, Math.floor((availH - totalH) / 2));

  return Array.from({ length: n }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const lastRowCount = n - row * cols;
    const rowOffset =
      lastRowCount < cols && row === rows - 1
        ? Math.floor(((cols - lastRowCount) * (w + gap)) / 2)
        : 0;
    return {
      x: startX + col * (w + gap) + rowOffset,
      y: startY + row * (h + gap),
      w,
      h,
    };
  });
}
