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
// AND A FOURTH (v0.14). The 2×2 tiles took nearly half a phone screen, and
// tiles and bubbles were two controls for the same four domains that did
// different things (a tile started a run, a bubble switched the list). On a
// phone they are now ONE pinned switch (main.ts, renderTrainRoom) that shrinks
// as you scroll and can be reordered by long-press (train-order.ts), and the
// door stays in its panel as the domain's Start card — the "hero". A desktop
// still shows the tiles and every box. Inside a box the cards sit in headed
// SECTIONS (boxSection), the catalogue accordions became rows that open a
// bottom sheet (buildSheetRow), and every card wears its domain's colour. The
// layout came out of a clickable preview of three directions.
//
// The screens keep rendering into one host each and re-rendering themselves
// alone — no session machinery moved, and it did not have to: every drill in
// this app is a `position: fixed` overlay on <body>, so a screen's host was only
// ever the thing to redraw on the way back. A host holds that domain's door AND
// its box; the host is one of four panels. On a phone the door stays
// there as the Start card; on a desktop main.ts lifts it into the grid of tiles
// (renderTrainRoom's placeDoor).

import { Icons } from './icons';
import { pushBack } from './back-nav';

// ── The four domain colours ──────────────────────────────────────────────────
//
// One place, because five modules need them: the four screens and main.ts.
//
// These are the DOMAIN's colours and they are not the same thing as an
// exercise's accent. Several exercises own a colour that their overlay wears too
// — a Time attack run's header is gold because the thing that started it was
// gold (exercise-identity.ts). On the Train screen itself every card wears its
// DOMAIN's colour instead (v0.14: .train-box overrides --mode-accent), so the
// switch, the Start card and the list all agree on where you are; the cards
// still carry their own accent for the overlays they open.
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
  // The (i) explains every exercise in the box, so it rides on the box title on
  // a desktop and on the FIRST section head on a phone, where the title is
  // hidden (the switch already says which domain this is). boxSection moves it.
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
  (box as BoxElement).body = body;
  (box as BoxElement).info = info;
  return box;
}

type BoxElement = HTMLElement & { body: HTMLElement; info?: HTMLElement; sections?: number };

/** The list a box's cards go into. */
export function boxBody(box: HTMLElement): HTMLElement {
  return (box as BoxElement).body;
}

/**
 * A headed group of cards inside a box — "Play your lines", "Against the
 * clock". Returns the list to append the cards to. The first section of a box
 * takes the box's (i) beside its heading; on a desktop, where the box title
 * shows, that copy is hidden and the title's own (i) is the one you see.
 */
export function boxSection(box: HTMLElement, heading: string): HTMLElement {
  const b = box as BoxElement;
  const section = document.createElement('div');
  section.className = 'train-section';

  const head = document.createElement('div');
  head.className = 'train-section-head';
  const h = document.createElement('h3');
  h.className = 'train-section-title';
  h.textContent = heading;
  head.appendChild(h);
  if (!b.sections && b.info) {
    const clone = b.info.cloneNode(true) as HTMLElement;
    // cloneNode drops listeners: hand the tap to the original.
    clone.addEventListener('click', (e) => { e.stopPropagation(); b.info?.click(); });
    head.appendChild(clone);
  }
  section.appendChild(head);
  b.sections = (b.sections ?? 0) + 1;

  const list = document.createElement('div');
  list.className = 'mode-cards';
  section.appendChild(list);
  b.body.appendChild(section);
  return list;
}

// ── A row that opens a sheet ─────────────────────────────────────────────────

/**
 * The catalogue rows — "Mate in X", "Rook endings", "Based on my repertoire".
 *
 * These are not exercises with a Start button; they are LISTS you pick from.
 * They used to be <details> accordions that opened in place, which made the
 * Tactics and Endgames boxes a different shape from the other two and pushed
 * everything under an open one off the screen. Now each is a row like any
 * mode card, and tapping it opens the list in a bottom sheet.
 *
 * The body is built by the caller, exactly as the accordion body was. Picking
 * something in it starts a drill, which is an overlay on <body>; the sheet
 * closes itself the moment one appears. If the screen repaints while the sheet
 * is open (games finished loading, a scan landed), the repaint builds this row
 * again with the same key and the open sheet takes the fresh body.
 */
