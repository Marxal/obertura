// The first-run screen — ONE question, and out.
//
// It asks which colour you want to build a line for. That is the whole screen.
//
// WHAT IT USED TO ASK, AND WHY IT DOESN'T ANY MORE. Three questions: colour,
// depth, style — and then it handed the builder a CURATED line, four openings
// deep, that somebody else had chosen. Underneath sat two more routes ("import
// my games", "build my own"), so a stranger's first screen was a small
// questionnaire with two escape hatches.
//
// Every one of those questions has the same problem: it can only be answered by
// someone who already knows what the app does. "How much to learn" is a question
// about a training schedule they have never seen. "Sharp or solid" is a question
// about openings, asked before a single piece has moved. And picking one handed
// them a finished line to look at — which is the wrong first experience for an
// app whose entire point is that the lines are YOURS.
//
// So: colour, a button, and the board. Everything else the old screen asked has
// a sane default, and the two routes it offered are still one tap away from the
// Get-started checklist on Train (import your games) and from Explore (starter
// packs) — reached later, by someone who by then knows what they are for.
//
// COLOUR HAS NO DEFAULT. It is the only question here, and a pre-picked answer
// to the only question gets tapped past without being read. So nothing is
// selected when the screen opens and the Start button is not there yet; picking
// a colour is what makes it appear. One thing to do, then one thing to press.
//
// AND SIGN IN IS A SENTENCE, NOT A BUTTON. Someone who already has an account is
// on this screen by accident (a new device, cleared storage) — so the way in has
// to exist, but it is the rarest thing anyone does here and it used to be the
// only object on screen that looked like a website button. It is a quiet line at
// the very bottom now.

import { Icons } from './icons';
import { getAllLines } from './storage';
import { isOnboardingComplete } from './prefs';
import { pushBack } from './back-nav';

export type OnboardingColour = 'white' | 'black';

// Where the brand mark points. The marketing page, not the app.
const BITO_CHESS_URL = 'https://bitochess.com';

export interface PickerDeps {
  // A colour was chosen and Start pressed: open an empty builder of that colour,
  // guided. The picker has already closed itself by the time this runs.
  onStart: (colour: OnboardingColour) => void;
  // "I already have an account" — absent in a build with no accounts (the
  // internal GitHub Pages one), where the line would be a dead end.
  onSignIn?: () => void;
  // Fires once the picker is actually on screen, so the caller can drop the
  // boot splash. The picker IS the first screen on a first visit, and the splash
  // sits above everything, so this must not wait on anything else.
  onShown?: () => void;
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
  // No default: picking IS the action this screen exists for.
  let colour: OnboardingColour | null = null;

  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay picker-overlay--slim';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Build your first opening line');

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.documentElement.classList.remove('picker-open');
    removeBack();
  };
  // The system back gesture closes the picker the same way a pick does — it just
  // doesn't pick anything. There's nothing behind it but Train.
  const removeBack = pushBack(close);

  // ── Identity, one line, at the top ──
  // The brand is a link out to the product page. A stranger who has landed on
  // the app itself has no other way back to "what is this?", and the mark in the
  // corner is where everyone looks for it.
  const bar = document.createElement('div');
  bar.className = 'picker-bar';

  const brandRow = document.createElement('a');
  brandRow.className = 'picker-brandrow';
  brandRow.href = BITO_CHESS_URL;
  brandRow.target = '_blank';
  brandRow.rel = 'noopener noreferrer';
  brandRow.setAttribute('aria-label', 'Bito Chess — about the app');
  brandRow.appendChild(appMark());
  const brand = document.createElement('span');
  brand.className = 'picker-brand';
  brand.textContent = 'bito chess';
  brandRow.appendChild(brand);
  bar.appendChild(brandRow);
  overlay.appendChild(bar);

  // ── The one question ──
  const stage = document.createElement('div');
  stage.className = 'picker-stage-slim';

  const lead = document.createElement('h1');
  lead.className = 'picker-lead';
  lead.textContent = 'Let’s build your first line.';
  stage.appendChild(lead);

  const sub = document.createElement('p');
  sub.className = 'picker-sub';
  sub.textContent = 'Which colour are you preparing for?';
  stage.appendChild(sub);

  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'btn-primary picker-start';
  start.textContent = 'Start building';
  start.hidden = true;
  start.addEventListener('click', () => {
    if (!colour) return;
    const chosen = colour;
    close();
    deps.onStart(chosen);
  });

  stage.appendChild(colourChooser((v) => {
    colour = v;
    // The button arrives with the answer, so there is only ever one thing on
    // this screen asking to be pressed.
    if (start.hidden) {
      start.hidden = false;
      start.classList.add('picker-start--in');
    }
  }));
  stage.appendChild(start);
  overlay.appendChild(stage);

  // ── The returning user's way in, at the very bottom ──
  if (deps.onSignIn) {
    const foot = document.createElement('div');
    foot.className = 'picker-foot-signin';
    const text = document.createElement('span');
    text.textContent = 'I already have an account,';
    foot.appendChild(text);
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'picker-signin-link';
    link.textContent = 'log in';
    link.addEventListener('click', () => deps.onSignIn?.());
    foot.appendChild(link);
    overlay.appendChild(foot);
  }

  document.body.appendChild(overlay);
  // Freeze the page behind the picker. The overlay is position:fixed, so the app
  // underneath keeps its own scroll height: the document grows a scrollbar the
  // picker can't use, a wheel or a swipe scrolls the Train screen behind it, and
  // the whole screen reads as a panel floating over something you're not
  // supposed to be able to move. Dropped again in close().
  document.documentElement.classList.add('picker-open');
  deps.onShown?.();
}

// The real installed app icon (public/icons/icon-192.png) — the same art Android
// puts on the home screen, so the very first screen opens on the actual brand
// mark.
function appMark(): HTMLImageElement {
  const img = document.createElement('img');
  img.src = `${import.meta.env.BASE_URL}icons/icon-192.png`;
  img.width = 28;
  img.height = 28;
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  img.className = 'picker-mark';
  return img;
}

// ── Colour ───────────────────────────────────────────────────────────────────
// Not the shared segmented control: this one wants a real white pawn on a light
// disc and a real black pawn on a dark one, which says "colour" faster than the
// words do — and is the same token the FAB's new-line rows use.

function colourChooser(onChange: (v: OnboardingColour) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'picker-colours picker-colours--lead';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Colour');

  const buttons: HTMLButtonElement[] = [];
  const reflect = (active: OnboardingColour): void => {
    for (const b of buttons) {
      const on = b.dataset.value === active;
      b.classList.toggle('picker-colour--on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };

  for (const value of ['white', 'black'] as OnboardingColour[]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'picker-colour';
    btn.dataset.value = value;
    btn.setAttribute('aria-pressed', 'false');

    const token = document.createElement('span');
    token.className = `picker-colour-token picker-colour-token--${value}`;
    token.setAttribute('aria-hidden', 'true');
    token.appendChild(Icons.pawn(26));
    btn.appendChild(token);

    const label = document.createElement('span');
    label.className = 'picker-colour-label';
    label.textContent = value === 'white' ? 'White' : 'Black';
    btn.appendChild(label);

    btn.addEventListener('click', () => { reflect(value); onChange(value); });
    buttons.push(btn);
    wrap.appendChild(btn);
  }
  return wrap;
}
