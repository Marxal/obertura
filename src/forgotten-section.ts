// "Forgotten moves" — the block that shows what keeps slipping, on the Train
// screen's Openings pane (it replaced the old per-window board carousel there).
//
// Two views behind one segmented control:
//   Moves — the individual moves you keep missing, worst first. Each row is a
//     position miniature, the move, and a green/red bar of recalled-vs-missed
//     over every time it has been asked. Tapping opens the position on a board.
//   Lines — the same question one level up: how much of each line still sticks.
//     Tapping opens the whole line, steppable, with per-move miss counts.
//
// Everything here reads the per-move SM-2 blocks (`lapses` for the misses,
// `reps` for whether a move was remembered at its last drill). Nothing new is
// recorded for it.
//
// On "accuracy": the scheduler keeps no lifetime attempt count, so a true
// accuracy percentage isn't in the data. What the Lines view shows is RECALL —
// the share of a line's drilled moves remembered last time — next to how many
// times the line has actually been trained, so the percentage has a denominator
// you can judge it by.

import type { Line } from './types';
import {
  needsWorkMoves,
  lineRecall,
  lineTrainingCount,
  type NeedsWorkMove,
  type LineRecall,
  type MoveMemory,
} from './stats';
import { mainlineNodes, describeDue } from './scheduler';
import { statsSection, buildSegmented, openSheet } from './stats-ui';
import { buildEmptyState } from './empty-state';
import { colourPip, lineFinalFen } from './card-position';
import { buildMiniBoard } from './board-mini';
import { getShowLineMiniatures } from './prefs';
import { openPositionPeek } from './position-peek';
import { openLinePeek } from './line-peek';
import { formatMove } from './notation';
import { Icons } from './icons';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// How many rows before the block defers to its "See all" sheet.
const PREVIEW = 5;

export interface ForgottenCallbacks {
  /** Three reps of this exact move, then the full line it lives in. */
  onFixMove: (move: NeedsWorkMove, lines: Line[]) => void;
  /** Drill one line, start to finish. */
  onDrillLine: (line: Line) => void;
  /** Open a line for editing. Omit where there's no builder route. */
  onOpenLine?: (line: Line) => void;
  /** The empty states' way out. */
  onStartTraining: () => void;
}

type Tab = 'moves' | 'lines';

// A move in the usual written form: "8. ♞f3" for White, "8… c6" for Black — the
// ellipsis is how notation says "this is Black's half of move 8".
function moveLabel(m: NeedsWorkMove): string {
  return `${m.moveNumber}${m.colour === 'white' ? '.' : '…'} ${formatMove(m.san)}`;
}

export function renderForgottenSection(host: HTMLElement, lines: Line[], cb: ForgottenCallbacks): void {
  const moves = needsWorkMoves(lines, 50);
  const recall = lineRecall(lines, 50);
  // Nothing has ever been missed — no section at all, rather than an empty card.
  if (moves.length === 0 && recall.length === 0) return;

  const section = statsSection('Forgotten moves', `${moves.length} to work on`);

  const body = document.createElement('div');
  body.className = 'stats-forgotten-body';

  let tab: Tab = moves.length > 0 ? 'moves' : 'lines';

  // The caption explains whichever bar you're looking at, so it changes with
  // the tab rather than trying to describe both at once.
  const cap = document.createElement('p');
  cap.className = 'stats-trend-caption';

  const paint = (): void => {
    body.innerHTML = '';
    if (tab === 'moves') paintMoves(body, moves, lines, cb);
    else paintLines(body, recall, lines, cb);
    cap.textContent = tab === 'moves'
      ? 'Green is recalled, red missed, over every time the move has been asked.'
      : 'Recall is the share of a line’s drilled moves you remembered last time.';
  };

  section.appendChild(buildSegmented<Tab>(
    [['moves', 'Moves'], ['lines', 'Lines']],
    tab,
    (v) => { tab = v; paint(); },
    'stats-range stats-forgotten-tabs',
    body,
  ));
  section.appendChild(body);
  paint();

  section.appendChild(cap);

  host.appendChild(section);
}

// ── Moves ────────────────────────────────────────────────────────────────────

function paintMoves(body: HTMLElement, moves: NeedsWorkMove[], lines: Line[], cb: ForgottenCallbacks): void {
  if (moves.length === 0) {
    body.appendChild(buildEmptyState({
      line: 'No missed moves yet — clean run.',
      cta: { label: 'Start training', onClick: cb.onStartTraining },
    }));
    return;
  }
  for (const m of moves.slice(0, PREVIEW)) body.appendChild(moveRow(m, lines, cb));
  if (moves.length > PREVIEW) {
    body.appendChild(seeAllRow(`See all ${moves.length}`, () => openMovesSheet(moves, lines, cb)));
  }
}

