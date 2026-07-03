// A tiny pixel-pawn progress bar for the import scan (see import-panel.ts).
//
// One little 8-bit pawn marches along a track. Neither source ever reports a
// known total up front (Lichess streams one window; Chess.com's archive count
// is a moving estimate), so the fill is driven from approxScanFraction(),
// below — an asymptotic curve over gamesSoFar that always inches forward and
// never resets, so the bar reads the same way on both platforms and never
// appears to move backward.
//
// The pawn is inline pixel-art SVG (blocky, crisp edges), themed in --accent.
// prefers-reduced-motion is honoured in CSS: no walking, no marching legs — just
// a calm static bar.

import { pixelPawnSvg } from './pixel-pawn';

// ── "Did you know?" facts ticker ──────────────────────────────────────────────
//
// An import scan (your games, an opponent scout) can take a while — Chess.com and
// Lichess are slow to hand over archives. Rather than leave you staring at a bar,
// the loader types out a short fact about the app, holds it long enough to read,
// fades it, and types the next — looping the list in order. Pure JS timers driving
// a typewriter; prefers-reduced-motion swaps the typing for a plain cross-fade.

const APP_FACTS: string[] = [
  'Meanwhile, let me tell you a few things about the app.',
  'This app doesn’t store any personal data.',
  'Everything stays on your phone.',
  'No subscriptions. No cloud lock-in.',
  'All your moves stay on your phone.',
  'You can export and import your data in Settings.',
  'Sorry this is taking a while…',
  'It takes some time for Chess.com and Lichess to fetch your games.',
  'But it’s worth the wait, I promise.',
  'I recommend saving at least 10 lines.',
  'The app starts working with just 5 lines.',
  'But I’m sure you’ll save many more!',
  'I currently have around 100 lines!',
  'And I’ve even managed to remember some of them! 😄',
  'It’s so satisfying when they show up in a game!',
  'Feel free to send feedback if you like the app.',
  'And if you don’t like it, that helps me improve too.',
  'If it’s taking this long, you’ve probably played a lot! 😅',
  'You can import as many games as you want.',
  'But I recommend starting with 500.',
  'If you use the app daily, I’m sure you’ll improve.',
  'I gained 100+ rating points in my first two weeks.',
  'That’s a looooooooong wait… 😅',
  'Stay with me…',
  '“Obertura” means “Opening” in Catalan.',
  'Now you’re learning languages too! 🌍',
  'Soon you’ll be learning new openings.',
  'Or should I say, “oberturas”? 😄',
  'Grab a coffee ☕',
  'Maybe I should have mentioned that earlier…',
  'Anyway, thanks for waiting.',
  'And thanks for using Obertura.',
  'If you like it, share it with your friends.',
  'Don’t keep it a secret. 🤫',
  'They deserve to learn chess too.',
  'Otherwise, it gets boring when you’re the only one winning… 😏',
  'Just ask Magnus Carlsen. ♟️',
  'He probably doesn’t need this app.',
  'But we mere humans do. 😄',
];

const TYPE_CHAR_MS = 26;   // per code-point while typing — a calm typewriter
const FADE_MS = 220;       // cross-fade between facts

// Hold time once a fact is fully shown: enough to read, scaled to length, capped.
function readMs(text: string): number {
  return Math.min(3000, Math.max(1300, text.length * 40));
}

export interface FactsTicker {
  readonly el: HTMLElement;
  stop(): void;
}

