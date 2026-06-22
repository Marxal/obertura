import type { EvalResult, MoveEval } from './engine';
import { formatMove } from './notation';

// The eval display is split across two mount points:
//   barEl       — the horizontal eval bar + score, sits ABOVE the board.
//   controlsEl  — the recommended moves + engine toggle, sit BELOW the board.
// Clicking a recommended move calls onPlayMove(uci) so it's played on the board.
export class EvalPanel {
  private barEl: HTMLElement;
  private controlsEl: HTMLElement;
  private _enabled: boolean;
  private onToggle: (enabled: boolean) => void;
  private onPlayMove: (uci: string) => void;

  constructor(
    barEl: HTMLElement,
    controlsEl: HTMLElement,
    enabled: boolean,
    onToggle: (enabled: boolean) => void,
    onPlayMove: (uci: string) => void,
  ) {
    this.barEl = barEl;
    this.controlsEl = controlsEl;
    this._enabled = enabled;
    this.onToggle = onToggle;
    this.onPlayMove = onPlayMove;
    this.build();
  }

  private build() {
    // Top: full-width horizontal bar with the score floating at its right end.
    this.barEl.innerHTML = `
      <div class="eval-bar-wrap" id="eval-bar-wrap">
        <div class="eval-bar" id="eval-bar">
          <div class="eval-bar-fill" id="eval-bar-fill" style="width:50%"></div>
        </div>
        <span class="eval-score" id="eval-score">0.0</span>
      </div>`;

    // Bottom: candidate moves on the left, toggle + label on the right.
    this.controlsEl.innerHTML = `
      <div class="eval-row">
        <div class="eval-moves" id="eval-moves"></div>
        <div class="eval-right">
          <span class="eval-source" id="eval-source"></span>
          <label class="engine-toggle" title="Engine analysis">
            <input type="checkbox" id="engine-cb" ${this._enabled ? 'checked' : ''}>
            <span class="engine-toggle-track"></span>
          </label>
          <span class="engine-label" id="engine-label"></span>
        </div>
      </div>`;

    this.controlsEl.querySelector<HTMLInputElement>('#engine-cb')!
      .addEventListener('change', e => {
        this._enabled = (e.target as HTMLInputElement).checked;
        this.syncVisibility();
        this.onToggle(this._enabled);
      });

    // Delegated click: play the first move of whichever line was tapped.
    this.controlsEl.querySelector<HTMLElement>('#eval-moves')!
      .addEventListener('click', e => {
        const row = (e.target as HTMLElement).closest<HTMLElement>('[data-uci]');
        const uci = row?.dataset.uci;
        if (uci) this.onPlayMove(uci);
      });

    this.syncVisibility();
  }

  // Programmatically flip the toggle (used to auto-enable the engine when its
  // carousel tab is opened). Mirrors a user tap: syncs the checkbox + the bar,
  // then fires onToggle so the engine actually starts/stops.
  setEnabled(on: boolean) {
    if (this._enabled === on) return;
    const cb = this.controlsEl.querySelector<HTMLInputElement>('#engine-cb');
    if (cb) cb.checked = on;
    this._enabled = on;
    this.syncVisibility();
    this.onToggle(on);
  }

  get isEnabled() { return this._enabled; }

  private syncVisibility() {
    const barWrap = this.barEl.querySelector<HTMLElement>('#eval-bar-wrap')!;
    const movesEl = this.controlsEl.querySelector<HTMLElement>('#eval-moves')!;
    const sourceEl = this.controlsEl.querySelector<HTMLElement>('#eval-source')!;
    const labelEl = this.controlsEl.querySelector<HTMLElement>('#engine-label')!;
    barWrap.hidden = !this._enabled;
    labelEl.textContent = this._enabled ? 'Engine on' : 'Turn on engine';
    if (!this._enabled) {
      movesEl.innerHTML = '';
      sourceEl.textContent = '';
    } else if (!movesEl.children.length) {
      movesEl.innerHTML = '<span class="eval-waiting">Analyzing…</span>';
    }
  }

