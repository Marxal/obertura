// A reusable two-row filter bar for line lists (Train now; Lines/Explore later).
//
// Row 1: the colour segment (All / White / Black), the search button, and the
//        sort menu, side by side.
// Row 1½: the search field — hidden until the magnifier is tapped, because a
//        list you can see is one you rarely need to search, and an always-open
//        input costs a row of every screen that shows the bar.
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

// How the list is grouped: flat (false), by opening family ('family'), the
// compact view — by full variation name ('variation'), which cuts each family
// into smaller, narrower buckets — or 'tree', the whole repertoire drawn as one
// position-merged map instead of a list. Old saved selections stored a boolean;
// true maps to 'family' on load. `if (sel.group)` still reads "grouped at all",
// so a caller that doesn't understand 'tree' never receives it: the mode is
// offered only where `config.groupTree` asks for it.
export type GroupMode = false | 'family' | 'variation' | 'tree';

export interface FilterSelection {
  colour: ColourFilter;
  sort: string;
  status: StatusFilter;
  tags: string[];
  group: GroupMode;
  // What's typed in the search box, trimmed and lowercased for the caller to
  // match however it likes. Deliberately NOT persisted: a filter you chose is
  // worth remembering, but a half-typed name silently hiding most of your lines
  // after a reload reads as data loss.
  query: string;
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
  // When true, draw a magnifier on row 1 that opens a search field; the caller
  // reads selection.query and filters its list by it.
  search?: boolean;
  // What the field says when empty (defaults to "Search lines").
  searchPlaceholder?: string;
  // When true, draw a "group by opening" icon toggle on row 1; the caller reads
  // selection.group and renders its list grouped into families (or flat).
  group?: boolean;
  // Adds 'tree' as a fourth stop on that toggle. Opt-in, because a caller that
  // doesn't render a tree would silently land on a state it can't draw.
  groupTree?: boolean;
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
  // Boolean true = the old "group by opening"; strings pass through when valid.
  const savedGroup = saved.group as GroupMode | true | undefined;
  const group: GroupMode = !config.group ? false
    : savedGroup === true || savedGroup === 'family' ? 'family'
    : savedGroup === 'variation' ? 'variation'
    // A remembered 'tree' on a screen that no longer offers one falls back to
    // the nearest grouped view rather than wedging the toggle.
    : savedGroup === 'tree' ? (config.groupTree ? 'tree' : 'family')
    : false;

  return { colour, sort, status, tags, group, query: '' };
}

function persist(config: FilterConfig, sel: FilterSelection): void {
  // Everything but the search text, which starts empty on every visit.
  const { query: _query, ...rest } = sel;
  localStorage.setItem(config.persistKey, JSON.stringify(rest));
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

  // Built before the top row, so the magnifier there has something to open.
  const searchRow = config.search ? buildSearchRow(config, selection, commit) : null;

  element.appendChild(buildTopRow(config, selection, commit, searchRow));
  if (searchRow) element.appendChild(searchRow.element);

  const chips = buildChipRow(config, selection, commit);
  if (chips) {
    element.appendChild(chips.element);
    refreshChips = chips.refresh;
    chips.refresh(); // hide any already-empty chip for the restored selection
  }

  return { element, selection };
}

// ── Row 1: colour segment + sort menu ─────────────────────────────────────────

function buildTopRow(
  config: FilterConfig, sel: FilterSelection, commit: () => void, search: SearchRow | null,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'fbar-top';
  row.appendChild(buildColourSeg(config, sel, commit));
  // Sort + group ride together on the right, each an icon-only control. Either is
  // optional: a screen with no sorts / no grouping just omits that icon.
  const tools = document.createElement('div');
  tools.className = 'fbar-tools';
  if (search) tools.appendChild(search.button);
  if ((config.sorts ?? []).length > 0) tools.appendChild(buildSortMenu(config, sel, commit));
  if (config.group) tools.appendChild(buildGroupToggle(config, sel, commit));
  // The tree gets its own button rather than hiding at the end of the grouping
  // cycle — see buildTreeToggle.
  if (config.groupTree) tools.appendChild(buildTreeToggle(sel, commit));
  if (tools.childElementCount > 0) row.appendChild(tools);
  return row;
}

// ── Row 1½: the search field ─────────────────────────────────────────────────
//
// Hidden until the magnifier is tapped, and cleared when it's tapped shut — so
// closing it can never leave a list quietly filtered by text nobody can see.
// Typing filters live; the field is never rebuilt by a caller's list rebuild, so
// it keeps focus (and the keyboard) between keystrokes.

interface SearchRow {
  element: HTMLElement;
  button: HTMLElement;
}

function buildSearchRow(
  config: FilterConfig, sel: FilterSelection, commit: () => void,
): SearchRow {
  const row = document.createElement('div');
  row.className = 'fbar-search';
  row.hidden = true;

  const icon = Icons.search(16);
  icon.classList.add('fbar-search-icon');
  row.appendChild(icon);

  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'fbar-search-input';
  input.placeholder = config.searchPlaceholder ?? 'Search lines';
  input.setAttribute('aria-label', config.searchPlaceholder ?? 'Search lines');
  input.addEventListener('input', () => {
    sel.query = input.value.trim().toLowerCase();
    commit();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  });
  row.appendChild(input);

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'fbar-search-clear';
  clear.setAttribute('aria-label', 'Clear search');
  clear.appendChild(Icons.close(15));
  clear.addEventListener('click', () => {
    if (input.value === '') { setOpen(false); return; }
    input.value = '';
    sel.query = '';
    commit();
    input.focus();
  });
  row.appendChild(clear);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'fbar-searchbtn';
  button.appendChild(Icons.search(18));
  button.title = 'Search';
  button.setAttribute('aria-label', 'Search');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', () => setOpen(row.hidden));

  function setOpen(open: boolean): void {
    row.hidden = !open;
    button.classList.toggle('active', open);
    button.setAttribute('aria-expanded', String(open));
    if (open) { input.focus(); return; }
    // Closing clears: an invisible filter is the one kind this bar must not have.
    if (sel.query !== '' || input.value !== '') {
      input.value = '';
      sel.query = '';
      commit();
    }
  }

  return { element: row, button };
}

