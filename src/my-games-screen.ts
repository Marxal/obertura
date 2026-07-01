// "My games" — the home for the games you import. Mirrors My Lines: an import
// action on top, a filter bar (All/White/Black · Won/Lost/Drew · sort · group by
// opening · your tags), then a card per game showing the opponent, opening,
// result and a miniature of the position the stored moves reach. Tapping a card
// opens it on the board and analyses it. Tags are added in the analyser (its Tags
// button) and persist with "Save game".
//
// The list renders in batches and grows on scroll, so a big library opens fast.
//
// Deferred: the opponent's rating on the card (not stored yet) and full-move
// storage (cards show the position the capped opening moves reach).

import { Chess } from 'chess.js';
import { getAllGames, deleteGame } from './storage';
import { TIME_CLASS_LABELS, type ImportedGame } from './import-games';
import { buildMiniBoard } from './board-mini';
import { openingFamily } from './analysis';
import { createFilterBar } from './filters';
import { renderGroups } from './line-groups';
import { showDialog } from './dialog';
import { showToast } from './toast';
import { Icons } from './icons';
import { renderLoadError } from './load-error';
import { getGamesSource } from './import-panel';
import { refreshGamesNow } from './auto-refresh';

// A short, locale-aware game date ("12 Mar 2024") from the stored unix seconds.
// Shared with the analyser's "vs <opponent>" line. Empty when the date is unknown.
export function formatGameDate(endTimeSec: number | undefined): string {
  if (!endTimeSec) return '';
  return new Date(endTimeSec * 1000).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// A compact numeric date ("23/06/2026") for the card's own date row. Empty when
// the date is unknown.
function formatGameDateNumeric(endTimeSec: number | undefined): string {
  if (!endTimeSec) return '';
  const d = new Date(endTimeSec * 1000);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// Which opening families are expanded in the grouped view. Module-level so the
// open/closed state survives re-renders (filter changes, reopening the tab).
const expandedFamilies = new Set<string>();

export interface MyGamesDeps {
  // Open the import sheet (Import last game / Browse / Paste PGN).
  onImport: () => void;
  // Open a saved game on the board and start (or restore) its analysis.
  onOpenGame: (game: ImportedGame) => void;
}

const RESULT_LABEL: Record<ImportedGame['result'], string> = {
  win: 'Won', draw: 'Drew', loss: 'Lost',
};

const PLATFORM_LABEL = { chesscom: 'Chess.com', lichess: 'Lichess' } as const;

// Tags shown/filtered on for a game: the user's own tags plus the platform and
// time control, derived on the fly rather than written into the stored `tags`
// array — so they can never duplicate or get clobbered across re-imports, and
// stay in sync automatically if timeClass/platform data ever changes shape.
function effectiveTags(g: ImportedGame): string[] {
  const derived: string[] = [];
  if (g.platform) derived.push(PLATFORM_LABEL[g.platform]);
  derived.push(TIME_CLASS_LABELS[g.timeClass]);
  return [...(g.tags ?? []), ...derived];
}

// How many list items (cards / group headers) to render per batch.
const BATCH = 24;

// Replay the stored moves to the position they reach, for the card miniature.
function fenAfter(ucis: string[]): string {
  const ch = new Chess();
  for (const uci of ucis) {
    try {
      ch.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: (uci[4] as 'q' | 'r' | 'b' | 'n') || 'q' });
    } catch { break; }
  }
  return ch.fen();
}

