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
// Now the top of the panel is a row of three raised, tinted, plus-marked tiles —
// the move and where it came from — and tapping one plays it onto the line.
// Everything under them is the argument for them: the same three moves again,
// each with its whole record laid out.
//
// NOTHING IS HIDDEN BEHIND A TAP. The record used to sit under a chevron, one
// disclosure per card. That made the interesting part — how a move actually
// scores — invisible exactly when you were deciding, and made comparing three
// moves a three-tap job. Now every card shows the same fixed layout, so the
// three cards read as a table: your win/draw/loss bar over the database's win/
// draw/loss bar, aligned to the same grid, with one line saying which way the
// comparison went and a row of facts (engine evaluation, popularity) underneath.
//
// WHERE THE THREE COME FROM, IN ORDER OF PRIORITY:
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
// The cloud eval is now asked for at EVERY position the slide shows, not only
// when the other two sources came up short — one cached GET per position, which
// is what lets a card from any source carry an evaluation.
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
import { bandRangeLabel, explorerFilter } from './explorer-bands';
import { activeBand, cachedMyLevel, resolveMyLevel, type MyLevel } from './explorer-level';
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

// Below this many of your own games, "you score better than the book here" is
// noise — one win out of one game is a 100% score. The two bars still both show;
// only the verdict line waits for a sample worth reading.
const COMPARE_MIN_GAMES = 3;

// A score gap this small either way reads as "the same", because it is.
const COMPARE_LEVEL_PTS = 3;

// Cloud evals, kept per position for the life of the panel so re-rendering the
// same position (a repaint when a slower source lands) costs nothing.
const EVAL_CACHE_MAX = 80;

export type ExploreSource = 'games' | 'library' | 'engine';

interface Candidate {
  uci: string;
  san: string;
  source: ExploreSource;
  // Sort key WITHIN a source: game count, explorer game count, engine rank.
  weight: number;
  // The opening this move reaches, when the book knows one — a name is the best
  // single hint about where a move leads.
  opening?: string;
  // An override for the headline, used only by the walkthrough's scripted move.
  note?: string;

  // ── your games ──
  // How the games in which this move appeared actually went, from the line
  // owner's side (so it reads the same whether you played the move or faced it).
  mine?: WdlCounts;

  // ── the database ──
  db?: WdlCounts;          // the same, from the explorer's games
  dbSharePct?: number;     // this move's share of the database's games here
  dbLabel?: string;        // 'masters' | 'Lichess players'

  // ── the engine ──
  cp?: number;             // white-perspective, like every other eval in the app
  mate?: number;
  engineRank?: number;     // 0 = the engine's first choice
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
  // The user's playing strength, behind the "Around my level" band. Seeded from
  // the cache so the first render already filters correctly, then refreshed;
  // held in one place so every render builds its filter from the same value.
  let myLevel: MyLevel | null = cachedMyLevel();
  const statsByColour = new Map<'white' | 'black', StatNode>();
  const evalCache = new Map<string, Promise<MoveEval[]>>();

  void resolveMyLevel().then(found => {
    if (!found) return;
    myLevel = found;
    render();
  }).catch(() => { /* no level — the band stays All ratings */ });

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
      const lib = await libraryCandidates(fen);
      if (deps.getFen() !== fen) return;
      const known = mergeCandidates([...instant, ...lib]);
      paint(picks, rows, known, fen);

      // The engine, always: its evaluation is a fact about every candidate, not
      // just about the moves it had to supply itself. The cloud answers most
      // opening positions instantly and for free; only when the other sources
      // left an empty slot do we pay for a local search to fill it.
      const eng = await engineCandidates(fen, known.length < SUGGESTIONS);
      if (deps.getFen() !== fen || !eng.length) return;
      paint(picks, rows, mergeCandidates([...instant, ...lib, ...eng]), fen);
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
    return [...node.children.values()]
      .filter(c => c.games > 0)
      .sort((a, b) => b.games - a.games)
      .map(c => ({
        uci: c.uci,
        san: c.san,
        source: 'games' as const,
        weight: c.games,
        mine: {
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
    const { band } = activeBand(myLevel);
    const filter = explorerFilter(db, band, myLevel?.rating ?? null);
    const { moves, coverage } = await resolveExplorerStats(
      fen, db, true, () => deps.getFen() === fen, filter,
    );
    if (!moves) return [];
    const total = [...moves.values()]
      .reduce((sum, c) => sum + c.white + c.draws + c.black, 0);
    if (!total) return [];
    // The label carries the band, because these numbers are quoted in sentences
    // — "62% of Lichess players play this", "+6 points better than them here" —
    // and a claim about "players" that silently means "players near your rating"
    // is a different claim. `coverage` (not the preference) decides, so a fetch
    // that fell back to the bundled all-ratings set says so rather than
    // inheriting the band's label.
    const label = db === 'masters'
      ? 'masters'
      : coverage === 'band'
        ? `Lichess players ${bandRangeLabel(band, myLevel?.rating ?? null)}`
        : band === 'all' ? 'Lichess players' : 'Lichess players (all ratings)';
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
        weight: counts.games,
        db: counts,
        dbSharePct: Math.round((100 * counts.games) / total),
        dbLabel: label,
      });
    }
    return out.sort((a, b) => b.weight - a.weight);
  }

