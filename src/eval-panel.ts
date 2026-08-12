import { cloudLooksOffline, type EvalResult, type MoveEval } from './engine';
import { formatMove } from './notation';

export interface EvalPanelOpts {
  // Show just the 3 best moves in one fixed-height row (no principal variation)
  // rather than the richer stacked-PV view. Used by the spar overlay and the
  // builder's docked eval bar so a longer line can never grow the panel taller
  // and nudge the board out from under an in-progress drag.
  compact?: boolean;
  // Render the on/off switch in the controls row. The builder's docked eval bar
  // is switched by the dock's engine icon instead, so it hides this (false); the
  // spar overlay keeps its own inline toggle (the default).
  showToggle?: boolean;
  // Show the "cloud · d38" / "local · d20" source-and-depth badge. The builder's
  // docked bar turns it off: the whole point of the quick engine is a glance at
  // three moves and a bar, and the provenance of the eval is what the Engine tab
  // is for. The unreachable-Lichess warning is NOT part of this — that's an
  // actionable error, and it still shows.
  showSource?: boolean;
  // Tapped from the discreet "can't reach Lichess" warning that replaces the
  // source badge while the cloud is unreachable. The caller resets the cloud
  // breaker and re-evaluates the current position. Without it (or while the
  // cloud answers) the warning never shows.
  onRetryCloud?: () => void;
}

// A small warning-triangle mark for the cloud warning, inlined so this module
// stays free of the icon set.
const WARN_SVG =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" ' +
  'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0z"/>' +
  '<path d="M12 9v4"/><path d="M12 17h.01"/></svg>';

// The eval display is split across two mount points:
//   barEl       — the horizontal eval bar + score.
//   controlsEl  — the recommended moves (+ optional engine toggle).
// Clicking a recommended move calls onPlayMove(uci) so it's played on the board.
export class EvalPanel {
  private barEl: HTMLElement;
  private controlsEl: HTMLElement;
  private _enabled: boolean;
  private onToggle: (enabled: boolean) => void;
  private onPlayMove: (uci: string) => void;
  private compact: boolean;
  private showToggle: boolean;
  private showSource: boolean;
  private onRetryCloud?: () => void;
  private retrying = false;

