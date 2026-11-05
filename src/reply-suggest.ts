// "Suggest moves": up to three moves as arrows on the board, with their numbers.
//
// THE USUAL MOVES FIRST, from the bundled statistics. The engine is one tap further,
// or the only tab when the database knows nothing here. It runs on the phone, so a
// suggestion costs no request, and only when someone asks.
//
// Tapping a row plays that move, the same as playing it on the board.

import { Chess } from 'chess.js';
import type { Api } from 'chessground/api';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { registerBrushes, HINT_COLOR } from './board-brushes';
import { Icons } from './icons';
import { formatMove } from './notation';
import { topMoves } from './next-reply';
import { meterBar } from './reply-facts';
import { wdlBar } from './wdl-bar';
import type { StatsAt } from './rare-branch';
import { t as tr } from './i18n';

const ENGINE_COLOR = '#2f9e5f';
const ENGINE_DEPTH = 14;
const ENGINE_TIME_MS = 1500;
const LOOKS = [
  { opacity: 0.9, lineWidth: 13 },
  { opacity: 0.65, lineWidth: 10 },
  { opacity: 0.45, lineWidth: 7 },
];

type Tab = 'usual' | 'engine';

export interface SuggestPanel {
  button: HTMLButtonElement;
  panel: HTMLElement;
  /**
   * Whether the board can be played on right now. If not (browsing, waiting for a reply,
   * paused to save) neither the arrows nor the list show, so they can't go stale.
   */
  setActive: (active: boolean) => void;
  /** The position you can play. An open panel follows it. */
  setPosition: (fen: string) => void;
  /** The statistics have arrived: read this position again. */
  refresh: () => void;
  open: () => void;
  close: () => void;
  /** The board is going. A late answer from the engine has nothing left to draw on. */
  dispose: () => void;
}

