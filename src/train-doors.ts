// The Train screen's chrome — the four doors at the top, and the boxes below.
//
// WHY THE TAB STRIP WENT. Train used to be four tabs, each opening a pane of
// five to eight mode cards. Four panes of very different depth (the Openings
// pane is 2,500 lines of screen code, the End game one 700) were presented as
// four identical doors on one thin strip, and whichever tab you landed on you
// were still two decisions from playing anything: pick a tab, read a menu, pick
// a card.
//
// WHAT REPLACED IT. Two layers.
//
// The DOORS — all four together at the top. Each is a big card filled in its
// domain's colour, carrying that domain's live figure, and one tap starts that
// domain's flagship. Four of them in a row is the one place the app says "these
// are the four things training is", and it is what you press when you have ten
// minutes and no particular plan.
//
// The BOXES — one per domain below, washed in the same colour, each a title and
// a list. This is where you go for something specific. Two kinds of thing live
// in a box: mode CARDS, which start an exercise, and ACCORDIONS, which open a
// catalogue you pick from (the mate themes, the endgames from your games, the
// openings you have puzzles for). Nothing is nested further than that.
//
// WHAT WAS TRIED AND UNDONE, TWICE. First: all four doors at the top and every
// remaining exercise in ONE three-across tile grid banded by domain colour.
// Twenty-odd two-word tiles in five colours read as a wall. Second: each door
// moved down to head its own box, so the four were no longer together — which
// lost the one row that says what training is. The answer was both: doors
// together at the top, boxes below. Don't re-derive either.
//
// The screens keep rendering into one host each and re-rendering themselves
// alone — no session machinery moved, and it did not have to: every drill in
// this app is a `position: fixed` overlay on <body>, so a screen's host was only
// ever the thing to redraw on the way back. A host holds that domain's door AND
// its box; `display: contents` plus one `order` apiece sorts the four doors
// above the four boxes (see .train-room in style.css).

import { Icons } from './icons';

// ── The four domain colours ──────────────────────────────────────────────────
//
// One place, because five modules need them: the four screens and main.ts.
//
// These are the DOMAIN's colours and they are not the same thing as an
// exercise's accent. Several exercises own a colour that their overlay wears too
// — a Time attack run's header is gold because the thing that started it was
// gold (exercise-identity.ts) — so the cards inside a box keep their own hues.
// The domain's colour is worn by the box itself: its door, its rule, its head.
export const DOMAIN_ACCENT = {
  openings: '#3e6650',   // felt green — the app's primary; the default domain
  middlegame: '#a3492e', // ember — corrective, kin to the review reds
  tactics: '#c4741d',    // warm orange — the puzzle gold family, pushed to orange
  endgames: '#33677a',   // deep teal — the long game
} as const;

export type DomainId = keyof typeof DOMAIN_ACCENT;

// ── The box ──────────────────────────────────────────────────────────────────

/**
 * One domain's list of exercises, under a title, washed in that domain's colour.
 *
 * The DOORS are not in here. All four sit together at the top of the screen —
 * they are what you press when you have ten minutes and no particular plan, and
 * four of them in a row is the one place the app says "these are the four things
 * training is". The boxes below are for when you want something specific, and
 * each is only as tall as what its domain actually offers.
 *
 * A screen appends its own cards and accordions to the returned element.
 */
export function buildBox(domain: DomainId, title: string, info?: HTMLElement): HTMLElement {
  const box = document.createElement('section');
  box.className = 'train-box';
  box.dataset.domain = domain;
  box.style.setProperty('--domain-accent', DOMAIN_ACCENT[domain]);

  const head = document.createElement('div');
  head.className = 'train-box-head';
  const label = document.createElement('h2');
  label.className = 'train-box-title';
  label.textContent = title;
  head.appendChild(label);
  if (info) head.appendChild(info);
  box.appendChild(head);

  const body = document.createElement('div');
  body.className = 'train-box-body';
  box.appendChild(body);
  // The screens fill the body, not the box — so a box is always title-then-list
  // and no caller can accidentally put a card above the title.
  (box as HTMLElement & { body: HTMLElement }).body = body;
  return box;
}

/** The list a box's cards go into. */
export function boxBody(box: HTMLElement): HTMLElement {
  return (box as HTMLElement & { body: HTMLElement }).body;
}

// ── A collapsible row ────────────────────────────────────────────────────────

/**
 * The catalogue rows — "Mate in X", "From your games", "Based on my repertoire".
 *
 * These are not exercises with a Start button; they are LISTS you open and pick
 * from. A plain <details> is what the app already uses for the endgame themes
 * and the puzzle themes, so this is that pattern with one shape for all of them,
 * sized to sit in the same rhythm as the mode cards above it.
 */
