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
}

export interface FilterConfig {
  // Where the selection is remembered (one JSON entry, device-local).
  persistKey: string;
  // The sort menu options and which one leads by default.
  sorts: { key: string; label: string }[];
  defaultSort: string;
  // Chip groups, drawn left-to-right. Empty/omitted groups simply don't appear.
  userTags?: string[];
  opponentTags?: string[];
  status?: boolean;
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
  const sortKeys = new Set(config.sorts.map(s => s.key));
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
  const sort = typeof saved.sort === 'string' && sortKeys.has(saved.sort) ? saved.sort : config.defaultSort;
  const tags = Array.isArray(saved.tags) ? saved.tags.filter(t => known.has(t)) : [];

  return { colour, sort, status, tags };
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
  row.appendChild(buildColourSeg(sel, commit));
  row.appendChild(buildSortMenu(config, sel, commit));
  return row;
}

function buildColourSeg(sel: FilterSelection, commit: () => void): HTMLElement {
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
  const wrap = document.createElement('div');
  wrap.className = 'dorder';

  const icon = Icons.order(16);
  icon.classList.add('dorder-icon');
  wrap.appendChild(icon);

  const select = document.createElement('select');
  select.className = 'dorder-select';
  select.setAttribute('aria-label', 'Sort lines');
  for (const o of config.sorts) {
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

// ── Row 2: tag chips (user, then opponent) + status pills ──────────────────────

function buildChipRow(config: FilterConfig, sel: FilterSelection, commit: () => void): HTMLElement | null {
  const userTags = config.userTags ?? [];
  const opponentTags = config.opponentTags ?? [];
  const hasStatus = !!config.status;
  if (userTags.length === 0 && opponentTags.length === 0 && !hasStatus) return null;

  const row = document.createElement('div');
  row.className = 'fbar-chips';

  for (const tag of userTags) row.appendChild(buildTagChip(tag, sel, commit));
  for (const tag of opponentTags) row.appendChild(buildTagChip(tag, sel, commit));

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

function buildTagChip(tag: string, sel: FilterSelection, commit: () => void): HTMLElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  const on = sel.tags.includes(tag);
  chip.className = `fchip${on ? ' active' : ''}`;
  chip.textContent = tag;
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
