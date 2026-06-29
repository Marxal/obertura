// The builder's carousel slides that aren't the line itself: Library and Games.
// Both read the builder's CURRENT position and list the continuations from here,
// each tappable to play it straight onto the line being built. They share the
// one builder board — there's no separate board here, just the move lists.
//
//   Library — what the bundled opening book plays next (move, opening reached,
//             how many named openings lie down that branch).
//   Games   — what the user actually played next in their imported games, with
//             the W/D/L split, drawn with the same wdl row as the board browser.
//
// The Engine slide is handled elsewhere: it's the EvalPanel's controls mounted
// into #slide-engine, so it needs nothing here.

import { Chess } from 'chess.js';
import { nameForFen } from './openings';
import { buildBook, bookNodeAt, loadBookEntries, type BookNode } from './book-tree';
import { getAllGames, getAllOpponents, getAllLines } from './storage';
import type { Line } from './types';
import type { MoveNode } from './tree';
import { buildMoveStats, statAt, statScorePct, gameAtPath, type StatNode } from './move-stats';
import {
  MAP_MAX_PLIES, MAP_START_PLIES, MAP_STEP_PLIES,
  buildOpponentTree, opponentLine, type Opponent,
} from './scout';
import { openRepertoireMap } from './repertoire-map';
import { userAvatar } from './avatar';
import { Icons } from './icons';
import { formatMove } from './notation';
import { wdlScoreRow, type WdlCounts } from './wdl-bar';
import { fetchExplorer, type ExplorerCounts, type ExplorerDb } from './lichess-explorer';
import { bundledStats } from './explorer-stats';
import { isConnected, connect, disconnect, getAccessToken, stashReturn } from './lichess-auth';
import { getExplorerDb, setExplorerDb } from './prefs';
import { showDialog } from './dialog';
import { platformLabel } from './board-explorer';
import type { ImportedGame } from './import-core';

export interface BuilderPanelsDeps {
  libraryEl: HTMLElement;
  gamesEl: HTMLElement;
  scoutingEl: HTMLElement;
  getSans: () => string[];          // SAN path to the current cursor node
  getUcis: () => string[];          // UCI path to the current cursor node
  getFen: () => string;             // FEN of the current position
  getColour: () => 'white' | 'black';
  onPlay: (uci: string) => void;    // play this move onto the line
  onImportGames: () => void;        // My games empty state → import your games
  onImportOpponent: () => void;     // Scouting → import a new opponent
  onOpenOpponentReport: (id: string) => void; // Scouting → opponent's full report
  onOpenLine: (line: Line) => void; // My lines "show tree" → open a saved line
}

export interface BuilderPanels {
  render(): void;                   // repaint every slide for the current position
  reload(): void;                   // re-read games from storage (after an import)
  reloadLines(): void;              // re-read saved lines from storage (after a save)
  reloadOpponents(): void;          // re-read opponents from storage (after import)
  selectOpponent(id: string): void; // preselect a Scouting opponent (board browser)
  setActiveSlide(index: number): void; // which carousel slide is showing
}

const LIBRARY_SLIDE = 2;
const SCOUTING_SLIDE = 4;

