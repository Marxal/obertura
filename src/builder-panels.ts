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
import { getAllGames, getAllOpponents } from './storage';
import { buildMoveStats, statAt, statScorePct, gameAtPath, type StatNode } from './move-stats';
import { MAP_MAX_PLIES, type Opponent } from './scout';
import { wdlScoreRow, wdlBar, type WdlCounts } from './wdl-bar';
import { fetchExplorer, type ExplorerCounts } from './lichess-explorer';
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
}

export interface BuilderPanels {
  render(): void;                   // repaint every slide for the current position
  reload(): void;                   // re-read games from storage (after an import)
  reloadOpponents(): void;          // re-read opponents from storage (after import)
  selectOpponent(id: string): void; // preselect a Scouting opponent (board browser)
  setActiveSlide(index: number): void; // which carousel slide is showing
}

const LIBRARY_SLIDE = 1;
const SCOUTING_SLIDE = 4;

export function createBuilderPanels(deps: BuilderPanelsDeps): BuilderPanels {
  let book: BookNode | null = null;
  let games: ImportedGame[] | null = null;
  let opponents: Opponent[] | null = null;
  let selectedOppId: string | null = null;       // null → show the opponents list
  let activeSlide = 0;
  const statsByColour = new Map<'white' | 'black', StatNode>();
  // Per-opponent stats trees (their side against you), cached by id+colour.
  const oppStats = new Map<string, StatNode>();

  // Lazy loads — repaint each slide once its data lands.
  loadBookEntries()
    .then(entries => { book = buildBook(entries); renderLibrary(); })
    .catch(() => { /* leave the loading note */ });
  loadGames();
  loadOpponents();

  function loadGames(): void {
    getAllGames()
      .then(g => { games = g; statsByColour.clear(); renderGames(); })
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
  function renderLibrary(): void {
    const el = deps.libraryEl;
    el.innerHTML = '';
    if (!book) { el.appendChild(emptyNote('Loading openings…')); return; }

    const node = bookNodeAt(book, deps.getSans());
    const kids = node ? [...node.children.entries()] : [];
    // Busiest branches first, then alphabetical — mirrors the library explorer.
    kids.sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));

    if (!kids.length) {
      el.appendChild(emptyNote(node
        ? 'End of the book line — this is a named opening.'
        : 'Off the book from here.'));
      return;
    }

    const prefix = movePrefix(deps.getSans().length);
    const fen = deps.getFen();
    // One chess seeded at the live position resolves each candidate to a UCI and
    // the opening name it reaches (play, read, undo).
    const chess = new Chess(fen);
    // Track each row's right-hand slot by uci so we can swap the count for a
    // Lichess win/loss bar once the explorer answers.
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

      row.appendChild(span('lib-bx-move', `${prefix} ${san}`));
      row.appendChild(span('lib-bx-name', label));
      const stat = span('lib-bx-count', `${child.count}`);
      row.appendChild(stat);
      statSlots.set(uci, stat);
      el.appendChild(row);
    }

    // Online win/draw/loss bars from the Lichess explorer (rated games) — only
    // when the Library slide is actually showing, so we don't hit the network on
    // every move. Applied only if the position hasn't moved on; silent offline.
    if (activeSlide !== LIBRARY_SLIDE) return;
    fetchExplorer(fen).then(moves => {
      if (!moves || deps.getFen() !== fen) return;
      const colour = deps.getColour();
      for (const [uci, slot] of statSlots) {
        const c = moves.get(uci);
        if (!c) continue;
        const counts = explorerCounts(c, colour);
        if (!counts.games) continue;
        slot.classList.add('lib-bx-wdl');
        slot.replaceChildren(wdlBar(counts));
      }
    }).catch(() => { /* offline — keep the counts */ });
  }

  // ── Games slide ───────────────────────────────────────────────────────────
  function renderGames(): void {
    const el = deps.gamesEl;
    el.innerHTML = '';
    if (!games) { el.appendChild(emptyNote('Loading your games…')); return; }

    const stats = statsFor(deps.getColour());
    if (!stats || stats.games === 0) {
      el.appendChild(emptyNote('No imported games for this colour yet.'));
      el.appendChild(actionButton('Import games', () => deps.onImportGames()));
      return;
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
      el.appendChild(a);
    }

    const node = statAt(stats, deps.getUcis());
    const replies = node ? [...node.children.values()] : [];
    replies.sort((a, b) => b.games - a.games || a.san.localeCompare(b.san));

    if (!replies.length) {
      el.appendChild(emptyNote('No games continue from here.'));
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

    // Header: opponent name, a back-to-list control, and a full-report jump.
    const header = document.createElement('div');
    header.className = 'scout-slide-head';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'scout-back-btn';
    back.appendChild(span('scout-back-arrow', '‹'));
    back.appendChild(document.createTextNode(' Opponents'));
    back.addEventListener('click', () => { selectedOppId = null; renderScouting(); });
    header.appendChild(back);
    const name = document.createElement('span');
    name.className = 'scout-slide-name';
    name.textContent = selected.name;
    header.appendChild(name);
    const report = document.createElement('button');
    report.type = 'button';
    report.className = 'scout-report-btn';
    report.textContent = 'Full report ↗';
    report.addEventListener('click', () => deps.onOpenOpponentReport(selected.id));
    header.appendChild(report);
    el.appendChild(header);

    // Their side is the opposite of the colour you're preparing.
    const oppColour: 'white' | 'black' = deps.getColour() === 'white' ? 'black' : 'white';
    let stats = oppStats.get(selected.id);
    if (!stats) { stats = buildMoveStats(selected.games, oppColour, MAP_MAX_PLIES); oppStats.set(selected.id, stats); }
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
    el.appendChild(actionButton('Import opponent', () => deps.onImportOpponent()));
    if (!opponents || opponents.length === 0) {
      el.appendChild(emptyNote('Scout an opponent to walk their games from here.'));
      return;
    }
    for (const opp of opponents) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bx-row scout-opp-row';
      row.addEventListener('click', () => { selectedOppId = opp.id; renderScouting(); });
      row.appendChild(span('bx-move', opp.name));
      row.appendChild(span('scout-opp-count', `${opp.gamesAnalysed} game${opp.gamesAnalysed !== 1 ? 's' : ''}`));
      el.appendChild(row);
    }
  }

  return {
    render() { renderLibrary(); renderGames(); renderScouting(); },
    reload() { loadGames(); },
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

// Orient Lichess's white/draws/black to the line's own colour, with a score%.
function explorerCounts(c: ExplorerCounts, colour: 'white' | 'black'): WdlCounts {
  const wins = colour === 'white' ? c.white : c.black;
  const losses = colour === 'white' ? c.black : c.white;
  const games = wins + c.draws + losses;
  const scorePct = games ? Math.round(((wins + c.draws / 2) / games) * 100) : 0;
  return { wins, draws: c.draws, losses, scorePct, games };
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
