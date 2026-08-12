// The builder's Explore slide — three curated moves at a time, and nothing else.
//
// WHY THREE. Library already answers "what is playable here" exhaustively: a
// scrolling list of every book continuation with its win rates. That list is the
// right tool once you know what you're looking for, and the wrong one when you
// don't — a first-time builder facing twenty ranked continuations picks the top
// row, which is a menu, not a decision. Explore asks a narrower question and
// answers it in three rows: given YOUR games, the master library and the engine,
// what are the three moves actually worth having in your repertoire here?
//
// WHERE THEY COME FROM, IN ORDER OF PRIORITY:
//
//   1. Your games      — a move you have actually played (or actually faced) in
//                        an imported online game. Nothing beats this: a
//                        repertoire is for the positions you really get.
//   2. The library     — the most popular continuation among masters or Lichess
//                        players, from the same statistics the Library slide
//                        draws (bundled, plus the live explorer when connected).
//   3. The engine      — the Lichess cloud's best moves, for a position your
//                        games and the book have both run out on.
//
// Every row says WHICH of the three put it there, with the number that earned
// it, so a suggestion is never an oracle: "3 of your games", "48% of masters",
// "engine's best, +0.35".
//
// THE HEADER IS THE WHOLE FRAMING. On your move the question is "what do I
// play?" — the rows are answers. On the opponent's move the question is "what do
// they play?" — the rows are things to prepare for, and tapping one builds the
// branch that meets it. Same list, two jobs, and the header is what tells them
// apart.

import { Chess } from 'chess.js';
import { buildBook, bookNodeAt, loadBookEntries, type BookNode } from './book-tree';
import { getAllGames } from './storage';
import { buildMoveStats, statAt, type StatNode } from './move-stats';
import { MAP_MAX_PLIES } from './scout';
import { formatMove } from './notation';
import { Icons } from './icons';
import { getExplorerDb } from './prefs';
import { resolveExplorerStats } from './explorer-resolve';
import { cloudTopLines } from './engine';
import { isConnected } from './lichess-auth';
import type { ImportedGame } from './import-core';

// How many suggestions the slide ever shows. Three is the point of the slide.
const SUGGESTIONS = 3;

export type ExploreSource = 'games' | 'library' | 'engine';

interface Candidate {
  uci: string;
  san: string;
  source: ExploreSource;
  // The number that earned this move its place, already phrased.
  detail: string;
  // Sort key WITHIN a source: game count, explorer game count, engine rank.
  weight: number;
  // The opening this move reaches, when the book knows one — a name is the best
  // single hint about where a move leads.
  opening?: string;
}

export interface ExplorePanelDeps {
  el: HTMLElement;
  getSans: () => string[];
  getUcis: () => string[];
  getFen: () => string;
  getColour: () => 'white' | 'black';
  onPlay: (uci: string) => void;
  onImportGames: () => void;
}

export interface ExplorePanel {
  render(): void;
  reload(): void;                 // re-read games from storage (after an import)
  setActive(on: boolean): void;   // is the slide showing? gates network work
}

