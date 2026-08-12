// The first-run picker — one screen, a small form, and out.
//
// This replaces the old install-an-app first run (intro carousel → 5-step setup
// wizard → "add 5 lines to unlock training") with a web-visitor one: a stranger
// who lands on bitochess.com should be looking at their own saved line inside a
// minute, with no account, no code and no questionnaire.
//
// WHAT THE SCREEN ASKS. Three things and nothing else: which colour, how deep,
// and which style. Everything the wizard used to ask — rating, notation, theme,
// Lichess, import — either has a sane default or comes back later as a row in
// the Get-started checklist. Tapping a style hands a LineCut to the caller,
// which walks the user through the builder and opens it (see main.ts's guided
// flow).
//
// IT ARRIVES IN TWO STEPS. Colour and depth first, and only once a depth has
// been chosen do the four styles appear underneath. The whole form at once was
// three fields and a button on a phone screen — a small questionnaire, which is
// exactly what this screen was built to stop being. Two of the three fields fit
// above the fold, the third arrives when it's earned, and the screen is never
// taller than the decision in front of you.
//
// Colour has a default (White, because most people play a first line as White)
// and depth deliberately does NOT: it's the choice that decides how long the
// line is, and a pre-picked answer to it gets accepted without being read.
//
// NO BOARDS. The four choices used to be cards with a miniature board on each,
// showing the position the line ends on. It was the prettiest thing in the app
// and it was the wrong thing: four boards at thumbnail size are four grids of
// beige squares to someone who hasn't played the line, they pushed the controls
// off a short screen, and they made a three-second decision look like homework.
// A style is a WORD — "solid", "sharp" — so the choice is now a word, an icon
// and the opening's name, in a 2×2 grid. The board arrives one tap later, full
// size, with the walkthrough on it.
//
// AND THE STYLE COMMITS. There was a "Start building the …" button under the
// tiles for a while, on the theory that a form's last field should behave like
// its first two. It cost every user an extra tap to confirm a choice they'd
// already made, on a screen whose whole point is speed — and the choice is
// undoable anyway: Back on the walkthrough's first bubble comes right back here.
//
// The two ways out — import your games, or start from an empty board — sit
// under a labelled "or start from" rule, so they read as alternatives rather
// than as two unexplained buttons below a primary.

import {
  LEVELS,
  STYLE_LABELS,
  cutFor,
  linesFor,
  type LineCut,
  type OnboardingColour,
  type OnboardingLevel,
  type OnboardingStyle,
} from './onboarding-lines';
import { Icons } from './icons';
import { getAllLines } from './storage';
import { isOnboardingComplete } from './prefs';
import { pushBack } from './back-nav';

// How long the style-list crossfade runs. Long enough to read as a dissolve
// rather than a flicker — this is the one moment in the picker that should feel
// like something, so it's deliberately slower than a normal UI transition.
const CROSSFADE_MS = 320;

// One glyph per style. They carry no information the label doesn't; they're
// there so the four rows scan as four distinct things rather than a list.
const STYLE_ICONS: Record<OnboardingStyle, (size?: number) => SVGElement> = {
  solid: Icons.flag,       // ground held
  sharp: Icons.zap,        // a line with teeth
  classical: Icons.star,   // the time-honoured choice
  wild: Icons.swords,      // both kings in trouble
};

export interface PickerDeps {
  // A style was tapped: open that cut in the builder, guided. The picker has
  // already closed itself by the time this runs — the builder replaces it.
  onPick: (cut: LineCut) => void;
  // "Import my games". Handed a callback that closes the picker, so it stays up
  // behind the import sheet and only goes away if the import actually happens —
  // a cancelled import comes back here.
  onImport: (close: () => void) => void;
  // "Build my own" — an empty board of the chosen colour. Closes the picker
  // itself, like a style pick does.
  onBuildOwn: (colour: OnboardingColour) => void;
  // "Sign in", top right. Absent in a build with no accounts (the internal
  // GitHub Pages one), where the button would be a dead end — so the top bar
  // simply doesn't grow it.
  onSignIn?: () => void;
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
  // No default: picking a depth is what opens the second half of the screen.
  let level: OnboardingLevel | null = null;

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
  // The system back gesture closes the picker the same way a pick does — it just
  // doesn't pick anything. There's nothing behind it but Train.
  const removeBack = pushBack(close);

  // ── Top bar: identity on the left, the returning user's way in on the right ──
  // The brand used to be a stacked, centred block — a 72px app tile over a
  // wordmark over the lead — which is three rows of chrome above the first thing
  // the user can act on. On a phone browser the URL bar takes another ~110px of
  // that budget, and the footer buttons fell off the bottom. Identity is a job
  // for one line at the top; the space it gives back goes to the lead.
  const bar = document.createElement('div');
  bar.className = 'picker-bar';

  const brandRow = document.createElement('div');
  brandRow.className = 'picker-brandrow';
  brandRow.appendChild(appMark());
  const brand = document.createElement('span');
  brand.className = 'picker-brand';
  brand.textContent = 'bito chess';
  brandRow.appendChild(brand);
  bar.appendChild(brandRow);

