// A tiny pixel-pawn progress bar for the import scan (see import-panel.ts).
//
// One little 8-bit pawn marches along a track. Two modes, both driven from the
// import fetcher's onProgress (monthsDone / monthsTotal):
//
//   • DETERMINATE — when we know the total (e.g. the 1m/3m/12m ranges): the fill
//     grows to monthsDone/monthsTotal and the pawn rides its leading edge.
//   • INDETERMINATE — when the end is unknown (the "All" range, or a single
//     archive where per-month progress isn't meaningful): the pawn walks the
//     whole rail on a loop, laying a trail that resets, until we snap to 100%.
//
// The pawn is inline pixel-art SVG (blocky, crisp edges), themed in --accent.
// prefers-reduced-motion is honoured in CSS: no walking, no marching legs — just
// a calm static bar.

import { pixelPawnSvg } from './pixel-pawn';

export interface PawnProgress {
  // The element to drop into the DOM. Hidden until start().
  readonly el: HTMLElement;
  // Show the bar and begin walking (indeterminate). Call set() to switch it to a
  // proportional fill once a real total is known.
  start(): void;
  // Determinate update: fraction in 0..1. Flips the bar out of indeterminate.
  set(fraction: number): void;
  // Finished: stop walking and snap the fill (and pawn) to 100%.
  done(): void;
  // Reset and hide.
  hide(): void;
}

export function createPawnProgress(): PawnProgress {
  const el = document.createElement('div');
  el.className = 'pawn-progress';
  el.setAttribute('role', 'progressbar');
  el.setAttribute('aria-valuemin', '0');
  el.setAttribute('aria-valuemax', '100');
  el.hidden = true;

  // The pawn rides on a rail above the track so the track's overflow:hidden
  // never clips it.
  const rail = document.createElement('div');
  rail.className = 'pawn-progress-rail';
  const pawn = document.createElement('div');
  pawn.className = 'pawn-progress-pawn';
  pawn.innerHTML = pixelPawnSvg('pawn-progress-pawn-svg');
  rail.appendChild(pawn);

  const track = document.createElement('div');
  track.className = 'pawn-progress-track';
  const fill = document.createElement('div');
  fill.className = 'pawn-progress-fill';
  track.appendChild(fill);

  el.appendChild(rail);
  el.appendChild(track);

  function setPct(pct: number): void {
    const p = Math.max(0, Math.min(100, pct));
    fill.style.width = `${p}%`;
    pawn.style.left = `${p}%`;
    el.setAttribute('aria-valuenow', String(Math.round(p)));
  }

  // Clear the inline left/width so the indeterminate CSS keyframes can drive them.
  function clearInline(): void {
    fill.style.width = '';
    pawn.style.left = '';
    el.removeAttribute('aria-valuenow');
  }

  return {
    el,
    start(): void {
      el.hidden = false;
      el.classList.add('pawn-progress--indeterminate');
      clearInline();
    },
    set(fraction: number): void {
      el.classList.remove('pawn-progress--indeterminate');
      setPct(fraction * 100);
    },
    done(): void {
      el.classList.remove('pawn-progress--indeterminate');
      setPct(100);
    },
    hide(): void {
      el.hidden = true;
      el.classList.remove('pawn-progress--indeterminate');
      clearInline();
    },
  };
}

// ── Full-screen import loader ─────────────────────────────────────────────────
//
// The scan is the one real wait in the import flow, so it gets the whole screen:
// a centred pawn bar, the status line beneath it, and — for Chess.com — your
// profile picture fading in above once it's fetched. It composes the pawn bar
// above rather than reimplementing it, and sits at z-index 400 so it covers the
// import bottom-sheet (.edit-sheet, 300) while scanning.

export interface ImportLoader {
  // The full-screen overlay. Append to document.body to show; remove() to close.
  readonly el: HTMLElement;
  // Show the bar walking. Pass true for an unknown end (the "All" range).
  start(indeterminate: boolean): void;
  // Proportional fill, fraction 0..1 (flips the bar out of indeterminate).
  set(fraction: number): void;
  // The status line under the bar.
  setStatus(text: string): void;
  // Fade your picture in above the bar (Chess.com only). A broken URL is ignored.
  setAvatar(url: string): void;
  // Finished: snap the pawn home to 100%.
  done(): void;
  // Detach from the DOM.
  remove(): void;
}

export function createImportLoader(): ImportLoader {
  const el = document.createElement('div');
  el.className = 'import-loader';

  const card = document.createElement('div');
  card.className = 'import-loader-card';

  // Avatar block — hidden until setAvatar() lands a usable picture.
  const avatar = document.createElement('div');
  avatar.className = 'import-loader-avatar';
  avatar.hidden = true;

  const bar = createPawnProgress();
  bar.start(); // shown the moment the loader mounts

  const status = document.createElement('p');
  status.className = 'import-loader-status';
  status.setAttribute('aria-live', 'polite');

  card.append(avatar, bar.el, status);
  el.appendChild(card);

  return {
    el,
    start(indeterminate: boolean): void {
      bar.start();
      if (!indeterminate) bar.set(0);
    },
    set(fraction: number): void {
      bar.set(fraction);
    },
    setStatus(text: string): void {
      status.textContent = text;
    },
    setAvatar(url: string): void {
      avatar.innerHTML = '';
      avatar.hidden = false; // optimistic — the error handler hides it on failure
      // Concentric rings pulsing out from behind the picture while we fetch.
      for (let i = 0; i < 3; i++) {
        const ring = document.createElement('span');
        ring.className = 'import-loader-ring';
        avatar.appendChild(ring);
      }
      const img = document.createElement('img');
      img.className = 'import-loader-avatar-img';
      img.src = url;
      img.alt = '';
      // A broken/blocked picture just keeps the loader picture-less.
      img.addEventListener('error', () => { avatar.hidden = true; avatar.innerHTML = ''; });
      avatar.appendChild(img);
    },
    done(): void {
      bar.done();
    },
    remove(): void {
      el.remove();
    },
  };
}