  // The engine's read on this position. The Lichess cloud first — free, cached
  // per position, and it knows most opening positions. `allowLocal` is set only
  // when the other sources left a slot empty: then the dedicated review worker
  // runs a short shallow search, which is NOT the live Engine, so this still
  // works with the engine toggle off. That's the whole point of promising three
  // suggestions.
  async function engineCandidates(fen: string, allowLocal: boolean): Promise<Candidate[]> {
    // The cache holds the PROMISE, not the answer: render() runs several times
    // per position (the book lands, the games land, the slide opens), and
    // caching only the settled value would let three identical requests race
    // out before the first one came back.
    let pending = evalCache.get(fen);
    if (!pending) {
      if (evalCache.size >= EVAL_CACHE_MAX) evalCache.clear();
      pending = cloudTopLines(fen).then(l => l ?? []).catch(() => []);
      evalCache.set(fen, pending);
    }
    let lines: MoveEval[] = await pending;
    if (!lines.length && allowLocal) {
      lines = await analysePosition(fen, LOCAL_DEPTH, undefined, {
        multiPv: SUGGESTIONS, movetimeMs: LOCAL_MOVETIME_MS,
      });
    }
    if (!lines.length) return [];
    return lines.slice(0, SUGGESTIONS).map((m, i) => ({
      uci: m.uci,
      san: m.san || m.uci,
      source: 'engine' as const,
      // Rank 0 is the strongest, so invert it into a descending weight.
      weight: SUGGESTIONS - i,
      engineRank: i,
      cp: m.cp,
      mate: m.mate,
    }));
  }

  // ── Merging ───────────────────────────────────────────────────────────────

  // One row per move, keeping the highest-priority source that suggested it (a
  // move you played AND masters play is listed as yours — that's the stronger
  // reason), and carrying across everything the other sources knew about it. The
  // carry-across is what fills a card: a "your games" move gets the database's
  // bar and the engine's evaluation from the losing entries.
  function mergeCandidates(all: Candidate[]): Candidate[] {
    const rank: Record<ExploreSource, number> = { games: 0, library: 1, engine: 2 };
    const byUci = new Map<string, Candidate>();
    for (const c of all) {
      const existing = byUci.get(c.uci);
      if (!existing) { byUci.set(c.uci, { ...c }); continue; }
      // Keep the better source; either way, don't lose what the other one knew.
      const winner = rank[c.source] < rank[existing.source] ? { ...c } : existing;
      const loser = winner === existing ? c : existing;
      winner.opening ??= loser.opening;
      winner.note ??= loser.note;
      winner.mine ??= loser.mine;
      winner.db ??= loser.db;
      winner.dbSharePct ??= loser.dbSharePct;
      winner.dbLabel ??= loser.dbLabel;
      winner.cp ??= loser.cp;
      winner.mate ??= loser.mate;
      winner.engineRank ??= loser.engineRank;
      // Within the library source the explorer's real game counts beat the
      // book's theory-count placeholder, so let the bigger number rank the row.
      if (winner.source === loser.source && loser.weight > winner.weight) {
        winner.weight = loser.weight;
      }
      byUci.set(c.uci, winner);
    }

    const ordered = [...byUci.values()]
      .sort((a, b) => rank[a.source] - rank[b.source] || b.weight - a.weight);

    // The walkthrough's scripted move leads the three even if the sources rank
    // it fourth, or don't know it at all — the bubble is about to point at it,
    // and "tap the ringed move" has to be possible.
    if (highlightUci) {
      const at = ordered.findIndex(c => c.uci === highlightUci);
      if (at > 0) ordered.unshift(...ordered.splice(at, 1));
      else if (at < 0) {
        const own = scriptedCandidate(highlightUci);
        if (own) ordered.unshift(own);
      }
    }
    return ordered.slice(0, SUGGESTIONS);
  }

