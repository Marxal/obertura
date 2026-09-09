// Time pressure — the run overlay. Two minutes, twenty seconds a position,
// drawn from the moves you actually got wrong (time-pressure.ts has the pool,
// the ranking and the scoring).
//
// HOW IT DIFFERS FROM THE MISTAKE DRILL, and why. The drill next door asks you
// to work a position out: hints, a second try, a reveal, and a comparison of
// what you played against what the engine wanted. None of that belongs here.
// This asks a smaller question — can you SEE a move that doesn't lose, right
// now — so there is one try, no hint, and the round moves on the instant you
// answer. Any of the engine's top three counts, because under this clock
// "don't blunder" is the skill and "find the single best" is a different one.
//
// NOTHING IS DRAWN ON THE BOARD. Not the move you played, not the move that was
// there. The drill next door shows both, and that is the drill's job — here the
// position has to be read cold, which is what it was in the game. An arrow
// would answer half the question before the clock started, and a reveal at the
// end would turn a two-minute sprint into a lesson it has no room for.
//
// SO THE FEEDBACK IS ONE MARK. Right or wrong, a tick or a cross under the
// board for a moment, and on. What was actually there is in the results screen
// afterwards, where there is time to look at it.
//
// THREE OUTCOMES. Found, missed, and ran out — kept apart all the way to the
// results screen, because "I knew it and was too slow" is the failure this
// exercise exists to show you, and folding it in with "I had no idea" would
// hide exactly that.
//
// The per-position clock is a draining bar, not a counting number: a big ticking
// readout over a position you are already meant to feel rushed by tips the
// exercise from sharp into stressful.

import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import { Icons } from './icons';
import { playFeedback } from './sound';
import { pushBack } from './back-nav';
import { burstConfetti, celebratePawn } from './confetti';
import { formatMove } from './notation';
import { buildRunHeader } from './run-header';
import { openSpotPeek, type SpotPeekOptions } from './spot-peek';
import { buildStoryContent } from './full-story';
import { TIME_PRESSURE_ACCENT } from './exercise-identity';
import {
  DEFAULT_ROUND_MINUTES,
  roundMsFor,
  PER_POSITION_MS,
  scoreSolve,
  totalsFor,
  recordTimePressureRound,
  type TimePressureEntry,
  type TimePressureOutcome,
} from './time-pressure';
import type { SpotRef } from './mistake-scan';
import type { ImportedGame } from './import-core';
import type { OpenGameCtx } from './mistake-run';

// How long the mark holds before the next position. Both are short now that
// there is nothing to read on the board — long enough to register a tick or a
// cross, not long enough to feel like a pause.
const HOLD_FOUND_MS = 320;
const HOLD_SHOWN_MS = 520;

// The one mark each outcome gets, in the round and again on its results row.
const MARK_GLYPH: Record<TimePressureOutcome, string> = {
  found: '✓',
  missed: '✕',
  'ran-out': '⏱',
};

// The clocks are read on a timer rather than a rAF loop: nothing here animates
// per-frame except the bar's width, which CSS transitions on its own.
const TICK_MS = 100;

export interface TimePressureSessionOptions {
  /** Already dealt and ordered — see dealRound(). */
  refs: SpotRef[];
  /**
   * How long the round runs, in minutes. Defaults to the standard two; the
   * daily challenge passes whatever length is configured for its part, and the
   * personal best is filed against that length rather than pooled.
   */
  minutes?: number;
  onExit: () => void;
  onPlayAgain?: () => void;
  onOpenGame?: (game: ImportedGame, ctx?: OpenGameCtx) => void;
  /**
   * The session's framing above the exercise name in the run header —
   * "Daily challenge". Context, not identity (run-header.ts).
   */
  contextLabel?: string;
  /** Fired once when the results screen comes up, for the daily challenge's tally. */
  onComplete?: (summary: { found: number; missed: number; ranOut: number; score: number }) => void;
  /** Daily challenge: the results screen's primary jumps to the next challenge. */
  nextAction?: { label: string; run: () => void };
}

