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
// NO BOARDS. The four choices used to be cards with a miniature board on each,
// showing the position the line ends on. It was the prettiest thing in the app
// and it was the wrong thing: four boards at thumbnail size are four grids of
// beige squares to someone who hasn't played the line, they pushed the controls
// off a short screen, and they made a three-second decision look like homework.
// A style is a WORD — "solid", "sharp" — so the choice is now a word, an icon
// and the opening's name, in a 2×2 grid. The board arrives one tap later, full
// size, playing itself in.
//
// IT'S A FORM, ALL THE WAY DOWN. The style tiles SELECT; a single "Start
// building the …" button at the bottom commits, and stays disabled until
// something is chosen. Tapping a tile used to launch the builder on the spot,
// which made the last field behave unlike the two above it — colour and depth
// were changeable, style was a trapdoor.
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
import { segmented } from './settings-screen';
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
  // "Start building this line": open the selected cut in the builder, guided.
  // The picker has already closed itself by the time this runs — the builder
  // replaces it.
  onPick: (cut: LineCut) => void;
  // "Import my games". Handed a callback that closes the picker, so it stays up
  // behind the import sheet and only goes away if the import actually happens —
  // a cancelled import comes back here.
  onImport: (close: () => void) => void;
  // "Build my own line" — an empty board of the chosen colour. Closes the picker
  // itself, like a style pick does.
  onBuildOwn: (colour: OnboardingColour) => void;
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
  // The system back gesture closes the picker the same way a pick does — it just
  // doesn't pick anything. There's nothing behind it but Train.
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

  // ── The form: colour, then depth ──
  const form = document.createElement('div');
  form.className = 'picker-form';

  form.appendChild(field('I play as', colourChooser(colour, (v) => {
    colour = v;
    swapStyles();
  })));

  form.appendChild(field('How much to learn', segmented<OnboardingLevel>(
    LEVELS.map(l => ({
      value: l.value,
      label: l.label,
      sublabel: `${l.moves} moves`,
    })),
    level,
    (v) => { level = v; swapStyles(); },
    { fullWidth: true },
  )));

  overlay.appendChild(form);

  // ── The four styles, on a stage so one layer can cross-fade over another ──
  // They SELECT rather than commit. Tapping a tile used to launch the builder
  // immediately, which makes the last field of a form behave unlike the two
  // above it: you can change your mind about colour and depth, but not about the
  // style — the one choice you'd most want to compare before committing. Now all
  // three settle, and one button at the bottom does the committing.
  const stylesLabel = document.createElement('div');
  stylesLabel.className = 'picker-field-label picker-styles-label';
  stylesLabel.textContent = 'Pick a style';
  overlay.appendChild(stylesLabel);

  const stage = document.createElement('div');
  stage.className = 'picker-stage';
  overlay.appendChild(stage);

  let selected: OnboardingStyle | null = null;

  const select = (style: OnboardingStyle): void => {
    selected = style;
    reflectSelection();
  };

  function reflectSelection(): void {
    for (const tile of overlay.querySelectorAll<HTMLElement>('.picker-style')) {
      const on = tile.dataset.style === selected;
      tile.classList.toggle('picker-style--on', on);
      tile.setAttribute('aria-pressed', String(on));
    }
    start.disabled = selected === null;
    // Name the choice on the button once there is one, so the CTA confirms what
    // it's about to do rather than repeating a generic instruction.
    const cut = selectedCut();
    start.textContent = cut ? `Start building the ${cut.line.name}` : 'Start building this line';
  }

  // The cut the CTA would open: the selected style, at the current colour and
  // depth. Null while nothing is selected.
  function selectedCut(): LineCut | null {
    if (!selected) return null;
    const line = linesFor(colour).find(l => l.style === selected);
    return line ? cutFor(line, level) : null;
  }

  let currentLayer = buildStyleLayer(colour, level, select);
  stage.appendChild(currentLayer);

  // Replace the four tiles with a crossfade: the outgoing layer is lifted out of
  // flow and faded out while the incoming one (which keeps the stage's height)
  // fades in underneath it. Reduced motion swaps outright. The SELECTION rides
  // through a swap — the style is still whatever they picked, it's just a
  // different opening now, and the button's label says so.
  function swapStyles(): void {
    const next = buildStyleLayer(colour, level, select);

    if (prefersReducedMotion()) {
      currentLayer.replaceWith(next);
      currentLayer = next;
      reflectSelection();
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
    reflectSelection();
  }

  // ── Commit ──
  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'btn-primary picker-start';
  start.addEventListener('click', () => {
    const cut = selectedCut();
    if (!cut) return;
    close();
    deps.onPick(cut);
  });
  overlay.appendChild(start);

  // ── The two ways out ──
  // Introduced, not just present: a labelled rule turns them from two mystery
  // buttons under a primary into the alternatives they are.
  const or = document.createElement('div');
  or.className = 'picker-or';
  const orText = document.createElement('span');
  orText.textContent = 'or start from';
  or.appendChild(orText);
  overlay.appendChild(or);

  const foot = document.createElement('div');
  foot.className = 'picker-foot';
  foot.appendChild(footButton('My own games', Icons.download(17), () => deps.onImport(close)));
  foot.appendChild(footButton('An empty board', Icons.plus(17), () => {
    close();
    deps.onBuildOwn(colour);
  }));
  overlay.appendChild(foot);

  reflectSelection();
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
  img.width = 64;
  img.height = 64;
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
  // A selector, so it announces as one: pressed/not, rather than a link that
  // navigates.
  btn.setAttribute('aria-pressed', 'false');

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
