// The Engine tab — the heavy half of the engine, split out from the quick one.
//
// THERE ARE TWO ENGINE SURFACES AND THEY WANT OPPOSITE THINGS. The quick engine
// is the dock's eval bar: it rides above the control bar on EVERY tab, so every
// pixel it takes is a pixel off the board, and its whole job is "am I still OK
// here?" — a bar, three moves, an eval each, done. This tab is where you go when
// the answer is "no": it owns a whole panel, so it can afford the vertical eval
// bar, the depth readout, three full principal variations, and a depth control.
//
// THE LINES ARE WALKABLE. A principal variation printed as text is a fact you
// have to take on trust; the same variation with every move tappable is
// something you can check. Tapping the third move of a line plays the first
// three onto the board, so "why is that better?" is one tap from being on the
// board in front of you.
//
// DEPTH IS A REAL CONTROL, NOT A SETTING. It only governs the local Stockfish
// search: when the Lichess cloud answers (which it does for most opening
// positions) the depth is whatever the cloud analysed at, and the control says
// so rather than pretending to drive it.

import { Chess } from 'chess.js';
import {
  MIN_SEARCH_DEPTH, MAX_SEARCH_DEPTH,
  cloudLooksOffline, type EvalResult, type MoveEval,
} from './engine';
import { formatMove } from './notation';
import { Icons } from './icons';

// How many plies of each principal variation the tab shows. The engine caps its
// own PVs shorter than this; the limit is here so a mating line can't run the
// row off the side of a phone.
const PV_PLIES = 8;

export interface EnginePanelDeps {
  el: HTMLElement;
  getFen: () => string;
  isOn: () => boolean;
  // Turn the engine on/off — the same switch the dock's engine icon throws, so
  // the two surfaces can never disagree about whether it's running.
  setOn: (on: boolean) => void;
  // Play a sequence of UCIs onto the line, in order. Walking into an engine line
  // is exactly what the board is for.
  onPlayLine: (ucis: string[]) => void;
  getDepth: () => number;
  setDepth: (depth: number) => void;
  onRetryCloud: () => void;
}

export interface EnginePanel {
  // A fresh engine result for the live position.
  update(result: EvalResult): void;
  // The position changed, or the engine was switched off: clear the readouts.
  clear(): void;
  // Repaint the frame (the toggle, the depth control) without a new result.
  render(): void;
  setActive(on: boolean): void;
}

