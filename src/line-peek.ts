// The whole line in one popup: a board you can step through, the move list with
// each move's miss count, and the line's own recall figures on top.
//
// Opened from the Statistics "Forgotten moves → Lines" rows. Read-only by
// design — this is for looking at where a line leaks, not for editing it; the
// two actions at the foot are the ways out (drill it, or open it in the builder).
//
// Only YOUR moves are scheduled, so only they carry stats: the opponent's
// replies are auto-played in training and never tested, and they read as muted
// text here to make that difference obvious.

import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import type { Api } from 'chessground/api';
import { registerBrushes } from './board-brushes';
import type { Line } from './types';
import type { MoveNode } from './tree';
import { mainlineNodes } from './scheduler';
import { lineTrainingCount } from './stats';
import { Icons } from './icons';
import { pushBack } from './back-nav';
import { formatMove } from './notation';
import { peekActionBtn } from './position-peek';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface LinePeekOptions {
  line: Line;
  /** Full runs of this line — the denominator the recall figure is read against. */
  timesTrained?: number;
  /** Jump straight to this move index (0-based ply) when opening. */
  focusPly?: number;
  onDrill?: (line: Line) => void;
  onOpen?: (line: Line) => void;
}

interface Ply {
  node: MoveNode;
  index: number;          // 0-based ply
  isUser: boolean;
  preFen: string;         // position before the move — where the arrow starts
  lapses: number;
  reps: number;
}

