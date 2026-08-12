// The builder's Explore slide — three curated moves at a glance, then the case
// for each of them.
//
// WHY THREE. Library already answers "what is playable here" exhaustively: a
// scrolling list of every book continuation with its win rates. That list is the
// right tool once you know what you're looking for, and the wrong one when you
// don't — a first-time builder facing twenty ranked continuations picks the top
// row, which is a menu, not a decision. Explore asks a narrower question and
// answers it in three: given YOUR games, the master library and the engine, what
// are the three moves actually worth having in your repertoire here?
//
// THE THREE COME FIRST, AS THREE BUTTONS. The slide used to open with a heading
// and a subheading, so the thing you came to do was below two lines of prose.
// Now the top of the panel is a row of three tiles — the move and a mark saying
// where it came from — and tapping one plays it. Everything under them is the
// argument for them: the same three moves again, with the number that earned
// each its place and, one tap further, the record behind it.
//
// WHERE THEY COME FROM, IN ORDER OF PRIORITY:
//
//   1. Your games      — a move you have actually played (or actually faced) in
//                        an imported online game. Nothing beats this: a
//                        repertoire is for the positions you really get.
//   2. The library     — the most popular continuation among masters or Lichess
//                        players, from the same statistics the Library slide
//                        draws (bundled, plus the live explorer when connected).
//   3. The engine      — for a position your games and the book have both run
//                        out on. The engine here does NOT depend on the engine
//                        toggle: the Lichess cloud answers most opening
//                        positions for free, and where it can't, the dedicated
//                        review worker (the one game review uses, separate from
//                        the live Engine) runs a short shallow search. Three
//                        suggestions is the promise of the slide, and "turn the
//                        engine on first" is not an answer to a question.
//
// THE HEADER IS THE FRAMING. On your move the question is "what do I play?" — the
// rows are answers. On the opponent's move it's "what do they play?" — the rows
// are things to prepare for, and tapping one builds the branch that meets it.

import { Chess } from 'chess.js';
import { buildBook, bookNodeAt, loadBookEntries, type BookNode } from './book-tree';
import { getAllGames } from './storage';
import { buildMoveStats, statAt, statScorePct, type StatNode } from './move-stats';
import { MAP_MAX_PLIES } from './scout';
import { formatMove } from './notation';
import { Icons } from './icons';
import { getExplorerDb } from './prefs';
import { resolveExplorerStats, orientCounts } from './explorer-resolve';
import { cloudTopLines, analysePosition, type MoveEval } from './engine';
import { wdlScoreRow, type WdlCounts } from './wdl-bar';
import { compactCount } from './builder-panels';
import type { ImportedGame } from './import-core';

// How many suggestions the slide ever shows. Three is the point of the slide.
const SUGGESTIONS = 3;

// The last-resort local search: shallow and time-boxed, because it runs to fill
// a gap in a suggestion list, not to analyse a position. Deep enough to rank
// three candidate moves; cheap enough that a phone doesn't notice.
const LOCAL_DEPTH = 12;
const LOCAL_MOVETIME_MS = 1200;

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
  // The record behind the move, when the source has one: how the games that
  // played it actually went, from the line owner's side.
  wdl?: WdlCounts;
  // The engine's verdict, white-perspective like every other eval in the app.
  cp?: number;
  mate?: number;
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
  // The walkthrough's scripted next move: pinned into the three and ringed, so
  // the bubble that says "tap one to add it to your line" has something to point
  // at. Null clears it.
  setHighlight(uci: string | null): void;
}