function moveRow(m: NeedsWorkMove, lines: Line[], cb: ForgottenCallbacks): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'stats-sheet-card stats-forgotten-row';

  appendMini(card, m.preFen, m.colour);

  const text = document.createElement('span');
  text.className = 'stats-sheet-text';

  const name = document.createElement('span');
  name.className = 'stats-sheet-name';
  name.appendChild(colourPip(m.colour));
  name.appendChild(document.createTextNode(moveLabel(m)));
  if (m.hasNote) {
    const badge = document.createElement('span');
    badge.className = 'stats-note-badge';
    badge.textContent = 'note';
    name.appendChild(badge);
  }
  text.appendChild(name);

  // Recalled vs missed over every time the move has been asked — the same
  // green/red language the Lines view uses, so a leaky move looks leaky
  // whichever list you're in.
  text.appendChild(splitBar(Math.max(0, m.attempts - m.lapses), m.lapses));

  const meta = document.createElement('span');
  meta.className = 'stats-sheet-meta';
  meta.textContent = `${m.lineName} · missed ${m.lapses} of ${m.attempts}`;
  text.appendChild(meta);

  card.appendChild(text);

  const count = document.createElement('span');
  count.className = 'stats-miss-count';
  count.textContent = `${m.lapses}×`;
  card.appendChild(count);

  // Tapping opens the position rather than launching straight into a drill —
  // you usually want to SEE what you keep missing before drilling it.
  card.addEventListener('click', () => openMovePeek(m, lines, cb));
  return card;
}

// The tapped move, on a board, with its arrow already drawn, everything the
// app actually knows about how it's going, and its note underneath.
//
// Four figures, chosen because each answers a different question:
//   recall  — how often you get it, over every time it's been asked;
//   missed  — the raw count, so the rate has its numerator;
//   asked   — the denominator, so 3-of-4 can't masquerade as 3-of-40;
//   streak  — clean recalls in a row RIGHT NOW, the only forward-looking one:
//             it says whether the move is recovering or still going.
// The footnote carries the opening and when it next comes round.
function openMovePeek(m: NeedsWorkMove, lines: Line[], cb: ForgottenCallbacks): void {
  const line = lines.find(l => l.id === m.lineId);
  const recalled = Math.max(0, m.attempts - m.lapses);
  const pct = m.attempts > 0 ? Math.round((100 * recalled) / m.attempts) : null;

  const foot = [
    m.openingName ?? m.lineName,
    m.due ? describeDue(m.due) : 'not scheduled yet',
  ].join(' · ');

  openPositionPeek({
    fen: m.preFen,
    orientation: m.colour,
    revealUci: m.uci,
    title: moveLabel(m),
    subtitle: m.lineName,
    stats: [
      {
        value: pct === null ? '—' : `${pct}%`,
        label: 'recall',
        tone: pct === null ? undefined : pct < 50 ? 'low' : pct < 80 ? 'mid' : 'ok',
      },
      { value: String(m.lapses), label: m.lapses === 1 ? 'miss' : 'misses', tone: 'low' },
      { value: String(m.attempts), label: 'asked' },
      {
        value: String(m.reps),
        label: 'in a row',
        tone: m.reps > 0 ? 'ok' : 'low',
      },
    ],
    footnote: foot,
    note: line ? noteForMove(line, m) : undefined,
    actions: [
      { icon: Icons.target(18), label: 'Fix it', onClick: ({ close }) => { close(); cb.onFixMove(m, lines); } },
      ...(line
        ? [{ icon: Icons.zap(18), label: 'Drill line', onClick: ({ close }: { close: () => void }) => { close(); cb.onDrillLine(line); } }]
        : []),
    ],
  });
}

// The written note on the exact move this row points at, matched by position +
// move so a repeated SAN elsewhere in the line can't pick up the wrong one.
function noteForMove(line: Line, m: NeedsWorkMove): string | undefined {
  const main = mainlineNodes(line.tree);
  for (let i = 0; i < main.length; i++) {
    const preFen = i === 0 ? START_FEN : main[i - 1].fen;
    if (preFen === m.preFen && main[i].san === m.san) return main[i].note;
  }
  return undefined;
}

// ── Lines ────────────────────────────────────────────────────────────────────

function paintLines(body: HTMLElement, recall: LineRecall[], lines: Line[], cb: ForgottenCallbacks): void {
  if (recall.length === 0) {
    body.appendChild(buildEmptyState({
      line: 'Nothing drilled yet — train a line and it shows up here.',
      cta: { label: 'Start training', onClick: cb.onStartTraining },
    }));
    return;
  }
  for (const r of recall.slice(0, PREVIEW)) body.appendChild(lineRow(r, lines, cb));
  if (recall.length > PREVIEW) {
    body.appendChild(seeAllRow(`See all ${recall.length}`, () => openLinesSheet(recall, lines, cb)));
  }
}