  // Someone who already has an account is on this screen by accident (a new
  // device, cleared storage). Without a way in they'd have to build a line
  // first, then find sign-in in Settings, to get their own repertoire back.
  if (deps.onSignIn) {
    const signIn = document.createElement('button');
    signIn.type = 'button';
    signIn.className = 'picker-signin';
    signIn.textContent = 'Sign in';
    signIn.addEventListener('click', () => deps.onSignIn?.());
    bar.appendChild(signIn);
  }

  overlay.appendChild(bar);

  const lead = document.createElement('h1');
  lead.className = 'picker-lead';
  lead.textContent = 'Let’s build your first line.';
  overlay.appendChild(lead);

  // ── One card, two fields, then four tiles ──
  const card = document.createElement('div');
  card.className = 'picker-card';
  overlay.appendChild(card);

  const form = document.createElement('div');
  form.className = 'picker-form';

  form.appendChild(field('I play as', colourChooser(colour, (v) => {
    colour = v;
    swapStyles();
  })));

  // Depth wears the same clothes as colour — two rows of the same big, tappable
  // choice — rather than the app's segmented control. They're the same KIND of
  // question, asked one after the other, and a form that changes control style
  // between two adjacent rows reads as two unrelated settings.
  form.appendChild(field('How much to learn', levelChooser((v) => {
    const first = level === null;
    level = v;
    revealStyles(first);
  })));

  card.appendChild(form);

  // ── The four styles, on a stage so one layer can cross-fade over another ──
  // Hidden until a depth is chosen, then they arrive — the second half of the
  // screen, and the last thing asked.
  const stylesBlock = document.createElement('div');
  stylesBlock.className = 'picker-styles-block';
  stylesBlock.hidden = true;

  const stylesLabel = document.createElement('div');
  stylesLabel.className = 'picker-field-label picker-styles-label';
  stylesLabel.textContent = 'Pick a style';
  stylesBlock.appendChild(stylesLabel);

  const stage = document.createElement('div');
  stage.className = 'picker-stage';
  stylesBlock.appendChild(stage);
  card.appendChild(stylesBlock);

  let currentLayer: HTMLElement | null = null;

  // A style tap IS the commit — no confirming button under it.
  const select = (style: OnboardingStyle): void => {
    const cut = cutFor2(colour, level, style);
    if (!cut) return;
    close();
    deps.onPick(cut);
  };

  // First depth pick: grow the tiles in. Later ones just swap the four openings
  // under the same four words.
  function revealStyles(first: boolean): void {
    if (!first) { swapStyles(); return; }
    stylesBlock.hidden = false;
    currentLayer = buildStyleLayer(colour, level!, select);
    stage.appendChild(currentLayer);
    if (prefersReducedMotion()) return;
    stylesBlock.classList.add('picker-styles-block--in');
    // The card just got taller than the screen on a short phone — bring the new
    // half into view rather than leaving it below the fold.
    setTimeout(() => stylesBlock.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
  }

  // Replace the four tiles with a crossfade: the outgoing layer is lifted out of
  // flow and faded out while the incoming one (which keeps the stage's height)
  // fades in underneath it. Reduced motion swaps outright.
  function swapStyles(): void {
    if (!currentLayer || level === null) return;
    const next = buildStyleLayer(colour, level, select);

    if (prefersReducedMotion()) {
      currentLayer.replaceWith(next);
      currentLayer = next;
      return;
    }

    const outgoing = currentLayer;
    outgoing.classList.add('picker-styles--out');
    next.classList.add('picker-styles--enter');
    stage.appendChild(next);
    currentLayer = next;

    // One frame with the start styles applied, then run both halves together.
    requestAnimationFrame(() => {
      outgoing.classList.add('is-gone');
      next.classList.remove('picker-styles--enter');
    });

    setTimeout(() => outgoing.remove(), CROSSFADE_MS + 40);
  }

  // ── The two ways out ──
  // Introduced, not just present: a labelled rule turns them from two mystery
  // buttons under a primary into the alternatives they are. They're quiet by
  // design — text links, not framed buttons — because they're the answer to
  // "what if none of this is me", not a third thing to weigh up.
  const or = document.createElement('div');
  or.className = 'picker-or';
  const orText = document.createElement('span');
  orText.textContent = 'or start from';
  or.appendChild(orText);
  overlay.appendChild(or);

  const foot = document.createElement('div');
  foot.className = 'picker-foot';
  foot.appendChild(footButton('Import my games', Icons.download(17), () => deps.onImport(close)));
  foot.appendChild(footButton('Build my own', Icons.plus(17), () => {
    close();
    deps.onBuildOwn(colour);
  }));
  overlay.appendChild(foot);

  document.body.appendChild(overlay);
  deps.onShown?.();
}

// The cut a tap means: this style, at the chosen colour and depth.
function cutFor2(
  colour: OnboardingColour,
  level: OnboardingLevel | null,
  style: OnboardingStyle,
): LineCut | null {
  if (!level) return null;
  const line = linesFor(colour).find(l => l.style === style);
  return line ? cutFor(line, level) : null;
}

// The real installed app icon (public/icons/icon-192.png) — the same art Android
// puts on the home screen, so the very first screen opens on the actual brand
// mark. Small and inline beside the wordmark now: at 64px centred it was the
// largest thing on a screen whose job is to get a line built.
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

// A labelled row of the form.
function field(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'picker-field';
  const lbl = document.createElement('div');
  lbl.className = 'picker-field-label';
  lbl.textContent = label;
  wrap.appendChild(lbl);
  wrap.appendChild(control);
  return wrap;
}

// ── Colour ───────────────────────────────────────────────────────────────────
// Not the shared segmented control: this one wants a real white pawn on a light
// disc and a real black pawn on a dark one, which says "colour" faster than the
// words do — and is the same token the FAB's new-line rows use.

function colourChooser(
  current: OnboardingColour,
  onChange: (v: OnboardingColour) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'picker-colours';
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

    const token = document.createElement('span');
    token.className = `picker-colour-token picker-colour-token--${value}`;
    token.setAttribute('aria-hidden', 'true');
    token.appendChild(Icons.pawn(22));
    btn.appendChild(token);

    const label = document.createElement('span');
    label.className = 'picker-colour-label';
    label.textContent = value === 'white' ? 'White' : 'Black';
    btn.appendChild(label);

    btn.addEventListener('click', () => { reflect(value); onChange(value); });
    buttons.push(btn);
    wrap.appendChild(btn);
  }
  reflect(current);
  return wrap;
}

