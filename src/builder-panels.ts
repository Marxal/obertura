// The builder's list slides: Library and My lines. Both read the builder's
// CURRENT position and list the continuations from here, each tappable to play
// it straight onto the line being built. They share the one builder board —
// there's no separate board here, just the move lists.
//
//   Library  — what the bundled opening book plays next (move, opening reached,
//              how many named openings lie down that branch).
//   My lines — three stacked sections, all answering "what happens from here?"
//              from a different source: your saved repertoire, your own imported
//              games (W/D/L split, drawn with the board browser's wdl row), and
//              My opponents — the scouted opponents' games, which used to be a
//              tab of their own.
//
// Explore and Engine are their own modules (explore-panel.ts, engine-panel.ts);
// the quick engine is the dock's engine icon and its docked eval bar (main.ts).

import { Chess } from 'chess.js';
import { nameForFen } from './openings';
import { buildBook, bookNodeAt, loadBookEntries, type BookNode } from './book-tree';
import { getAllGames, getAllOpponents, getAllLines } from './storage';
import type { Line } from './types';
import type { MoveNode } from './tree';
import { positionIndex, positionKey, type PositionIndex } from './position-index';
import { buildMoveStats, statAt, statScorePct, gameAtPath, type StatNode } from './move-stats';
import {
  MAP_MAX_PLIES, MAP_START_PLIES, MAP_STEP_PLIES,
  buildOpponentTree, opponentLine, type Opponent,
} from './scout';
import { openRepertoireMap } from './repertoire-map';
import { userAvatar } from './avatar';
import { Icons } from './icons';
import { formatMove } from './notation';
import { wdlScoreRow } from './wdl-bar';
import type { ExplorerDb } from './lichess-explorer';
import { resolveExplorerStats, orientCounts } from './explorer-resolve';
import {
  BANDS, bandLabel, bandShort, bandRangeLabel, explorerFilter, isNarrowed, type ExplorerBand,
} from './explorer-bands';
import { activeBand, cachedMyLevel, resolveMyLevel, levelSourceLabel, type MyLevel } from './explorer-level';
import { isConnected, connect, disconnect, stashReturn } from './lichess-auth';
import { getExplorerDb, setExplorerDb, setExplorerBand } from './prefs';
import { showDialog } from './dialog';
import { platformLabel } from './board-explorer';
import type { ImportedGame } from './import-core';

// Which slide is showing. The builder addresses its panels by name (main.ts owns
// the per-mode ordering), so nothing here depends on a slide's index.
export type BuilderSlideId = 'explore' | 'library' | 'mylines' | 'line' | 'engine';

export interface BuilderPanelsDeps {
  libraryEl: HTMLElement;
  gamesEl: HTMLElement;
  getSans: () => string[];          // SAN path to the current cursor node
  getUcis: () => string[];          // UCI path to the current cursor node
  getFen: () => string;             // FEN of the current position
  getColour: () => 'white' | 'black';
  // The saved line currently loaded into the builder, if any — so a
  // transposition/alternative-answer row never reports the line against itself.
  // Null on a fresh, unsaved build.
  getEditingLineId: () => string | null;
  onPlay: (uci: string) => void;    // play this move onto the line
  onImportGames: () => void;        // My games empty state → import your games
  onImportOpponent: () => void;     // My opponents → import a new opponent
  onOpenOpponentReport: (id: string) => void; // My opponents → their full report
  // My lines "show tree" → open a saved line. `atFen`, when given, lands the
  // builder on that position rather than the start.
  onOpenLine: (line: Line, atFen?: string) => void;
  // My saved lines → the trash on a continuation row. Only offered while a book
  // is actually open for editing (the analyser has no book to cut), which is
  // what `canRemoveLines` answers — the panel can't know the builder's mode.
  canRemoveLines: () => boolean;
  onRemoveContinuation: (uci: string) => void;
}

