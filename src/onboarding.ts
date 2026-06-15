// The first-launch intro — four full-screen slides that pitch the app and end on
// a "start from your games" action. Shown once (a localStorage flag), and
// replayable from Settings. CSS-only animation, no libraries.
//
// Each slide leads with an icon the tab bar uses for the matching area (the app
// mark for Welcome, then the Train, Explore and Import glyphs), so the intro
// nods at where each feature lives once you're in.
//
// The final slide doesn't rebuild the import flow — its Import button opens the
// shared import panel (import-panel.ts). A successful import OR the "Skip for
// now" link both finish the intro and land the caller on Train.

import { Icons } from './icons';
import { openImportPanel } from './import-panel';
import { pushBack } from './back-nav';

const INTRO_SEEN_KEY = 'obertura.introSeen';

export function hasSeenIntro(): boolean {
  try {
    return localStorage.getItem(INTRO_SEEN_KEY) === '1';
  } catch {
    return false; // storage off — treat as unseen, the intro just won't persist
  }
}

function markIntroSeen(): void {
  try { localStorage.setItem(INTRO_SEEN_KEY, '1'); } catch { /* storage off */ }
}

// The app mark — Obertura's real installed icon (public/icons/icon-192.png), the
// same art Android puts on the home screen, so the intro opens on the actual
// brand mark instead of a stand-in. Served from public/ under the app's base
// path; rendered as a rounded app-icon tile (see .intro-mark-img in style.css).
function appMark(size = 104): HTMLImageElement {
  const img = document.createElement('img');
  img.src = `${import.meta.env.BASE_URL}icons/icon-192.png`;
  img.width = size;
  img.height = size;
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  img.className = 'intro-mark-img';
  return img;
}

interface Slide {
  icon: () => SVGSVGElement | HTMLImageElement;
  // The app mark rides its own brand colour; the menu icons take the themed
  // accent so they match the tab bar as it lights up.
  mark?: boolean;
  heading: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    icon: () => appMark(),
    mark: true,
    heading: 'Welcome to Obertura',
    body: 'Your personal opening library. Master your repertoire, analyze your play, and never forget a line.',
  },
  {
    icon: () => Icons.zap(64),
    heading: 'Build & Train',
    body: 'Play your favorite lines to save them to your repertoire, then let the algorithm help you memorize them perfectly.',
  },
  {
    icon: () => Icons.compass(64),
    heading: 'Explore & Analyze',
    body: 'Scout your opponents, consult the engine, and track your opening performance to see exactly what’s working.',
  },
  {
    icon: () => Icons.download(64),
    heading: 'Start from your games',
    body: 'Connect your Chess.com or Lichess account. Obertura shows you the openings you actually play.',
  },
];

const SWIPE_THRESHOLD = 50; // px of horizontal travel before a swipe flips a slide

interface IntroOptions {
  // Run once the intro finishes (import success OR skip). First launch points
  // this at Train; replay-from-Settings leaves it out (just closes the overlay).
  onFinish?: () => void;
}