function lineRow(r: LineRecall, lines: Line[], cb: ForgottenCallbacks): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'stats-sheet-card stats-forgotten-row';

  const line = lines.find(l => l.id === r.lineId);
  if (line) appendMini(card, lineFinalFen(line.tree), r.colour);

  const text = document.createElement('span');
  text.className = 'stats-sheet-text';

  const name = document.createElement('span');
  name.className = 'stats-sheet-name';
  name.appendChild(colourPip(r.colour));
  name.appendChild(document.createTextNode(r.lineName));
  text.appendChild(name);

  text.appendChild(memoryBar(r.memory));

  // How often the line has actually been drilled sits next to the recall
  // figure — a percentage over two runs means something very different from
  // the same percentage over twenty.
  const meta = document.createElement('span');
  meta.className = 'stats-sheet-meta';
  meta.textContent = `${trainedLabel(r.timesTrained)} · ${r.memory.solid} solid · ${r.memory.shaky} slipping`
    + (r.lapses > 0 ? ` · missed ${r.lapses}×` : '');
  text.appendChild(meta);
  card.appendChild(text);

  const pct = document.createElement('span');
  pct.className = 'stats-miss-count stats-recall-pct';
  pct.textContent = r.memory.recallPct === null ? '—' : `${r.memory.recallPct}%`;
  card.appendChild(pct);

  card.addEventListener('click', () => {
    // `recall` is derived from `lines`, so the lookup always finds one; the
    // guard just keeps a stale render from throwing.
    if (!line) return;
    openLinePeek({
      line,
      timesTrained: r.timesTrained,
      onDrill: cb.onDrillLine,
      onOpen: cb.onOpenLine,
    });
  });
  return card;
}

export function trainedLabel(times: number): string {
  if (times <= 0) return 'not trained yet';
  return times === 1 ? 'trained once' : `trained ${times}×`;
}

// A segmented memory meter: solid / slipping / not-yet-trained, in the same
// order and colours as the Move memory donut, so one glance carries across
// both. Zero-width segments are skipped rather than drawn as slivers.
function memoryBar(m: MoveMemory): HTMLElement {
  return segmentBar([
    [m.solid, 'solid'],
    [m.shaky, 'shaky'],
    [m.total - m.trained, 'untrained'],
  ]);
}

// The move-level version: how often you got it against how often you didn't.
function splitBar(recalled: number, missed: number): HTMLElement {
  return segmentBar([[recalled, 'solid'], [missed, 'shaky']]);
}

function segmentBar(segs: [number, string][]): HTMLElement {
  const bar = document.createElement('span');
  bar.className = 'stats-mem-bar';
  const total = Math.max(1, segs.reduce((n, [v]) => n + v, 0));
  for (const [value, kind] of segs) {
    if (value <= 0) continue;
    const seg = document.createElement('span');
    seg.className = `stats-mem-seg stats-mem-seg--${kind}`;
    seg.style.width = `${(value / total) * 100}%`;
    bar.appendChild(seg);
  }
  return bar;
}

// ── Shared bits ──────────────────────────────────────────────────────────────

// The position miniature, at the same size the saved-line cards use, and behind
// the same global "show line miniatures" Settings toggle.
function appendMini(card: HTMLElement, fen: string, colour: 'white' | 'black'): void {
  if (!getShowLineMiniatures()) return;
  const mini = document.createElement('span');
  mini.className = 'stats-forgotten-mini';
  mini.appendChild(buildMiniBoard(fen, colour));
  card.appendChild(mini);
}

function seeAllRow(label: string, onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'stats-see-all';
  btn.textContent = `${label} →`;
  btn.addEventListener('click', onClick);
  return btn;
}

// The full list as a sheet. Exported because Statistics' "Needs work" box opens
// the same thing — one row implementation, two entry points.
export function openMovesSheet(
  moves: NeedsWorkMove[],
  lines: Line[],
  cb: ForgottenCallbacks,
  title = 'Forgotten moves',
): void {
  openSheet(title, (body, close) => {
    if (moves.length === 0) {
      body.appendChild(buildEmptyState({
        line: 'No missed moves yet — clean run.',
        cta: { label: 'Start training', onClick: () => { close(); cb.onStartTraining(); } },
      }));
      return;
    }
    for (const m of moves) {
      const card = moveRow(m, lines, cb);
      // The row's own handler fires too; close the sheet first so the popup
      // opens over the screen, not over a stacked sheet.
      card.addEventListener('click', () => close(), { capture: true });
      body.appendChild(card);
    }
  });
}

function openLinesSheet(recall: LineRecall[], lines: Line[], cb: ForgottenCallbacks): void {
  openSheet('Line recall', (body, close) => {
    for (const r of recall) {
      const card = lineRow(r, lines, cb);
      card.addEventListener('click', () => close(), { capture: true });
      body.appendChild(card);
    }
  });
}