export function createBuilderPanels(deps: BuilderPanelsDeps): BuilderPanels {
  let book: BookNode | null = null;
  let games: ImportedGame[] | null = null;
  let lines: Line[] | null = null;
  let opponents: Opponent[] | null = null;
  let selectedOppId: string | null = null;       // null → show the opponents list
  let activeSlide = 0;
  // Which Lichess explorer database the Library slide draws its stats from.
  // Remembered across sessions; the toggle at the top of the slide flips it.
  let explorerDb: ExplorerDb = getExplorerDb();
  const statsByColour = new Map<'white' | 'black', StatNode>();
  // Per-opponent stats trees (their side against you), cached by `id:colour`.
  const oppStats = new Map<string, StatNode>();

  // Lazy loads — repaint each slide once its data lands.
  loadBookEntries()
    .then(entries => { book = buildBook(entries); renderLibrary(); })
    .catch(() => { /* leave the loading note */ });
  loadGames();
  loadLines();
  loadOpponents();

  function loadGames(): void {
    getAllGames()
      .then(g => { games = g; statsByColour.clear(); renderGames(); })
      .catch(() => { /* leave the loading note */ });
  }

  function loadLines(): void {
    getAllLines()
      .then(l => { lines = l; renderGames(); })
      .catch(() => { /* leave the loading note */ });
  }

  function loadOpponents(): void {
    getAllOpponents()
      .then(o => { opponents = o; oppStats.clear(); renderScouting(); })
      .catch(() => { /* leave the loading note */ });
  }

  function statsFor(colour: 'white' | 'black'): StatNode | null {
    if (!games) return null;
    let s = statsByColour.get(colour);
    if (!s) { s = buildMoveStats(games, colour, MAP_MAX_PLIES); statsByColour.set(colour, s); }
    return s;
  }

  // ── Library slide ─────────────────────────────────────────────────────────
  // Win/draw/loss stats come from the bundled stats database (instant, offline,
  // no login). When the user has connected their Lichess account, we additionally
  // try the live explorer (more current, every position) and prefer it when it
  // answers — otherwise we degrade silently to the bundled data.
  // `moves` is the stats to render (live when it answered, else bundled), or null
  // if the position moved on while awaiting. `liveFailed` is true only when we're
  // connected and the live fetch couldn't be reached (null = error/abort/blocked,
  // NOT an empty "reached, no games" answer) — the caller shows a subtle note so
  // a silent degrade to built-in data is no longer invisible.
  function resolveStats(
    fen: string, db: ExplorerDb, allowLive: boolean,
  ): Promise<{ moves: Map<string, ExplorerCounts> | null; liveFailed: boolean }> {
    return bundledStats(fen, db).then(async bundled => {
      if (allowLive && isConnected()) {
        const token = await getAccessToken();
        if (deps.getFen() !== fen) return { moves: null, liveFailed: false }; // moved on
        const live = await fetchExplorer(fen, db, token);
        if (live === null) return { moves: bundled, liveFailed: true };  // couldn't reach
        if (live.size) return { moves: live, liveFailed: false };
        // live empty: reached, no games here — fall through to bundled, no failure.
      }
      return { moves: bundled, liveFailed: false };
    });
  }

  function renderLibrary(): void {
    const el = deps.libraryEl;
    el.innerHTML = '';

    const fen = deps.getFen();

    // One reliable path whether or not you're connected: list the bundled book's
    // named continuations from here (always populated for real theory), and
    // overlay each with live Lichess W/D/L when connected. Only once the book
    // runs out do we lean purely on the live explorer (renderStatMoves below).
    //
    // The slide used to switch to the *pure* live explorer the moment you
    // connected — but when the live fetch was blocked or empty (CORS, rate
    // limit, a deep position) the slide showed nothing, so you had to connect
    // AND disconnect to coax the moves back. Always rendering the book first
    // means moves are there immediately; the live data only ever enriches them.
    if (!book) { el.appendChild(topBar()); el.appendChild(emptyNote('Loading openings…')); return; }

    const node = bookNodeAt(book, deps.getSans());
    const kids = node ? [...node.children.entries()] : [];
    // Busiest branches first, then alphabetical — mirrors the library explorer.
    kids.sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));

    // Off the bundled book: keep going by listing the continuations the stats
    // database (or live Lichess) plays from here, instead of dead-ending. The
    // "games from here" note rides discreetly on the top bar — no extra row.
    if (!kids.length) {
      el.appendChild(topBar(node ? 'End of book · games from here' : 'Off book · games from here'));
      renderStatMoves(el, fen);
      return;
    }

    el.appendChild(topBar());
    const prefix = movePrefix(deps.getSans().length);
    // One chess seeded at the live position resolves each candidate to a UCI and
    // the opening name it reaches (play, read, undo).
    const chess = new Chess(fen);
    // Track each row's right-hand slot by uci so we can swap the count for a
    // win/loss row once the stats land.
    const statSlots = new Map<string, HTMLElement>();
    for (const [san, child] of kids) {
      let uci = '';
      let label = child.name ?? '';
      try {
        const m = chess.move(san);
        if (m) {
          uci = m.from + m.to + (m.promotion ?? '');
          if (!label) label = nameForFen(chess.fen()) ?? '';
          chess.undo();
        }
      } catch { /* a stale book SAN — skip it */ }
      if (!uci) continue;

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'lib-bx-row';
      row.addEventListener('click', () => deps.onPlay(uci));

      row.appendChild(span('lib-bx-move', `${prefix} ${formatMove(san)}`));
      row.appendChild(span('lib-bx-name', label));
      const stat = span('lib-bx-count', `${child.count}`);
      row.appendChild(stat);
      statSlots.set(uci, stat);
      el.appendChild(row);
    }

    // Win/draw/loss + games count overlaid on each book move. Bundled is instant;
    // live is only tried when the slide is actually showing, so we don't hit the
    // network on every move. Applied only if the position hasn't moved on.
    resolveStats(fen, explorerDb, activeSlide === LIBRARY_SLIDE).then(({ moves, liveFailed }) => {
      if (!moves || deps.getFen() !== fen) return;
      const colour = deps.getColour();
      for (const [uci, slot] of statSlots) {
        const c = moves.get(uci);
        if (!c) continue;
        const counts = explorerCounts(c, colour);
        if (!counts.games) continue;
        slot.className = 'lib-bx-wdl';
        slot.replaceChildren(wdlScoreRow(counts, compactCount(counts.games)));
      }
      if (liveFailed) el.appendChild(liveUnavailableNote());
    }).catch(() => { /* keep the plain counts */ });
  }

  // The off-book continuations: every move the stats database (or live Lichess)
  // plays from here, busiest first, each a tappable My-games-style W/D/L row.
  function renderStatMoves(el: HTMLElement, fen: string): void {
    resolveStats(fen, explorerDb, activeSlide === LIBRARY_SLIDE).then(({ moves, liveFailed }) => {
      if (deps.getFen() !== fen) return;       // position moved on; drop this
      const colour = deps.getColour();
      const chess = new Chess(fen);
      const prefix = movePrefix(deps.getSans().length);
      const rows = [...(moves?.entries() ?? [])]
        .map(([uci, c]) => ({ uci, counts: explorerCounts(c, colour) }))
        .filter(r => r.counts.games > 0)
        .sort((a, b) => b.counts.games - a.counts.games);
      if (!rows.length) {
        // Live fetch couldn't be reached: say so plainly rather than implying the
        // position is unexplored ("New territory") when we simply didn't ask.
        if (liveFailed) { el.appendChild(liveUnavailableNote()); return; }
        // The games run out here — past the reach of the database. Frame it as a
        // discovery rather than a dead end. Connected, that's genuinely new
        // territory; disconnected, it may just be past the bundled set.
        const note = emptyNote(isConnected()
          ? '🧭 New territory — no recorded games reach this position.'
          : '🧭 New territory — connect Lichess to see games this deep.');
        note.classList.add('bx-frontier');
        el.appendChild(note);
        return;
      }
      for (const r of rows) {
        let san = '';
        try {
          const m = chess.move({
            from: r.uci.slice(0, 2), to: r.uci.slice(2, 4),
            promotion: r.uci.slice(4) || undefined,
          });
          if (m) { san = m.san; chess.undo(); }
        } catch { /* a move illegal here — skip it */ }
        if (!san) continue;
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'bx-row';
        row.addEventListener('click', () => deps.onPlay(r.uci));
        row.appendChild(span('bx-move', `${prefix} ${formatMove(san)}`));
        row.appendChild(wdlScoreRow(r.counts, compactCount(r.counts.games)));
        el.appendChild(row);
      }
      if (liveFailed) el.appendChild(liveUnavailableNote());
    }).catch(() => { /* graceful — bundled empty and live unavailable */ });
  }

  // A discreet note for when we're connected but the live explorer couldn't be
  // reached (CORS, rate limit, network) and we've fallen back to the bundled
  // book. Styled like the off-book frontier note so it stays unobtrusive.
  function liveUnavailableNote(): HTMLElement {
    const note = emptyNote('Showing built-in data — couldn’t reach Lichess.');
    note.classList.add('bx-frontier');
    return note;
  }

  // The Library slide's top bar, on a single row:
  //   • connected   → the Masters / Lichess source toggle, then the "i".
  //   • disconnected → the Connect nudge stands in for the toggle, then the "i".
  // An optional caption (e.g. "games from here") rides discreetly in between, so
  // off-book notes don't cost their own row.
  function topBar(caption?: string): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'lib-db-bar';

    if (isConnected()) {
      const seg = document.createElement('div');
      seg.className = 'lib-db-seg';
      const opt = (db: ExplorerDb, label: string) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'lib-db-opt' + (explorerDb === db ? ' is-active' : '');
        b.textContent = label;
        b.addEventListener('click', () => {
          if (explorerDb === db) return;
          explorerDb = db;
          setExplorerDb(db);
          renderLibrary();
        });
        return b;
      };
      seg.appendChild(opt('masters', 'Masters'));
      seg.appendChild(opt('lichess', 'Lichess'));
      bar.appendChild(seg);
    } else {
      const cta = document.createElement('button');
      cta.type = 'button';
      cta.className = 'lib-connect-cta lib-connect-cta--inline';
      cta.textContent = 'Connect Lichess for every position →';
      cta.addEventListener('click', doConnect);
      bar.appendChild(cta);
    }

    if (caption) bar.appendChild(span('lib-db-caption', caption));

    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'lib-db-info';
    info.setAttribute('aria-label', 'About the opening database');
    info.appendChild(Icons.info(16));
    info.addEventListener('click', showDbInfo);
    bar.appendChild(info);
    return bar;
  }

  // Start the Lichess connect, first stashing the current position so the
  // post-redirect reload returns the builder here instead of to the start.
  function doConnect(): void {
    stashReturn(deps.getUcis(), deps.getColour());
    connect();
  }

  function showDbInfo(): void {
    const connected = isConnected();
    showDialog({
      title: 'Opening database',
      body:
        'The bars under each move show how that position has scored across real ' +
        'games — so you can tell a solid main line from a shaky sideline at a glance.\n\n' +
        'Masters — over-the-board games between titled players: cleaner, established theory.\n\n' +
        'Lichess — rated online games: what real opponents actually play.\n\n' +
        'A built-in set of the most common positions works instantly and offline, with no ' +
        'login. Connecting your Lichess account extends the stats to every position, live — ' +
        'no personal data is read, so even a throwaway account works.',
      links: [
        { label: 'Live opening explorer', href: 'https://lichess.org/analysis' },
        { label: 'About the game data', href: 'https://database.lichess.org' },
      ],
      buttons: connected
        ? [
            { label: 'Disconnect Lichess', variant: 'secondary', onClick: () => { disconnect(); renderLibrary(); } },
            { label: 'Done', variant: 'primary' },
          ]
        : [
            { label: 'Connect to Lichess', variant: 'primary', onClick: doConnect },
            { label: 'Not now', variant: 'secondary' },
          ],
    });
  }

  // ── My lines slide ──────────────────────────────────────────────────────────
  // Two stacked sections, each listing the continuations from the CURRENT
  // position and each topped by a discrete "Show tree" link that opens the full
  // tree for that source:
  //   • My saved lines — what your own saved repertoire plays from here. Always
  //     shown, even with no imported games, since it reads from your lines.
  //   • My games — what you actually played from here in your imported games
  //     (the old "My games" slide). Offers the import flow when empty.
  function renderGames(): void {
    const el = deps.gamesEl;
    el.innerHTML = '';
    el.appendChild(savedLinesSection());
    el.appendChild(myGamesSection());
  }

  // Section header: a title with a discrete "Show tree" link on the same row.
  // `onTree` is omitted (no link) when there's nothing to open.
  function sectionHead(title: string, onTree?: () => void): HTMLElement {
    const head = document.createElement('div');
    head.className = 'mylines-head';
    head.appendChild(span('mylines-head-title', title));
    if (onTree) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'mylines-tree-link';
      link.appendChild(Icons.tree(15));
      link.appendChild(document.createTextNode('Show tree'));
      link.addEventListener('click', onTree);
      head.appendChild(link);
    }
    return head;
  }

  function savedLinesSection(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'mylines-section';
    const colour = deps.getColour();
    const mine = (lines ?? []).filter(l => l.colour === colour);
    const hasTree = mine.length > 0;

    wrap.appendChild(sectionHead('My saved lines', hasTree ? () => openSavedTree(mine) : undefined));

    if (!lines) { wrap.appendChild(emptyNote('Loading your lines…')); return wrap; }

    const replies = savedLineReplies(mine, deps.getUcis());
    if (!replies.length) {
      wrap.appendChild(emptyNote('No lines saved from here.'));
      return wrap;
    }
    const prefix = movePrefix(deps.getUcis().length);
    for (const r of replies) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bx-row bx-row--plain';
      row.addEventListener('click', () => deps.onPlay(r.uci));
      row.appendChild(span('bx-move', `${prefix} ${formatMove(r.san)}`));
      row.appendChild(span('bx-line-count', `${r.count} line${r.count === 1 ? '' : 's'}`));
      wrap.appendChild(row);
    }
    return wrap;
  }

  function myGamesSection(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'mylines-section';

    const stats = games ? statsFor(deps.getColour()) : null;
    const hasGames = !!stats && stats.games > 0;
    wrap.appendChild(sectionHead('My games', hasGames ? () => openGamesTree() : undefined));

    if (!games) { wrap.appendChild(emptyNote('Loading your games…')); return wrap; }

    // No imported games for this colour: offer the import flow right here so
    // "My games" is actionable rather than just empty.
    if (!hasGames) {
      wrap.appendChild(emptyNote('No games imported yet.'));
      wrap.appendChild(actionButton('Import my games', () => deps.onImportGames()));
      return wrap;
    }

    // When the line narrows to exactly one of your games, link straight to it —
    // same affordance as the board browser's "See full game".
    const single = gameAtPath(games, deps.getColour(), deps.getUcis());
    if (single?.url) {
      const a = document.createElement('a');
      a.className = 'bx-full-game';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.href = single.url;
      a.textContent = `See full game on ${platformLabel(single.url)} ↗`;
      wrap.appendChild(a);
    }

    const node = statAt(stats!, deps.getUcis());
    const replies = node ? [...node.children.values()] : [];
    replies.sort((a, b) => b.games - a.games || a.san.localeCompare(b.san));

    if (!replies.length) {
      wrap.appendChild(emptyNote('No games from here.'));
      return wrap;
    }
    const prefix = movePrefix(deps.getUcis().length);
    for (const c of replies) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bx-row';
      row.addEventListener('click', () => deps.onPlay(c.uci));
      row.appendChild(span('bx-move', `${prefix} ${formatMove(c.san)}`));
      row.appendChild(wdlScoreRow(
        { wins: c.wins, draws: c.draws, losses: c.losses, scorePct: statScorePct(c), games: c.games },
        `${c.games}`,
      ));
      wrap.appendChild(row);
    }
    return wrap;
  }

  // Open this colour's saved lines as one merged tree, landed on the current
  // position. Reuses the repertoire-map viewer with the real Line trees.
  function openSavedTree(mine: Line[]): void {
    const colour = deps.getColour();
    openRepertoireMap(mine, colour, line => deps.onOpenLine(line), {
      title: 'My saved lines',
      subtitle: `${mine.length} line${mine.length === 1 ? '' : 's'}`,
      initialPath: deps.getUcis(),
    });
  }

  // Open the current colour's imported games as a tree (repertoire-map). Reuses
  // the recipe from explore-screen's visualizeSection: a single seed line of the
  // merged game tree, re-pruned at each depth, with W/D/L overlaid from games.
  function openGamesTree(): void {
    if (!games) return;
    const colour = deps.getColour();
    const buildLines = (plies: number) =>
      [opponentLine(buildOpponentTree(games!, colour, plies, false), colour, 'Your games')];
    const count = games.filter(g => g.colour === colour).length;
    openRepertoireMap(buildLines(MAP_START_PLIES), colour, () => { /* no open-in-builder; we're already here */ }, {
      title: 'Your games',
      subtitle: `${count} game${count !== 1 ? 's' : ''}`,
      // Land on the board's current position rather than the first move.
      initialPath: deps.getUcis(),
      depth: {
        startPlies: MAP_START_PLIES,
        stepPlies: MAP_STEP_PLIES,
        maxPlies: Math.max(0, ...games.filter(g => g.colour === colour).map(g => g.sans.length)),
        atDepth: buildLines,
      },
      stats: { tree: buildMoveStats(games, colour, MAP_MAX_PLIES), caption: 'your results', games },
    });
  }

  // ── Scouting slide ──────────────────────────────────────────────────────────
  // Two states: no opponent selected → a tappable opponents list (+ import); an
  // opponent selected → their continuations from the current position, drawn
  // exactly like My games but from THEIR side (the opposite of your save colour).
  function renderScouting(): void {
    const el = deps.scoutingEl;
    el.innerHTML = '';
    if (!opponents) { el.appendChild(emptyNote('Loading opponents…')); return; }

    const selected = selectedOppId ? opponents.find(o => o.id === selectedOppId) ?? null : null;
    if (!selected) { renderOpponentList(el); return; }

    // Their side is the opposite of the colour you're preparing.
    const oppColour: 'white' | 'black' = deps.getColour() === 'white' ? 'black' : 'white';

    // Header: opponent avatar + name + their side, a back-to-list control, and a
    // full-report jump.
    const header = document.createElement('div');
    header.className = 'scout-slide-head';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'scout-back-btn';
    back.appendChild(span('scout-back-arrow', '‹'));
    back.appendChild(document.createTextNode(' Opponents'));
    back.addEventListener('click', () => { selectedOppId = null; renderScouting(); });
    header.appendChild(back);
    // Avatar + name + side kept together as one centered cluster.
    const id = document.createElement('div');
    id.className = 'scout-slide-id';
    id.appendChild(userAvatar(selected.avatarUrl, 24));
    const name = document.createElement('span');
    name.className = 'scout-slide-name';
    name.textContent = selected.name;
    id.appendChild(name);
    id.appendChild(colourTag(oppColour));
    header.appendChild(id);
    const report = document.createElement('button');
    report.type = 'button';
    report.className = 'scout-report-btn';
    report.textContent = 'Full report ↗';
    report.addEventListener('click', () => deps.onOpenOpponentReport(selected.id));
    header.appendChild(report);
    el.appendChild(header);

    // Cache by id+colour: oppColour flips with the board, so the key must too.
    const statsKey = `${selected.id}:${oppColour}`;
    let stats = oppStats.get(statsKey);
    if (!stats) { stats = buildMoveStats(selected.games, oppColour, MAP_MAX_PLIES); oppStats.set(statsKey, stats); }
    if (stats.games === 0) {
      el.appendChild(emptyNote(`No games for ${selected.name} as ${oppColour}.`));
      return;
    }

    const node = statAt(stats, deps.getUcis());
    const replies = node ? [...node.children.values()] : [];
    replies.sort((a, b) => b.games - a.games || a.san.localeCompare(b.san));
    if (!replies.length) {
      el.appendChild(emptyNote(`${selected.name} has no games from here.`));
      return;
    }

    const prefix = movePrefix(deps.getUcis().length);
    for (const c of replies) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bx-row';
      row.addEventListener('click', () => deps.onPlay(c.uci));
      row.appendChild(span('bx-move', `${prefix} ${c.san}`));
      row.appendChild(wdlScoreRow(
        { wins: c.wins, draws: c.draws, losses: c.losses, scorePct: statScorePct(c), games: c.games },
        `${c.games}`,
      ));
      el.appendChild(row);
    }
  }

  function renderOpponentList(el: HTMLElement): void {
    // "+ Add opponent" — the same pill the Explore scouting section uses, so the
    // two entry points read identically.
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'games-refresh-btn scout-add-btn';
    add.appendChild(Icons.plus(15));
    add.appendChild(document.createTextNode('Add opponent'));
    add.addEventListener('click', () => deps.onImportOpponent());
    el.appendChild(add);
    if (!opponents || opponents.length === 0) {
      el.appendChild(emptyNote('Scout an opponent to walk their games from here.'));
      return;
    }
    // Their side is the opposite of the colour you're preparing — the same
    // perspective the selected view uses, so the cached stats trees are reused.
    const oppColour: 'white' | 'black' = deps.getColour() === 'white' ? 'black' : 'white';
    for (const opp of opponents) {
      const statsKey = `${opp.id}:${oppColour}`;
      let s = oppStats.get(statsKey);
      if (!s) { s = buildMoveStats(opp.games, oppColour, MAP_MAX_PLIES); oppStats.set(statsKey, s); }
      const posGames = statAt(s, deps.getUcis())?.games ?? 0;

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'scout-opp-card';
      card.addEventListener('click', () => { selectedOppId = opp.id; renderScouting(); });
      card.appendChild(userAvatar(opp.avatarUrl, 36));

      const text = document.createElement('span');
      text.className = 'scout-opp-text';
      text.appendChild(span('scout-opp-name', opp.name));
      text.appendChild(span('scout-opp-sub',
        `${posGames} from this position · ${opp.gamesAnalysed} game${opp.gamesAnalysed !== 1 ? 's' : ''}`));
      card.appendChild(text);

      const chev = Icons.chevronRight(18);
      chev.classList.add('scout-opp-chev');
      card.appendChild(chev);
      el.appendChild(card);
    }
  }

  // A small "White"/"Black" chip with a colour pip — reused for the scouting
  // header and the board strips so a side reads the same everywhere.
  function colourTag(colour: 'white' | 'black'): HTMLElement {
    const tag = document.createElement('span');
    tag.className = 'scout-side-tag';
    const pip = document.createElement('span');
    pip.className = `colour-pip colour-pip--${colour}`;
    pip.setAttribute('aria-hidden', 'true');
    tag.appendChild(pip);
    tag.appendChild(document.createTextNode(colour === 'white' ? 'White' : 'Black'));
    return tag;
  }

  return {
    render() { renderLibrary(); renderGames(); renderScouting(); },
    reload() { loadGames(); },
    reloadLines() { loadLines(); },
    reloadOpponents() { loadOpponents(); },
    selectOpponent(id: string) { selectedOppId = id; renderScouting(); },
    setActiveSlide(index: number) {
      if (index === activeSlide) return;
      activeSlide = index;
      // Entering the Library slide: repaint so its explorer bars fetch now.
      if (index === LIBRARY_SLIDE) renderLibrary();
      if (index === SCOUTING_SLIDE) renderScouting();
    },
  };
}