export function buildAccordion(o: {
  icon: SVGElement;
  label: string;
  /** One line under the label, shown whether open or shut — it is what tells you whether to open it. */
  sub?: string;
  accent?: string;
  /** Filled by the caller. Kept out of the summary so a shut row costs one row. */
  body: HTMLElement;
  open?: boolean;
}): HTMLElement {
  const details = document.createElement('details');
  details.className = 'train-acc';
  if (o.accent) details.style.setProperty('--mode-accent', o.accent);
  details.open = !!o.open;

  const summary = document.createElement('summary');
  summary.className = 'train-acc-summary';

  const icon = document.createElement('span');
  icon.className = 'train-acc-icon';
  icon.appendChild(o.icon);
  summary.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'train-acc-text';
  const label = document.createElement('span');
  label.className = 'train-acc-label';
  label.textContent = o.label;
  text.appendChild(label);
  if (o.sub) {
    const sub = document.createElement('span');
    sub.className = 'train-acc-sub';
    sub.textContent = o.sub;
    text.appendChild(sub);
  }
  summary.appendChild(text);

  const chev = document.createElement('span');
  chev.className = 'train-acc-chev';
  chev.appendChild(Icons.chevronDown(18));
  summary.appendChild(chev);

  details.appendChild(summary);
  o.body.classList.add('train-acc-body');
  details.appendChild(o.body);
  return details;
}

// ── The door ─────────────────────────────────────────────────────────────────

export interface DoorOptions {
  /** The domain, which sets the colour the whole box wears. */
  domain: DomainId;
  icon: SVGElement;
  /** One word: Openings / Middlegame / Tactics / Endgames. */
  name: string;
  /** What one tap starts. One short line, no count — the count is the figure. */
  sub: string;
  /**
   * The live figure, big, on the right — "17" over "moves due". This is what
   * makes a door worth looking at twice: a name never changes, a number does.
   * Omit it and the door shows a play arrow instead, which is right for a
   * domain with nothing to count.
   */
  stat?: number | string;
  statLabel?: string;
  /** Omitted only on a door that is disabled — there is nothing to start. */
  onClick?: () => void;
  disabled?: boolean;
  /** Said under the name when greyed out, so a dead door explains itself. */
  disabledReason?: string;
}

/**
 * The big one-tap card at the head of a box.
 *
 * Deliberately NOT a bigger mode card. A mode card is pale with a coloured left
 * edge, because it sits in a list of its peers and the edge is all it needs to
 * be told apart. A door has to read as the thing you press from across the room,
 * so it is FILLED with its domain's colour — softly, as a tint over the card
 * surface rather than the flat hue, so the text contrast stays the theme's own
 * and is not something to re-check for four different backgrounds.
 */
export function buildDoor(o: DoorOptions): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'train-door' + (o.disabled ? ' train-door--disabled' : '');
  card.style.setProperty('--mode-accent', DOMAIN_ACCENT[o.domain]);
  card.disabled = !!o.disabled;

  const icon = document.createElement('span');
  icon.className = 'train-door-icon';
  icon.appendChild(o.icon);
  card.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'train-door-text';
  const name = document.createElement('span');
  name.className = 'train-door-name';
  name.textContent = o.name;
  text.appendChild(name);
  const sub = document.createElement('span');
  sub.className = 'train-door-sub';
  sub.textContent = o.disabled && o.disabledReason ? o.disabledReason : o.sub;
  text.appendChild(sub);
  card.appendChild(text);

  // The figure, or the play arrow when there is no figure. Never both: two
  // things competing for the right-hand end of a card is what made the old hero
  // blocks read as dashboards rather than as buttons.
  if (!o.disabled && o.stat !== undefined) {
    const fig = document.createElement('span');
    fig.className = 'train-door-fig';
    const num = document.createElement('span');
    num.className = 'train-door-num';
    num.textContent = String(o.stat);
    fig.appendChild(num);
    if (o.statLabel) {
      const lbl = document.createElement('span');
      lbl.className = 'train-door-fig-label';
      lbl.textContent = o.statLabel;
      fig.appendChild(lbl);
    }
    // Said once, properly, for a screen reader — the figure and its label read
    // as two loose fragments otherwise.
    fig.setAttribute('aria-label', `${o.stat} ${o.statLabel ?? ''}`.trim());
    card.appendChild(fig);
  } else if (!o.disabled) {
    const go = document.createElement('span');
    go.className = 'train-door-go';
    go.appendChild(Icons.play(18));
    card.appendChild(go);
  }

  if (!o.disabled && o.onClick) card.addEventListener('click', o.onClick);
  return card;
}

