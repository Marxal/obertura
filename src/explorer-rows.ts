// Shared DOM rows for the two board explorers that read the online masters
// explorer (library-explorer.ts and masters-explorer.ts). Both render the same
// two row kinds once a position's continuations come back: a tappable "deeper"
// move row and a master-game link row. Kept here so there's one source of truth.

import { Chess } from 'chess.js';
import { nameForFen } from './openings';
import type { ExplorerMove, ExplorerGame } from './explorer-api';

// Compact game-count label for deeper rows: 1234 → "1.2k", 25000 → "25k", 3.4M.
export function formatGames(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// A continuation row for a deeper (off-book) move. We trust chess.js's SAN over
// the explorer's dialect, so we play/undo on a throwaway Chess at `fen` to get
// the canonical SAN and the reached position's opening name. `onPick` walks on.
export function deeperRow(
  fen: string,
  mv: ExplorerMove,
  prefix: string,
  onPick: (uci: string) => void,
): HTMLButtonElement {
  let san = mv.san;
  let label = '';
  const probe = new Chess(fen);
  const played = probe.move({
    from: mv.uci.slice(0, 2),
    to: mv.uci.slice(2, 4),
    promotion: mv.uci.slice(4) || undefined,
  });
  if (played) {
    san = played.san;
    label = nameForFen(probe.fen()) ?? '';
  }

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'lib-bx-row lib-bx-row--deep';
  row.addEventListener('click', () => onPick(mv.uci));

  const move = document.createElement('span');
  move.className = 'lib-bx-move';
  move.textContent = `${prefix} ${san}`;
  row.appendChild(move);

  const name = document.createElement('span');
  name.className = 'lib-bx-name';
  name.textContent = label;
  row.appendChild(name);

  const count = document.createElement('span');
  count.className = 'lib-bx-count';
  count.textContent = formatGames(mv.games);
  row.appendChild(count);

  return row;
}

// A real master game played from this position, as a link to the lichess game
// viewer. Reuses the row layout but is an <a>, not a play-this-move button.
export function gameRow(g: ExplorerGame): HTMLAnchorElement {
  const row = document.createElement('a');
  row.className = 'lib-bx-row lib-bx-game';
  row.href = `https://lichess.org/${g.id}`;
  row.target = '_blank';
  row.rel = 'noopener';

  const players = document.createElement('span');
  players.className = 'lib-bx-name';
  players.textContent = `${g.white} (${g.whiteRating}) – ${g.black} (${g.blackRating})`;
  row.appendChild(players);

  const result = document.createElement('span');
  result.className = 'lib-bx-game-result';
  result.textContent = g.winner === 'white' ? '1–0' : g.winner === 'black' ? '0–1' : '½–½';
  row.appendChild(result);

  const year = document.createElement('span');
  year.className = 'lib-bx-game-year';
  year.textContent = g.year ? String(g.year) : '';
  row.appendChild(year);

  return row;
}