export function buildSheetRow(o: {
  /** An icon, or any small element — the classics use a piece glyph. */
  icon: Element;
  label: string;
  /** One line under the label — it is what tells you whether to open it. */
  sub?: string;
  /** How many choices are inside, as the row's pill. */
  count?: number;
  accent?: string;
  /** Filled by the caller. */
  body: HTMLElement;
  /** Unique within the screen; defaults to the label. */
  key?: string;
}): HTMLElement {
  const key = o.key ?? o.label;
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'mode-card train-sheet-row';
  if (o.accent) row.style.setProperty('--mode-accent', o.accent);

  const icon = document.createElement('span');
  icon.className = 'mode-card-icon';
  icon.appendChild(o.icon);
  row.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'mode-card-text';
  const name = document.createElement('span');
  name.className = 'mode-card-name';
  name.textContent = o.label;
  text.appendChild(name);
  if (o.sub) {
    const sub = document.createElement('span');
    sub.className = 'mode-card-sub';
    sub.textContent = o.sub;
    text.appendChild(sub);
  }
  row.appendChild(text);

  if (o.count) {
    const stat = document.createElement('span');
    stat.className = 'mode-card-stat';
    stat.textContent = String(o.count);
    row.appendChild(stat);
  }
  const chev = document.createElement('span');
  chev.className = 'mode-card-chev';
  chev.setAttribute('aria-hidden', 'true');
  chev.appendChild(Icons.chevronRight(18));
  row.appendChild(chev);

  o.body.classList.add('train-sheet-body');
  row.addEventListener('click', () => openRowSheet(key, o.label, o.sub, row, o.body));
  // A repaint while this row's sheet is open: hand it the new body.
  if (openSheet?.key === key) openSheet.swap(o.body);
  return row;
}

// The one sheet a row can have open. Module state because a repaint builds new
// rows, and the new row has to find the sheet the old one opened.
let openSheet: { key: string; swap: (body: HTMLElement) => void } | null = null;

// What a drill or another layer looks like when it lands on <body>.
const LAYER = '.pt-overlay, .rmap-overlay, .picker-overlay, .dc-overlay, .edit-overlay';

function openRowSheet(key: string, title: string, sub: string | undefined, row: HTMLElement, body: HTMLElement): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet train-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  // The row's accent is the domain colour on Train; the title wears it too.
  const accent = getComputedStyle(row).getPropertyValue('--mode-accent').trim();
  if (accent) sheet.style.setProperty('--sheet-accent', accent);

  const h = document.createElement('h3');
  h.className = 'edit-sheet-title train-sheet-title';
  h.textContent = title;
  sheet.appendChild(h);
  if (sub) {
    const p = document.createElement('p');
    p.className = 'section-desc train-sheet-sub';
    p.textContent = sub;
    sheet.appendChild(p);
  }

  const holder = document.createElement('div');
  holder.className = 'train-sheet-holder';
  holder.appendChild(body);
  sheet.appendChild(holder);

  const btnRow = document.createElement('div');
  btnRow.className = 'dialog-btn-row';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'dialog-btn btn-secondary';
  done.textContent = 'Close';
  btnRow.appendChild(done);
  sheet.appendChild(btnRow);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    watch.disconnect();
    overlay.remove();
    removeBack();
    if (openSheet?.key === key) openSheet = null;
  };
  // Anything else landing on <body> — the drill a pick started, a dialog it
  // asked — means this sheet's job is done.
  const watch = new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n !== overlay && n instanceof HTMLElement && n.matches(LAYER)) { close(); return; }
      }
    }
  });
  watch.observe(document.body, { childList: true });

  const removeBack = pushBack(close);
  done.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  openSheet = { key, swap: (fresh) => holder.replaceChildren(fresh) };

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
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
   * The Start card's headline on a phone, where the switch above already says
   * the domain's name — "Today's mix", "Daily rated mix". Defaults to `sub`.
   */
  heroTitle?: string;
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
  // What the Train switch shows under this domain's name (main.ts reads these
  // off the door, so the four screens never learn the switch exists): the
  // figure with a short unit, or a padlock.
  if (o.disabled) card.dataset.locked = '1';
  else if (o.stat !== undefined) card.dataset.figure = switchFigure(o.stat, o.statLabel);
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

  // The Start card's own text — a phone only; the tile hides it (CSS). The
  // headline is what one tap starts, the detail line the figure in words and
  // the progress, and a "Start" pill says the whole card is the button.
  const hero = document.createElement('span');
  hero.className = 'train-door-hero';
  hero.setAttribute('aria-hidden', 'true');
  const heroTitle = document.createElement('span');
  heroTitle.className = 'train-door-hero-title';
  heroTitle.textContent = o.heroTitle ?? o.sub;
  hero.appendChild(heroTitle);
  const said = o.stat !== undefined && o.statLabel
    ? (o.statLabel === 'rating' ? `Rating ${o.stat}` : `${o.stat} ${o.statLabel}`)
    : '';
  const detail = o.disabled
    ? o.disabledReason ?? ''
    : [said, o.progress?.label ?? (o.heroTitle ? o.sub : '')].filter(Boolean).join(' · ');
  if (detail) {
    const d = document.createElement('span');
    d.className = 'train-door-hero-detail';
    d.textContent = detail;
    hero.appendChild(d);
  }
  card.appendChild(hero);
  if (!o.disabled) {
    const go = document.createElement('span');
    go.className = 'train-door-go';
    go.setAttribute('aria-hidden', 'true');
    go.textContent = 'Start';
    card.appendChild(go);
  }

  if (!o.disabled && o.onClick) card.addEventListener('click', o.onClick);
  return card;
}

// The figure under a domain's name in the Train switch: a rating bare, a count
// with the shortest unit that still says what it counts.
function switchFigure(stat: number | string, label?: string): string {
  if (!label || label === 'rating') return String(stat);
  if (label.includes('due')) return `${stat} due`;
  return `${stat} ${label}`;
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