export function startTimePressureSession(opts: TimePressureSessionOptions): void {
  if (opts.refs.length === 0) { opts.onExit(); return; }

  const chess = new Chess();
  let cg: Api;
  let isCleaned = false;

  let index = 0;
  let current: SpotRef = opts.refs[0];
  let inputLocked = true;
  let roundOver = false;
  let positionStartedAt = 0;
  let roundEndsAt = 0;
  let positionEndsAt = 0;
  let tick: ReturnType<typeof setInterval> | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;

  const entries: TimePressureEntry[] = [];
  let score = 0;

  // ── Scaffold ───────────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'pt-overlay pt-overlay--puzzle pt-overlay--tinted pt-overlay--compact';
  overlay.style.setProperty('--pt-tint', TIME_PRESSURE_ACCENT);

  const minutes = Math.max(1, Math.round(opts.minutes ?? DEFAULT_ROUND_MINUTES));

  const header = buildRunHeader({
    icon: Icons.clock(18),
    title: 'Time pressure',
    kicker: opts.contextLabel,
    accent: TIME_PRESSURE_ACCENT,
    endLabel: 'End round',
    // No abandon dialog: a confirmation box with a clock running behind it is
    // the one thing worse than ending early. The round simply stops and shows
    // what it was worth — nothing you found is lost.
    onEnd: () => finishRound(),
  });

  const scoreEl = document.createElement('div');
  scoreEl.className = 'pt-timed-score tp-score';
  const clockEl = document.createElement('div');
  clockEl.className = 'pt-timer';
  header.extras.appendChild(scoreEl);
  header.extras.appendChild(clockEl);

  // The ten-second bar. It drains left-to-right and turns as it goes, so the
  // last seconds read as urgent without a number shouting them.
  const barEl = document.createElement('div');
  barEl.className = 'tp-bar';
  const barFillEl = document.createElement('div');
  barFillEl.className = 'tp-bar-fill';
  barEl.appendChild(barFillEl);

  const boardWrap = document.createElement('div');
  boardWrap.className = 'pt-board-wrap';
  const boardEl = document.createElement('div');
  boardEl.className = 'pt-board';
  boardWrap.appendChild(boardEl);

  const bottomEl = document.createElement('div');
  bottomEl.className = 'pt-bottom';
  // One line, and it is about the POSITION rather than the exercise: whose move
  // it is (which you cannot afford to work out at this speed) and who it was
  // against (which is what makes it yours).
  const metaEl = document.createElement('div');
  metaEl.className = 'tp-meta';
  bottomEl.appendChild(metaEl);

  // The whole of the in-round feedback: one mark, for a moment. Its slot is
  // always in the layout so the board never shifts when it appears.
  const markEl = document.createElement('div');
  markEl.className = 'tp-mark';
  markEl.setAttribute('aria-live', 'polite');
  bottomEl.appendChild(markEl);

  const scrollEl = document.createElement('div');
  scrollEl.className = 'pt-scroll';
  scrollEl.appendChild(barEl);
  scrollEl.appendChild(boardWrap);
  scrollEl.appendChild(bottomEl);

  overlay.appendChild(header.el);
  overlay.appendChild(scrollEl);
  document.body.appendChild(overlay);

  cg = Chessground(boardEl, {
    orientation: 'white',
    movable: { color: undefined, free: false, dests: new Map() },
    draggable: { showGhost: true },
    animation: { enabled: true, duration: 150 },
    events: { move(from, to) { onUserMove(from as Key, to as Key); } },
  });
  const ro = new ResizeObserver(() => cg.redrawAll());
  ro.observe(boardEl);

  let removeBack = pushBack(() => finishRound());

  // ── Helpers ────────────────────────────────────────────────────────────────
  function cgTurn(): 'white' | 'black' {
    return chess.turn() === 'w' ? 'white' : 'black';
  }
  function legalDests(): Map<Key, Key[]> {
    const dests = new Map<Key, Key[]>();
    for (const m of chess.moves({ verbose: true })) {
      const from = m.from as Key;
      if (!dests.has(from)) dests.set(from, []);
      dests.get(from)!.push(m.to as Key);
    }
    return dests;
  }
  function flashError(): void {
    playFeedback('wrong');
    const flash = document.createElement('div');
    flash.className = 'pt-error-flash';
    boardWrap.appendChild(flash);
    flash.addEventListener('animationend', () => flash.remove(), { once: true });
  }

  /**
   * Right or wrong, for a moment — see the note at the top of the file. `null`
   * clears it for the next position.
   */
  function showMark(outcome: TimePressureOutcome | null): void {
    if (!outcome) {
      markEl.textContent = '';
      markEl.className = 'tp-mark';
      return;
    }
    markEl.textContent = MARK_GLYPH[outcome];
    markEl.className = `tp-mark tp-mark--${outcome === 'ran-out' ? 'out' : outcome}`;
  }

  // ── The clocks ─────────────────────────────────────────────────────────────
  function renderClocks(): void {
    const roundLeft = Math.max(0, roundEndsAt - Date.now());
    const secs = Math.ceil(roundLeft / 1000);
    clockEl.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    clockEl.classList.toggle('pt-timer--low', secs <= 15);

    const posLeft = Math.max(0, positionEndsAt - Date.now());
    const share = posLeft / PER_POSITION_MS;
    barFillEl.style.width = `${share * 100}%`;
    barFillEl.classList.toggle('tp-bar-fill--low', share <= 0.35);
  }

  function onTick(): void {
    if (isCleaned || roundOver) return;
    renderClocks();
    if (Date.now() >= roundEndsAt) { finishRound(); return; }
    // The position's own clock only runs while the board is live — the hold
    // after an answer is not time you are being asked to think in.
    if (!inputLocked && Date.now() >= positionEndsAt) settle('ran-out');
  }

  // ── One position ───────────────────────────────────────────────────────────
  function loadPosition(): void {
    if (isCleaned || roundOver) return;
    if (index >= opts.refs.length) { finishRound(); return; }
    current = opts.refs[index];
    const { game, spot } = current;

    chess.load(spot.preFen);
    metaEl.textContent = `${cgTurn() === 'white' ? 'White' : 'Black'} to play · vs ${game.opponent}`;

    cg.set({
      fen: spot.preFen,
      orientation: game.colour,
      turnColor: cgTurn(),
      lastMove: undefined,
      movable: { color: game.colour, dests: legalDests() },
    });
    cg.setAutoShapes([]);
    showMark(null);

    inputLocked = false;
    positionStartedAt = Date.now();
    positionEndsAt = positionStartedAt + PER_POSITION_MS;
    // Snap the bar back to full without animating the rewind.
    barFillEl.classList.add('tp-bar-fill--reset');
    renderClocks();
    requestAnimationFrame(() => barFillEl.classList.remove('tp-bar-fill--reset'));
  }

  function onUserMove(from: Key, to: Key): void {
    if (inputLocked || roundOver) return;
    const uci4 = `${from}${to}`;
    // All three of the engine's picks count — see the header note.
    const hit = current.spot.best.slice(0, 3).find(m => m.uci.slice(0, 4) === uci4);
    settle(hit ? 'found' : 'missed');
  }

  /** Close the current position with an outcome, then move on. */
  function settle(outcome: TimePressureOutcome): void {
    if (inputLocked || roundOver) return;
    inputLocked = true;
    cg.set({ movable: { color: undefined, dests: new Map() } });

    const ms = outcome === 'ran-out'
      ? PER_POSITION_MS
      : Math.min(PER_POSITION_MS, Date.now() - positionStartedAt);
    const points = outcome === 'found' ? scoreSolve(ms) : 0;
    entries.push({ ref: current, outcome, ms, points });
    score += points;
    renderScore(points);

    if (outcome === 'found') playFeedback('correct');
    else if (outcome === 'missed') flashError();
    showMark(outcome);

    holdTimer = setTimeout(() => {
      index++;
      loadPosition();
    }, outcome === 'found' ? HOLD_FOUND_MS : HOLD_SHOWN_MS);
  }

  function renderScore(gained: number): void {
    scoreEl.textContent = `${score}`;
    if (gained > 0) {
      scoreEl.classList.remove('tp-score--pop');
      // Reflow so the animation restarts on a run of quick finds.
      void scoreEl.offsetWidth;
      scoreEl.classList.add('tp-score--pop');
    }
  }

  // ── The end ────────────────────────────────────────────────────────────────
  function finishRound(): void {
    if (roundOver) return;
    roundOver = true;
    inputLocked = true;
    if (tick) { clearInterval(tick); tick = null; }
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    cg.set({ movable: { color: undefined, dests: new Map() } });
    showResults();
  }

  function showResults(): void {
    const totals = totalsFor(entries);
    const { best, improved } = recordTimePressureRound(totals.score, minutes);
    // The daily challenge ticks its row off this. A round that never got as far
    // as one position — End round tapped on the way in — did not happen, and
    // should not be a way to clear the day's work in two taps.
    if (entries.length > 0) {
      opts.onComplete?.({
        found: totals.found, missed: totals.missed, ranOut: totals.ranOut, score: totals.score,
      });
    }

    overlay.replaceChildren();
    overlay.className = 'pt-overlay pt-overlay--results';

    const wrap = document.createElement('div');
    wrap.className = 'train-completion train-completion--enter pz-results';

    const head = document.createElement('div');
    head.className = 'pz-results-head';
    wrap.appendChild(head);
    head.appendChild(celebratePawn());
    if (totals.found > 0) burstConfetti(wrap);

    const done = document.createElement('div');
    done.className = 'train-completion-done';
    done.textContent = `${totals.score} point${totals.score === 1 ? '' : 's'}`;
    head.appendChild(done);

    const sub = document.createElement('div');
    sub.className = 'train-completion-name';
    // "Best yet" only when there was a best to beat — on a first round it would
    // be boasting about the only score that exists. And a standing best is only
    // worth printing when it is HIGHER than what you just scored; printing the
    // number you are already looking at reads as a bug.
    sub.textContent = improved
      ? 'Best yet'
      : best > totals.score
        ? `Best so far ${best}`
        : `${minutes} minute${minutes === 1 ? '' : 's'}, twenty seconds a position`;
    head.appendChild(sub);

    // The three outcomes, side by side. They are the exercise's whole finding:
    // what you saw, what you got wrong, and what the clock took off you.
    const tiles = document.createElement('div');
    tiles.className = 'tp-tiles';
    tiles.appendChild(outcomeTile(String(totals.found), 'found', 'tp-tile--found'));
    tiles.appendChild(outcomeTile(String(totals.missed), 'missed', 'tp-tile--missed'));
    tiles.appendChild(outcomeTile(String(totals.ranOut), 'ran out', 'tp-tile--out'));
    wrap.appendChild(tiles);

    const note = document.createElement('div');
    note.className = 'tp-note';
    const parts: string[] = [];
    if (totals.fast > 0) parts.push(`${totals.fast} inside three seconds`);
    if (totals.averageMs !== null) parts.push(`${(totals.averageMs / 1000).toFixed(1)}s a position`);
    note.textContent = parts.join(' · ');
    if (parts.length) wrap.appendChild(note);

    if (entries.length) {
      const listWrap = document.createElement('div');
      listWrap.className = 'pz-results-list-wrap';
      const list = document.createElement('div');
      list.className = 'pz-results-list';
      entries.forEach((e, idx) => list.appendChild(resultRow(e, idx)));
      listWrap.appendChild(list);
      const fade = document.createElement('div');
      fade.className = 'pz-results-fade';
      fade.setAttribute('aria-hidden', 'true');
      listWrap.appendChild(fade);
      wrap.appendChild(listWrap);
    }

    const actions = document.createElement('div');
    actions.className = 'pz-results-actions';
    // Daily challenge: straight on to the next part is the main action.
    if (opts.nextAction) {
      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'btn-primary train-next-btn';
      next.textContent = opts.nextAction.label;
      next.addEventListener('click', () => { const fn = opts.nextAction!.run; cleanup(); fn(); });
      actions.appendChild(next);
    }
    if (opts.onPlayAgain) {
      const again = document.createElement('button');
      again.type = 'button';
      again.className = opts.nextAction ? 'btn-secondary train-done-btn' : 'btn-primary train-next-btn';
      again.textContent = 'Go again';
      again.addEventListener('click', () => { const fn = opts.onPlayAgain!; cleanup(); fn(); });
      actions.appendChild(again);
    }
    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = (opts.nextAction || opts.onPlayAgain)
      ? 'btn-secondary train-done-btn'
      : 'btn-primary train-next-btn';
    doneBtn.textContent = 'Close round';
    doneBtn.addEventListener('click', () => doExit());
    actions.appendChild(doneBtn);
    wrap.appendChild(actions);

    overlay.appendChild(wrap);
  }

  function outcomeTile(value: string, label: string, cls: string): HTMLElement {
    const tile = document.createElement('div');
    tile.className = `tp-tile ${cls}`;
    const v = document.createElement('div');
    v.className = 'tp-tile-v';
    v.textContent = value;
    tile.appendChild(v);
    const l = document.createElement('div');
    l.className = 'tp-tile-l';
    l.textContent = label;
    tile.appendChild(l);
    return tile;
  }

  function resultRow(e: TimePressureEntry, idx: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'pz-result-row pz-result-row--linked '
      + (e.outcome === 'found' ? 'pz-result-row--solved' : 'pz-result-row--missed');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    const open = (): void => {
      const o = peekOptionsFor(idx);
      if (o) openSpotPeek(o);
    };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
    });

    const dot = document.createElement('span');
    dot.className = 'pz-result-dot';
    dot.textContent = MARK_GLYPH[e.outcome];
    row.appendChild(dot);

    const main = document.createElement('div');
    main.className = 'pz-result-main';
    const name = document.createElement('div');
    name.className = 'pz-result-name';
    name.textContent = `vs ${e.ref.game.opponent}`;
    main.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'pz-result-meta';
    const answer = formatMove(e.ref.spot.best[0]?.san ?? '?');
    meta.textContent = e.outcome === 'ran-out'
      ? `out of time · ${answer} was there`
      : `${(e.ms / 1000).toFixed(1)}s · ${answer}`;
    main.appendChild(meta);
    row.appendChild(main);

    if (e.points > 0) {
      const pts = document.createElement('span');
      pts.className = 'tp-result-points';
      pts.textContent = `+${e.points}`;
      row.appendChild(pts);
    }
    return row;
  }

  function peekOptionsFor(idx: number): SpotPeekOptions | null {
    const e = entries[idx];
    if (!e) return null;
    const { game, spot } = e.ref;
    const best = spot.best[0];
    return {
      fen: spot.preFen,
      orientation: game.colour,
      arrows: [
        { uci: spot.playedUci, kind: 'danger' },
        ...(best ? [{ uci: best.uci, kind: 'accent' as const }] : []),
      ],
      meta: `${formatMove(spot.playedSan)} → ${formatMove(best?.san ?? '?')} · vs ${game.opponent}`,
      story: () => buildStoryContent(game, spot.ply),
      onAnalyse: opts.onOpenGame ? () => { cleanup(); opts.onOpenGame!(game); } : undefined,
      onNav: (dir) => peekOptionsFor(idx + dir),
    };
  }

  function doExit(): void {
    cleanup();
    opts.onExit();
  }
  function cleanup(): void {
    isCleaned = true;
    if (tick) { clearInterval(tick); tick = null; }
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    ro.disconnect();
    overlay.remove();
    removeBack();
  }

  // ── Go ─────────────────────────────────────────────────────────────────────
  scoreEl.textContent = '0';
  roundEndsAt = Date.now() + roundMsFor(minutes);
  positionEndsAt = roundEndsAt; // replaced by loadPosition, just below
  tick = setInterval(onTick, TICK_MS);
  loadPosition();
  renderClocks();
}