export async function renderMyGamesScreen(host: HTMLElement, deps: MyGamesDeps): Promise<void> {
  host.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'mygames-screen';
  host.appendChild(root);

  // Re-render the whole screen (after a delete) so counts and groups update.
  const refresh = (): void => { void renderMyGamesScreen(host, deps); };

  // ── Import / refresh actions ──────────────────────────────────────────────────
  // Import and Refresh sit side by side. "Add a game" (manual entry) now lives
  // inside the import lightbox itself, reached via its "add manually" link.
  const topRow = document.createElement('div');
  topRow.className = 'mygames-top-row';

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'mygames-import';
  importBtn.appendChild(Icons.download(18));
  importBtn.appendChild(Object.assign(document.createElement('span'), { textContent: 'Import a game' }));
  importBtn.addEventListener('click', deps.onImport);
  topRow.appendChild(importBtn);

  // Refresh only appears once an account has been imported.
  if (getGamesSource()) {
    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'mygames-action';
    refreshBtn.appendChild(Icons.reset(15));
    refreshBtn.appendChild(Object.assign(document.createElement('span'), { textContent: 'Refresh games' }));
    refreshBtn.addEventListener('click', async () => {
      if (refreshBtn.disabled) return;
      refreshBtn.disabled = true;
      refreshBtn.classList.add('mygames-action--busy');
      showToast('Checking for new games…');
      try {
        const n = await refreshGamesNow();
        if (n > 0) {
          showToast(`${n} new game${n === 1 ? '' : 's'} added ✓`, { variant: 'success' });
          refresh();
          return; // re-render replaces this button; nothing left to re-enable
        }
        showToast('No new games.');
      } catch {
        showToast('Couldn’t refresh — check your connection.');
      }
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('mygames-action--busy');
    });
    topRow.appendChild(refreshBtn);
  }

  root.appendChild(topRow);

  let games: ImportedGame[];
  try {
    games = await getAllGames();
  } catch (err) {
    renderLoadError(root, err, () => { void renderMyGamesScreen(host, deps); });
    return;
  }

  if (!games.length) {
    const empty = document.createElement('p');
    empty.className = 'mygames-empty';
    empty.textContent = 'No games yet. Import your games to analyse them here.';
    root.appendChild(empty);
    return;
  }

  // ── Counts for the filter chips ─────────────────────────────────────────────
  const colourCounts = {
    all: games.length,
    white: games.filter(g => g.colour === 'white').length,
    black: games.filter(g => g.colour === 'black').length,
  };
  const tagCounts = new Map<string, number>();
  for (const g of games) for (const t of effectiveTags(g)) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const allTags = [...tagCounts.keys()].sort((a, b) => a.localeCompare(b));

  // ── Filter bar + list ───────────────────────────────────────────────────────
  const listWrap = document.createElement('div');
  listWrap.className = 'mygames-list-wrap';

  // Row 1 is intentionally lean: just the colour segment and the group/branching
  // toggle. No sort menu (always newest-first) and no Won/Lost/Drew pills — the
  // result now reads from the coloured border on each card's miniature.
  const filter = createFilterBar({
    persistKey: 'obertura.mygamesFilter',
    group: true,
    colourCounts,
    userTags: allTags,
    tagCounts,
    onChange: () => apply(),
  });
  root.appendChild(filter.element);
  root.appendChild(listWrap);

  let io: IntersectionObserver | null = null;

  // (Re)build the list for the current selection: filter, sort, optionally group,
  // then batch-render so a large library stays snappy.
  function apply(): void {
    io?.disconnect();
    listWrap.innerHTML = '';
    const sel = filter.selection;

    let gs = games.slice();
    if (sel.colour !== 'all') gs = gs.filter(g => g.colour === sel.colour);
    if (sel.tags.length > 0) gs = gs.filter(g => sel.tags.some(t => effectiveTags(g).includes(t)));
    gs.sort((a, b) => b.endTime - a.endTime); // always newest-first

    if (!gs.length) {
      const none = document.createElement('p');
      none.className = 'mygames-empty';
      none.textContent = 'No games match these filters.';
      listWrap.appendChild(none);
      return;
    }

    const list = document.createElement('div');
    list.className = 'mygames-list';
    listWrap.appendChild(list);

    if (sel.group) {
      // Collapsible opening-family accordion (same as My Lines). Collapsed groups
      // don't build their cards, so this stays cheap even for a big library.
      renderGroups(list, gs, g => openingFamily(g.opening), g => gameCard(g, deps, refresh), expandedFamilies);
      return;
    }

    // Flat list: render in batches and grow on scroll.
    let shown = 0;
    const renderBatch = (): void => {
      const slice = gs.slice(shown, shown + BATCH);
      const frag = document.createDocumentFragment();
      for (const g of slice) frag.appendChild(gameCard(g, deps, refresh));
      list.appendChild(frag);
      shown += slice.length;
    };
    renderBatch();

    if (shown < gs.length) {
      const sentinel = document.createElement('div');
      sentinel.className = 'mygames-sentinel';
      listWrap.appendChild(sentinel);
      io = new IntersectionObserver(entries => {
        if (!entries.some(e => e.isIntersecting)) return;
        renderBatch();
        if (shown >= gs.length) { io?.disconnect(); sentinel.remove(); }
      }, { rootMargin: '500px' });
      io.observe(sentinel);
    }
  }

  apply();
}

