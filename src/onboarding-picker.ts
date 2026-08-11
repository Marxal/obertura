// The first-run picker — one screen, three choices, and out.
//
// This replaces the old install-an-app first run (intro carousel → 5-step setup
// wizard → "add 5 lines to unlock training") with a web-visitor one: a stranger
// who lands on bitochess.com should be looking at their own saved line inside a
// minute, with no account, no code and no questionnaire.
//
// The three choices are colour, depth and style, and nothing else. Everything
// the wizard used to ask — rating, notation, theme, Lichess, import — either has
// a sane default or comes back later as a dismissible card on Train (see
// train-screen.ts's first-line cards). Tapping a style card hands a LineCut to
// the caller, which opens it in the builder (see main.ts's guided flow).
//
// Sizing note: this is built to fit a 412×915 phone without scrolling, which is
// why the copy is short and the cards are compact. The head (app mark +
// wordmark + one line), the two segmented controls and the footer are PINNED —
// only the card grid ever scrolls, so a tall board can never push the level
// chooser or "Rather start from your own games?" off the screen.
//
// A card is a board, a style tag and a name, and nothing else. It used to carry
// the move list and a one-line blurb too, which made each card tall enough that
// four of them crowded the controls out; the moves and the pitch belong in the
// builder, which is one tap away.

import {
  LEVELS,
  STYLE_LABELS,
  cutFor,
  linesFor,
  type LineCut,
  type OnboardingColour,
  type OnboardingLevel,
} from './onboarding-lines';
import { buildMiniBoard } from './board-mini';
import { segmented } from './settings-screen';
import { getAllLines } from './storage';
import { isOnboardingComplete } from './prefs';
import { pushBack } from './back-nav';

// How long the card crossfade runs. Long enough to read as a dissolve rather
// than a flicker — this is the one moment in the picker that should feel like
// something, so it's deliberately slower than a normal UI transition.
const CROSSFADE_MS = 320;

export interface PickerDeps {
  // A style card was tapped: open this cut in the builder, guided. The picker
  // has already closed itself by the time this runs — the builder replaces it.
  onPick: (cut: LineCut) => void;
  // The quiet "start from your own games" escape hatch. Handed a callback that
  // closes the picker, so it stays up behind the import sheet and only goes
  // away if the import actually happens — a cancelled import comes back here.
  onImport: (close: () => void) => void;
  // Fires once the picker is actually on screen, so the caller can drop the
  // boot splash. The picker IS the first screen on a first visit, and the splash
  // sits above everything, so this must not wait on anything else.
  onShown?: () => void;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Is this a genuine first visit? No saved lines AND onboarding never finished.
// Both halves matter: the flag alone would re-show the picker to someone who
// cleared it, and the line count alone would re-show it to someone who deleted
// their last line months later.
export async function shouldShowFirstRun(): Promise<boolean> {
  if (isOnboardingComplete()) return false;
  try {
    return (await getAllLines()).length === 0;
  } catch {
    // Storage unreadable — the app has bigger problems than onboarding, and
    // showing a first-run screen over a broken database helps nobody.
    return false;
  }
}

export function showOnboardingPicker(deps: PickerDeps): void {
  let colour: OnboardingColour = 'white';
  let level: OnboardingLevel = 'intermediate';

  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Build your first opening line');

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  };
  // The system back gesture closes the picker the same way a card tap does —
  // it just doesn't pick anything. There's nothing behind it but Train.
  const removeBack = pushBack(close);

  // ── Head: the app mark, the wordmark, and the one line of copy ──
  const head = document.createElement('div');
  head.className = 'picker-head';
  head.appendChild(appMark());

  const brand = document.createElement('div');
  brand.className = 'picker-brand';
  brand.textContent = 'bito chess';
  head.appendChild(brand);

  const lead = document.createElement('h1');
  lead.className = 'picker-lead';
  lead.textContent = 'Let’s build your first opening line.';
  head.appendChild(lead);

  overlay.appendChild(head);

  // ── The two segmented controls ──
  const controls = document.createElement('div');
  controls.className = 'picker-controls';

  controls.appendChild(segmented<OnboardingColour>(
    [
      { value: 'white', label: 'White' },
      { value: 'black', label: 'Black' },
    ],
    colour,
    (v) => { colour = v; swapCards(); },
    { fullWidth: true },
  ));

  controls.appendChild(segmented<OnboardingLevel>(
    LEVELS.map(l => ({
      value: l.value,
      label: l.label,
      sublabel: `${l.moves} moves`,
    })),
    level,
    (v) => { level = v; swapCards(); },
    { fullWidth: true },
  ));

  overlay.appendChild(controls);