  constructor(
    barEl: HTMLElement,
    controlsEl: HTMLElement,
    enabled: boolean,
    onToggle: (enabled: boolean) => void,
    onPlayMove: (uci: string) => void,
    opts: EvalPanelOpts = {},
  ) {
    this.barEl = barEl;
    this.controlsEl = controlsEl;
    this._enabled = enabled;
    this.onToggle = onToggle;
    this.onPlayMove = onPlayMove;
    this.compact = opts.compact ?? false;
    this.showToggle = opts.showToggle ?? true;
    this.showSource = opts.showSource ?? true;
    this.onRetryCloud = opts.onRetryCloud;
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

    // Bottom: candidate moves on the left, source badge (+ optional toggle) right.
    const toggle = this.showToggle
      ? `<label class="engine-toggle" title="Engine analysis">
            <input type="checkbox" id="engine-cb" ${this._enabled ? 'checked' : ''}>
            <span class="engine-toggle-track"></span>
          </label>
          <span class="engine-label" id="engine-label"></span>`
      : '';
    this.controlsEl.innerHTML = `
      <div class="eval-row">
        <div class="eval-moves${this.compact ? ' eval-moves--compact' : ''}" id="eval-moves"></div>
        <div class="eval-right">
          <button class="eval-cloud-warn" id="eval-cloud-warn" type="button" hidden
                  title="Couldn’t reach the Lichess engine — running locally. Tap to retry."
                  aria-label="Couldn’t reach the Lichess engine — tap to retry">
            ${WARN_SVG}<span id="eval-cloud-warn-text">Lichess off</span>
          </button>
          <span class="eval-source" id="eval-source"></span>
          ${toggle}
        </div>
      </div>`;

    this.controlsEl.querySelector<HTMLInputElement>('#engine-cb')
      ?.addEventListener('change', e => {
        this._enabled = (e.target as HTMLInputElement).checked;
        this.syncVisibility();
        this.onToggle(this._enabled);
      });

    // The cloud warning doubles as its own retry button. The tap resets the
    // breaker and re-evaluates (via onRetryCloud); the label flips to
    // "retrying…" until the next result lands and settles it either way.
    this.controlsEl.querySelector<HTMLButtonElement>('#eval-cloud-warn')
      ?.addEventListener('click', () => {
        if (this.retrying || !this.onRetryCloud) return;
        this.retrying = true;
        const text = this.controlsEl.querySelector<HTMLElement>('#eval-cloud-warn-text');
        if (text) text.textContent = 'retrying…';
        this.onRetryCloud();
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
    const labelEl = this.controlsEl.querySelector<HTMLElement>('#engine-label');
    barWrap.hidden = !this._enabled;
    if (labelEl) labelEl.textContent = this._enabled ? 'Engine on' : 'Turn on engine';
    if (!this._enabled) {
      movesEl.innerHTML = '';
      sourceEl.textContent = '';
    } else if (!movesEl.children.length) {
      movesEl.innerHTML = '<span class="eval-waiting">Analyzing…</span>';
    }
  }

  update(result: EvalResult, fen: string) {
    if (!this._enabled || result.fen !== fen) return;

    // A finished position: no candidate moves exist, so say so instead of
    // leaving "Analyzing…" up. Checkmate pins the bar to the winner (the side
    // NOT to move); a draw/stalemate centres it.
    if (result.gameOver) {
      const mate = result.gameOver === 'checkmate';
      const whiteWins = mate && fen.split(' ')[1] === 'b';
      this.barEl.querySelector<HTMLElement>('#eval-bar-fill')!.style.width =
        mate ? (whiteWins ? '100%' : '0%') : '50%';
      this.barEl.querySelector<HTMLElement>('#eval-score')!.textContent = mate ? '#' : '½';
      this.controlsEl.querySelector<HTMLElement>('#eval-moves')!.innerHTML =
        `<span class="eval-waiting">${mate ? 'Checkmate' : 'Draw'}</span>`;
      const sourceEl = this.controlsEl.querySelector<HTMLElement>('#eval-source')!;
      sourceEl.textContent = '';
      // Settle any cloud-warning state too — this result ends the evaluation,
      // so a lingering "retrying…" chip must not sit on top of "Checkmate".
      sourceEl.hidden = false;
      const warn = this.controlsEl.querySelector<HTMLButtonElement>('#eval-cloud-warn');
      if (warn) warn.hidden = true;
      this.retrying = false;
      return;
    }

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

    // Top 3 candidates, clickable to play. Compact mounts show just the best
    // move itself (fixed height, one row); the full builder tab shows each
    // move's whole principal variation, stacked.
    const movesEl = this.controlsEl.querySelector<HTMLElement>('#eval-moves')!;
    if (this.compact) {
      movesEl.innerHTML = result.moves.slice(0, 3).map(m => {
        return `<button class="eval-move" type="button" data-uci="${m.uci}">` +
          `<span class="eval-move-san">${this.escape(formatMove(m.san))}</span>` +
          `<span class="eval-move-cp">${this.fmtScore(m)}</span>` +
        `</button>`;
      }).join('');
    } else {
      movesEl.innerHTML = result.moves.slice(0, 3).map(m => {
        const pv = (m.sanLine && m.sanLine.length ? m.sanLine : [m.san || m.uci]);
        return `<button class="eval-line" type="button" data-uci="${m.uci}">` +
          `<span class="eval-line-score">${this.fmtScore(m)}</span>` +
          `<span class="eval-line-pv">${this.escape(this.formatLine(pv, fen))}</span>` +
        `</button>`;
      }).join('');
    }

    // Source + depth badge: "cloud · d38" when Lichess answered, or
    // "local · d14…d20" while the bundled Stockfish climbs to its target
    // (collapsing to "local · d20" once it lands). Suppressed on the docked bar,
    // where the provenance is the Engine tab's job.
    const sourceEl = this.controlsEl.querySelector<HTMLElement>('#eval-source')!;
    sourceEl.textContent = this.showSource ? this.badgeText(result) : '';
    this.syncCloudWarning(result);
  }

  // Show the discreet cloud warning whenever a local result arrived because
  // Lichess couldn't be reached (not the healthy "position not in the cloud"
  // miss). It REPLACES the source badge in the same slot, so the row — and the
  // whole docked panel — never changes height.
  private syncCloudWarning(result: EvalResult): void {
    const warn = this.controlsEl.querySelector<HTMLButtonElement>('#eval-cloud-warn');
    const sourceEl = this.controlsEl.querySelector<HTMLElement>('#eval-source');
    if (!warn || !sourceEl) return;
    // Any fresh result settles a pending retry: evaluate() concludes the cloud
    // attempt before local output starts, so this result IS the retry's outcome.
    this.retrying = false;
    const offline = !!this.onRetryCloud && result.source === 'stockfish' && cloudLooksOffline();
    warn.hidden = !offline;
    sourceEl.hidden = offline;
    if (offline) {
      const text = this.controlsEl.querySelector<HTMLElement>('#eval-cloud-warn-text');
      if (text) text.textContent = 'Lichess off';
    }
  }

  clear() {
    const fill = this.barEl.querySelector<HTMLElement>('#eval-bar-fill');
    if (fill) fill.style.width = '50%';
    const score = this.barEl.querySelector<HTMLElement>('#eval-score');
    if (score) score.textContent = '0.0';
    const moves = this.controlsEl.querySelector<HTMLElement>('#eval-moves');
    if (moves) moves.innerHTML = this._enabled ? '<span class="eval-waiting">Analyzing…</span>' : '';
    const source = this.controlsEl.querySelector<HTMLElement>('#eval-source');
    if (source) { source.textContent = ''; source.hidden = false; }
    const warn = this.controlsEl.querySelector<HTMLButtonElement>('#eval-cloud-warn');
    if (warn) warn.hidden = true;
    this.retrying = false;
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
  // The number is glued to its move ("1.e4", not "1. e4") so each move reads as
  // one tight unit, matching the main move list.
  private formatLine(sanLine: string[], fen: string): string {
    const parts = fen.split(' ');
    let moveNo = parseInt(parts[5] ?? '1') || 1;
    let white = (parts[1] ?? 'w') === 'w';
    const out: string[] = [];
    for (let i = 0; i < sanLine.length; i++) {
      const san = formatMove(sanLine[i]);
      if (white) out.push(`${moveNo}.${san}`);
      else if (i === 0) out.push(`${moveNo}…${san}`);
      else out.push(san);
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
