// The Train screen's chrome — the four doors, the tile grid under them, and the
// collapsible readouts at the bottom.
//
// WHY THE TAB STRIP WENT. Train used to be four tabs, each opening a pane of
// five to eight mode cards. Four panes of very different depth (the Openings
// pane is 2,500 lines of screen code, the End game one 700) were presented as
// four identical doors on one thin strip, and whichever tab you landed on you
// were still two decisions from playing anything: pick a tab, read a menu, pick
// a card.
//
// So the four flagships — the ones each pane already fronted with a hero — come
// up onto four big cards that START a session on one tap. Everything else in the
// app goes into one flat grid of compact tiles below them, in domain order, with
// the domain's colour on each tile's top edge so the grid bands by colour
// without costing a single row of headers. Nothing is nested and nothing is
// hidden: the whole training offer is one screen and one short scroll.
//
// HOW THE FOUR SCREENS SHARE IT. Each domain is still handed ONE host and still
// renders into it — same signature, same data, same self-re-render. None of the
// session machinery moved, and it did not have to: every drill in this app is a
// `position: fixed` overlay on <body>, so a screen's host was only ever the
// thing to redraw on the way back.
//
// What produces three grouped bands out of four separate hosts is two lines of
// CSS rather than any plumbing. Each host is `display: contents`, so its
// children become items of the shared `.train-room` grid; and each kind of child
// carries an `order`, so all four doors sort above every tile, which sort above
// every readout. A domain re-rendering itself replaces only its own children,
// and they land back in the right band because the band is a class, not a
// position in the DOM.
//
// See ".train-room" in style.css for the other half of this.

import { Icons } from './icons';

// ── The four domain colours ──────────────────────────────────────────────────
//
// One place, because five modules need them: the four screens and main.ts.
//
// These are the DOMAIN's colours, and they are not the same thing as an
// exercise's own accent. Several exercises own a colour that their overlay
// wears too — a Time attack run's header is gold because the thing that started
// it was gold (exercise-identity.ts) — and breaking that link to make the grid
// tidy would cost more than it bought. So a tile carries both: the exercise's
// colour on its icon and its number, the domain's on its top edge. The band
// reads as one group at arm's length; up close each tile is still itself.
export const DOMAIN_ACCENT = {
  openings: '#3e6650',   // felt green — the app's primary; the default domain
  middlegame: '#a3492e', // ember — corrective, kin to the review reds
  tactics: '#c4741d',    // warm orange — the puzzle gold family, pushed to orange
  endgames: '#33677a',   // deep teal — the long game
} as const;

// ── The door ─────────────────────────────────────────────────────────────────

export interface DoorOptions {
  accent: string;
  icon: SVGElement;
  /** The domain, one word: Openings / Middlegame / Tactics / Endgames. */
  name: string;
  /** What one tap starts, plus the live count. One short line. */
  sub: string;
  /** Omitted only on a door that is disabled — there is nothing to start. */
  onClick?: () => void;
  disabled?: boolean;
  /** Said under the name when greyed out, so a dead door explains itself. */
  disabledReason?: string;
}

/**
 * One of the four. Deliberately NOT a mode card with bigger padding: a door
 * carries the domain's name alone (no mode name, no stat badge) because the
 * thing it starts is the domain's obvious default, and a badge would invite
 * reading rather than tapping. The count lives in the subtitle, where it reads
 * as part of the sentence.
 */
export function buildDoor(o: DoorOptions): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'train-door' + (o.disabled ? ' train-door--disabled' : '');
  card.style.setProperty('--mode-accent', o.accent);
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

  // The play chevron. Its only job is to say "this starts something" — which is
  // the one thing a door has to promise that a menu card doesn't.
  const go = document.createElement('span');
  go.className = 'train-door-go';
  go.appendChild(Icons.play(18));
  card.appendChild(go);

  if (!o.disabled && o.onClick) card.addEventListener('click', o.onClick);
  return card;
}

// ── The tiles ────────────────────────────────────────────────────────────────

export interface TileOptions {
  accent: string;
  icon: SVGElement;
  /**
   * SHORT. Two words at most — the grid is three columns on a phone and a name
   * that wraps to three lines breaks the row's rhythm. "Missed moves", not
   * "Review missed moves"; the long form lives in the (i) sheet, which every
   * one of these sections already has.
   */
  name: string;
  /** A live number, or a short string like "best 21". Omitted when there's none. */
  stat?: number | string;
  /**
   * The DOMAIN's colour, for the tile's top edge — what makes six tiles read as
   * one group. Falls back to `accent` for a domain whose exercises have no
   * colours of their own.
   */
  domainAccent?: string;
  onClick: () => void;
  disabled?: boolean;
  /** Shown as the tile's title attribute — there is no room for it in the tile. */
  disabledReason?: string;
}

