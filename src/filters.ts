// A reusable two-row filter bar for line lists (Train now; Lines/Explore later).
//
// Row 1: the colour segment (All / White / Black) and the sort menu, side by
//        side.
// Row 2: one horizontally scrollable chip row — the user's own tags first, then
//        the "vs <name>" opponent tags, then the status pills (Due / Learning /
//        Solid) at the end.
//
// Tag chips are multi-select toggles. The status pills are exclusive: tap the
// active one to clear it, so none active means "all statuses". The colour
// segment and sort are single-choice. The bar owns nothing but its own UI and
// selection state, which it persists under `config.persistKey` (one JSON entry,
// device-local) and reports through `onChange`. Filtering and sorting stay with
// the caller — this is purely the UI layer.

import { Icons } from './icons';

export type ColourFilter = 'all' | 'white' | 'black';
export type StatusFilter = 'all' | 'due' | 'learning' | 'solid';

export interface FilterSelection {
  colour: ColourFilter;
  sort: string;
  status: StatusFilter;
  tags: string[];
  group: boolean;
}

export interface FilterConfig {
  // Where the selection is remembered (one JSON entry, device-local).
  persistKey: string;
  // The sort menu options and which one leads by default. Omit (or pass an empty
  // list) on a screen that doesn't sort — the sort menu then simply isn't drawn.
  sorts?: { key: string; label: string }[];
  defaultSort?: string;
  // Chip groups, drawn left-to-right. Empty/omitted groups simply don't appear.
  userTags?: string[];
  opponentTags?: string[];
  // Optional discrete counts shown inside each tab. When provided, the colour
  // segment and the tag chips each carry a small count badge.
  colourCounts?: { all: number; white: number; black: number };
  tagCounts?: Map<string, number>;
  status?: boolean;
  // When true, draw a "group by opening" icon toggle on row 1; the caller reads
  // selection.group and renders its list grouped into families (or flat).
  group?: boolean;
  // Fired after every change, with the (already-persisted) selection.
  onChange: (sel: FilterSelection) => void;
}

export interface FilterBar {
  element: HTMLElement;
  // Live selection — read it any time (e.g. inside the caller's filter pass).
  selection: FilterSelection;
}

const COLOURS: { key: ColourFilter; label: string; pip?: 'white' | 'black' }[] = [
  { key: 'all', label: 'All' },
  { key: 'white', label: 'White', pip: 'white' },
  { key: 'black', label: 'Black', pip: 'black' },
];

const STATUSES: { key: Exclude<StatusFilter, 'all'>; label: string }[] = [
  { key: 'due', label: 'Due' },
  { key: 'learning', label: 'Learning' },
  { key: 'solid', label: 'Solid' },
];

// Read + sanitise the saved selection against the current config, so a stale tag
// (deleted opponent/tag) or an old sort key can never wedge the bar.
function loadSelection(config: FilterConfig): FilterSelection {
  const known = new Set([...(config.userTags ?? []), ...(config.opponentTags ?? [])]);
  const sorts = config.sorts ?? [];
  const sortKeys = new Set(sorts.map(s => s.key));
  let saved: Partial<FilterSelection> = {};
  try {
    const raw = localStorage.getItem(config.persistKey);
    if (raw) saved = JSON.parse(raw) as Partial<FilterSelection>;
  } catch {
    /* corrupt entry — fall back to defaults */
  }

  const colour = saved.colour === 'white' || saved.colour === 'black' ? saved.colour : 'all';
  const status =
    saved.status === 'due' || saved.status === 'learning' || saved.status === 'solid'
      ? saved.status
      : 'all';
  const fallbackSort = config.defaultSort ?? sorts[0]?.key ?? '';
  const sort = typeof saved.sort === 'string' && sortKeys.has(saved.sort) ? saved.sort : fallbackSort;
  const tags = Array.isArray(saved.tags) ? saved.tags.filter(t => known.has(t)) : [];
  const group = !!config.group && saved.group === true;

  return { colour, sort, status, tags, group };
}

function persist(config: FilterConfig, sel: FilterSelection): void {
  localStorage.setItem(config.persistKey, JSON.stringify(sel));
}

export function createFilterBar(config: FilterConfig): FilterBar {
  const selection = loadSelection(config);

  const element = document.createElement('div');
  element.className = 'fbar';

  // Persist + report after any change.
  const commit = () => {
    persist(config, selection);
    config.onChange(selection);
  };

  element.appendChild(buildTopRow(config, selection, commit));

  const chips = buildChipRow(config, selection, commit);
  if (chips) element.appendChild(chips);

  return { element, selection };
}

// ── Row 1: colour segment + sort menu ─────────────────────────────────────────

function buildTopRow(config: FilterConfig, sel: FilterSelection, commit: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'fbar-top';
  row.appendChild(buildColourSeg(config, sel, commit));
  // Sort + group ride together on the right, each an icon-only control. Either is
  // optional: a screen with no sorts / no grouping just omits that icon.
  const tools = document.createElement('div');
  tools.className = 'fbar-tools';
  if ((config.sorts ?? []).length > 0) tools.appendChild(buildSortMenu(config, sel, commit));
  if (config.group) tools.appendChild(buildGroupToggle(sel, commit));
  if (tools.childElementCount > 0) row.appendChild(tools);
  return row;
}