function buildColourSeg(config: FilterConfig, sel: FilterSelection, commit: () => void): HTMLElement {
  const seg = document.createElement('div');
  seg.className = 'dfilter-seg';
  // The segment scrolls rather than overflowing (see .fbar .dfilter-seg in the
  // CSS — it used to run out from under itself and across the tools beside it).
  // The trailing fade that says so is only wanted when there really is more to
  // scroll to, so the class is set from the measured widths once laid out, and
  // again whenever the row's width changes.
  markOverflow(seg);
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
    // The word rides in its own span so a phone can drop it and keep the pip —
    // see .dfilter-btn-label in the CSS. The aria-label below always carries it,
    // so nothing is lost to a screen reader.
    const label = document.createElement('span');
    label.className = 'dfilter-btn-label';
    label.textContent = o.label;
    btn.appendChild(label);
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

// Keep `.dfilter-seg--overflowing` in step with whether the chips actually
// overrun the segment. ResizeObserver catches a rotation, a desktop resize and
// the first layout alike; where it isn't available a single rAF still gets the
// common case right.
function markOverflow(seg: HTMLElement): void {
  const sync = (): void => {
    seg.classList.toggle('dfilter-seg--overflowing', seg.scrollWidth > seg.clientWidth + 1);
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(sync).observe(seg);
  requestAnimationFrame(sync);
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

// The grouping toggle — sits beside sort on row 1. Cycles:
// flat → by opening family → compact (by variation, narrower buckets) → flat.
// The compact state carries a small "2" pip on the icon so the two grouped looks
// are tellable apart.
//
// THE TREE IS NOT ON THIS CYCLE ANY MORE. It used to be its fourth stop, which
// meant reaching the one view that shows the repertoire as a repertoire took
// three taps on a control whose other three states are all lists — and there was
// nothing on screen to say it was there. It has its own button now (see
// buildTreeToggle), so it is one tap from anywhere and visibly exists.
const GROUP_TITLES: Record<'off' | 'family' | 'variation' | 'tree', string> = {
  off: 'Group by opening',
  family: 'Compact view (group by variation)',
  variation: 'Flat list',
  // Only reachable from a restored selection made before the tree got its own
  // button; tapping the grouping control from there returns to a flat list.
  tree: 'Flat list',
};

function buildGroupToggle(
  config: FilterConfig,
  sel: FilterSelection,
  commit: () => void,
): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dgroup';

  const icon = Icons.rows(18);
  icon.classList.add('dgroup-icon');
  btn.appendChild(icon);

  const pip = document.createElement('span');
  pip.className = 'dgroup-pip';
  pip.textContent = '2';
  pip.setAttribute('aria-hidden', 'true');
  btn.appendChild(pip);

  const paint = (): void => {
    // In tree view the grouping control describes the LIST underneath, which
    // isn't on screen — so it reads as off rather than claiming a state.
    const grouped = sel.group === 'family' || sel.group === 'variation';
    btn.classList.toggle('active', grouped);
    btn.classList.toggle('dgroup--deep', sel.group === 'variation');
    // The title names the NEXT state (what a tap does), like a play/pause button.
    const title = GROUP_TITLES[sel.group === false ? 'off' : sel.group];
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.setAttribute('aria-pressed', String(grouped));
  };
  paint();

  btn.addEventListener('click', () => {
    sel.group =
      sel.group === false ? 'family'
      : sel.group === 'family' ? 'variation'
      : false;
    paint();
    commit();
  });
  return btn;
}

// The tree view's own control — a plain on/off, beside the grouping one.
//
// It is a SWITCH, not another stop on a cycle: the tree isn't a third way of
// grouping a list, it is a different drawing of the same repertoire, and going
// back to a list should not mean cycling forward through two grouped states to
// reach it. Turning it off restores whatever grouping was showing beforehand,
// so the list you left is the list you come back to.
function buildTreeToggle(sel: FilterSelection, commit: () => void): HTMLElement {
  // What the list was doing before the tree took over. Held here (not persisted)
  // because it only has to survive the current visit.
  let lastList: GroupMode = sel.group === 'tree' ? false : sel.group;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dtree';
  const icon = Icons.merge(18);
  icon.classList.add('dgroup-icon');
  btn.appendChild(icon);

  const paint = (): void => {
    const on = sel.group === 'tree';
    btn.classList.toggle('active', on);
    const title = on ? 'Back to the list' : 'Tree view (merged by position)';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.setAttribute('aria-pressed', String(on));
  };
  paint();

  btn.addEventListener('click', () => {
    if (sel.group === 'tree') {
      sel.group = lastList;
    } else {
      lastList = sel.group;
      sel.group = 'tree';
    }
    paint();
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
