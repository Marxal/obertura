import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import type { Key } from 'chessground/types';
import { Icons } from './icons';
import { cloudLine, type CloudLine } from './engine';
import { pushBack } from './back-nav';

// ── Line explorer ────────────────────────────────────────────────────────────
//
// A lightweight, throw-away board for "where does this go?". Opened on top of
// the drill overlay (so the drill is untouched underneath and resumes when you
// tap Back) at the position AFTER a good-alternative move. You can play moves
// freely from here; the engine shows its eval, a best-move arrow, and its main
// line as tappable chips so you can step straight into the continuation.
//
// No persistence, no grading — purely "let me see what my move leads to".

const GREEN = '#3a9a5c';

export function openExplorer(
  startFen: string,
  opts: { onClose: () => void; label?: string; orientation?: 'white' | 'black' },
): void {
  const chess = new Chess(startFen);
  const startOrientation =
    opts.orientation ?? (startFen.split(' ')[1] === 'b' ? 'black' : 'white');
  let isCleaned = false;
  let evalReqId = 0;

  // ── Overlay scaffolding (reuses the training overlay's chrome) ──────────────
  const overlay = document.createElement('div');
  overlay.className = 'pt-overlay explore-overlay';

  const header = document.createElement('div');
  header.className = 'pt-header';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'pt-back-btn';
  backBtn.appendChild(Icons.back(15));
  backBtn.appendChild(document.createTextNode('Back to drill'));
  backBtn.addEventListener('click', () => { cleanup(); opts.onClose(); });

  const modeEl = document.createElement('div');
  modeEl.className = 'pt-mode-label';
  modeEl.textContent = opts.label ?? 'Explore line';

  header.appendChild(backBtn);
  header.appendChild(modeEl);

  const boardWrap = document.createElement('div');
  boardWrap.className = 'pt-board-wrap';
  const boardEl = document.createElement('div');
  boardEl.className = 'pt-board';
  boardWrap.appendChild(boardEl);

  const evalEl = document.createElement('div');
  evalEl.className = 'explore-eval';

  const lineEl = document.createElement('div');
  lineEl.className = 'explore-line';

  const histEl = document.createElement('div');
  histEl.className = 'explore-history';

  const controls = document.createElement('div');
  controls.className = 'explore-controls';

  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'btn-secondary explore-btn';
  undoBtn.textContent = 'Undo';
  undoBtn.addEventListener('click', () => {
    if (chess.history().length > 0) { chess.undo(); refresh(); }
  });

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'btn-secondary explore-btn';
  resetBtn.textContent = 'Restart';
  resetBtn.addEventListener('click', () => { chess.load(startFen); refresh(); });

  controls.appendChild(undoBtn);
  controls.appendChild(resetBtn);

  overlay.appendChild(header);
  overlay.appendChild(boardWrap);
  overlay.appendChild(evalEl);
  overlay.appendChild(lineEl);
  overlay.appendChild(histEl);
  overlay.appendChild(controls);
  document.body.appendChild(overlay);

  // System back gesture returns to the drill, same as tapping Back.
  const removeBack = pushBack(() => { cleanup(); opts.onClose(); });

  // ── Chess helpers ───────────────────────────────────────────────────────────
  function legalDests(): Map<Key, Key[]> {
    const dests = new Map<Key, Key[]>();
    for (const m of chess.moves({ verbose: true })) {
      const from = m.from as Key;
      if (!dests.has(from)) dests.set(from, []);
      dests.get(from)!.push(m.to as Key);
    }
    return dests;
  }
  function cgTurn(): 'white' | 'black' {
    return chess.turn() === 'w' ? 'white' : 'black';
  }
  function lastMoveKeys(): [Key, Key] | undefined {
    const h = chess.history({ verbose: true });
    const last = h[h.length - 1];
    return last ? [last.from as Key, last.to as Key] : undefined;
  }

  const cg = Chessground(boardEl, {
    fen: startFen,
    orientation: startOrientation,
    turnColor: cgTurn(),
    movable: { color: cgTurn(), free: false, dests: legalDests() },
    draggable: { showGhost: true },
    animation: { enabled: true, duration: 200 },
    events: { move(from, to) { onMove(from, to); } },
  });
  cg.state.drawable.brushes['alt'] = { key: 'alt', color: GREEN, opacity: 0.85, lineWidth: 10 };

  const ro = new ResizeObserver(() => cg.redrawAll());
  ro.observe(boardEl);

  function onMove(from: Key, to: Key): void {
    chess.move({ from, to, promotion: 'q' });
    refresh();
  }

  // Step into the engine line: play UCI moves 0..idx in order from here.
  function playInto(line: CloudLine, idx: number): void {
    for (let k = 0; k <= idx; k++) {
      const u = line.uciLine[k];
      if (!u) break;
      const m = chess.move({
        from: u.slice(0, 2),
        to: u.slice(2, 4),
        promotion: (u[4] as 'q' | 'r' | 'b' | 'n') || 'q',
      });
      if (!m) break;
    }
    refresh();
  }

  function refresh(): void {
    cg.set({
      fen: chess.fen(),
      turnColor: cgTurn(),
      movable: { color: cgTurn(), free: false, dests: legalDests() },
      lastMove: lastMoveKeys(),
    });
    cg.setAutoShapes([]);
    undoBtn.disabled = chess.history().length === 0;
    renderHistory();
    requestEval();
  }

  function renderHistory(): void {
    const sans = chess.history();
    histEl.textContent = sans.length > 0
      ? sans.join('  ')
      : 'Play moves to see where this leads.';
  }

  function requestEval(): void {
    const reqId = ++evalReqId;
    const fen = chess.fen();
    evalEl.textContent = 'Analyzing…';
    lineEl.replaceChildren();
    void cloudLine(fen).then(line => {
      if (isCleaned || reqId !== evalReqId) return;
      if (!line) {
        evalEl.textContent = 'No engine data for this position.';
        return;
      }
      evalEl.textContent = `Engine eval: ${fmtEval(line)}`;
      const orig = line.bestUci.slice(0, 2) as Key;
      const dest = line.bestUci.slice(2, 4) as Key;
      cg.setAutoShapes([{ orig, dest, brush: 'alt' }]);
      renderLine(line);
    });
  }

  function renderLine(line: CloudLine): void {
    lineEl.replaceChildren();
    const label = document.createElement('span');
    label.className = 'explore-line-label';
    label.textContent = 'Engine line:';
    lineEl.appendChild(label);

    const max = Math.min(line.sanLine.length, 8);
    for (let i = 0; i < max; i++) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'explore-line-move';
      chip.textContent = line.sanLine[i];
      // Tapping a move plays the line up to and including it.
      chip.addEventListener('click', () => playInto(line, i));
      lineEl.appendChild(chip);
    }
  }

  function cleanup(): void {
    isCleaned = true;
    ro.disconnect();
    overlay.remove();
    removeBack();
  }

  refresh();
}

// White-perspective eval → a short "+0.7" / "M3" readout.
function fmtEval(line: CloudLine): string {
  if (line.mate !== undefined) {
    return line.mate > 0 ? `M${line.mate}` : `-M${Math.abs(line.mate)}`;
  }
  if (line.cp !== undefined) {
    const v = line.cp / 100;
    return (v >= 0 ? '+' : '') + v.toFixed(1);
  }
  return '—';
}
