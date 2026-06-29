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
// 'all' means "no status selected"; any other key is one of the configured
// status options (the line statuses by default, or e.g. won/lost/drew for games).
export type StatusFilter = string;

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
  statusCounts?: Record<string, number>;
  // When the chip counts depend on which colour is selected (e.g. a tag that
  // only ever appears on Black lines), pass this instead of/alongside the
  // static counts above. Whatever it returns for the active colour decides
  // which chips are shown at all — a chip whose count is 0 hides outright,
  // so the bar never offers a tab that would land on an empty list.
  countsForColour?: (colour: ColourFilter) => {
    tagCounts?: Map<string, number>;
    statusCounts?: Record<string, number>;
  };
  status?: boolean;
  // The exclusive status pills to draw (defaults to the line statuses). A games
  // list passes its own, e.g. Won / Lost / Drew.
  statusOptions?: { key: string; label: string }[];
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

// Default status pills (line lists). Games override these via config.statusOptions.
const STATUSES: { key: string; label: string }[] = [
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
  const statusKeys = new Set((config.statusOptions ?? STATUSES).map(s => s.key));
  const status = typeof saved.status === 'string' && statusKeys.has(saved.status) ? saved.status : 'all';
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

  let refreshChips: (() => void) | null = null;

  // Persist + report after any change, then re-evaluate which chips should be
  // visible (the colour filter may have just changed, and counts can depend on
  // it — see countsForColour).
  const commit = () => {
    persist(config, selection);
    config.onChange(selection);
    refreshChips?.();
  };

  element.appendChild(buildTopRow(config, selection, commit));

  const chips = buildChipRow(config, selection, commit);
  if (chips) {
    element.appendChild(chips.element);
    refreshChips = chips.refresh;
    chips.refresh(); // hide any already-empty chip for the restored selection
  }

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

interface ChipRow {
  element: HTMLElement;
  refresh: () => void;
}

function buildChipRow(config: FilterConfig, sel: FilterSelection, commit: () => void): ChipRow | null {
  const userTags = config.userTags ?? [];
  const opponentTags = config.opponentTags ?? [];
  const hasStatus = !!config.status;
  if (userTags.length === 0 && opponentTags.length === 0 && !hasStatus) return null;

  const row = document.createElement('div');
  row.className = 'fbar-chips';

  const tagChips: { tag: string; el: HTMLElement }[] = [];
  for (const tag of userTags) {
    const el = buildTagChip(tag, config, sel, commit);
    tagChips.push({ tag, el });
    row.appendChild(el);
  }
  for (const tag of opponentTags) {
    const el = buildTagChip(tag, config, sel, commit);
    tagChips.push({ tag, el });
    row.appendChild(el);
  }

  let sep: HTMLElement | null = null;
  const statusPills: { key: string; el: HTMLElement }[] = [];
  if (hasStatus) {
    // A hairline divider sets the status pills apart from the tags before them.
    if (userTags.length + opponentTags.length > 0) {
      sep = document.createElement('span');
      sep.className = 'fbar-sep';
      sep.setAttribute('aria-hidden', 'true');
      row.appendChild(sep);
    }
    for (const s of (config.statusOptions ?? STATUSES)) {
      const el = buildStatusPill(s, config, sel, commit);
      statusPills.push({ key: s.key, el });
      row.appendChild(el);
    }
  }

  // Hide any chip whose count is known to be zero — for callers that pass
  // countsForColour this re-runs on every colour change, so e.g. switching to
  // White drops a tag that only ever appears on Black lines. Chips with no
  // count info at all (callers that pass neither) always stay visible.
  function refresh(): void {
    const counts = config.countsForColour?.(sel.colour);
    const tagCounts = counts?.tagCounts ?? config.tagCounts;
    const statusCounts = counts?.statusCounts ?? config.statusCounts;

    let anyTagVisible = false;
    for (const { tag, el } of tagChips) {
      const hide = !!tagCounts && (tagCounts.get(tag) ?? 0) === 0;
      el.hidden = hide;
      if (!hide) anyTagVisible = true;
    }
    let anyStatusVisible = false;
    for (const { key, el } of statusPills) {
      const hide = !!statusCounts && statusCounts[key] === 0;
      el.hidden = hide;
      if (!hide) anyStatusVisible = true;
    }
    if (sep) sep.hidden = !anyTagVisible || !anyStatusVisible;
    row.hidden = !anyTagVisible && !anyStatusVisible;
  }

  return { element: row, refresh };
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
  s: { key: string; label: string },
  config: FilterConfig,
  sel: FilterSelection,
  commit: () => void,
): HTMLElement {
  const pill = document.createElement('button');
  pill.type = 'button';
  const on = sel.status === s.key;
  pill.className = `fchip fchip--status${on ? ' active' : ''}`;
  pill.dataset.status = s.key;
  pill.appendChild(document.createTextNode(s.label));
  if (config.statusCounts) pill.appendChild(countBadge(config.statusCounts[s.key]));
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
