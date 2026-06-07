import type { EvalResult, MoveEval } from './engine';

export class EvalPanel {
  private el: HTMLElement;
  private _enabled: boolean;
  private onToggle: (enabled: boolean) => void;

  constructor(el: HTMLElement, enabled: boolean, onToggle: (enabled: boolean) => void) {
    this.el = el;
    this._enabled = enabled;
    this.onToggle = onToggle;
    this.build();
  }

  private build() {
    this.el.innerHTML = `
      <div class="eval-row">
        <div class="eval-bar-wrap" id="eval-bar-wrap">
          <div class="eval-bar" id="eval-bar">
            <div class="eval-bar-fill" id="eval-bar-fill" style="height:50%"></div>
          </div>
          <span class="eval-score" id="eval-score">0.0</span>
        </div>
        <div class="eval-moves" id="eval-moves"></div>
        <div class="eval-right">
          <label class="engine-toggle" title="Engine analysis">
            <input type="checkbox" id="engine-cb" ${this._enabled ? 'checked' : ''}>
            <span class="engine-toggle-track"></span>
          </label>
          <span class="eval-source" id="eval-source"></span>
        </div>
      </div>`;

    this.el.querySelector<HTMLInputElement>('#engine-cb')!
      .addEventListener('change', e => {
        this._enabled = (e.target as HTMLInputElement).checked;
        this.syncVisibility();
        this.onToggle(this._enabled);
      });

    this.syncVisibility();
  }

  private syncVisibility() {
    const barWrap = this.el.querySelector<HTMLElement>('#eval-bar-wrap')!;
    const movesEl = this.el.querySelector<HTMLElement>('#eval-moves')!;
    const sourceEl = this.el.querySelector<HTMLElement>('#eval-source')!;
    barWrap.hidden = !this._enabled;
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
    this.el.querySelector<HTMLElement>('#eval-bar-fill')!.style.height = `${fillPct}%`;
    this.el.querySelector<HTMLElement>('#eval-score')!.textContent = scoreText;

    // Top 3 moves.
    const movesEl = this.el.querySelector<HTMLElement>('#eval-moves')!;
    movesEl.innerHTML = result.moves.slice(0, 3).map(m =>
      `<span class="eval-move">` +
        `<span class="eval-move-san">${m.san || m.uci}</span>` +
        `<span class="eval-move-cp">${this.fmtScore(m)}</span>` +
      `</span>`
    ).join('');

    // Source badge.
    const sourceEl = this.el.querySelector<HTMLElement>('#eval-source')!;
    sourceEl.textContent = result.source === 'lichess'
      ? `☁ d${result.depth}`
      : `⚙ d${result.depth}`;
  }

  clear() {
    const fill = this.el.querySelector<HTMLElement>('#eval-bar-fill');
    if (fill) fill.style.height = '50%';
    const score = this.el.querySelector<HTMLElement>('#eval-score');
    if (score) score.textContent = '0.0';
    const moves = this.el.querySelector<HTMLElement>('#eval-moves');
    if (moves) moves.innerHTML = this._enabled ? '<span class="eval-waiting">Analyzing…</span>' : '';
    const source = this.el.querySelector<HTMLElement>('#eval-source');
    if (source) source.textContent = '';
  }

  // Maps white-perspective centipawns to a 0–100% fill (white fills from bottom).
  // Uses a soft sigmoid so extreme evals don't peg the bar instantly.
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
