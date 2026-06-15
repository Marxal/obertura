// A brief, tasteful confetti burst, used to celebrate completions (a finished
// line/drill, and a finished training session). The pieces fly out from the
// centre of the target element, so the target should be a positioned container
// (position: relative or similar) — the layer fills it via inset: 0.
//
// Honours prefers-reduced-motion: if the user asked for less motion, nothing is
// shown at all.

const CONFETTI_COLORS = ['#c07a2a', '#2d7d3e', '#e8c14a', '#d4633f', '#5b8fb0', '#f5ede0'];

export function burstConfetti(target: HTMLElement): void {
  // Respect users who'd rather not have motion.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  const N = 26;
  for (let i = 0; i < N; i++) {
    const p = document.createElement('span');
    p.className = 'confetti-piece';
    const angle = Math.random() * Math.PI * 2;
    const dist = 55 + Math.random() * 120;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 35; // bias upward
    p.style.setProperty('--dx', `${dx.toFixed(0)}px`);
    p.style.setProperty('--dy', `${dy.toFixed(0)}px`);
    p.style.setProperty('--rot', `${(Math.random() * 720 - 360).toFixed(0)}deg`);
    p.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    p.style.animationDelay = `${(Math.random() * 60).toFixed(0)}ms`;
    layer.appendChild(p);
  }
  target.appendChild(layer);
  setTimeout(() => layer.remove(), 1300);
}