export function createFactsTicker(): FactsTicker {
  const el = document.createElement('p');
  el.className = 'import-facts';
  el.setAttribute('aria-live', 'polite');
  const textEl = document.createElement('span');
  textEl.className = 'import-facts-text';
  const caret = document.createElement('span');
  caret.className = 'import-facts-caret';
  caret.setAttribute('aria-hidden', 'true');
  el.append(textEl, caret);

  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let idx = 0;
  let stopped = false;
  const timers: number[] = [];
  const wait = (ms: number) => new Promise<void>((res) => { timers.push(window.setTimeout(res, ms)); });

  async function run(): Promise<void> {
    while (!stopped) {
      const text = APP_FACTS[idx];
      idx = (idx + 1) % APP_FACTS.length;

      if (reduce) {
        textEl.textContent = text;
        el.classList.remove('is-out');
        await wait(readMs(text) + 600);
        if (stopped) break;
        el.classList.add('is-out');
        await wait(FADE_MS);
        continue;
      }

      // Type the fact out a code-point at a time (Array.from keeps emoji whole).
      const chars = Array.from(text);
      el.classList.remove('is-out');
      el.classList.add('is-typing');
      textEl.textContent = '';
      for (let i = 1; i <= chars.length; i++) {
        textEl.textContent = chars.slice(0, i).join('');
        await wait(TYPE_CHAR_MS);
        if (stopped) return;
      }
      el.classList.remove('is-typing');
      await wait(readMs(text));
      if (stopped) break;
      el.classList.add('is-out');
      await wait(FADE_MS);
    }
  }
  void run();

  return {
    el,
    stop(): void {
      stopped = true;
      for (const t of timers) clearTimeout(t);
    },
  };
}

// A scan never reports a known total up front (Lichess streams one window;
// Chess.com's archive count is a moving estimate), so the bar can't ever know
// "100%" until done() is called. Instead it crawls toward a soft ceiling as
// games come in — strictly monotonic (never resets, never moves backward) and
// asymptotic, so it keeps inching forward however long the scan takes.
const SCAN_FRACTION_SOFTCAP = 0.92;
const SCAN_FRACTION_K = 220;
export function approxScanFraction(gamesSoFar: number): number {
  return Math.min(SCAN_FRACTION_SOFTCAP, gamesSoFar / (gamesSoFar + SCAN_FRACTION_K));
}

export interface PawnProgress {
  // The element to drop into the DOM. Hidden until start().
  readonly el: HTMLElement;
  // Show the bar at 0% and begin tracking.
  start(): void;
  // Update: fraction in 0..1.
  set(fraction: number): void;
  // Finished: snap the fill (and pawn) to 100%.
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

  return {
    el,
    start(): void {
      el.hidden = false;
      setPct(0);
    },
    set(fraction: number): void {
      setPct(fraction * 100);
    },
    done(): void {
      setPct(100);
    },
    hide(): void {
      el.hidden = true;
      fill.style.width = '';
      pawn.style.left = '';
      el.removeAttribute('aria-valuenow');
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
  // Show the bar at 0% and begin tracking.
  start(): void;
  // Proportional fill, fraction 0..1. Always monotonic — never moves backward.
  set(fraction: number): void;
  // The status line under the bar.
  setStatus(text: string): void;
  // Fade your picture in above the bar (Chess.com only). A broken URL is ignored.
  setAvatar(url: string): void;
  // Show the pulsing rings without a picture, around an optional centre glyph
  // (used for Lichess, which has no public avatar, so there's still visible
  // activity while we scan).
  showRings(center?: Node): void;
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

  // A looping "things about the app" ticker, to fill the wait with something to
  // read. It runs from the moment the loader mounts and is stopped on remove().
  const facts = createFactsTicker();

  card.append(avatar, bar.el, status, facts.el);
  el.appendChild(card);

  // The three concentric rings that pulse out from behind the avatar block.
  function addRings(): void {
    for (let i = 0; i < 3; i++) {
      const ring = document.createElement('span');
      ring.className = 'import-loader-ring';
      avatar.appendChild(ring);
    }
  }

  return {
    el,
    start(): void {
      bar.start();
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
      addRings();
      const img = document.createElement('img');
      img.className = 'import-loader-avatar-img';
      img.src = url;
      img.alt = '';
      // A broken/blocked picture just keeps the loader picture-less.
      img.addEventListener('error', () => { avatar.hidden = true; avatar.innerHTML = ''; });
      avatar.appendChild(img);
    },
    showRings(center?: Node): void {
      avatar.innerHTML = '';
      avatar.hidden = false;
      addRings();
      const disc = document.createElement('span');
      disc.className = 'import-loader-avatar-img import-loader-glyph';
      if (center) disc.appendChild(center);
      avatar.appendChild(disc);
    },
    done(): void {
      bar.done();
    },
    remove(): void {
      facts.stop();
      el.remove();
    },
  };
}
