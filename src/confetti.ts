// A brief, tasteful confetti burst, used to celebrate completions (a finished
// line/drill, and a finished training session). The pieces fly out from the
// centre of the target element, so the target should be a positioned container
// (position: relative or similar) — the layer fills it via inset: 0.
//
// Honours prefers-reduced-motion: if the user asked for less motion, nothing is
// shown at all.

import { pixelPawnSvg } from './pixel-pawn';

const CONFETTI_COLORS = ['#c07a2a', '#2d7d3e', '#e8c14a', '#d4633f', '#5b8fb0', '#f5ede0'];

// The little pixel-pawn mascot, hopping to celebrate a finished round. Returns
// the element so the caller can place it at the top of the completion panel.
//
// Three nested elements so three independent CSS animations can run at once:
//   • .celebrate-pawn       — the one-shot drop-in entrance (and tap explosion).
//   • .celebrate-pawn-flip  — the occasional mid-air somersault.
//   • .celebrate-pawn-svg   — the constant squash-and-stretch hop.
//
// Tap it and it bursts into confetti and pops back a beat later — a small
// easter-egg reward. Unlike the confetti, the pawn always shows (it's content,
// not just sparkle); reduced-motion just stills it (handled in CSS).
export function celebratePawn(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'celebrate-pawn';
  el.setAttribute('aria-hidden', 'true');

  const flip = document.createElement('div');
  flip.className = 'celebrate-pawn-flip';
  flip.innerHTML = pixelPawnSvg('celebrate-pawn-svg');
  el.appendChild(flip);

  el.addEventListener('click', () => explodePawn(el));
  return el;
}

// Tap reward: burst confetti from the pawn, blow it apart, leave it gone for a
// beat, then pop it back. Guarded so rapid taps don't overlap.
function explodePawn(el: HTMLElement): void {
  if (el.dataset.boom) return;
  el.dataset.boom = '1';
  burstConfetti(el);
  el.classList.add('celebrate-pawn--boom');
  // Explosion (~420ms) then a short absence before it springs back.
  window.setTimeout(() => {
    el.classList.remove('celebrate-pawn--boom');
    el.classList.add('celebrate-pawn--return');
    window.setTimeout(() => {
      el.classList.remove('celebrate-pawn--return');
      delete el.dataset.boom;
    }, 520);
  }, 820);
}

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

// A gentle rain of small stars, used to mark the end of a training round (a
// lighter touch than the full confetti burst the finished session gets). Stars
// drift down from above the target and fade out. Like the burst, the target
// should be a positioned container — the layer fills it via inset: 0.
//
// Honours prefers-reduced-motion: nothing is shown when the user asked for less
// motion.

const STARFALL_COLORS = ['#e8c14a', '#f5ede0'];

export function starfall(target: HTMLElement): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const layer = document.createElement('div');
  layer.className = 'starfall-layer';
  const N = 18;
  for (let i = 0; i < N; i++) {
    const s = document.createElement('span');
    s.className = 'star';
    s.style.left = `${(Math.random() * 100).toFixed(1)}%`;
    s.style.setProperty('--drift', `${(Math.random() * 36 - 18).toFixed(0)}px`);
    s.style.setProperty('--delay', `${(Math.random() * 400).toFixed(0)}ms`);
    s.style.setProperty('--dur', `${(1000 + Math.random() * 500).toFixed(0)}ms`);
    const size = 6 + Math.random() * 2;
    s.style.width = `${size.toFixed(1)}px`;
    s.style.height = `${size.toFixed(1)}px`;
    s.style.background = STARFALL_COLORS[i % STARFALL_COLORS.length];
    layer.appendChild(s);
  }
  target.appendChild(layer);
  setTimeout(() => layer.remove(), 1600);
}