export function buildTile(o: TileOptions): HTMLElement {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'train-tile' + (o.disabled ? ' train-tile--disabled' : '');
  tile.style.setProperty('--mode-accent', o.accent);
  tile.style.setProperty('--domain-accent', o.domainAccent ?? o.accent);
  tile.disabled = !!o.disabled;
  // A tile has no room for the "why is this greyed out" line a mode card gets,
  // so the reason rides on the accessible name instead of being lost.
  if (o.disabled && o.disabledReason) {
    tile.title = o.disabledReason;
    tile.setAttribute('aria-label', `${o.name} — ${o.disabledReason}`);
  }

  const icon = document.createElement('span');
  icon.className = 'train-tile-icon';
  icon.appendChild(o.icon);
  tile.appendChild(icon);

  const name = document.createElement('span');
  name.className = 'train-tile-name';
  name.textContent = o.name;
  tile.appendChild(name);

  // No count-up animation here, unlike the mode cards. Nineteen tiles counting
  // up from zero at once is a slot machine, not a screen.
  const stat = document.createElement('span');
  stat.className = 'train-tile-stat';
  stat.textContent = o.stat === undefined ? '' : String(o.stat);
  tile.appendChild(stat);

  if (!o.disabled) tile.addEventListener('click', o.onClick);
  return tile;
}

// ── The readouts ─────────────────────────────────────────────────────────────

// Which extras sections are open. Module-level so the state survives the many
// re-renders a training session causes on the way back to this screen — the same
// discipline as My Lines' expanded opening families.
const openExtras = new Set<string>();

export interface ExtrasOptions {
  /** Stable key for the open/closed memory. The domain name does fine. */
  id: string;
  accent: string;
  icon: SVGElement;
  name: string;
  /** What's inside, in a few words — this is what makes it worth opening. */
  sub: string;
  /** The readouts themselves. An empty list renders nothing at all. */
  body: HTMLElement[];
}

/**
 * A domain's readouts, collapsed.
 *
 * WHY THESE COLLAPSE WHEN THE TILES DON'T. A tile is something you start; a
 * readout is something you read. Nineteen tiles are a menu and belong open,
 * because choosing is the job. But four heroes, two accordions, a carousel and a
 * fixed-spot list stacked open underneath them would make Train the longest
 * screen in the app — longer than the one tab everyone already found crowded.
 * Collapsed they cost one row each, and the row says what's inside.
 */
export function buildExtras(o: ExtrasOptions): HTMLElement | null {
  if (o.body.length === 0) return null;

  const section = document.createElement('section');
  section.className = 'train-extras';
  section.style.setProperty('--mode-accent', o.accent);

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'train-extras-head';

  const icon = document.createElement('span');
  icon.className = 'train-extras-icon';
  icon.appendChild(o.icon);
  head.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'train-extras-text';
  const name = document.createElement('span');
  name.className = 'train-extras-name';
  name.textContent = o.name;
  const sub = document.createElement('span');
  sub.className = 'train-extras-sub';
  sub.textContent = o.sub;
  text.append(name, sub);
  head.appendChild(text);

  const chev = document.createElement('span');
  chev.className = 'train-extras-chev';
  chev.appendChild(Icons.chevronDown(18));
  head.appendChild(chev);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'train-extras-body';
  for (const el of o.body) bodyEl.appendChild(el);

  const apply = (open: boolean): void => {
    bodyEl.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
    section.classList.toggle('train-extras--open', open);
  };
  apply(openExtras.has(o.id));

  head.addEventListener('click', () => {
    const open = !openExtras.has(o.id);
    if (open) openExtras.add(o.id);
    else openExtras.delete(o.id);
    apply(open);
  });

  section.append(head, bodyEl);
  // Registered so a tile elsewhere in the room can open this drawer and jump to
  // one block inside it — see openExtrasAt. Overwriting on every render is
  // right: the newest section is the one in the document.
  extrasIndex.set(o.id, { open: () => apply(true), section });
  return section;
}

// The drawers currently in the document, by id.
const extrasIndex = new Map<string, { open: () => void; section: HTMLElement }>();

/**
 * Open a domain's readouts drawer and scroll one block inside it into view.
 *
 * This is for the handful of tiles whose "mode" is really a LIST to choose from
 * — the endgame classics, the endgames found in your games. They have a board
 * and a best time each, so a tile that launched one would be launching at
 * random; what the tile can honestly do is take you to the list. Rather than
 * duplicate that list in a sheet, the tile opens the drawer that already holds
 * it.
 */
export function openExtrasAt(id: string, anchorClass: string): void {
  const entry = extrasIndex.get(id);
  if (!entry) return;
  entry.open();
  openExtras.add(id);
  const target = entry.section.querySelector<HTMLElement>(`.${anchorClass}`) ?? entry.section;
  // After the drawer has been un-hidden, so the target has a layout box to
  // scroll to.
  requestAnimationFrame(() => {
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
}

// ── Section headings ─────────────────────────────────────────────────────────

/** The one label above the tile grid, and the one above the readouts. */
export function buildRegionLabel(text: string): HTMLElement {
  const el = document.createElement('h2');
  el.className = 'train-region-label';
  el.textContent = text;
  return el;
}
