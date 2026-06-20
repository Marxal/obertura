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
import { getAllGames } from './storage';
import { buildMoveStats, statAt, statScorePct, type StatNode } from './move-stats';
import { MAP_MAX_PLIES } from './scout';
import { wdlScoreRow } from './wdl-bar';
import type { ImportedGame } from './import-core';

export interface BuilderPanelsDeps {
  libraryEl: HTMLElement;
  gamesEl: HTMLElement;
  getSans: () => string[];          // SAN path to the current cursor node
  getUcis: () => string[];          // UCI path to the current cursor node
  getFen: () => string;             // FEN of the current position
  getColour: () => 'white' | 'black';
  onPlay: (uci: string) => void;    // play this move onto the line
}

export interface BuilderPanels {
  render(): void;                   // repaint both slides for the current position
  reload(): void;                   // re-read games from storage (after an import)
}

export function createBuilderPanels(deps: BuilderPanelsDeps): BuilderPanels {
  let book: BookNode | null = null;
  let games: ImportedGame[] | null = null;
  const statsByColour = new Map<'white' | 'black', StatNode>();

  // Lazy loads — repaint each slide once its data lands.
  loadBookEntries()
    .then(entries => { book = buildBook(entries); renderLibrary(); })
    .catch(() => { /* leave the loading note */ });
  loadGames();

  function loadGames(): void {
    getAllGames()
      .then(g => { games = g; statsByColour.clear(); renderGames(); })
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
    // One chess seeded at the live position resolves each candidate to a UCI and
    // the opening name it reaches (play, read, undo).
    const chess = new Chess(deps.getFen());
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
      row.appendChild(span('lib-bx-count', `${child.count}`));
      el.appendChild(row);
    }
  }

  // ── Games slide ───────────────────────────────────────────────────────────
  function renderGames(): void {
    const el = deps.gamesEl;
    el.innerHTML = '';
    if (!games) { el.appendChild(emptyNote('Loading your games…')); return; }

    const stats = statsFor(deps.getColour());
    if (!stats || stats.games === 0) {
      el.appendChild(emptyNote('No imported games for this colour yet — import games in Explore.'));
      return;
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

  return {
    render() { renderLibrary(); renderGames(); },
    reload() { loadGames(); },
  };
}

// ── small helpers ─────────────────────────────────────────────────────────────

function movePrefix(ply: number): string {
  const num = Math.floor(ply / 2) + 1;
  return ply % 2 === 0 ? `${num}.` : `${num}…`;
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