export function createExplorePanel(deps: ExplorePanelDeps): ExplorePanel {
  let book: BookNode | null = null;
  let games: ImportedGame[] | null = null;
  let active = false;
  let highlightUci: string | null = null;
  const statsByColour = new Map<'white' | 'black', StatNode>();
  // Which rows the user has opened. Keyed by uci so it survives a repaint when
  // the slower sources land, and cleared whenever the position changes.
  let expanded = new Set<string>();
  let expandedFen = '';

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

    // A new position is a new question; nothing stays open across it.
    if (fen !== expandedFen) { expanded = new Set(); expandedFen = fen; }

    el.replaceChildren();

    // The three tiles, at the very top — the reason the slide exists is one tap
    // from the top of the panel, not below a paragraph.
    const picks = document.createElement('div');
    picks.className = 'explore-picks';
    el.appendChild(picks);

    el.appendChild(buildHeader());

    const rows = document.createElement('div');
    rows.className = 'explore-rows';
    el.appendChild(rows);

    // Draw what we can answer instantly (your games + the bundled book), then
    // fill the remaining slots once the slower sources land. The slide is never
    // blank waiting on a network call.
    const instant = mergeCandidates([...gameCandidates(), ...bookCandidates()]);
    paint(picks, rows, instant, fen);

    // The library's popularity numbers and the engine only get asked for while
    // the slide is actually showing — this render() runs on every move.
    if (!active) return;

    void (async () => {
      const extra: Candidate[] = [];
      const lib = await libraryCandidates(fen);
      if (deps.getFen() !== fen) return;
      extra.push(...lib);
      paint(picks, rows, mergeCandidates([...instant, ...extra]), fen);

      // The engine is the last resort — and the guarantee. If your games and the
      // book between them can't fill three rows, ask it, whether or not the
      // user has the live engine switched on.
      if (mergeCandidates([...instant, ...extra]).length >= SUGGESTIONS) return;
      const eng = await engineCandidates(fen);
      if (deps.getFen() !== fen || !eng.length) return;
      paint(picks, rows, mergeCandidates([...instant, ...extra, ...eng]), fen);
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
        wdl: {
          wins: c.wins, draws: c.draws, losses: c.losses,
          scorePct: statScorePct(c), games: c.games,
        },
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
  // "there is theory here" into "this is what people actually play", and carry
  // the win/draw/loss record behind each move.
  async function libraryCandidates(fen: string): Promise<Candidate[]> {
    const db = getExplorerDb();
    const { moves } = await resolveExplorerStats(fen, db, true, () => deps.getFen() === fen);
    if (!moves) return [];
    const total = [...moves.values()]
      .reduce((sum, c) => sum + c.white + c.draws + c.black, 0);
    if (!total) return [];
    const label = db === 'masters' ? 'masters' : 'Lichess players';
    const colour = deps.getColour();
    const chess = new Chess(fen);
    const out: Candidate[] = [];
    for (const [uci, c] of moves) {
      const counts = orientCounts(c, colour);
      if (!counts.games) continue;
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
        detail: `${Math.round((100 * counts.games) / total)}% of ${label} play this`,
        weight: counts.games,
        wdl: counts,
      });
    }
    return out.sort((a, b) => b.weight - a.weight);
  }

  // The engine's best moves, for positions the games and the book have both run
  // out on. The Lichess cloud first — free, instant, and it knows most opening
  // positions. Where it can't answer, the dedicated review worker runs a short
  // shallow search: NOT the live Engine, so this works with the engine toggle
  // off, which is the whole point of promising three suggestions.
  async function engineCandidates(fen: string): Promise<Candidate[]> {
    let lines: MoveEval[] | null = await cloudTopLines(fen);
    if (!lines?.length) {
      const local = await analysePosition(fen, LOCAL_DEPTH, undefined, {
        multiPv: SUGGESTIONS, movetimeMs: LOCAL_MOVETIME_MS,
      });
      lines = local.length ? local : null;
    }
    if (!lines?.length) return [];
    return lines.slice(0, SUGGESTIONS).map((m, i) => ({
      uci: m.uci,
      san: m.san || m.uci,
      source: 'engine' as const,
      detail: i === 0 ? 'The engine’s first choice here' : `The engine’s #${i + 1} choice here`,
      // Rank 0 is the strongest, so invert it into a descending weight.
      weight: SUGGESTIONS - i,
      cp: m.cp,
      mate: m.mate,
    }));
  }

  // ── Merging ───────────────────────────────────────────────────────────────

  // One row per move, keeping the highest-priority source that suggested it (a
  // move you played AND masters play is listed as yours — that's the stronger
  // reason), and carrying across whatever the other sources knew about it.
  function mergeCandidates(all: Candidate[]): Candidate[] {
    const rank: Record<ExploreSource, number> = { games: 0, library: 1, engine: 2 };
    const byUci = new Map<string, Candidate>();
    for (const c of all) {
      const existing = byUci.get(c.uci);
      if (!existing) { byUci.set(c.uci, { ...c }); continue; }
      // Keep the better source; either way, don't lose what the other one knew.
      const winner = rank[c.source] < rank[existing.source] ? { ...c } : existing;
      const loser = winner === existing ? c : existing;
      winner.opening = winner.opening ?? loser.opening;
      winner.wdl = winner.wdl ?? loser.wdl;
      winner.cp = winner.cp ?? loser.cp;
      winner.mate = winner.mate ?? loser.mate;
      // Within the library source the explorer's real popularity beats the
      // book's theory-count placeholder, so let a richer detail win.
      if (winner === existing && c.source === existing.source && c.weight > existing.weight) {
        winner.detail = c.detail;
        winner.weight = c.weight;
      }
      byUci.set(c.uci, winner);
    }

    const ordered = [...byUci.values()]
      .sort((a, b) => rank[a.source] - rank[b.source] || b.weight - a.weight);

    // The walkthrough's scripted move must be one of the three even if the
    // sources rank it fourth — the bubble is about to point at it.
    if (highlightUci) {
      const at = ordered.findIndex(c => c.uci === highlightUci);
      if (at > 0) ordered.unshift(...ordered.splice(at, 1));
    }
    return ordered.slice(0, SUGGESTIONS);
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  function paint(
    picksHost: HTMLElement, rowsHost: HTMLElement, list: Candidate[], fen: string,
  ): void {
    if (deps.getFen() !== fen) return;
    picksHost.replaceChildren();
    rowsHost.replaceChildren();

    if (!list.length) {
      rowsHost.appendChild(emptyState());
      return;
    }

    const prefix = movePrefix(deps.getSans().length);
    for (const c of list) {
      picksHost.appendChild(pickTile(c, prefix));
      rowsHost.appendChild(detailRow(c, prefix));
    }
  }

  // A quick pick: the move, and a mark saying where it came from. Nothing else —
  // the whole row has to fit three of these across a phone, and the argument for
  // each move is right underneath.
  function pickTile(c: Candidate, prefix: string): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `explore-pick explore-pick--${c.source}`;
    if (c.uci === highlightUci) btn.classList.add('explore-pick--cue');
    btn.addEventListener('click', () => deps.onPlay(c.uci));

    const move = document.createElement('span');
    move.className = 'explore-pick-move';
    move.textContent = `${prefix} ${formatMove(c.san)}`;
    btn.appendChild(move);

    const mark = document.createElement('span');
    mark.className = 'explore-pick-mark';
    mark.appendChild(sourceIcon(c.source, 13));
    btn.appendChild(mark);

    btn.setAttribute('aria-label', `${prefix} ${c.san} — ${c.detail}`);
    btn.title = c.detail;
    return btn;
  }

  // The same move again, with the reason it's on the list and — one tap further
  // — the record behind it.
  function detailRow(c: Candidate, prefix: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = `explore-card explore-card--${c.source}`;
    if (c.uci === highlightUci) wrap.classList.add('explore-card--cue');

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'explore-card-head';
    head.addEventListener('click', () => deps.onPlay(c.uci));

    head.appendChild(span('explore-card-move', `${prefix} ${formatMove(c.san)}`));

    const body = document.createElement('span');
    body.className = 'explore-card-body';
    const chipRow = document.createElement('span');
    chipRow.className = 'explore-card-chiprow';
    chipRow.appendChild(sourceChip(c.source));
    if (c.opening) chipRow.appendChild(span('explore-card-opening', c.opening));
    body.appendChild(chipRow);
    body.appendChild(span('explore-card-detail', c.detail));
    head.appendChild(body);
    wrap.appendChild(head);

    // Nothing more to say about an engine pick with no eval — don't grow a
    // disclosure that opens onto nothing.
    const hasMore = !!c.wdl || c.cp !== undefined || c.mate !== undefined;
    if (!hasMore) return wrap;

    const isOpen = expanded.has(c.uci);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'explore-card-toggle';
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.setAttribute('aria-label', isOpen ? 'Hide the record' : 'Show the record');
    const chev = Icons.chevronDown(18);
    chev.classList.add('explore-card-chev');
    toggle.appendChild(chev);
    toggle.addEventListener('click', () => {
      if (expanded.has(c.uci)) expanded.delete(c.uci); else expanded.add(c.uci);
      render();
    });
    wrap.appendChild(toggle);

    if (!isOpen) return wrap;

    const more = document.createElement('div');
    more.className = 'explore-card-more';
    if (c.wdl) {
      const caption = c.source === 'games' ? 'How those games went' : 'How this move scores';
      more.appendChild(span('explore-more-label', caption));
      more.appendChild(wdlScoreRow(c.wdl, compactCount(c.wdl.games)));
    }
    if (c.cp !== undefined || c.mate !== undefined) {
      more.appendChild(span('explore-more-label', 'Engine evaluation'));
      more.appendChild(span('explore-more-eval', formatEval(c.cp, c.mate)));
    }
    wrap.appendChild(more);
    return wrap;
  }

  function sourceIcon(source: ExploreSource, size: number): SVGElement {
    return source === 'games' ? Icons.grid2x2(size)
      : source === 'library' ? Icons.book(size)
      : Icons.cpu(size);
  }

  // The badge that says why a move is on the list. It's the whole reason the
  // slide is trustworthy — a suggestion with no stated basis is just an opinion.
  function sourceChip(source: ExploreSource): HTMLElement {
    const chip = document.createElement('span');
    chip.className = `explore-chip explore-chip--${source}`;
    chip.appendChild(sourceIcon(source, 12));
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
      ? 'Nothing to suggest from here — this position is past everything we can reach.'
      : 'Import your games and the suggestions here start with the moves you actually play.';
    wrap.appendChild(note);
    if (!games || !games.length) {
      const cta = document.createElement('button');
      cta.type = 'button';
      cta.className = 'games-refresh-btn builder-slide-action';
      cta.textContent = 'Import my games';
      cta.addEventListener('click', () => deps.onImportGames());
      wrap.appendChild(cta);
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
    setHighlight(uci: string | null) {
      if (uci === highlightUci) return;
      highlightUci = uci;
      render();
    },
  };
}

// ── small helpers ────────────────────────────────────────────────────────────

function span(cls: string, text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
}

function sideToMove(fen: string): 'white' | 'black' {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

function movePrefix(ply: number): string {
  const num = Math.floor(ply / 2) + 1;
  return ply % 2 === 0 ? `${num}.` : `${num}…`;
}

// White-perspective, like every other eval in the app: "+0.35" is White better.
function formatEval(cp?: number, mate?: number): string {
  if (mate !== undefined) return mate > 0 ? `Mate in ${mate}` : `Mate in ${Math.abs(mate)} for Black`;
  if (cp === undefined) return '—';
  const s = `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(2)}`;
  return `${s} — ${cp > 40 ? 'White is better' : cp < -40 ? 'Black is better' : 'about level'}`;
}
