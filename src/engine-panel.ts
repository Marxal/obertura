// The Engine tab — the engine given a whole panel instead of a dock strip.
//
// IT OWNS THE ENGINE WHILE IT'S SHOWING. Landing here switches the engine on
// (main.ts's onActiveSlide) and hides the docked quick engine, because the dock
// is the same bar and the same three moves in miniature: two copies of one
// answer on one screen, one of them costing the board its pixels. Leave the tab
// and the dock comes back.
//
// SO THERE ARE NO CONTROLS ON IT. It had a power button (the engine is already
// on), a source-and-depth readout (a fact about the answer, not the answer) and
// a depth slider (a knob for a number most people have no way to choose). What's
// left is what you came for: the evaluation, and the three strongest lines.
//
// THE LINES ARE WALKABLE. A principal variation printed as text is a fact you
// have to take on trust; the same variation with every move tappable is
// something you can check. Tapping the third move of a line plays the first
// three onto the board. Each line is ONE row that scrolls sideways — wrapping
// made a long mating line three rows tall and pushed the third variation off the
// screen, and a row that reflows as the engine's depth climbs is a moving target
// for a thumb.

import { Chess } from 'chess.js';
import { cloudLooksOffline, type EvalResult, type MoveEval } from './engine';
import { formatMove } from './notation';

// How many plies of each principal variation the tab shows. The engine caps its
// own PVs shorter than this; the limit is here so a long line can't make the row
// scroll forever.
const PV_PLIES = 8;

export interface EnginePanelDeps {
  el: HTMLElement;
  getFen: () => string;
  isOn: () => boolean;
  // Play a sequence of UCIs onto the line, in order. Walking into an engine line
  // is exactly what the board is for.
  onPlayLine: (ucis: string[]) => void;
  onRetryCloud: () => void;
}

export interface EnginePanel {
  // A fresh engine result for the live position.
  update(result: EvalResult): void;
  // The position changed, or the engine was switched off: clear the readouts.
  clear(): void;
  // Repaint without a new result.
  render(): void;
  setActive(on: boolean): void;
}

