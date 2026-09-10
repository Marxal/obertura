// The Train screen's chrome — the four doors that head the four boxes.
//
// WHY THE TAB STRIP WENT. Train used to be four tabs, each opening a pane of
// five to eight mode cards. Four panes of very different depth (the Openings
// pane is 2,500 lines of screen code, the End game one 700) were presented as
// four identical doors on one thin strip, and whichever tab you landed on you
// were still two decisions from playing anything: pick a tab, read a menu, pick
// a card.
//
// WHAT REPLACED IT. Four boxes, stacked, one per domain. Each is headed by a
// DOOR — a big coloured card that starts that domain's flagship on one tap —
// with that domain's own exercises listed underneath it in a single column, the
// same full-width mode cards they always were. So the screen is: play the
// obvious thing in one tap, or read down the box you are already in for
// something specific. No tabs, no nesting, and the grouping is visible rather
// than implied.
//
// WHAT WAS TRIED AND UNDONE. The first cut put all four doors at the top and
// every remaining exercise into ONE three-across tile grid below them, banded by
// domain colour. It read as a mess: twenty-odd tiles in five colours with
// two-word names is a wall, and the grouping the colour was supposed to carry
// did not survive contact with a phone screen. Grouping beats density.
//
// The screens keep rendering into one host each and re-rendering themselves
// alone — no session machinery moved, and it did not have to: every drill in
// this app is a `position: fixed` overlay on <body>, so a screen's host was only
// ever the thing to redraw on the way back.

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
 * One domain's container: the door, then everything that domain offers.
 *
 * The screens append their own cards to the returned element, so a box is only
 * ever as tall as its contents — a domain with nothing to offer yet (Middlegame
 * before an import) is a door and a short empty state, not a hole.
 */
export function buildBox(domain: DomainId, door: HTMLElement): HTMLElement {
  const box = document.createElement('section');
  box.className = 'train-box';
  box.dataset.domain = domain;
  box.style.setProperty('--domain-accent', DOMAIN_ACCENT[domain]);
  box.appendChild(door);
  return box;
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

// ── The heading above a box's own cards ──────────────────────────────────────

/**
 * The one row between a door and its list — "Practise", "From your games".
 * Takes the optional (i) that used to sit beside the old section titles, so the
 * sentence a card's subtitle has no room for stays one tap away.
 */
export function buildBoxHead(text: string, info?: HTMLElement): HTMLElement {
  const head = document.createElement('div');
  head.className = 'train-box-head';
  const label = document.createElement('span');
  label.className = 'train-box-head-label';
  label.textContent = text;
  head.appendChild(label);
  if (info) head.appendChild(info);
  return head;
}
