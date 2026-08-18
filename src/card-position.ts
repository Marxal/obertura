// Shared scaffold for any card that represents a chess position — used by the
// Saved-lines cards and the "From my games" suggestion cards, so both read as
// one family.
//
// The shape (agreed in Phase 2, Task 5):
//   Row 1 (titleRow): full width — the line/opening title with its colour pip.
//   Row 2 (body): a larger position miniature on the LEFT, with the rest of the
//     card's info + action buttons stacked on the RIGHT (content).
//
// Every position card shows a miniature, gated globally by the Settings
// "show line miniatures" toggle. When it's off (or there's no FEN), no board is
// drawn and the content simply fills the row — the layout reflows cleanly.

import type { Line } from './types';
import type { MoveNode } from './tree';
import { Chess } from 'chess.js';
import { buildMiniBoard } from './board-mini';
import { getShowLineMiniatures } from './prefs';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// The final position of a line's mainline (the children[0] chain), for its
// miniature. Shared so every screen draws the same board for a given line.
export function lineFinalFen(tree: MoveNode): string {
  let node: MoveNode | undefined = tree.children[0];
  let fen = START_FEN;
  while (node) {
    fen = node.fen;
    node = node.children[0];
  }
  return fen;
}

// The final position of a representative line (a flat UCI list) for a card
// miniature. Replays the moves and returns the FEN; a bad/illegal move just
// stops the walk early, so the miniature shows as far as it got. Shared by the
// suggestion and recommendation cards.
export function fenFromUcis(ucis: string[]): string {
  const chess = new Chess();
  for (const uci of ucis) {
    try {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
    } catch {
      break;
    }
  }
  return chess.fen();
}

export interface PositionCardParts {
  /** The outer card element — append it to the list. */
  card: HTMLDivElement;
  /** Row 1, full width — append the colour pip + title (and any trailing icon). */
  titleRow: HTMLDivElement;
  /** Row 2 flex container — holds the board slot (when shown) + content. */
  body: HTMLDivElement;
  /** Right side of row 2 — append the info + action buttons here. */
  content: HTMLDivElement;
}

export interface PositionCardOpts {
  /** Position to draw a miniature for. Omit to never show a board for this card. */
  fen?: string | null;
  /** Board orientation — Black lines show from Black's side. */
  orientation?: 'white' | 'black';
  /** Extra class(es) for the card element (e.g. 'games-card'). */
  className?: string;
  /**
   * When set, the miniature becomes a button that opens the position (item 8) —
   * the tap fires this, stopping propagation so it doesn't also trigger any
   * card-level handler. Wire it to whatever "open this position" means for the
   * card (open the line, build it, prepare a reply…).
   */
  onMiniClick?: () => void;
  /** Accessible label for the clickable miniature (defaults to "Open position"). */
  miniLabel?: string;
}

export function buildPositionCard(opts: PositionCardOpts = {}): PositionCardParts {
  const card = document.createElement('div');
  card.className = 'pcard' + (opts.className ? ' ' + opts.className : '');

  const titleRow = document.createElement('div');
  titleRow.className = 'pcard-titlerow';
  card.appendChild(titleRow);

  const body = document.createElement('div');
  body.className = 'pcard-body';

  if (opts.fen && getShowLineMiniatures()) {
    // A plain div by default; a button when the position is openable, so the
    // miniature itself is a live link to the position (not just decoration).
    let mini: HTMLElement;
    if (opts.onMiniClick) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pcard-mini pcard-mini--btn';
      btn.setAttribute('aria-label', opts.miniLabel ?? 'Open position');
      btn.addEventListener('click', (e) => { e.stopPropagation(); opts.onMiniClick!(); });
      mini = btn;
    } else {
      mini = document.createElement('div');
      mini.className = 'pcard-mini';
    }
    mini.appendChild(buildMiniBoard(opts.fen, opts.orientation ?? 'white'));
    body.appendChild(mini);
    card.classList.add('pcard--hasboard');
  }

  const content = document.createElement('div');
  content.className = 'pcard-content';
  body.appendChild(content);

  card.appendChild(body);

  return { card, titleRow, body, content };
}

// Convenience: a colour pip (white/black dot) for a position card's title row.
export function colourPip(colour: Line['colour']): HTMLSpanElement {
  const pip = document.createElement('span');
  pip.className = `colour-pip colour-pip--${colour}`;
  pip.setAttribute('aria-hidden', 'true');
  return pip;
}