export function createEnginePanel(deps: EnginePanelDeps): EnginePanel {
  let active = false;
  let last: EvalResult | null = null;

  const root = deps.el;
  root.classList.add('engine-tab');

  // The eval bar: a full-width horizontal bar with the score at its end, sized
  // for a panel rather than squeezed into the dock.
  const barWrap = document.createElement('div');
  barWrap.className = 'engine-tab-barwrap';
  const bar = document.createElement('div');
  bar.className = 'engine-tab-bar';
  const fill = document.createElement('div');
  fill.className = 'engine-tab-bar-fill';
  fill.style.width = '50%';
  bar.appendChild(fill);
  barWrap.appendChild(bar);
  const score = document.createElement('span');
  score.className = 'engine-tab-score';
  score.textContent = '0.0';
  barWrap.appendChild(score);
  root.appendChild(barWrap);

  const linesEl = document.createElement('div');
  linesEl.className = 'engine-tab-lines';
  root.appendChild(linesEl);

  // ── Painting ───────────────────────────────────────────────────────────────

  function renderLines(): void {
    linesEl.replaceChildren();
    root.classList.toggle('engine-tab--off', !deps.isOn());

    if (!deps.isOn()) {
      linesEl.appendChild(note('Switch the engine on from the bar below to see the best lines from here.'));
      return;
    }
    if (!last) {
      linesEl.appendChild(note('Analysing…'));
      return;
    }
    if (last.gameOver) {
      linesEl.appendChild(note(last.gameOver === 'checkmate'
        ? 'Checkmate — nothing left to search.'
        : 'Drawn — nothing left to search.'));
      return;
    }

    const fen = last.fen;
    last.moves.slice(0, 3).forEach((m, i) => linesEl.appendChild(pvRow(m, i, fen)));

    // The one status the panel still shows, because it's the difference between
    // "the engine thinks this" and "we couldn't ask the strong one" — and it's
    // actionable.
    if (last.source === 'stockfish' && cloudLooksOffline()) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'engine-tab-retry';
      retry.textContent = 'Couldn’t reach Lichess — running locally. Retry';
      retry.addEventListener('click', () => deps.onRetryCloud());
      linesEl.appendChild(retry);
    }
  }

  // One principal variation: its rank, its score, and every move in it as its own
  // tappable chip on a single sideways-scrolling row.
  function pvRow(m: MoveEval, rank: number, fen: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'engine-line';

    row.appendChild(text('engine-line-rank', `${rank + 1}`));
    row.appendChild(text('engine-line-score', formatScore(m)));

    const moves = document.createElement('div');
    moves.className = 'engine-line-moves';

    // Resolve the SAN line back into ucis by replaying it, so a tap can play the
    // prefix onto the board. A move that won't apply (a stale line racing the
    // position) stops the walk rather than mis-playing it.
    const sans = (m.sanLine?.length ? m.sanLine : [m.san]).slice(0, PV_PLIES);
    const chess = new Chess(fen);
    const ucis: string[] = [];
    let moveNo = Number(fen.split(' ')[5] ?? '1') || 1;
    let white = (fen.split(' ')[1] ?? 'w') === 'w';

    for (let i = 0; i < sans.length; i++) {
      let played;
      try { played = chess.move(sans[i]); } catch { played = null; }
      if (!played) break;
      ucis.push(played.from + played.to + (played.promotion ?? ''));

      const prefix = white ? `${moveNo}.` : (i === 0 ? `${moveNo}…` : '');
      const upTo = ucis.slice();
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'engine-line-move';
      chip.textContent = `${prefix}${formatMove(sans[i])}`;
      chip.title = `Play up to ${prefix}${sans[i]}`;
      chip.addEventListener('click', () => deps.onPlayLine(upTo));
      moves.appendChild(chip);

      if (!white) moveNo++;
      white = !white;
    }
    row.appendChild(moves);
    return row;
  }

  function paintBar(result: EvalResult): void {
    if (result.gameOver) {
      const mate = result.gameOver === 'checkmate';
      const whiteWins = mate && result.fen.split(' ')[1] === 'b';
      fill.style.width = mate ? (whiteWins ? '100%' : '0%') : '50%';
      score.textContent = mate ? '#' : '½';
      return;
    }
    const top = result.moves[0];
    if (!top) return;
    let cpWhite: number;
    if (top.mate !== undefined) {
      cpWhite = top.mate > 0 ? 9999 : -9999;
      score.textContent = top.mate > 0 ? `M${top.mate}` : `-M${Math.abs(top.mate)}`;
    } else {
      cpWhite = top.cp ?? 0;
      score.textContent = (cpWhite >= 0 ? '+' : '') + (cpWhite / 100).toFixed(1);
    }
    fill.style.width = `${cpToFill(cpWhite)}%`;
  }

  renderLines();

  return {
    update(result: EvalResult) {
      // Only ever show the live position: engine replies can lag a move behind.
      if (result.fen !== deps.getFen()) return;
      last = result;
      paintBar(result);
      renderLines();
    },
    clear() {
      last = null;
      fill.style.width = '50%';
      score.textContent = '0.0';
      renderLines();
    },
    render() { renderLines(); },
    setActive(on: boolean) {
      if (on === active) return;
      active = on;
      if (on) renderLines();
    },
  };
}

// ── small helpers ────────────────────────────────────────────────────────────

function text(cls: string, s: string): HTMLElement {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = s;
  return el;
}

function note(s: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'engine-tab-note';
  el.textContent = s;
  return el;
}

function formatScore(m: MoveEval): string {
  if (m.mate !== undefined) return m.mate > 0 ? `M${m.mate}` : `-M${Math.abs(m.mate)}`;
  if (m.cp === undefined) return '';
  return (m.cp >= 0 ? '+' : '') + (m.cp / 100).toFixed(2);
}

// The same winning-chances curve the docked bar uses, so the two never disagree
// about how big an advantage looks.
function cpToFill(cp: number): number {
  if (cp >= 9999) return 100;
  if (cp <= -9999) return 0;
  const winChance = 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
  return 50 + 50 * Math.max(-1, Math.min(1, winChance));
}