export function buildSuggest(opts: {
  fen: string;
  colour: 'white' | 'black';
  /** Asked each time, because a card kept from last visit is drawn before they load. */
  statsAt: () => StatsAt;
  cg: Api;
  onPlay: (uci: string) => void;
}): SuggestPanel {
  const { colour, statsAt, cg, onPlay } = opts;
  let fen = opts.fen;
  let usual = topMoves(fen, colour, statsAt());

  const brushes: Record<string, { color: string; opacity: number; lineWidth: number }> = {};
  LOOKS.forEach((look, i) => {
    brushes[`usual${i}`] = { color: HINT_COLOR, ...look };
    brushes[`engine${i}`] = { color: ENGINE_COLOR, ...look };
  });
  registerBrushes(cg, brushes);

  const panel = document.createElement('div');
  panel.className = 'nr-suggest';
  panel.hidden = true;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-secondary nr-action';
  button.append(Icons.bulb(15), tr('open.suggest'));

  let open = false;
  let active = true;
  let disposed = false;
  let preferred: Tab = 'usual';
  let arrows: DrawShape[] = [];
  let engineRows: HTMLElement[] | null = null;
  let engineFen: string | null = null;

  /** The tab on show: the database has nothing to say at some positions. */
  const tab = (): Tab => (usual.length > 0 ? preferred : 'engine');

  const paintArrows = (): void => cg.setAutoShapes(open && active ? arrows : []);

  const setArrows = (ucis: string[]): void => {
    arrows = ucis.map((uci, i) => ({
      orig: uci.slice(0, 2) as Key,
      dest: uci.slice(2, 4) as Key,
      brush: `${tab()}${i}`,
    }));
    paintArrows();
  };

  const pick = (uci: string, san: string, ...extras: HTMLElement[]): HTMLElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nr-pick';
    const name = document.createElement('span');
    name.className = 'nr-pick-move';
    name.textContent = formatMove(san);
    b.append(name, ...extras);
    b.addEventListener('click', () => onPlay(uci));
    return b;
  };

  const text = (className: string, value: string): HTMLElement => {
    const el = document.createElement('span');
    el.className = className;
    el.textContent = value;
    return el;
  };

  const switcher = document.createElement('div');
  switcher.className = 'nr-tabs';
  const list = document.createElement('div');
  list.className = 'nr-picks';
  panel.append(switcher, list);

  const paintTabs = (): void => {
    switcher.hidden = usual.length === 0;
    switcher.replaceChildren(...(['usual', 'engine'] as const).map((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nr-tab';
      b.textContent = t === 'usual' ? tr('stats.mostPlayed') : tr('story.engine');
      b.setAttribute('aria-pressed', String(t === tab()));
      b.addEventListener('click', () => {
        preferred = t;
        paint();
      });
      return b;
    }));
  };

  const paint = (): void => {
    paintTabs();
    if (tab() === 'usual') {
      list.replaceChildren(...usual.map(m => pick(
        m.uci, m.san,
        meterBar(m.playedPct),
        text('nr-pick-number', `${m.playedPct}%`),
        wdlBar({ wins: m.wins, draws: m.draws, losses: m.losses, scorePct: m.scorePct, games: m.games }),
        text('nr-pick-number', `${m.scorePct}%`),
      )));
      setArrows(usual.map(m => m.uci));
      return;
    }
    if (engineRows && engineFen === fen) {
      list.replaceChildren(...engineRows);
      setArrows(engineRows.map(r => r.dataset.uci ?? ''));
      return;
    }
    list.replaceChildren(text('nr-note', tr('reply.fact.thinking')));
    setArrows([]);
    if (engineFen !== fen) void askEngine(fen);
  };

  const askEngine = async (asked: string): Promise<void> => {
    engineFen = asked;
    engineRows = null;
    let found: Array<{ uci: string; san: string; value: string }> = [];
    try {
      const { analysePosition } = await import('./engine');
      const moves = await analysePosition(asked, ENGINE_DEPTH, undefined, {
        multiPv: 3, movetimeMs: ENGINE_TIME_MS,
      });
      // Only moves that exist here, whatever came back.
      const legal = new Set(new Chess(asked).moves({ verbose: true }).map(m => m.from + m.to + (m.promotion ?? '')));
      found = moves
        .filter(m => legal.has(m.uci))
        .slice(0, 3)
        .map(m => ({ uci: m.uci, san: m.san, value: evalText(m.cp, m.mate) }));
    } catch {
      found = [];
    }
    if (disposed || asked !== fen) return;   // the board has moved on
    if (found.length === 0) {
      engineFen = null;
      if (tab() === 'engine') list.replaceChildren(text('nr-note', tr('open.theEngineIsnT')));
      return;
    }
    engineRows = found.map((m) => {
      const row = pick(m.uci, m.san, text('nr-pick-eval', m.value));
      row.dataset.uci = m.uci;
      return row;
    });
    if (tab() === 'engine' && open && active) paint();
  };

  const setOpen = (next: boolean): void => {
    open = next;
    panel.hidden = !open || !active;
    button.setAttribute('aria-pressed', String(open));
    if (open && active) paint();
    else paintArrows();
  };
  button.addEventListener('click', () => setOpen(!open));

  return {
    button,
    panel,
    setActive(next) {
      if (next === active) return;
      active = next;
      panel.hidden = !open || !active;
      if (open && active) paint();
      else paintArrows();
    },
    setPosition(next) {
      if (next === fen) return;
      fen = next;
      usual = topMoves(fen, colour, statsAt());
      engineRows = null;
      engineFen = null;
      arrows = [];
      if (open && active) paint();
      else paintArrows();
    },
    refresh() {
      usual = topMoves(fen, colour, statsAt());
      if (open && active) paint();
    },
    open() {
      if (!open) setOpen(true);
    },
    close() {
      if (open) setOpen(false);
    },
    dispose() {
      disposed = true;
    },
  };
}

/** The usual way of writing an evaluation: White's point of view, in pawns. */
export function evalText(cp: number | undefined, mate: number | undefined): string {
  if (mate !== undefined) return `${mate > 0 ? '' : '-'}M${Math.abs(mate)}`;
  if (cp === undefined) return '';
  return `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(1)}`;
}