// ── Depth ────────────────────────────────────────────────────────────────────
// The same button as colour, with the move count in the token's place: "5" over
// "moves" says what "Club player" costs you, which is the part of the choice
// that's actually being made.

function levelChooser(onChange: (v: OnboardingLevel) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'picker-colours picker-levels';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'How much to learn');

  const buttons: HTMLButtonElement[] = [];
  for (const l of LEVELS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'picker-colour picker-level';
    btn.dataset.value = l.value;
    btn.setAttribute('aria-pressed', 'false');

    const token = document.createElement('span');
    token.className = 'picker-colour-token picker-level-token';
    token.setAttribute('aria-hidden', 'true');
    token.textContent = String(l.moves);
    btn.appendChild(token);

    const label = document.createElement('span');
    label.className = 'picker-colour-label';
    label.textContent = l.label;
    btn.appendChild(label);

    btn.setAttribute('aria-label', `${l.label}, ${l.moves} moves`);
    btn.addEventListener('click', () => {
      for (const b of buttons) {
        const on = b === btn;
        b.classList.toggle('picker-colour--on', on);
        b.setAttribute('aria-pressed', String(on));
      }
      onChange(l.value);
    });
    buttons.push(btn);
    wrap.appendChild(btn);
  }
  return wrap;
}

// ── One layer of four style buttons ──────────────────────────────────────────

function buildStyleLayer(
  colour: OnboardingColour,
  level: OnboardingLevel,
  onSelect: (style: OnboardingStyle) => void,
): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'picker-styles';

  for (const line of linesFor(colour)) {
    grid.appendChild(styleTile(cutFor(line, level), onSelect));
  }
  return grid;
}

function styleTile(cut: LineCut, onSelect: (style: OnboardingStyle) => void): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `picker-style picker-style--${cut.line.style}`;
  btn.dataset.style = cut.line.style;

  const icon = document.createElement('span');
  icon.className = 'picker-style-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.appendChild(STYLE_ICONS[cut.line.style](22));
  btn.appendChild(icon);

  const style = document.createElement('span');
  style.className = 'picker-style-name';
  style.textContent = STYLE_LABELS[cut.line.style];
  btn.appendChild(style);

  // The CURATED name, not the book name openings.ts resolves. The book is
  // precise to a fault — the same cut comes back as "Sicilian: Najdorf, 6.Be3 e5
  // 7.Nb3" or "French Defense: Steinitz Variation, Boleslavsky Variation", which
  // is three lines of jargon under a word meant to be chosen in a glance. The
  // resolved name still matters, but as a data check (the self-test asserts one
  // exists at every cut), not as copy.
  const opening = document.createElement('span');
  opening.className = 'picker-style-opening';
  opening.textContent = cut.line.name;
  btn.appendChild(opening);

  // The blurb, the move count and (for Black) what the line answers don't fit a
  // tile, but they're still the best description of what it holds — so they stay
  // in the accessible name.
  btn.setAttribute(
    'aria-label',
    `${STYLE_LABELS[cut.line.style]} — ${cut.line.name}`
    + (cut.line.colour === 'black' ? ', against 1.e4' : '')
    + `, ${cut.ownMoves} moves. ${cut.line.blurb}`,
  );
  btn.addEventListener('click', () => onSelect(cut.line.style));
  return btn;
}

// ── The footer's two escape hatches ──────────────────────────────────────────

function footButton(label: string, icon: SVGElement, onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'picker-foot-btn';
  btn.appendChild(icon);
  const text = document.createElement('span');
  text.textContent = label;
  btn.appendChild(text);
  btn.addEventListener('click', onClick);
  return btn;
}