  // ── The 2×2 card grid, on a stage so one layer can cross-fade over another ──
  const stage = document.createElement('div');
  stage.className = 'picker-stage';
  overlay.appendChild(stage);

  const pick = (cut: LineCut): void => { close(); deps.onPick(cut); };

  let currentLayer = buildCardLayer(colour, level, pick);
  stage.appendChild(currentLayer);

  // Replace the four cards with a crossfade: the outgoing layer is lifted out of
  // flow and faded out while the incoming one (which keeps the stage's height)
  // fades in underneath it. Reduced motion swaps outright.
  function swapCards(): void {
    const next = buildCardLayer(colour, level, pick);

    if (prefersReducedMotion()) {
      currentLayer.replaceWith(next);
      currentLayer = next;
      return;
    }

    const outgoing = currentLayer;
    outgoing.classList.add('picker-cards--out');
    next.classList.add('picker-cards--enter');
    stage.appendChild(next);
    currentLayer = next;

    // One frame with the start styles applied, then run both halves together.
    requestAnimationFrame(() => {
      outgoing.classList.add('is-gone');
      next.classList.remove('picker-cards--enter');
    });

    setTimeout(() => outgoing.remove(), CROSSFADE_MS + 40);
  }

  // ── The quiet way out ──
  const foot = document.createElement('div');
  foot.className = 'picker-foot';
  const footText = document.createElement('span');
  footText.textContent = 'Rather start from your own games? ';
  foot.appendChild(footText);
  const importLink = document.createElement('button');
  importLink.type = 'button';
  importLink.className = 'picker-import-link';
  importLink.textContent = 'Import them';
  importLink.addEventListener('click', () => deps.onImport(close));
  foot.appendChild(importLink);
  overlay.appendChild(foot);

  document.body.appendChild(overlay);
  deps.onShown?.();
}

// The real installed app icon (public/icons/icon-192.png) — the same art Android
// puts on the home screen, so the very first screen opens on the actual brand
// mark rather than a wordmark alone. Served from public/ under the app's base
// path; drawn as a rounded app tile (.picker-mark in style.css).
function appMark(): HTMLImageElement {
  const img = document.createElement('img');
  img.src = `${import.meta.env.BASE_URL}icons/icon-192.png`;
  img.width = 72;
  img.height = 72;
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  img.className = 'picker-mark';
  return img;
}

// ── One layer of four cards ──────────────────────────────────────────────────

function buildCardLayer(
  colour: OnboardingColour,
  level: OnboardingLevel,
  onPick: (cut: LineCut) => void,
): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'picker-cards';

  for (const line of linesFor(colour)) {
    grid.appendChild(styleCard(cutFor(line, level), onPick));
  }
  return grid;
}

function styleCard(cut: LineCut, onPick: (cut: LineCut) => void): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'picker-card';

  // The miniature shows the position the line ACTUALLY ends on at this level, so
  // switching level visibly changes the board, not just the move list. Oriented
  // from the user's side.
  const board = document.createElement('div');
  board.className = 'picker-card-board';
  board.appendChild(buildMiniBoard(cut.finalFen, cut.line.colour));
  card.appendChild(board);

  const body = document.createElement('div');
  body.className = 'picker-card-body';

  const style = document.createElement('span');
  style.className = 'picker-card-style';
  style.textContent = STYLE_LABELS[cut.line.style];
  body.appendChild(style);

  // The CURATED name, not the book name openings.ts resolves. The book is
  // precise to a fault — the same cut comes back as "Sicilian: Najdorf, 6.Be3 e5
  // 7.Nb3" or "French Defense: Steinitz Variation, Boleslavsky Variation", which
  // is three lines of jargon on a card meant to be chosen from in a glance. The
  // resolved name still matters, but as a data check (the self-test asserts one
  // exists at every cut), not as copy. The real name lands on the line at save
  // time, from the builder's normal naming.
  const name = document.createElement('span');
  name.className = 'picker-card-name';
  name.textContent = cut.line.name;
  body.appendChild(name);

  // A Black repertoire is an ANSWER to what White chose, and with the move list
  // gone there is nothing else on the card that says so. Two words, kept.
  if (cut.line.colour === 'black') {
    const against = document.createElement('span');
    against.className = 'picker-card-against';
    against.textContent = 'against 1.e4';
    body.appendChild(against);
  }

  card.appendChild(body);

  // The blurb and the move count left the card face, but they're still the best
  // description of what tapping it does — so they stay in the accessible name.
  card.setAttribute(
    'aria-label',
    `${STYLE_LABELS[cut.line.style]} — ${cut.line.name}, `
    + `${cut.ownMoves} moves. ${cut.line.blurb}`,
  );
  card.addEventListener('click', () => onPick(cut));
  return card;
}