export function createExplorePanel(deps: ExplorePanelDeps): ExplorePanel {
  let book: BookNode | null = null;
  let games: ImportedGame[] | null = null;
  let active = false;
  const statsByColour = new Map<'white' | 'black', StatNode>();

  loadBookEntries()
    .then(entries => { book = buildBook(entries); render(); })
    .catch(() => { /* the book is a bonus here, not a dependency */ });
  loadGames();

  function loadGames(): void {
    getAllGames()
      .then(g => { games = g; statsByColour.clear(); render(); })
      .catch(() => { /* leave whatever is on screen */ });
  }

  function statsFor(colour: 'white' | 'black'): StatNode | null {
    if (!games) return null;
    let s = statsByColour.get(colour);
    if (!s) { s = buildMoveStats(games, colour, MAP_MAX_PLIES); statsByColour.set(colour, s); }
    return s;
  }

  // Whose move is it on the board right now, relative to the line's owner?
  function myTurn(): boolean {
    return sideToMove(deps.getFen()) === deps.getColour();
  }

  function render(): void {
    const el = deps.el;
    const fen = deps.getFen();
    el.replaceChildren();
    el.appendChild(buildHeader());

    const rows = document.createElement('div');
    rows.className = 'explore-rows';
    el.appendChild(rows);

    // Draw what we can answer instantly (your games + the bundled book), then
    // fill the remaining slots once the slower sources land. The slide is never
    // blank waiting on a network call.
    const instant = mergeCandidates([...gameCandidates(), ...bookCandidates()]);
    paintRows(rows, instant, fen);

    // The library's popularity numbers and the engine only get asked for while
    // the slide is actually showing — this render() runs on every move.
    if (!active) return;

    void (async () => {
      const extra: Candidate[] = [];
      const lib = await libraryCandidates(fen);
      if (deps.getFen() !== fen) return;
      extra.push(...lib);

      // The engine is the last resort, so only pay for it when your games and
      // the book between them can't fill three rows.
      if (mergeCandidates([...instant, ...extra]).length < SUGGESTIONS) {
        const eng = await engineCandidates(fen);
        if (deps.getFen() !== fen) return;
        extra.push(...eng);
      }
      paintRows(rows, mergeCandidates([...instant, ...extra]), fen);
    })();
  }

  // ── The header: what this list is FOR at this position ────────────────────
  function buildHeader(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'explore-head';

    const sans = deps.getSans();
    const last = sans.length
      ? `${movePrefix(sans.length - 1)} ${formatMove(sans[sans.length - 1])}`
      : null;
    const mine = myTurn();
    const them = deps.getColour() === 'white' ? 'Black' : 'White';

    const title = document.createElement('div');
    title.className = 'explore-head-title';
    title.textContent = mine
      ? (last ? `Possible answers for ${last}` : 'Possible first moves')
      : (last ? `Prepare for the reply to ${last}` : `Prepare for ${them}’s first move`);
    wrap.appendChild(title);

    const sub = document.createElement('div');
    sub.className = 'explore-head-sub';
    sub.textContent = mine
      ? 'Three moves worth having in your repertoire here.'
      : 'Three replies worth being ready for. Tap one to build against it.';
    wrap.appendChild(sub);
    return wrap;
  }

  // ── The sources ───────────────────────────────────────────────────────────

  // What actually happened next in your imported games. On your move these are
  // moves you played; on theirs, moves you faced — both are the strongest reason
  // a position deserves a line.
  function gameCandidates(): Candidate[] {
    const stats = statsFor(deps.getColour());
    if (!stats) return [];
    const node = statAt(stats, deps.getUcis());
    if (!node) return [];
    const mine = myTurn();
    return [...node.children.values()]
      .filter(c => c.games > 0)
      .sort((a, b) => b.games - a.games)
      .map(c => ({
        uci: c.uci,
        san: c.san,
        source: 'games' as const,
        detail: mine
          ? `You played this in ${c.games} game${c.games === 1 ? '' : 's'}`
          : `Faced in ${c.games} game${c.games === 1 ? '' : 's'}`,
        weight: c.games,
      }));
  }

  // The bundled opening book's named continuations. Instant and offline; its
  // `count` is how many named openings lie down that branch, which is a decent
  // stand-in for "how much theory is here" before the explorer numbers land.
  function bookCandidates(): Candidate[] {
    if (!book) return [];
    const node = bookNodeAt(book, deps.getSans());
    if (!node) return [];
    const chess = new Chess(deps.getFen());
    const out: Candidate[] = [];
    for (const [san, child] of node.children) {
      let uci = '';
      try {
        const m = chess.move(san);
        if (m) { uci = m.from + m.to + (m.promotion ?? ''); chess.undo(); }
      } catch { /* a stale book SAN — skip it */ }
      if (!uci) continue;
      out.push({
        uci,
        san,
        source: 'library',
        detail: 'Main opening theory',
        weight: child.count,
        opening: child.name ?? undefined,
      });
    }
    return out.sort((a, b) => b.weight - a.weight);
  }

  // The explorer's popularity numbers for this position, which turn the book's
  // "there is theory here" into "this is what people actually play".
  async function libraryCandidates(fen: string): Promise<Candidate[]> {
    const db = getExplorerDb();
    const { moves } = await resolveExplorerStats(fen, db, true, () => deps.getFen() === fen);
    if (!moves) return [];
    const total = [...moves.values()]
      .reduce((sum, c) => sum + c.white + c.draws + c.black, 0);
    if (!total) return [];
    const label = db === 'masters' ? 'masters' : 'Lichess players';
    const chess = new Chess(fen);
    const out: Candidate[] = [];
    for (const [uci, c] of moves) {
      const played = c.white + c.draws + c.black;
      if (!played) continue;
      let san = '';
      try {
        const m = chess.move({
          from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined,
        });
        if (m) { san = m.san; chess.undo(); }
      } catch { /* illegal here — skip it */ }
      if (!san) continue;
      out.push({
        uci,
        san,
        source: 'library',
        detail: `${Math.round((100 * played) / total)}% of ${label} play this`,
        weight: played,
      });
    }
    return out.sort((a, b) => b.weight - a.weight);
  }

  // The engine's best moves, for positions the games and the book have both run
  // out on. The Lichess cloud only — the local worker is the Engine tab's job,
  // and firing it up on every Explore repaint would cost more than it's worth.
  async function engineCandidates(fen: string): Promise<Candidate[]> {
    const lines = await cloudTopLines(fen);
    if (!lines?.length) return [];
    return lines.slice(0, SUGGESTIONS).map((m, i) => ({
      uci: m.uci,
      san: m.san ?? m.uci,
      source: 'engine' as const,
      detail: i === 0
        ? `Engine’s best move${scoreSuffix(m.cp, m.mate)}`
        : `Engine’s #${i + 1} move${scoreSuffix(m.cp, m.mate)}`,
      // Rank 0 is the strongest, so invert it into a descending weight.
      weight: SUGGESTIONS - i,
    }));
  }

  // ── Merging ───────────────────────────────────────────────────────────────

  // One row per move, keeping the highest-priority source that suggested it (a
  // move you played AND masters play is listed as yours — that's the stronger
  // reason), and carrying across any opening name the book contributed.
  function mergeCandidates(all: Candidate[]): Candidate[] {
    const rank: Record<ExploreSource, number> = { games: 0, library: 1, engine: 2 };
    const byUci = new Map<string, Candidate>();
    for (const c of all) {
      const existing = byUci.get(c.uci);
      if (!existing) { byUci.set(c.uci, { ...c }); continue; }
      // Keep the better source; either way, don't lose a known opening name.
      const winner = rank[c.source] < rank[existing.source] ? { ...c } : existing;
      winner.opening = winner.opening ?? c.opening ?? existing.opening;
      // Within the library source the explorer's real popularity beats the
      // book's theory-count placeholder, so let a richer detail win.
      if (winner === existing && c.source === existing.source && c.weight > existing.weight) {
        winner.detail = c.detail;
        winner.weight = c.weight;
      }
      byUci.set(c.uci, winner);
    }
    return [...byUci.values()]
      .sort((a, b) => rank[a.source] - rank[b.source] || b.weight - a.weight)
      .slice(0, SUGGESTIONS);
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  function paintRows(host: HTMLElement, picks: Candidate[], fen: string): void {
    if (deps.getFen() !== fen) return;
    host.replaceChildren();

    if (!picks.length) {
      host.appendChild(emptyState());
      return;
    }

    const prefix = movePrefix(deps.getSans().length);
    for (const c of picks) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `explore-card explore-card--${c.source}`;
      row.addEventListener('click', () => deps.onPlay(c.uci));

      const move = document.createElement('span');
      move.className = 'explore-card-move';
      move.textContent = `${prefix} ${formatMove(c.san)}`;
      row.appendChild(move);

      const body = document.createElement('span');
      body.className = 'explore-card-body';
      body.appendChild(sourceChip(c.source));
      const detail = document.createElement('span');
      detail.className = 'explore-card-detail';
      detail.textContent = c.detail;
      body.appendChild(detail);
      if (c.opening) {
        const name = document.createElement('span');
        name.className = 'explore-card-opening';
        name.textContent = c.opening;
        body.appendChild(name);
      }
      row.appendChild(body);

      const chev = Icons.chevronRight(18);
      chev.classList.add('explore-card-chev');
      row.appendChild(chev);
      host.appendChild(row);
    }
  }

  // The badge that says why a move is on the list. It's the whole reason the
  // slide is trustworthy — a suggestion with no stated basis is just an opinion.
  function sourceChip(source: ExploreSource): HTMLElement {
    const chip = document.createElement('span');
    chip.className = `explore-chip explore-chip--${source}`;
    const icon = source === 'games' ? Icons.grid2x2(12)
      : source === 'library' ? Icons.book(12)
      : Icons.cpu(12);
    chip.appendChild(icon);
    chip.appendChild(document.createTextNode(
      source === 'games' ? 'Your games' : source === 'library' ? 'Library' : 'Engine',
    ));
    return chip;
  }

  function emptyState(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'explore-empty';
    const note = document.createElement('div');
    note.className = 'bx-empty';
    note.textContent = games && games.length
      ? 'Nothing to suggest from here yet — play a move on the board, or check the Library tab.'
      : 'Import your games and the suggestions here start with the moves you actually play.';
    wrap.appendChild(note);
    if (!games || !games.length) {
      const cta = document.createElement('button');
      cta.type = 'button';
      cta.className = 'games-refresh-btn builder-slide-action';
      cta.textContent = 'Import my games';
      cta.addEventListener('click', () => deps.onImportGames());
      wrap.appendChild(cta);
    } else if (!isConnected()) {
      const note2 = document.createElement('div');
      note2.className = 'bx-empty bx-frontier';
      note2.textContent = 'Connect Lichess on the Library tab to reach deeper positions.';
      wrap.appendChild(note2);
    }
    return wrap;
  }

  return {
    render,
    reload() { loadGames(); },
    setActive(on: boolean) {
      if (on === active) return;
      active = on;
      // Entering the slide: repaint so the library/engine sources are fetched now.
      if (on) render();
    },
  };
}

// ── small helpers ────────────────────────────────────────────────────────────

function sideToMove(fen: string): 'white' | 'black' {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

function movePrefix(ply: number): string {
  const num = Math.floor(ply / 2) + 1;
  return ply % 2 === 0 ? `${num}.` : `${num}…`;
}

// " +0.35" / " mate in 3" / "" — the engine's verdict, in the mover's favour or
// against them, kept short enough to ride at the end of a sentence.
function scoreSuffix(cp?: number, mate?: number): string {
  if (mate !== undefined) return `, mate in ${Math.abs(mate)}`;
  if (cp === undefined) return '';
  return `, ${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(2)}`;
}