  // A candidate for a move none of the sources offered — only ever the
  // walkthrough's own next move, which is by definition the right answer here.
  function scriptedCandidate(uci: string): Candidate | null {
    try {
      const chess = new Chess(deps.getFen());
      const m = chess.move({
        from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined,
      });
      if (!m) return null;
      return {
        uci, san: m.san, source: 'library',
        note: 'The next move of the line you’re building',
        weight: Number.MAX_SAFE_INTEGER,
      };
    } catch {
      return null;   // not legal here — the cue is stale, so drop it
    }
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
    const faced = !myTurn();
    for (const c of list) {
      picksHost.appendChild(pickTile(c, prefix, faced));
      rowsHost.appendChild(detailCard(c, prefix, faced));
    }
  }

  // A quick pick, and it has to LOOK like the button it is: a raised, tinted,
  // source-coloured tile with a plus in the corner saying what tapping does.
  // Nothing else — the whole row has to fit three of these across a phone, and
  // the argument for each move is right underneath.
  function pickTile(c: Candidate, prefix: string, faced: boolean): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `explore-pick explore-pick--${c.source}`;
    if (c.uci === highlightUci) btn.classList.add('explore-pick--cue');
    btn.addEventListener('click', () => deps.onPlay(c.uci));

    const move = document.createElement('span');
    move.className = 'explore-pick-move';
    move.textContent = `${prefix} ${formatMove(c.san)}`;
    btn.appendChild(move);

    const src = document.createElement('span');
    src.className = 'explore-pick-src';
    src.appendChild(sourceIcon(c.source, 11));
    src.appendChild(document.createTextNode(sourceName(c.source)));
    btn.appendChild(src);

    const add = document.createElement('span');
    add.className = 'explore-pick-add';
    add.appendChild(Icons.plus(13));
    btn.appendChild(add);