function buildColourSeg(config: FilterConfig, sel: FilterSelection, commit: () => void): HTMLElement {
  const seg = document.createElement('div');
  seg.className = 'dfilter-seg';
  for (const o of COLOURS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `dfilter-btn${sel.colour === o.key ? ' active' : ''}`;
    if (o.pip) {
      const pip = document.createElement('span');
      pip.className = `colour-pip colour-pip--${o.pip}`;
      pip.setAttribute('aria-hidden', 'true');
      btn.appendChild(pip);
    }
    btn.appendChild(document.createTextNode(o.label));
    if (config.colourCounts) btn.appendChild(countBadge(config.colourCounts[o.key]));
    btn.setAttribute('aria-label', o.label);
    btn.addEventListener('click', () => {
      sel.colour = o.key;
      seg.querySelectorAll('.dfilter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      commit();
    });
    seg.appendChild(btn);
  }
  return seg;
}

function buildSortMenu(config: FilterConfig, sel: FilterSelection, commit: () => void): HTMLElement {
  // Icon-only: the order glyph shows, with the native <select> laid transparently
  // over it so a tap opens the platform sort menu (and it stays accessible).
  const wrap = document.createElement('div');
  wrap.className = 'dorder dorder--icon';
  wrap.title = 'Sort';

  const icon = Icons.order(18);
  icon.classList.add('dorder-icon');
  wrap.appendChild(icon);

  const select = document.createElement('select');
  select.className = 'dorder-select dorder-select--overlay';
  select.setAttribute('aria-label', 'Sort lines');
  for (const o of config.sorts ?? []) {
    const opt = document.createElement('option');
    opt.value = o.key;
    opt.textContent = o.label;
    if (o.key === sel.sort) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    sel.sort = select.value;
    commit();
  });
  wrap.appendChild(select);

  return wrap;
}

// The "group by opening" icon toggle — sits beside sort on row 1. Active when on.
function buildGroupToggle(sel: FilterSelection, commit: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dgroup' + (sel.group ? ' active' : '');
  btn.title = 'Group by opening';
  btn.setAttribute('aria-label', 'Group by opening');
  btn.setAttribute('aria-pressed', String(sel.group));

  const icon = Icons.tree(18);
  icon.classList.add('dgroup-icon');
  btn.appendChild(icon);

  btn.addEventListener('click', () => {
    sel.group = !sel.group;
    btn.classList.toggle('active', sel.group);
    btn.setAttribute('aria-pressed', String(sel.group));
    commit();
  });
  return btn;
}

// ── Row 2: tag chips (user, then opponent) + status pills ──────────────────────

function buildChipRow(config: FilterConfig, sel: FilterSelection, commit: () => void): HTMLElement | null {
  const userTags = config.userTags ?? [];
  const opponentTags = config.opponentTags ?? [];
  const hasStatus = !!config.status;
  if (userTags.length === 0 && opponentTags.length === 0 && !hasStatus) return null;

  const row = document.createElement('div');
  row.className = 'fbar-chips';

  for (const tag of userTags) row.appendChild(buildTagChip(tag, config, sel, commit));
  for (const tag of opponentTags) row.appendChild(buildTagChip(tag, config, sel, commit));

  if (hasStatus) {
    // A hairline divider sets the status pills apart from the tags before them.
    if (userTags.length + opponentTags.length > 0) {
      const sep = document.createElement('span');
      sep.className = 'fbar-sep';
      sep.setAttribute('aria-hidden', 'true');
      row.appendChild(sep);
    }
    for (const s of STATUSES) row.appendChild(buildStatusPill(s, sel, commit));
  }

  return row;
}

// A discrete count badge that rides inside a tab/chip after its label.
function countBadge(n: number): HTMLElement {
  const b = document.createElement('span');
  b.className = 'fchip-badge';
  b.textContent = String(n);
  b.setAttribute('aria-hidden', 'true');
  return b;
}

function buildTagChip(tag: string, config: FilterConfig, sel: FilterSelection, commit: () => void): HTMLElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  const on = sel.tags.includes(tag);
  chip.className = `fchip${on ? ' active' : ''}`;
  chip.appendChild(document.createTextNode(tag));
  if (config.tagCounts) chip.appendChild(countBadge(config.tagCounts.get(tag) ?? 0));
  chip.setAttribute('aria-pressed', String(on));
  chip.addEventListener('click', () => {
    const i = sel.tags.indexOf(tag);
    const nowOn = i < 0;
    if (nowOn) sel.tags.push(tag);
    else sel.tags.splice(i, 1);
    chip.classList.toggle('active', nowOn);
    chip.setAttribute('aria-pressed', String(nowOn));
    commit();
  });
  return chip;
}

function buildStatusPill(
  s: { key: Exclude<StatusFilter, 'all'>; label: string },
  sel: FilterSelection,
  commit: () => void,
): HTMLElement {
  const pill = document.createElement('button');
  pill.type = 'button';
  const on = sel.status === s.key;
  pill.className = `fchip fchip--status${on ? ' active' : ''}`;
  pill.dataset.status = s.key;
  pill.textContent = s.label;
  pill.setAttribute('aria-pressed', String(on));
  pill.addEventListener('click', () => {
    // Exclusive: tap the active pill to clear back to "all"; otherwise switch.
    sel.status = sel.status === s.key ? 'all' : s.key;
    pill.parentElement?.querySelectorAll<HTMLElement>('.fchip--status').forEach(el => {
      const active = el.dataset.status === sel.status;
      el.classList.toggle('active', active);
      el.setAttribute('aria-pressed', String(active));
    });
    commit();
  });
  return pill;
}
