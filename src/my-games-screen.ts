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
import { getAllGames } from './storage';
import type { ImportedGame } from './import-games';
import { buildMiniBoard } from './board-mini';
import { openingFamily } from './analysis';
import { createFilterBar } from './filters';
import { Icons } from './icons';
import { renderLoadError } from './load-error';

export interface MyGamesDeps {
  // Open the import sheet (Import last game / Browse / Paste PGN).
  onImport: () => void;
  // Open a saved game on the board and start (or restore) its analysis.
  onOpenGame: (game: ImportedGame) => void;
}

const RESULT_LABEL: Record<ImportedGame['result'], string> = {
  win: 'Won', draw: 'Drew', loss: 'Lost',
};

// Filter pill key → stored result code.
const RESULT_OF: Record<string, ImportedGame['result']> = {
  won: 'win', lost: 'loss', drew: 'draw',
};

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

  // ── Import action ───────────────────────────────────────────────────────────
  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'mygames-import';
  importBtn.appendChild(Icons.download(18));
  importBtn.appendChild(Object.assign(document.createElement('span'), { textContent: 'Import a game' }));
  importBtn.addEventListener('click', deps.onImport);
  root.appendChild(importBtn);

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
  const statusCounts: Record<string, number> = { won: 0, lost: 0, drew: 0 };
  for (const g of games) {
    statusCounts[g.result === 'win' ? 'won' : g.result === 'loss' ? 'lost' : 'drew']++;
  }
  const tagCounts = new Map<string, number>();
  for (const g of games) for (const t of g.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const allTags = [...tagCounts.keys()].sort((a, b) => a.localeCompare(b));

  // ── Filter bar + list ───────────────────────────────────────────────────────
  const listWrap = document.createElement('div');
  listWrap.className = 'mygames-list-wrap';

  const filter = createFilterBar({
    persistKey: 'obertura.mygamesFilter',
    sorts: [{ key: 'newest', label: 'Newest first' }, { key: 'oldest', label: 'Oldest first' }],
    defaultSort: 'newest',
    group: true,
    status: true,
    statusOptions: [{ key: 'won', label: 'Won' }, { key: 'lost', label: 'Lost' }, { key: 'drew', label: 'Drew' }],
    statusCounts,
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
    if (sel.status !== 'all') gs = gs.filter(g => g.result === RESULT_OF[sel.status]);
    if (sel.tags.length > 0) gs = gs.filter(g => sel.tags.some(t => (g.tags ?? []).includes(t)));
    gs.sort((a, b) => sel.sort === 'oldest' ? a.endTime - b.endTime : b.endTime - a.endTime);

    if (!gs.length) {
      const none = document.createElement('p');
      none.className = 'mygames-empty';
      none.textContent = 'No games match these filters.';
      listWrap.appendChild(none);
      return;
    }

    const items: ({ header: string } | { game: ImportedGame })[] =
      sel.group ? groupItems(gs) : gs.map(g => ({ game: g }));

    const list = document.createElement('div');
    list.className = 'mygames-list';
    listWrap.appendChild(list);

    let shown = 0;
    const renderBatch = (): void => {
      const slice = items.slice(shown, shown + BATCH);
      const frag = document.createDocumentFragment();
      for (const it of slice) {
        frag.appendChild('header' in it ? groupHeader(it.header) : gameCard(it.game, deps));
      }
      list.appendChild(frag);
      shown += slice.length;
    };
    renderBatch();

    if (shown < items.length) {
      const sentinel = document.createElement('div');
      sentinel.className = 'mygames-sentinel';
      listWrap.appendChild(sentinel);
      io = new IntersectionObserver(entries => {
        if (!entries.some(e => e.isIntersecting)) return;
        renderBatch();
        if (shown >= items.length) { io?.disconnect(); sentinel.remove(); }
      }, { rootMargin: '500px' });
      io.observe(sentinel);
    }
  }

  apply();
}

// Group the (already-sorted) games by opening family, preserving the sorted order
// both of the groups (by first appearance) and of games within each group.
function groupItems(games: ImportedGame[]): ({ header: string } | { game: ImportedGame })[] {
  const order: string[] = [];
  const byFamily = new Map<string, ImportedGame[]>();
  for (const g of games) {
    const fam = openingFamily(g.opening);
    let bucket = byFamily.get(fam);
    if (!bucket) { bucket = []; byFamily.set(fam, bucket); order.push(fam); }
    bucket.push(g);
  }
  const out: ({ header: string } | { game: ImportedGame })[] = [];
  for (const fam of order) {
    out.push({ header: `${fam} · ${byFamily.get(fam)!.length}` });
    for (const g of byFamily.get(fam)!) out.push({ game: g });
  }
  return out;
}

function groupHeader(label: string): HTMLElement {
  const h = document.createElement('div');
  h.className = 'mygames-group-head';
  h.textContent = label;
  return h;
}

function gameCard(g: ImportedGame, deps: MyGamesDeps): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'mygames-card';
  card.addEventListener('click', () => deps.onOpenGame(g));

  const mini = buildMiniBoard(fenAfter(g.ucis), g.colour);
  mini.classList.add('mygames-card-mini');
  card.appendChild(mini);

  const text = document.createElement('div');
  text.className = 'mygames-card-text';

  const opp = document.createElement('div');
  opp.className = 'mygames-card-opp';
  const pip = document.createElement('span');
  pip.className = `colour-pip colour-pip--${g.colour}`;
  pip.setAttribute('aria-hidden', 'true');
  opp.appendChild(pip);
  opp.appendChild(Object.assign(document.createElement('span'), { textContent: `vs ${g.opponent}` }));
  text.appendChild(opp);

  if (g.opening) {
    const op = document.createElement('div');
    op.className = 'mygames-card-opening';
    op.textContent = g.opening;
    text.appendChild(op);
  }

  const sub = document.createElement('div');
  sub.className = `mygames-card-sub mygames-card-sub--${g.result}`;
  sub.textContent = `${RESULT_LABEL[g.result]} · ${g.timeClass}`;
  if (g.analysis) {
    const tag = document.createElement('span');
    tag.className = 'mygames-card-analysed';
    tag.textContent = 'Analysed';
    sub.appendChild(document.createTextNode(' · '));
    sub.appendChild(tag);
  }
  text.appendChild(sub);

  if (g.tags && g.tags.length) {
    const tags = document.createElement('div');
    tags.className = 'mygames-card-tags';
    for (const t of g.tags) {
      tags.appendChild(Object.assign(document.createElement('span'), { className: 'mygames-tag', textContent: t }));
    }
    text.appendChild(tags);
  }

  card.appendChild(text);

  const chev = Icons.chevronRight(18);
  chev.classList.add('mygames-card-chev');
  card.appendChild(chev);
  return card;
}