function gameCard(g: ImportedGame, deps: MyGamesDeps, refresh: () => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mygames-card';

  // The big tap target opens the game; a separate trash button deletes it (two
  // siblings, so no invalid button-in-button nesting).
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'mygames-card-open';
  open.addEventListener('click', () => deps.onOpenGame(g));

  // The miniature carries a thin result border: green won, red lost, neutral drew.
  const mini = buildMiniBoard(fenAfter(g.ucis), g.colour);
  mini.classList.add('mygames-card-mini', `mygames-card-mini--${g.result}`);
  open.appendChild(mini);

  const text = document.createElement('div');
  text.className = 'mygames-card-text';

  const opp = document.createElement('div');
  opp.className = 'mygames-card-opp';
  const pip = document.createElement('span');
  pip.className = `colour-pip colour-pip--${g.colour}`;
  pip.setAttribute('aria-hidden', 'true');
  opp.appendChild(pip);
  opp.appendChild(Object.assign(document.createElement('span'), { textContent: `vs ${g.opponent}` }));
  if (g.opponentRating !== undefined) {
    opp.appendChild(Object.assign(document.createElement('span'), {
      className: 'mygames-card-rating', textContent: `${g.opponentRating}`,
    }));
  }
  text.appendChild(opp);

  // Reserved 2-line height regardless of the actual name length, so every card
  // matches height whether the opening wraps or not (see .mygames-card-opening).
  const op = document.createElement('div');
  op.className = 'mygames-card-opening';
  op.textContent = g.opening ?? '';
  text.appendChild(op);

  // Result badge + time-class on the left, date pushed to the right — one row.
  const meta = document.createElement('div');
  meta.className = 'mygames-card-meta';

  const metaLeft = document.createElement('div');
  metaLeft.className = 'mygames-card-meta-left';
  const badge = document.createElement('span');
  badge.className = `mygames-card-badge mygames-card-badge--${g.result}`;
  badge.textContent = RESULT_LABEL[g.result];
  metaLeft.appendChild(badge);
  metaLeft.appendChild(document.createTextNode(g.timeClass));
  meta.appendChild(metaLeft);

  const date = formatGameDateNumeric(g.endTime);
  if (date) {
    const dateEl = document.createElement('span');
    dateEl.className = 'mygames-card-date';
    dateEl.textContent = date;
    meta.appendChild(dateEl);
  }
  text.appendChild(meta);

  const cardTags = effectiveTags(g);
  if (cardTags.length || g.analysis) {
    const tags = document.createElement('div');
    tags.className = 'mygames-card-tags';
    if (g.analysis) {
      const analysedIcon = document.createElement('span');
      analysedIcon.className = 'mygames-card-analysed';
      analysedIcon.setAttribute('aria-label', 'Analysed');
      analysedIcon.title = 'Analysed';
      analysedIcon.appendChild(Icons.review(14));
      tags.appendChild(analysedIcon);
    }
    for (const t of cardTags) {
      tags.appendChild(Object.assign(document.createElement('span'), { className: 'mygames-tag', textContent: t }));
    }
    text.appendChild(tags);
  }

  open.appendChild(text);
  wrap.appendChild(open);

  // Delete tucks into the top-right corner (overlaid on the card) so it no longer
  // needs its own column.
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'mygames-card-del';
  del.setAttribute('aria-label', `Delete game vs ${g.opponent}`);
  del.appendChild(Icons.trash(16));
  del.addEventListener('click', () => {
    showDialog({
      title: 'Delete this game?',
      body: `Remove your game vs ${g.opponent} from My games? This can’t be undone.`,
      buttons: [
        { label: 'Delete', variant: 'danger', onClick: () => {
          void deleteGame(g.id).then(() => { showToast('Game deleted'); refresh(); });
        } },
        { label: 'Cancel', variant: 'secondary' },
      ],
    });
  });
  wrap.appendChild(del);

  return wrap;
}