// ── small helpers ─────────────────────────────────────────────────────────────

function movePrefix(ply: number): string {
  const num = Math.floor(ply / 2) + 1;
  return ply % 2 === 0 ? `${num}.` : `${num}…`;
}

// The moves your saved lines continue with from `ucis`, merged across every
// line that passes through this exact position. `count` is how many of your
// saved lines play each continuation (so a shared main move floats to the top).
function savedLineReplies(
  lines: Line[], ucis: string[],
): Array<{ san: string; uci: string; count: number }> {
  const byUci = new Map<string, { san: string; uci: string; count: number }>();
  for (const line of lines) {
    let node: MoveNode | undefined = line.tree;
    let reached = true;
    for (const u of ucis) {
      node = node?.children.find(c => c.uci === u);
      if (!node) { reached = false; break; }
    }
    if (!reached || !node) continue;
    for (const child of node.children) {
      const existing = byUci.get(child.uci);
      if (existing) existing.count++;
      else byUci.set(child.uci, { san: child.san, uci: child.uci, count: 1 });
    }
  }
  return [...byUci.values()].sort((a, b) => b.count - a.count || a.san.localeCompare(b.san));
}

// Orient Lichess's white/draws/black to the line's own colour, with a score%.
function explorerCounts(c: ExplorerCounts, colour: 'white' | 'black'): WdlCounts {
  const wins = colour === 'white' ? c.white : c.black;
  const losses = colour === 'white' ? c.black : c.white;
  const games = wins + c.draws + losses;
  const scorePct = games ? Math.round(((wins + c.draws / 2) / games) * 100) : 0;
  return { wins, draws: c.draws, losses, scorePct, games };
}

// Compact a games total so big Lichess counts fit the row: 276500000 → "276M",
// 12400 → "12.4K". Keeps small counts (masters, deep lines) exact.
function compactCount(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(0) + 'K';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

function span(cls: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

function emptyNote(text: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'bx-empty';
  d.textContent = text;
  return d;
}

// A full-width action button reusing the games-refresh-btn look, for the empty
// states (import your games / import an opponent) inside the list slides.
function actionButton(label: string, onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'games-refresh-btn builder-slide-action';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}