// Build and show the intro. Always sets the seen-flag on finish, so a forced
// replay leaves it set exactly as the first run did.
export function showIntro(opts: IntroOptions = {}): void {
  let index = 0;

  const overlay = document.createElement('div');
  overlay.className = 'intro-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Welcome to Obertura');

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  };
  const removeBack = pushBack(close);

  const finish = () => {
    markIntroSeen();
    close();
    opts.onFinish?.();
  };

  // ── Sliding track ──
  const track = document.createElement('div');
  track.className = 'intro-track';

  const slideEls: HTMLElement[] = [];
  for (const slide of SLIDES) {
    const el = document.createElement('div');
    el.className = 'intro-slide';

    const badge = document.createElement('div');
    badge.className = 'intro-icon' + (slide.mark ? ' intro-icon--mark' : '');
    badge.appendChild(slide.icon());
    el.appendChild(badge);

    const text = document.createElement('div');
    text.className = 'intro-text';

    const h = document.createElement('h2');
    h.className = 'intro-heading';
    h.textContent = slide.heading;
    text.appendChild(h);

    const p = document.createElement('p');
    p.className = 'intro-body';
    p.textContent = slide.body;
    text.appendChild(p);

    el.appendChild(text);
    slideEls.push(el);
    track.appendChild(el);
  }

  // The final slide carries the action row (Import + Skip).
  const actions = document.createElement('div');
  actions.className = 'intro-actions';

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'btn-primary intro-import-btn';
  importBtn.appendChild(Icons.download(16));
  importBtn.appendChild(document.createTextNode('Import my games'));
  importBtn.addEventListener('click', () => {
    openImportPanel({ onImported: () => finish() });
  });

  const skipBtn = document.createElement('button');
  skipBtn.type = 'button';
  skipBtn.className = 'intro-skip-link';
  skipBtn.textContent = 'Skip for now';
  skipBtn.addEventListener('click', () => finish());

  actions.appendChild(importBtn);
  actions.appendChild(skipBtn);
  slideEls[slideEls.length - 1].appendChild(actions);

  // ── Footer: Back · dots · Next ──
  const footer = document.createElement('div');
  footer.className = 'intro-footer';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'intro-nav-btn intro-back';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', () => go(index - 1));

  const dots = document.createElement('div');
  dots.className = 'intro-dots';
  const dotEls: HTMLElement[] = SLIDES.map((_, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'intro-dot';
    dot.setAttribute('aria-label', `Go to slide ${i + 1}`);
    dot.addEventListener('click', () => go(i));
    dots.appendChild(dot);
    return dot;
  });

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'intro-nav-btn intro-next';
  nextBtn.textContent = 'Next';
  nextBtn.addEventListener('click', () => go(index + 1));

  footer.appendChild(backBtn);
  footer.appendChild(dots);
  footer.appendChild(nextBtn);

  overlay.appendChild(track);
  overlay.appendChild(footer);

  // ── Navigation ──
  const lastIndex = SLIDES.length - 1;
  function paint(): void {
    track.style.transform = `translateX(${-index * 100}%)`;
    slideEls.forEach((el, i) => el.classList.toggle('is-active', i === index));
    dotEls.forEach((d, i) => d.classList.toggle('is-active', i === index));
    // Back appears from slide 2; Next hides on the action slide.
    backBtn.classList.toggle('intro-hidden', index === 0);
    nextBtn.classList.toggle('intro-hidden', index === lastIndex);
  }
  function go(target: number): void {
    const clamped = Math.max(0, Math.min(lastIndex, target));
    if (clamped === index) return;
    index = clamped;
    track.style.transition = ''; // ensure the snap is animated
    paint();
  }

  // ── Swipe (live drag, snaps on release) ──
  let startX = 0;
  let dragging = false;
  track.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    dragging = true;
    track.style.transition = 'none';
  }, { passive: true });
  track.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    let dx = e.touches[0].clientX - startX;
    // At the ends there's nothing to reveal, so resist an over-swipe instead of
    // dragging blank space in: a heavily damped pull keeps the first and last
    // slides essentially centred (and it snaps back on release).
    const atStartPullingRight = index === 0 && dx > 0;
    const atEndPullingLeft = index === lastIndex && dx < 0;
    if (atStartPullingRight || atEndPullingLeft) dx *= 0.2;
    track.style.transform = `translateX(calc(${-index * 100}% + ${dx}px))`;
  }, { passive: true });
  track.addEventListener('touchend', (e) => {
    if (!dragging) return;
    dragging = false;
    track.style.transition = '';
    const dx = e.changedTouches[0].clientX - startX;
    if (dx <= -SWIPE_THRESHOLD) go(index + 1);
    else if (dx >= SWIPE_THRESHOLD) go(index - 1);
    else paint(); // snap back to the current slide
  });

  document.body.appendChild(overlay);
  paint();
}

// Show the intro only on a fresh install (flag unset). Called at boot.
export function maybeShowIntro(opts: IntroOptions = {}): void {
  if (hasSeenIntro()) return;
  showIntro(opts);
}