export function openLinePeek(opts: LinePeekOptions): void {
  const { line } = opts;
  const nodes = mainlineNodes(line.tree);
  if (nodes.length === 0) return;

  const plies: Ply[] = nodes.map((node, i) => ({
    node,
    index: i,
    isUser: line.colour === 'white' ? i % 2 === 0 : i % 2 === 1,
    preFen: i === 0 ? START_FEN : nodes[i - 1].fen,
    lapses: node.review?.lapses ?? 0,
    reps: node.review?.reps ?? 0,
  }));

  const userPlies = plies.filter(p => p.isUser);
  const worst = Math.max(1, ...userPlies.map(p => p.lapses));
  const totalMisses = userPlies.reduce((n, p) => n + p.lapses, 0);
  const drilled = userPlies.filter(p => p.node.review).length;
  const solid = userPlies.filter(p => p.node.review && p.reps > 0).length;
  const recallPct = drilled > 0 ? Math.round((100 * solid) / drilled) : null;

  // Open on the worst move when there is one — that's why you tapped in.
  const defaultPly = opts.focusPly
    ?? (userPlies.length && worst > 1
      ? userPlies.reduce((a, b) => (b.lapses > a.lapses ? b : a)).index
      : plies.length - 1);
  let current = defaultPly;

  // ── Scaffold ───────────────────────────────────────────────────────────────

  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet peek-sheet lpeek-sheet';

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  };

  const h = document.createElement('h3');
  h.className = 'edit-sheet-title peek-title';
  h.textContent = line.name || line.openingName || 'Untitled line';
  sheet.appendChild(h);

  // ── The line's own numbers, as three plain figures ─────────────────────────

  // Recall is only meaningful next to how often the line has actually been run,
  // so "trained" sits right beside it rather than being buried in a caption.
  const times = opts.timesTrained ?? lineTrainingCount(line);

  const statRow = document.createElement('div');
  statRow.className = 'lpeek-stats';
  statRow.appendChild(lpeekStat(
    recallPct === null ? '—' : `${recallPct}%`, 'recall',
    recallPct !== null && recallPct < 50 ? 'low' : recallPct !== null && recallPct < 80 ? 'mid' : 'ok',
  ));
  statRow.appendChild(lpeekStat(String(times), times === 1 ? 'run' : 'runs'));
  statRow.appendChild(lpeekStat(`${drilled}/${userPlies.length}`, 'drilled'));
  statRow.appendChild(lpeekStat(String(totalMisses), totalMisses === 1 ? 'miss' : 'misses',
    totalMisses > 0 ? 'low' : undefined));
  sheet.appendChild(statRow);

  // ── Board ──────────────────────────────────────────────────────────────────

  const board = document.createElement('div');
  board.className = 'peek-board cg-wrap';
  sheet.appendChild(board);

  const cg: Api = Chessground(board, {
    fen: plies[current].node.fen,
    orientation: line.colour,
    viewOnly: true,
    coordinates: false,
    animation: { enabled: true, duration: 180 },
    drawable: { enabled: false, visible: true },
  });
  registerBrushes(cg, {
    accent: { color: '#ff9b21', opacity: 0.9, lineWidth: 10 },
    danger: { color: '#c93636', opacity: 0.85, lineWidth: 10 },
  });

  // ── Stepper: ‹ caption › ───────────────────────────────────────────────────

  const stepRow = document.createElement('div');
  stepRow.className = 'lpeek-step';
  // Icons.back is the plain left chevron — the mirror of chevronRight.
  const prevBtn = stepBtn('Previous move', Icons.back(18), () => select(current - 1));
  const caption = document.createElement('div');
  caption.className = 'lpeek-caption';
  const nextBtn = stepBtn('Next move', Icons.chevronRight(18), () => select(current + 1));
  stepRow.append(prevBtn, caption, nextBtn);
  sheet.appendChild(stepRow);

  // ── Move list ──────────────────────────────────────────────────────────────

  const listWrap = document.createElement('div');
  listWrap.className = 'lpeek-list';
  const moveBtns = new Map<number, HTMLElement>();

  for (let i = 0; i < plies.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'lpeek-row';

    const num = document.createElement('span');
    num.className = 'lpeek-num';
    num.textContent = `${Math.floor(i / 2) + 1}.`;
    row.appendChild(num);

    for (const p of [plies[i], plies[i + 1]]) {
      if (!p) { row.appendChild(document.createElement('span')); continue; }
      row.appendChild(buildMoveCell(p));
    }
    listWrap.appendChild(row);
  }
  sheet.appendChild(listWrap);

  function buildMoveCell(p: Ply): HTMLElement {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'lpeek-move' + (p.isUser ? ' lpeek-move--mine' : ' lpeek-move--theirs');
    moveBtns.set(p.index, cell);

    const san = document.createElement('span');
    san.className = 'lpeek-san';
    san.textContent = formatMove(p.node.san);
    cell.appendChild(san);

    if (p.node.note) {
      const dot = document.createElement('span');
      dot.className = 'lpeek-notedot';
      dot.setAttribute('aria-hidden', 'true');
      cell.appendChild(dot);
    }

    // Only your moves are scheduled, so only they can have been missed. The bar
    // is scaled against this line's worst move, so the leak is visible at a
    // glance without reading a single number.
    if (p.isUser && p.lapses > 0) {
      const badge = document.createElement('span');
      badge.className = 'lpeek-misses';
      badge.textContent = `${p.lapses}×`;
      cell.appendChild(badge);

      const bar = document.createElement('span');
      bar.className = 'lpeek-bar';
      const fill = document.createElement('span');
      fill.className = 'lpeek-bar-fill';
      fill.style.width = `${Math.round((p.lapses / worst) * 100)}%`;
      bar.appendChild(fill);
      cell.appendChild(bar);
    }

    cell.addEventListener('click', () => select(p.index));
    return cell;
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  function select(index: number): void {
    current = Math.max(0, Math.min(plies.length - 1, index));
    const p = plies[current];

    cg.set({ fen: p.node.fen, orientation: line.colour });
    requestAnimationFrame(() => {
      cg.setAutoShapes([{
        orig: p.node.uci.slice(0, 2) as Key,
        dest: p.node.uci.slice(2, 4) as Key,
        brush: p.isUser && p.lapses > 0 ? 'danger' : 'accent',
      }]);
    });

    const moveNo = Math.floor(p.index / 2) + 1;
    const dots = p.index % 2 === 0 ? '.' : '…';
    const bits = [`${moveNo}${dots} ${formatMove(p.node.san)}`];
    if (p.isUser) {
      bits.push(p.lapses > 0 ? `missed ${p.lapses}×` : 'never missed');
      if (p.node.review) bits.push(p.reps > 0 ? `${p.reps} clean in a row` : 'slipping');
    } else {
      bits.push("their reply");
    }
    caption.textContent = bits.join(' · ');

    for (const [i, el] of moveBtns) el.classList.toggle('lpeek-move--on', i === current);
    prevBtn.disabled = current === 0;
    nextBtn.disabled = current === plies.length - 1;
    moveBtns.get(current)?.scrollIntoView({ block: 'nearest' });

    // The selected move's note rides along under the board.
    if (p.node.note) {
      noteEl.textContent = p.node.note;
      noteEl.removeAttribute('hidden');
    } else {
      noteEl.setAttribute('hidden', '');
    }
  }

  // ── Note for the selected move ─────────────────────────────────────────────
  //
  // Declared after `select` but only ever touched from inside it, and the first
  // call happens at the very end of this function — so it is always initialised
  // by the time it's read.

  const noteEl = document.createElement('div');
  noteEl.className = 'peek-note lpeek-note';
  noteEl.setAttribute('hidden', '');
  sheet.appendChild(noteEl);

  // ── Actions ────────────────────────────────────────────────────────────────

  const btnRow = document.createElement('div');
  btnRow.className = 'peek-actions';
  if (opts.onDrill) {
    btnRow.appendChild(peekActionBtn(Icons.zap(18), 'Drill line',
      () => { close(); opts.onDrill!(line); }));
  }
  if (opts.onOpen) {
    btnRow.appendChild(peekActionBtn(Icons.pencil(18), 'Open',
      () => { close(); opts.onOpen!(line); }));
  }
  if (btnRow.childElementCount > 0) sheet.appendChild(btnRow);

  const removeBack = pushBack(() => close());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  // Mounted into a transient popup, so nudge a redraw once it's actually sized,
  // then open on the focused move.
  requestAnimationFrame(() => cg.redrawAll());
  select(current);
}

function stepBtn(label: string, icon: SVGElement, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lpeek-step-btn';
  btn.setAttribute('aria-label', label);
  btn.appendChild(icon);
  btn.addEventListener('click', onClick);
  return btn;
}

function lpeekStat(value: string, label: string, tone?: string): HTMLElement {
  const cell = document.createElement('div');
  cell.className = 'lpeek-stat' + (tone ? ` lpeek-stat--${tone}` : '');
  const v = document.createElement('span');
  v.className = 'lpeek-stat-value';
  v.textContent = value;
  cell.appendChild(v);
  const l = document.createElement('span');
  l.className = 'lpeek-stat-label';
  l.textContent = label;
  cell.appendChild(l);
  return cell;
}
