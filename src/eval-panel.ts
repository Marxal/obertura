import type { EvalResult, MoveEval } from './engine';

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

    // Delegated click: play whichever recommended move was tapped.
    this.controlsEl.querySelector<HTMLElement>('#eval-moves')!
      .addEventListener('click', e => {
        const chip = (e.target as HTMLElement).closest<HTMLElement>('.eval-move');
        const uci = chip?.dataset.uci;
        if (uci) this.onPlayMove(uci);
      });

    this.syncVisibility();
  }

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

    // Top 3 moves — clickable, each carrying its UCI so it can be played.
    const movesEl = this.controlsEl.querySelector<HTMLElement>('#eval-moves')!;
    movesEl.innerHTML = result.moves.slice(0, 3).map(m =>
      `<span class="eval-move" data-uci="${m.uci}" role="button" tabindex="0">` +
        `<span class="eval-move-san">${m.san || m.uci}</span>` +
        `<span class="eval-move-cp">${this.fmtScore(m)}</span>` +
      `</span>`
    ).join('');

    // Source badge.
    const sourceEl = this.controlsEl.querySelector<HTMLElement>('#eval-source')!;
    sourceEl.textContent = result.source === 'lichess'
      ? `☁ d${result.depth}`
      : `⚙ d${result.depth}`;
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
  // left). Uses a soft sigmoid so extreme evals don't peg the bar instantly.
  private cpToFill(cp: number): number {
    if (cp >= 9999) return 100;
    if (cp <= -9999) return 0;
    return 50 + 50 * (2 / (1 + Math.exp(-cp / 250)) - 1);
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