    const why = headline(c, faced);
    btn.setAttribute('aria-label', `Add ${prefix} ${c.san} to the line — ${why}`);
    btn.title = why;
    return btn;
  }

  // The same move again, with everything we know about it laid out in the same
  // order on every card: what it is, how you score with it, how the database
  // scores with it, which way that comparison went, and the loose facts.
  function detailCard(c: Candidate, prefix: string, faced: boolean): HTMLElement {
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
    body.appendChild(span('explore-card-detail', headline(c, faced)));
    head.appendChild(body);

    const add = document.createElement('span');
    add.className = 'explore-card-add';
    add.appendChild(Icons.plus(16));
    head.appendChild(add);
    head.setAttribute('aria-label', `Add ${prefix} ${c.san} to the line`);
    wrap.appendChild(head);

    const stats = statsBlock(c);
    if (stats) wrap.appendChild(stats);
    return wrap;
  }

  // Everything that used to live behind the chevron, always open and always in
  // the same places, so three cards can be read as one table.
  function statsBlock(c: Candidate): HTMLElement | null {
    const grid = document.createElement('div');
    grid.className = 'explore-stats';

    if (c.mine) {
      grid.appendChild(span('explore-stat-label', 'You'));
      grid.appendChild(wdlScoreRow(c.mine, gamesLabel(c.mine.games)));
    }
    if (c.db) {
      grid.appendChild(span('explore-stat-label', dbShort(c.dbLabel)));
      grid.appendChild(wdlScoreRow(c.db, `${compactCount(c.db.games)} games`));
    }

    const verdict = compareLine(c);
    if (verdict) grid.appendChild(verdict);

    const facts = factsRow(c);
    if (facts) grid.appendChild(facts);

    return grid.childElementCount ? grid : null;
  }

  // The green/red line: your score against the database's, in words, so the two
  // bars above it don't have to be eyeballed. Only once your own sample is big
  // enough to mean anything.
  function compareLine(c: Candidate): HTMLElement | null {
    if (!c.mine || !c.db || !c.db.games) return null;
    if (c.mine.games < COMPARE_MIN_GAMES) return null;

    const delta = c.mine.scorePct - c.db.scorePct;
    const kind = delta >= COMPARE_LEVEL_PTS ? 'up'
      : delta <= -COMPARE_LEVEL_PTS ? 'down'
      : 'level';
    const label = c.dbLabel ?? 'the database';

    const row = document.createElement('div');
    row.className = `explore-compare explore-compare--${kind}`;

    if (kind === 'level') {
      row.appendChild(span('explore-compare-text',
        `You score about the same as ${label} here`));
      return row;
    }

    const ico = Icons.trending(13);
    ico.classList.add('explore-compare-ico');
    row.appendChild(ico);
    row.appendChild(span('explore-compare-delta',
      `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`));
    row.appendChild(span('explore-compare-text',
      kind === 'up' ? `points better than ${label} here`
        : `points worse than ${label} here`));
    return row;
  }

  // The loose numbers that don't deserve a bar: the engine's verdict, and how
  // popular the move is when the headline hasn't already said so.
  function factsRow(c: Candidate): HTMLElement | null {
    const row = document.createElement('div');
    row.className = 'explore-facts';

    if (c.cp !== undefined || c.mate !== undefined) {
      const lean = evalLean(c.cp, c.mate);
      const text = evalText(c.cp, c.mate);
      const f = fact('Engine', lean ? `${text} · ${lean}` : text);
      f.title = 'The engine’s evaluation after this move, from White’s side';
      row.appendChild(f);
    }
    // A move of yours that is ALSO one of the engine's top three is the single
    // most reassuring thing this card can say, so it gets its own fact. On an
    // engine row the headline already said it.
    if (c.source !== 'engine' && c.engineRank !== undefined) {
      row.appendChild(fact('Engine pick', `#${c.engineRank + 1}`));
    }
    // For a library row the headline already IS the popularity — don't say it
    // twice; for a move of yours or the engine's, it's news.
    if (c.dbSharePct !== undefined && c.source !== 'library') {
      row.appendChild(fact('Played by', `${c.dbSharePct}% of ${c.dbLabel ?? 'them'}`));
    }
    return row.childElementCount ? row : null;
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

// ── the case for a move, in one line ─────────────────────────────────────────

// Why this move is on the list at all — the sentence under the source chip.
function headline(c: Candidate, faced: boolean): string {
  if (c.note) return c.note;
  if (c.source === 'games' && c.mine) {
    const n = c.mine.games;
    return faced
      ? `You’ve faced this in ${n} game${n === 1 ? '' : 's'}`
      : `You played this in ${n} game${n === 1 ? '' : 's'}`;
  }
  if (c.source === 'library') {
    return c.dbSharePct !== undefined
      ? `${c.dbSharePct}% of ${c.dbLabel ?? 'players'} play this`
      : 'Main opening theory';
  }
  if (c.source === 'engine') {
    return c.engineRank ? `The engine’s #${c.engineRank + 1} choice here`
      : 'The engine’s first choice here';
  }
  return '';
}

// ── small helpers ────────────────────────────────────────────────────────────

function sourceIcon(source: ExploreSource, size: number): SVGElement {
  return source === 'games' ? Icons.grid2x2(size)
    : source === 'library' ? Icons.book(size)
    : Icons.cpu(size);
}

function sourceName(source: ExploreSource): string {
  return source === 'games' ? 'Your games' : source === 'library' ? 'Library' : 'Engine';
}

// The badge that says why a move is on the list. It's the whole reason the
// slide is trustworthy — a suggestion with no stated basis is just an opinion.
function sourceChip(source: ExploreSource): HTMLElement {
  const chip = document.createElement('span');
  chip.className = `explore-chip explore-chip--${source}`;
  chip.appendChild(sourceIcon(source, 12));
  chip.appendChild(document.createTextNode(sourceName(source)));
  return chip;
}

function fact(key: string, value: string): HTMLElement {
  const f = document.createElement('span');
  f.className = 'explore-fact';
  f.appendChild(span('explore-fact-k', key));
  f.appendChild(span('explore-fact-v', value));
  return f;
}

function span(cls: string, text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
}

function gamesLabel(n: number): string {
  return `${n} game${n === 1 ? '' : 's'}`;
}

function dbShort(label?: string): string {
  return label === 'masters' ? 'Masters' : label ? 'Lichess' : 'Database';
}

function sideToMove(fen: string): 'white' | 'black' {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

function movePrefix(ply: number): string {
  const num = Math.floor(ply / 2) + 1;
  return ply % 2 === 0 ? `${num}.` : `${num}…`;
}

// White-perspective, like every other eval in the app: "+0.35" is White better.
function evalText(cp?: number, mate?: number): string {
  if (mate !== undefined) return mate > 0 ? `#${mate}` : `#−${Math.abs(mate)}`;
  if (cp === undefined) return '—';
  return `${cp >= 0 ? '+' : '−'}${(Math.abs(cp) / 100).toFixed(2)}`;
}

// Which way the evaluation leans, in three words or none. Empty when the
// position is level, because "+0.12 · about level" is the number twice.
function evalLean(cp?: number, mate?: number): string {
  if (mate !== undefined) {
    return mate > 0 ? `White mates in ${mate}` : `Black mates in ${Math.abs(mate)}`;
  }
  if (cp === undefined) return '';
  return cp > 40 ? 'White better' : cp < -40 ? 'Black better' : '';
}