export interface BuilderPanels {
  render(): void;                   // repaint every slide for the current position
  showLibraryInfo(): void;          // the Library tab's "what am I looking at?" dialog
  reload(): void;                   // re-read games from storage (after an import)
  reloadLines(): void;              // re-read saved lines from storage (after a save)
  reloadOpponents(): void;          // re-read opponents from storage (after import)
  selectOpponent(id: string): void; // preselect an opponent (the board browser)
  setActiveSlide(id: BuilderSlideId): void; // which carousel slide is showing
}

export function createBuilderPanels(deps: BuilderPanelsDeps): BuilderPanels {
  let book: BookNode | null = null;
  let games: ImportedGame[] | null = null;
  let lines: Line[] | null = null;
  let opponents: Opponent[] | null = null;
  let selectedOppId: string | null = null;       // null → show the opponents list
  let activeSlide: BuilderSlideId = 'explore';
  // Which Lichess explorer database the Library slide draws its stats from.
  // Remembered across sessions; the toggle at the top of the slide flips it.
  let explorerDb: ExplorerDb = getExplorerDb();
  // …and which rating band those stats are filtered to. Held here, next to the
  // database, and passed DOWN into every resolve call — never re-read from prefs
  // deeper in the stack, because a request built from one value and cached under
  // another is precisely the bug the cache key was rewritten to make impossible.
  // Seeded from the cache so the FIRST paint already knows the band. Passing an
  // explicit null here instead would make every panel open on All ratings and
  // then visibly flip once the level resolved.
  let level: MyLevel | null = cachedMyLevel();
  let band: ExplorerBand = 'all';
  let bandInferred = false;
  syncBand();

  // Refresh the band from storage + whatever we know of the user's level. The
  // level resolves asynchronously (it may read games or the Lichess account), so
  // this runs once now for an instant first paint and again when it lands.
  function syncBand(): void {
    const active = activeBand(level);
    band = active.band;
    bandInferred = active.inferred;
    level = active.level;
  }

  void resolveMyLevel().then(found => {
    if (!found) return;
    level = found;
    syncBand();
    renderLibrary();
  }).catch(() => { /* no level — the band stays All ratings */ });
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
      .then(o => { opponents = o; oppStats.clear(); renderGames(); })
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
  // no login), overlaid with the live Lichess explorer when the user is
  // connected — see explorer-resolve.ts for the layering rule.
  function resolveStats(fen: string, db: ExplorerDb, allowLive: boolean) {
    // The filter is resolved HERE, from the slide's own band, and handed down.
    // Masters gets null — it has no rating dimension and silently ignores the
    // parameters rather than refusing them.
    const filter = explorerFilter(db, band, level?.rating ?? null);
    return resolveExplorerStats(fen, db, allowLive, () => deps.getFen() === fen, filter);
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
    resolveStats(fen, explorerDb, activeSlide === 'library').then(({ moves, liveFailed, coverage, bandEmpty }) => {
      if (deps.getFen() !== fen) return;    // position moved on; drop this
      let painted = 0;
      const colour = deps.getColour();
      for (const [uci, slot] of statSlots) {
        const c = moves?.get(uci);
        if (!c) continue;
        const counts = orientCounts(c, colour);
        if (!counts.games) continue;
        slot.className = 'lib-bx-wdl';
        slot.replaceChildren(wdlScoreRow(counts, compactCount(counts.games)));
        painted++;
      }
      // The book moves are still listed either way — they're theory, not
      // statistics — but with no bars on them. Say why, rather than leaving rows
      // that silently lost their numbers. This runs even when `moves` came back
      // empty or null: a position the bundled set has never heard of is exactly
      // where a failed fetch leaves nothing to show and most needs explaining.
      //
      // The note goes at the TOP, under the controls, not at the end of the
      // list: it explains the rows below it, and appended to a long book list it
      // would sit off the bottom of a phone screen — unread, which is the same
      // as absent.
      const note = bandEmpty ? bandEmptyNote()
        : liveFailed ? liveUnavailableNote(coverage, painted > 0)
        : null;
      if (note) el.insertBefore(note, el.children[1] ?? null);
    }).catch(() => { /* keep the plain counts */ });
  }

  // The off-book continuations: every move the stats database (or live Lichess)
  // plays from here, busiest first, each a tappable My-games-style W/D/L row.
  function renderStatMoves(el: HTMLElement, fen: string): void {
    resolveStats(fen, explorerDb, activeSlide === 'library').then(({ moves, liveFailed, coverage, bandEmpty }) => {
      if (deps.getFen() !== fen) return;       // position moved on; drop this
      const colour = deps.getColour();
      const chess = new Chess(fen);
      const prefix = movePrefix(deps.getSans().length);
      const rows = [...(moves?.entries() ?? [])]
        .map(([uci, c]) => ({ uci, counts: orientCounts(c, colour) }))
        .filter(r => r.counts.games > 0)
        .sort((a, b) => b.counts.games - a.counts.games);
      if (!rows.length) {
        // No games AT THIS LEVEL is a fact about the band, not about the
        // position — a narrow band runs out long before the database does. It
        // must never read as "New territory", so it gets its own state and a way
        // out of it.
        if (bandEmpty) { el.appendChild(bandEmptyNote()); return; }
        // Live fetch couldn't be reached: say so plainly rather than implying the
        // position is unexplored ("New territory") when we simply didn't ask.
        if (liveFailed) { el.appendChild(liveUnavailableNote(coverage)); return; }
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
      if (liveFailed) el.appendChild(liveUnavailableNote(coverage));
    }).catch(() => { /* graceful — bundled empty and live unavailable */ });
  }

  // A discreet note for when we're connected but the live explorer couldn't be
  // reached (CORS, rate limit, network) and we've fallen back to the bundled
  // book. Styled like the off-book frontier note so it stays unobtrusive.
  //
  // `coverage` is what the numbers on screen ACTUALLY describe, and it decides
  // the wording. The bundled set has no rating dimension whatsoever, so when a
  // band was asked for and this is what came back, the note has to say the
  // numbers are unfiltered. Filtered-looking, unfiltered data is the single most
  // misleading thing this slide could show.
  function liveUnavailableNote(coverage: 'band' | 'all', hasNumbers = true): HTMLElement {
    const note = emptyNote(
      !hasNumbers
        // Nothing to fall back ON: the bundled set doesn't reach this position
        // either. Don't claim to be showing built-in data when there is none.
        ? 'Couldn’t reach Lichess — no win rates for this position.'
        : coverage !== 'band' && bandNarrowed()
          ? 'Showing built-in data for ALL ratings — couldn’t reach Lichess.'
          : 'Showing built-in data — couldn’t reach Lichess.',
    );
    note.classList.add('bx-frontier');
    return note;
  }

  // Reached Lichess, asked for a band, and this position has no games at that
  // level. Not a dead end and not a failure — an invitation to widen.
  function bandEmptyNote(): HTMLElement {
    const wrap = document.createElement('div');
    const note = emptyNote(
      `No games at this level here — nobody rated ${bandRangeLabel(band, level?.rating ?? null)} has reached this position.`,
    );
    note.classList.add('bx-frontier');
    wrap.appendChild(note);
    wrap.appendChild(actionButton('Show all ratings', () => chooseBand('all')));
    return wrap;
  }

  // Is the current band actually narrowing anything? ('mine' with no known
  // rating resolves to the full range, so it isn't; nor does masters.)
  function bandNarrowed(): boolean {
    return isNarrowed(explorerFilter(explorerDb, band, level?.rating ?? null));
  }

  // Picking a band is always an explicit choice, so it's STORED even when it
  // matches what we'd have inferred — that's what turns the caption from "we
  // guessed this" into "you chose this".
  function chooseBand(next: ExplorerBand): void {
    if (band === next && !bandInferred) return;
    band = next;
    bandInferred = false;
    setExplorerBand(next);
    renderLibrary();
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
      bar.appendChild(bandPick());
    } else {
      const cta = document.createElement('button');
      cta.type = 'button';
      cta.className = 'lib-connect-cta lib-connect-cta--inline';
      cta.textContent = 'Connect Lichess for every position →';
      cta.addEventListener('click', doConnect);
      bar.appendChild(cta);
    }

    if (caption) bar.appendChild(span('lib-db-caption', caption));

    // The "about the opening database" (i) used to sit here. Every builder tab
    // now carries one info control, bottom right of the sheet, and this slide's
    // is that dialog — so the bar gets its width back.

    // The band's own quiet line sits UNDER the bar rather than in it: it's an
    // explanation, not a control, and on a phone the bar has no room left.
    const head = document.createElement('div');
    head.className = 'lib-db-head';
    head.appendChild(bar);
    const note = bandNote();
    if (note) head.appendChild(note);
    return head;
  }

  // The rating level, immediately after the Masters / Lichess toggle — it answers
  // the neighbouring question, these two together being "whose games am I looking
  // at?". A DROPDOWN rather than the six-pill strip it used to be: six labels
  // never fit a phone's width beside the source toggle, so the strip wrapped onto
  // a row of its own and the bar cost two lines to say one thing. A menu is one
  // control the width of its longest label, and a filter you set once and read
  // afterwards is exactly the kind that belongs behind one.
  //
  // The native <select> is laid transparently over the pill, so the platform's
  // own picker opens on a tap and the control stays accessible for free.
  function bandPick(): HTMLElement {
    // Masters is over-the-board games between titled players: it carries no
    // rating dimension at all, and the API quietly ignores the parameters rather
    // than refusing them. A control that looks live and does nothing is worse
    // than no control, so it's disabled with the reason on it.
    const off = explorerDb === 'masters';

    const wrap = document.createElement('div');
    wrap.className = 'lib-band-pick' + (off ? ' is-disabled' : '');

    const label = document.createElement('span');
    label.className = 'lib-band-pick-label';
    // Masters shows "All" because that is what its numbers actually are — the
    // stored band is remembered and comes back the moment Lichess is picked.
    label.textContent = off ? 'All' : bandShort(band);
    wrap.appendChild(label);

    const chev = Icons.chevronDown(14);
    chev.classList.add('lib-band-pick-chev');
    wrap.appendChild(chev);

    const select = document.createElement('select');
    select.className = 'lib-band-select';
    select.setAttribute('aria-label', 'Rating level');
    for (const b of BANDS) {
      // "Around my level" needs a level. Without one it would silently mean
      // "all ratings", so it isn't offered.
      if (b === 'mine' && !level) continue;
      const opt = document.createElement('option');
      opt.value = b;
      opt.textContent = bandLabel(b);
      if (!off && band === b) opt.selected = true;
      select.appendChild(opt);
    }
    if (off) {
      select.disabled = true;
      wrap.title = 'Masters games aren’t rating-filtered.';
    } else {
      select.addEventListener('change', () => chooseBand(select.value as ExplorerBand));
    }
    wrap.appendChild(select);

    return wrap;
  }

  // One quiet line under the bar saying what the band means right now — the
  // rating span it covers and, when the app worked the level out rather than
  // being told, where that came from. An inferred band that never announced
  // itself would be the app quietly changing the numbers behind the user's back.
  function bandNote(): HTMLElement | null {
    if (!isConnected()) return null;
    if (explorerDb === 'masters') {
      return span('lib-band-note', 'Masters games aren’t rating-filtered.');
    }
    // A fixed band's own button already says its range ("<1400", "2200+"), so
    // repeating it here would be noise. Only "My level" needs explaining — it's
    // the one whose numbers the user can't read off the control.
    if (band !== 'mine') return null;
    const parts = [`Around my level · ${bandRangeLabel(band, level?.rating ?? null)}`];
    if (level) parts.push(levelSourceLabel(level));
    const note = span('lib-band-note', parts.join(' · '));
    if (bandInferred) note.classList.add('lib-band-note--inferred');
    return note;
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
      title: 'Library',
      body:
        'Every move played from the position on the board, most popular first, with a bar '
        + 'saying how each has actually scored. Tap one to play it onto your line.\n\n'
        + 'Masters is over-the-board games between titled players — established theory. '
        + 'Lichess is rated online games, filtered to a rating band, so the numbers describe '
        + 'the opponents you actually get.\n\n'
        + 'A built-in set of common positions works offline with no login. Connecting Lichess '
        + 'extends it to every position, live — no personal data is read.',
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
  // Three stacked sections, each listing the continuations from the CURRENT
  // position and each topped by a discrete "Show tree" link that opens the full
  // tree for that source:
  //   • My saved lines — what your own saved repertoire plays from here. Always
  //     shown, even with no imported games, since it reads from your lines.
  //   • My games — what you actually played from here in your imported games.
  //     Offers the import flow when empty.
  //   • My opponents — what a scouted opponent plays from here. This was a tab
  //     of its own until the tab strip was rebuilt around the five panels the
  //     builder actually needs; it belongs here, next to your own games, because
  //     it answers the same question from the other side of the board.
  function renderGames(): void {
    const el = deps.gamesEl;
    el.innerHTML = '';
    el.appendChild(savedLinesSection());
    el.appendChild(myGamesSection());
    el.appendChild(opponentsSection());
  }

  // COVERAGE GAPS USED TO SIT HERE, between your saved lines and your games.
  // They were the one block on this slide that is NOT about the position on the
  // board — a hole three moves back matters whatever the board is showing — and
  // that turned out to be the problem rather than the point: while you are
  // building, an unrelated list of what you have not built is noise. It lives on
  // My Lines, which is where you go to look at the repertoire as a whole.

  // Section header: a title with a discrete "Show tree" link on the same row.
  // `onTree` is omitted (no link) when there's nothing to open.
  //
  // THREE EMPTY SECTIONS USED TO COST SIX ROWS. Each one drew a title and then a
  // whole line of prose underneath saying it had nothing — which on a fresh book,
  // where all three are empty, filled the panel with three restatements of
  // "nothing here yet". `emptyNote` folds that answer onto the title row instead,
  // so an empty section is one line and the sections you DO have something in
  // start near the top.
  function sectionHead(title: string, onTree?: () => void, emptyText?: string): HTMLElement {
    const head = document.createElement('div');
    head.className = 'mylines-head' + (emptyText ? ' mylines-head--empty' : '');
    head.appendChild(span('mylines-head-title', title));
    if (emptyText) head.appendChild(span('mylines-head-note', emptyText));
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

    if (!lines) {
      wrap.appendChild(sectionHead('My saved lines', undefined, 'loading…'));
      return wrap;
    }

    const replies = savedLineReplies(mine, deps.getUcis());
    wrap.appendChild(sectionHead(
      'My saved lines',
      hasTree ? () => openSavedTree(mine) : undefined,
      replies.length ? undefined : 'nothing from here',
    ));
    if (replies.length) {
      const prefix = movePrefix(deps.getUcis().length);
      for (const r of replies) wrap.appendChild(savedLineRow(r, prefix));
    }

    appendTranspositionRows(wrap);
    return wrap;
  }

  /**
   * One continuation of your OWN book: tap it to play it, or take it out.
   *
   * Removal belongs here because this row is already the answer to "what does my
   * repertoire do from this position?" — one move, one branch, one count — so
   * cutting it reads as trimming that answer rather than as deleting some
   * abstract line elsewhere. Until now the builder had nowhere at all to remove
   * a move from; you had to leave for My Lines and find it again.
   *
   * A div holding two buttons, not a button inside a button: nesting is invalid,
   * and the two taps mean genuinely different things. The trash sits at the far
   * edge, away from the move, because playing the move is what people come to
   * this row to do.
   */
  function savedLineRow(
    r: { san: string; uci: string; count: number }, prefix: string,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'bx-row bx-row--plain mylines-saved-row';

    const tap = document.createElement('button');
    tap.type = 'button';
    tap.className = 'mylines-saved-tap';
    tap.addEventListener('click', () => deps.onPlay(r.uci));
    tap.appendChild(span('bx-move', `${prefix} ${formatMove(r.san)}`));
    tap.appendChild(span('bx-line-count', `${r.count} line${r.count === 1 ? '' : 's'}`));
    row.appendChild(tap);

    if (deps.canRemoveLines()) {
      const label = `Remove ${prefix} ${r.san}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'mylines-saved-remove';
      remove.setAttribute('aria-label', label);
      remove.title = label;
      remove.appendChild(Icons.trash(15));
      remove.addEventListener('click', () => deps.onRemoveContinuation(r.uci));
      row.appendChild(remove);
    }
    return row;
  }

  // Quiet rows for what the primary continuations above can't see: another
  // saved line reaching this SAME position by a different move order
  // (TRANSPOSITIONS.md's "Transpositions" section). savedLineReplies walks each
  // line's tree move-by-move, so a transposed line simply falls off that walk
  // at the first ply where it diverges — the position index is what still
  // knows it's the same position underneath.
  //
  // Async because the index is a lazily-rebuilt read from storage; the rows
  // land a beat after the rest of the section and are dropped if the board
  // moved on in the meantime. Never above the primary content — this is always
  // appended last — and silent when there's nothing to say (no empty state).
  function appendTranspositionRows(wrap: HTMLElement): void {
    const fen = deps.getFen();
    const colour = deps.getColour();
    const ucis = deps.getUcis();
    const excludeId = deps.getEditingLineId();

    void positionIndex().then(index => {
      if (deps.getFen() !== fen) return; // the board moved on; this answer is stale
      const matches = transpositionMatches(index, lines ?? [], fen, colour, ucis, excludeId);
      if (!matches.length) return;

      const shown = matches.slice(0, 3);
      for (const m of shown) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'bx-row mylines-xpos-row';
        row.addEventListener('click', () => deps.onOpenLine(m.line, m.atFen));
        row.appendChild(span('mylines-xpos-text', m.text));
        wrap.appendChild(row);
      }
      const rest = matches.length - shown.length;
      if (rest > 0) wrap.appendChild(span('mylines-xpos-more', `and ${rest} more`));
    }).catch(() => { /* a quiet feature stays quiet on failure too */ });
  }

  function myGamesSection(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'mylines-section';

    const stats = games ? statsFor(deps.getColour()) : null;
    const hasGames = !!stats && stats.games > 0;

    if (!games) {
      wrap.appendChild(sectionHead('My games', undefined, 'loading…'));
      return wrap;
    }

    // No imported games for this colour: offer the import flow right here so
    // "My games" is actionable rather than just empty. The reason folds onto
    // the title row; the button is the only thing that earns a row of its own.
    if (!hasGames) {
      wrap.appendChild(sectionHead('My games', undefined, 'none imported yet'));
      wrap.appendChild(actionButton('Import my games', () => deps.onImportGames()));
      return wrap;
    }

    const node = statAt(stats!, deps.getUcis());
    const replies = node ? [...node.children.values()] : [];
    replies.sort((a, b) => b.games - a.games || a.san.localeCompare(b.san));
    wrap.appendChild(sectionHead(
      'My games', () => openGamesTree(), replies.length ? undefined : 'nothing from here',
    ));

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

    if (!replies.length) return wrap;
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

  // ── My opponents section ────────────────────────────────────────────────────
  // Two states: no opponent selected → a tappable opponents list (+ import); an
  // opponent selected → their continuations from the current position, drawn
  // exactly like My games but from THEIR side (the opposite of your save colour).
  function opponentsSection(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'mylines-section';
    renderOpponents(wrap);
    return wrap;
  }

  function renderOpponents(el: HTMLElement): void {
    el.innerHTML = '';
    if (!opponents) {
      el.appendChild(sectionHead('My opponents', undefined, 'loading…'));
      return;
    }

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
    back.addEventListener('click', () => { selectedOppId = null; renderOpponents(el); });
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
    const scouted = opponents ?? [];
    const none = scouted.length === 0;
    // Nothing scouted yet: the reason rides on the title row and the "+ Add
    // opponent" pill is the whole section, rather than a title, a sentence and
    // a button stacked three deep on a panel that has two other sections below.
    el.appendChild(sectionHead('My opponents', undefined, none ? 'none scouted yet' : undefined));
    // "+ Add opponent" — the same pill the Explore scouting section uses, so the
    // two entry points read identically.
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'games-refresh-btn scout-add-btn';
    add.appendChild(Icons.plus(15));
    add.appendChild(document.createTextNode('Add opponent'));
    add.addEventListener('click', () => deps.onImportOpponent());
    el.appendChild(add);
    if (none) return;
    // Their side is the opposite of the colour you're preparing — the same
    // perspective the selected view uses, so the cached stats trees are reused.
    const oppColour: 'white' | 'black' = deps.getColour() === 'white' ? 'black' : 'white';
    for (const opp of scouted) {
      const statsKey = `${opp.id}:${oppColour}`;
      let s = oppStats.get(statsKey);
      if (!s) { s = buildMoveStats(opp.games, oppColour, MAP_MAX_PLIES); oppStats.set(statsKey, s); }
      const posGames = statAt(s, deps.getUcis())?.games ?? 0;

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'scout-opp-card';
      card.addEventListener('click', () => { selectedOppId = opp.id; renderOpponents(el); });
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
    render() { renderLibrary(); renderGames(); },
    showLibraryInfo() { showDbInfo(); },
    reload() { loadGames(); },
    reloadLines() { loadLines(); },
    reloadOpponents() { loadOpponents(); },
    selectOpponent(id: string) { selectedOppId = id; renderGames(); },
    setActiveSlide(id: BuilderSlideId) {
      if (id === activeSlide) return;
      activeSlide = id;
      // Entering the Library slide: repaint so its explorer bars fetch now.
      if (id === 'library') renderLibrary();
      if (id === 'mylines') renderGames();
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

interface TranspositionMatch {
  line: Line;
  atFen: string;
  text: string;
}

// Every OTHER saved line (same colour, not the one being edited) that reaches
// this exact position — by a different move order than `ucis` took to get
// here. Two shapes, per TRANSPOSITIONS.md's decision: a line that still has a
// move from here reports what it plays ("you play Nf3 here in Y"); a line
// that ends exactly here just reports the convergence ("also reached by X").
// Sorted by name for a stable order ahead of the three-row cap.
function transpositionMatches(
  index: PositionIndex, allLines: Line[], fen: string, colour: 'white' | 'black',
  ucis: string[], excludeId: string | null,
): TranspositionMatch[] {
  const key = positionKey(fen);
  const out: TranspositionMatch[] = [];
  for (const other of index.lines.values()) {
    if (other.colour !== colour || other.id === excludeId) continue;
    const ply = other.keys.indexOf(key);
    if (ply === -1) continue;
    // Reached by the SAME road so far — a shared opening prefix, not a
    // transposition (TRANSPOSITIONS.md's "Transpositions" section).
    if (ucis.length === ply && ucis.every((u, i) => u === other.ucis[i])) continue;

    const full = allLines.find(l => l.id === other.id);
    if (!full) continue;
    const atFen = fenAtPly(full, ply);

    if (ply < other.ucis.length) {
      const entry = (index.byPosition.get(key) ?? []).find(e => e.lineId === other.id);
      if (!entry) continue;
      out.push({ line: full, atFen, text: `you play ${formatMove(entry.san)} here in “${other.name}”` });
    } else {
      out.push({ line: full, atFen, text: `also reached by “${other.name}”` });
    }
  }
  out.sort((a, b) => a.line.name.localeCompare(b.line.name));
  return out;
}

// The FEN of a line's own node at `ply` half-moves in — walking the mainline
// (children[0]) chain, the same convention position-index.ts builds its
// `keys` from, so the ply lines up exactly. ply 0 is the root's own fen
// (START_FEN, per tree.ts).
function fenAtPly(line: Line, ply: number): string {
  let node = line.tree;
  for (let i = 0; i < ply; i++) {
    const next = node.children[0];
    if (!next) break;
    node = next;
  }
  return node.fen;
}

// Compact a games total so big Lichess counts fit the row: 276500000 → "276M",
// 12400 → "12.4K". Keeps small counts (masters, deep lines) exact. Also used
// for study like-counts in the Packs browser (study-browser.ts).
export function compactCount(n: number): string {
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
