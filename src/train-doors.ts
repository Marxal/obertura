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
// AND A THIRD STEP (v0.12). Doors together, all four boxes stacked below, was
// ~25 cards in one phone scroll. The doors are now "level" tiles in a 2×2 grid
// (the icon in a progress ring, the figure a badge), and under them bubbles
// pick which box shows, swiped one at a time on a phone (a desktop shows all
// four). This is not the old tab strip back: that one hid the doors too. The
// look came out of a three-option preview; see .train-room.
//
// The screens keep rendering into one host each and re-rendering themselves
// alone — no session machinery moved, and it did not have to: every drill in
// this app is a `position: fixed` overlay on <body>, so a screen's host was only
// ever the thing to redraw on the way back. A host holds that domain's door AND
// its box; the host is a panel in the swipe track and main.ts lifts the door
// into the grid of tiles (renderTrainRoom).

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
   * Omit it and the ring has no badge, which is right for a domain with
   * nothing to count. Only the number is drawn; the label is spoken.
   */
  stat?: number | string;
  statLabel?: string;
  /** Omitted only on a door that is disabled — there is nothing to start. */
  onClick?: () => void;
  disabled?: boolean;
  /** Said under the name when greyed out, so a dead door explains itself. */
  disabledReason?: string;
  /**
   * How far along this domain is: the ring round the icon fills with it, and
   * the label sits under the name — lines mastered, mistakes fixed, the way to
   * the next hundred of a rating. The figure says what is waiting; this says
   * what you have built.
   */
  progress?: { value: number; max: number; label: string };
}

/**
 * The big one-tap card — a "level" tile (v0.12, option C of the preview).
 *
 * The icon sits in a solid circle inside a RING that fills with the domain's
 * progress; the live figure is a small badge on the ring, like a notification
 * count, and the progress in words sits under the name. It replaced a tile
 * with a coloured left stripe, a display-size figure and a big icon chip,
 * which read as crowded at two to a row. Centred, one short line under the
 * name — the words are written to fit, so nothing is ever clipped with "…".
 */
export function buildDoor(o: DoorOptions): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'train-door' + (o.disabled ? ' train-door--disabled' : '');
  card.dataset.domain = o.domain;
  card.style.setProperty('--mode-accent', DOMAIN_ACCENT[o.domain]);
  // A greyed door is NOT a disabled button: tapping it opens its domain's box,
  // which is where the thing it is waiting for lives (the import form, the
  // first line to save). The room owns that — see the Train room in main.ts.
  // Not aria-disabled either, since it does do something; the reason under its
  // name is what it announces.

  const share = o.progress && o.progress.max > 0
    ? Math.max(0, Math.min(1, o.progress.value / o.progress.max))
    : 0;

  const ring = document.createElement('span');
  ring.className = 'train-door-ring';
  ring.appendChild(progressRing(share));
  const icon = document.createElement('span');
  icon.className = 'train-door-icon';
  icon.appendChild(o.icon);
  ring.appendChild(icon);

  // The badge: the live figure, or a padlock on a locked door. Nothing at all
  // on an open door with nothing to count — the tile itself is the button.
  if (o.disabled) {
    const lock = document.createElement('span');
    lock.className = 'train-door-badge train-door-badge--lock';
    lock.appendChild(Icons.lock(11));
    ring.appendChild(lock);
  } else if (o.stat !== undefined) {
    const badge = document.createElement('span');
    badge.className = 'train-door-badge';
    badge.textContent = String(o.stat);
    // The unit is not drawn (a badge has no room for "moves due"), so it is
    // said here for a screen reader and in the tooltip for a mouse.
    const said = `${o.stat} ${o.statLabel ?? ''}`.trim();
    badge.setAttribute('aria-label', said);
    badge.title = said;
    ring.appendChild(badge);
  }
  card.appendChild(ring);

  const name = document.createElement('span');
  name.className = 'train-door-name';
  name.textContent = o.name;
  card.appendChild(name);

  const sub = document.createElement('span');
  sub.className = 'train-door-sub';
  sub.textContent = o.disabled && o.disabledReason ? o.disabledReason : o.sub;
  card.appendChild(sub);

  if (!o.disabled && o.progress) {
    const prog = document.createElement('span');
    prog.className = 'train-door-progress';
    prog.textContent = o.progress.label;
    card.appendChild(prog);
  }

  if (!o.disabled && o.onClick) card.addEventListener('click', o.onClick);
  return card;
}

// The ring round the icon: a faint full track and the progress arc over it,
// starting at twelve o'clock. Stroke colours come from CSS (--mode-accent).
const RING_R = 29;
const RING_C = 2 * Math.PI * RING_R;

function progressRing(share: number): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('class', 'train-door-ring-svg');
  svg.setAttribute('aria-hidden', 'true');
  const track = document.createElementNS(NS, 'circle');
  track.setAttribute('class', 'train-door-ring-track');
  const arc = document.createElementNS(NS, 'circle');
  arc.setAttribute('class', 'train-door-ring-arc');
  for (const c of [track, arc]) {
    c.setAttribute('cx', '32');
    c.setAttribute('cy', '32');
    c.setAttribute('r', String(RING_R));
    c.setAttribute('fill', 'none');
  }
  arc.setAttribute('stroke-dasharray', String(RING_C));
  arc.setAttribute('stroke-dashoffset', String(RING_C * (1 - share)));
  if (share <= 0) arc.setAttribute('visibility', 'hidden');
  svg.append(track, arc);
  return svg;
}
