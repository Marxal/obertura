// A subtle bit of life on screen entry: a number ticks from a start value up to
// its target over about half a second, easing to a stop. Honours
// prefers-reduced-motion (and a trivial 0→0/0→1 target) by just showing the final
// value. Shared by the training hero, the puzzles hero, and the puzzle rating
// animation.
export function countUp(
  el: HTMLElement,
  to: number,
  opts: { from?: number; durationMs?: number } = {},
): void {
  const { from = 0, durationMs = 550 } = opts;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if ((to <= 1 && from === 0) || from === to || reduce) {
    el.textContent = String(to);
    return;
  }
  const start = performance.now();
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
    el.textContent = String(Math.round(from + (to - from) * eased));
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = String(to);
  };
  requestAnimationFrame(step);
}