  update(result: EvalResult, fen: string) {
    if (!this._enabled || result.fen !== fen) return;

    const top = result.moves[0];
    if (!top) return;

    // Eval bar & score — cp/mate already white-normalised from engine.ts.
    let cpWhite: number;
    let scoreText: string;

    if (top.mate !== undefined) {
      cpWhite = top.mate > 0 ? 9999 : -9999;
      scoreText = top.mate > 0 ? `M${top.mate}` : `-M${Math.abs(top.mate)}`;
    } else {
      cpWhite = top.cp ?? 0;
      scoreText = (cpWhite >= 0 ? '+' : '') + (cpWhite / 100).toFixed(1);
    }

    const fillPct = this.cpToFill(cpWhite);
    this.barEl.querySelector<HTMLElement>('#eval-bar-fill')!.style.width = `${fillPct}%`;
    this.barEl.querySelector<HTMLElement>('#eval-score')!.textContent = scoreText;

    // Top 3 lines — each its full principal variation, clickable to play its
    // first move. The score sits on the left, the SAN line on the right.
    const movesEl = this.controlsEl.querySelector<HTMLElement>('#eval-moves')!;
    movesEl.innerHTML = result.moves.slice(0, 3).map(m => {
      const pv = (m.sanLine && m.sanLine.length ? m.sanLine : [m.san || m.uci]);
      return `<button class="eval-line" type="button" data-uci="${m.uci}">` +
        `<span class="eval-line-score">${this.fmtScore(m)}</span>` +
        `<span class="eval-line-pv">${this.escape(this.formatLine(pv, fen))}</span>` +
      `</button>`;
    }).join('');

    // Source + depth badge: "cloud · d38" when Lichess answered, or
    // "local · d14…d20" while the bundled Stockfish climbs to its target
    // (collapsing to "local · d20" once it lands).
    const sourceEl = this.controlsEl.querySelector<HTMLElement>('#eval-source')!;
    sourceEl.textContent = this.badgeText(result);
  }

  clear() {
    const fill = this.barEl.querySelector<HTMLElement>('#eval-bar-fill');
    if (fill) fill.style.width = '50%';
    const score = this.barEl.querySelector<HTMLElement>('#eval-score');
    if (score) score.textContent = '0.0';
    const moves = this.controlsEl.querySelector<HTMLElement>('#eval-moves');
    if (moves) moves.innerHTML = this._enabled ? '<span class="eval-waiting">Analyzing…</span>' : '';
    const source = this.controlsEl.querySelector<HTMLElement>('#eval-source');
    if (source) source.textContent = '';
  }

  // Maps white-perspective centipawns to a 0–100% fill (white fills from the
  // left) using Lichess's winning-chances curve, so the bar reads as the
  // practical chance of winning rather than raw material. A +0.8 edge lands
  // near 57%, not a near-win. Mate scores are pinned to the extremes.
  private cpToFill(cp: number): number {
    if (cp >= 9999) return 100;
    if (cp <= -9999) return 0;
    // winChance ∈ (-1, 1): +1 = white winning, -1 = black winning.
    const winChance = 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
    const clamped = Math.max(-1, Math.min(1, winChance));
    return 50 + 50 * clamped;
  }

  private badgeText(result: EvalResult): string {
    if (result.source === 'lichess') return `cloud · d${result.depth}`;
    const target = result.targetDepth;
    if (target && result.depth < target) return `local · d${result.depth}…d${target}`;
    return `local · d${result.depth}`;
  }

  // Render a SAN line with move numbers, seeded from the position's fen so the
  // first move gets the right number and "." / "…" for white / black to move.
  private formatLine(sanLine: string[], fen: string): string {
    const parts = fen.split(' ');
    let moveNo = parseInt(parts[5] ?? '1') || 1;
    let white = (parts[1] ?? 'w') === 'w';
    const out: string[] = [];
    for (let i = 0; i < sanLine.length; i++) {
      if (white) out.push(`${moveNo}.`);
      else if (i === 0) out.push(`${moveNo}…`);
      out.push(formatMove(sanLine[i]));
      if (!white) moveNo++;
      white = !white;
    }
    return out.join(' ');
  }

  private escape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private fmtScore(m: MoveEval): string {
    if (m.mate !== undefined) {
      return m.mate > 0 ? `M${m.mate}` : `-M${Math.abs(m.mate)}`;
    }
    if (m.cp !== undefined) {
      return (m.cp >= 0 ? '+' : '') + (m.cp / 100).toFixed(1);
    }
    return '';
  }
}