export function createEnginePanel(deps: EnginePanelDeps): EnginePanel {
  let active = false;
  let last: EvalResult | null = null;

  const root = deps.el;
  root.classList.add('engine-tab');

  // ── Frame ──────────────────────────────────────────────────────────────────
  // Built once and updated in place: a repaint on every engine `info` message
  // would fight the user's finger on the depth slider.
  const head = document.createElement('div');
  head.className = 'engine-tab-head';
  root.appendChild(head);

  const power = document.createElement('button');
  power.type = 'button';
  power.className = 'engine-tab-power';
  power.addEventListener('click', () => deps.setOn(!deps.isOn()));
  head.appendChild(power);

  const meta = document.createElement('div');
  meta.className = 'engine-tab-meta';
  head.appendChild(meta);

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

  // ── Depth control ──────────────────────────────────────────────────────────
  const depthBlock = document.createElement('div');
  depthBlock.className = 'engine-depth';

  const depthHead = document.createElement('div');
  depthHead.className = 'engine-depth-head';
  const depthLabel = document.createElement('span');
  depthLabel.className = 'engine-depth-label';
  depthLabel.textContent = 'Search depth';
  depthHead.appendChild(depthLabel);
  const depthValue = document.createElement('span');
  depthValue.className = 'engine-depth-value';
  depthHead.appendChild(depthValue);
  depthBlock.appendChild(depthHead);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'engine-depth-slider';
  slider.min = String(MIN_SEARCH_DEPTH);
  slider.max = String(MAX_SEARCH_DEPTH);
  slider.step = '1';
  slider.setAttribute('aria-label', 'Engine search depth');
  // `input` updates the readout as the thumb moves; `change` is what actually
  // restarts the search, so a drag across the range doesn't kick off a dozen of
  // them.
  slider.addEventListener('input', () => { depthValue.textContent = `${slider.value}`; });
  slider.addEventListener('change', () => deps.setDepth(Number(slider.value)));
  depthBlock.appendChild(slider);

  const depthNote = document.createElement('p');
  depthNote.className = 'engine-depth-note';
  depthBlock.appendChild(depthNote);
  root.appendChild(depthBlock);

  // ── Painting ───────────────────────────────────────────────────────────────

  function renderFrame(): void {
    const on = deps.isOn();
    root.classList.toggle('engine-tab--off', !on);

    power.replaceChildren();
    power.appendChild(Icons.cpu(16));
    power.appendChild(document.createTextNode(on ? 'Engine on' : 'Turn on engine'));
    power.classList.toggle('engine-tab-power--on', on);
    power.setAttribute('aria-pressed', String(on));

    slider.value = String(deps.getDepth());
    depthValue.textContent = String(deps.getDepth());
    depthNote.textContent = last?.source === 'lichess'
      ? 'This position came from the Lichess cloud, already analysed deeper than any phone can. Depth applies when the local engine takes over.'
      : 'Deeper is stronger and slower. The local engine climbs to this depth on every position.';

    meta.replaceChildren();
    if (!on) {
      meta.appendChild(text('engine-tab-metabit', 'Off'));
      return;
    }
    if (!last) {
      meta.appendChild(text('engine-tab-metabit', 'Analysing…'));
      return;
    }
    if (last.source === 'lichess') {
      meta.appendChild(text('engine-tab-metabit', 'Lichess cloud'));
      meta.appendChild(text('engine-tab-metabit engine-tab-metabit--depth', `depth ${last.depth}`));
      return;
    }
    meta.appendChild(text('engine-tab-metabit', 'Stockfish, on this device'));
    const target = last.targetDepth;
    meta.appendChild(text(
      'engine-tab-metabit engine-tab-metabit--depth',
      target && last.depth < target ? `depth ${last.depth} → ${target}` : `depth ${last.depth}`,
    ));
    if (cloudLooksOffline()) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'engine-tab-retry';
      retry.textContent = 'Lichess unreachable — retry';
      retry.addEventListener('click', () => deps.onRetryCloud());
      meta.appendChild(retry);
    }
  }

  function renderLines(): void {
    linesEl.replaceChildren();

    if (!deps.isOn()) {
      linesEl.appendChild(text('engine-tab-note', 'Switch the engine on to see the best lines from this position.'));
      return;
    }
    if (!last) {
      linesEl.appendChild(text('engine-tab-note', 'Analysing…'));
      return;
    }
    if (last.gameOver) {
      linesEl.appendChild(text('engine-tab-note',
        last.gameOver === 'checkmate' ? 'Checkmate — nothing left to search.' : 'Drawn — nothing left to search.'));
      return;
    }

    const fen = last.fen;
    last.moves.slice(0, 3).forEach((m, i) => {
      linesEl.appendChild(pvRow(m, i, fen));
    });
  }

  // One principal variation: its rank, its score, and every move in it as its
  // own tappable chip. Tapping the nth chip plays the first n moves.
  function pvRow(m: MoveEval, rank: number, fen: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'engine-line';

    const head2 = document.createElement('div');
    head2.className = 'engine-line-head';
    head2.appendChild(text('engine-line-rank', `${rank + 1}`));
    const sc = text('engine-line-score', formatScore(m));
    sc.classList.add(scoreTone(m));
    head2.appendChild(sc);
    row.appendChild(head2);

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

  renderFrame();
  renderLines();

  return {
    update(result: EvalResult) {
      // Only ever show the live position: engine replies can lag a move behind.
      if (result.fen !== deps.getFen()) return;
      last = result;
      paintBar(result);
      renderFrame();
      renderLines();
    },
    clear() {
      last = null;
      fill.style.width = '50%';
      score.textContent = '0.0';
      renderFrame();
      renderLines();
    },
    render() {
      renderFrame();
      renderLines();
    },
    setActive(on: boolean) {
      if (on === active) return;
      active = on;
      if (on) { renderFrame(); renderLines(); }
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

function formatScore(m: MoveEval): string {
  if (m.mate !== undefined) return m.mate > 0 ? `M${m.mate}` : `-M${Math.abs(m.mate)}`;
  if (m.cp === undefined) return '';
  return (m.cp >= 0 ? '+' : '') + (m.cp / 100).toFixed(2);
}

// White-ahead / black-ahead / level, so a glance at the column reads before the
// numbers do.
function scoreTone(m: MoveEval): string {
  const cp = m.mate !== undefined ? (m.mate > 0 ? 9999 : -9999) : (m.cp ?? 0);
  if (cp >= 50) return 'engine-line-score--white';
  if (cp <= -50) return 'engine-line-score--black';
  return 'engine-line-score--level';
}

// The same winning-chances curve the docked bar uses, so the two never disagree
// about how big an advantage looks.
function cpToFill(cp: number): number {
  if (cp >= 9999) return 100;
  if (cp <= -9999) return 0;
  const winChance = 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
  return 50 + 50 * Math.max(-1, Math.min(1, winChance));
}
