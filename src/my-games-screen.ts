// "My games" — the home for the games you import. Slice 4.1: the import actions
// up top (reusing the builder's import sheet) and a card per saved game showing
// who you played, the opening, the result, and a miniature of the position the
// stored moves reach. Tapping a card opens it on the board and analyses it.
//
// Deferred to a later slice (matching the My Lines screen): all/white/black and
// won/lost filters, ordering, opening-nesting, user tags, and the opponent's
// rating on the card (not stored yet).

import { Chess } from 'chess.js';
import { getAllGames } from './storage';
import type { ImportedGame } from './import-games';
import { buildMiniBoard } from './board-mini';
import { Icons } from './icons';
import { renderLoadError } from './load-error';

export interface MyGamesDeps {
  // Open the import sheet (Import last game / Browse / Paste PGN).
  onImport: () => void;
  // Open a saved game on the board and start its analysis.
  onOpenGame: (game: ImportedGame) => void;
}

const RESULT_LABEL: Record<ImportedGame['result'], string> = {
  win: 'Won', draw: 'Drew', loss: 'Lost',
};

// Replay the stored moves to the position they reach, for the card miniature.
function fenAfter(ucis: string[]): string {
  const ch = new Chess();
  for (const uci of ucis) {
    try {
      ch.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: (uci[4] as 'q' | 'r' | 'b' | 'n') || 'q' });
    } catch { break; }
  }
  return ch.fen();
}

export async function renderMyGamesScreen(host: HTMLElement, deps: MyGamesDeps): Promise<void> {
  host.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'mygames-screen';
  host.appendChild(root);

  // ── Import actions ──────────────────────────────────────────────────────────
  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'mygames-import';
  importBtn.appendChild(Icons.download(18));
  importBtn.appendChild(Object.assign(document.createElement('span'), { textContent: 'Import a game' }));
  importBtn.addEventListener('click', deps.onImport);
  root.appendChild(importBtn);

  let games: ImportedGame[];
  try {
    games = await getAllGames();
  } catch (err) {
    renderLoadError(root, err, () => { void renderMyGamesScreen(host, deps); });
    return;
  }

  if (!games.length) {
    const empty = document.createElement('p');
    empty.className = 'mygames-empty';
    empty.textContent = 'No games yet. Import your games to analyse them here.';
    root.appendChild(empty);
    return;
  }

  // Newest first.
  games.sort((a, b) => b.endTime - a.endTime);

  const list = document.createElement('div');
  list.className = 'mygames-list';
  for (const g of games) list.appendChild(gameCard(g, deps));
  root.appendChild(list);
}

function gameCard(g: ImportedGame, deps: MyGamesDeps): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'mygames-card';
  card.addEventListener('click', () => deps.onOpenGame(g));

  const mini = buildMiniBoard(fenAfter(g.ucis), g.colour);
  mini.classList.add('mygames-card-mini');
  card.appendChild(mini);

  const text = document.createElement('div');
  text.className = 'mygames-card-text';

  const opp = document.createElement('div');
  opp.className = 'mygames-card-opp';
  const pip = document.createElement('span');
  pip.className = `colour-pip colour-pip--${g.colour}`;
  pip.setAttribute('aria-hidden', 'true');
  opp.appendChild(pip);
  opp.appendChild(Object.assign(document.createElement('span'), { textContent: `vs ${g.opponent}` }));
  text.appendChild(opp);

  if (g.opening) {
    const op = document.createElement('div');
    op.className = 'mygames-card-opening';
    op.textContent = g.opening;
    text.appendChild(op);
  }

  const sub = document.createElement('div');
  sub.className = `mygames-card-sub mygames-card-sub--${g.result}`;
  sub.textContent = `${RESULT_LABEL[g.result]} · ${g.timeClass}`;
  text.appendChild(sub);

  card.appendChild(text);

  const chev = Icons.chevronRight(18);
  chev.classList.add('mygames-card-chev');
  card.appendChild(chev);
  return card;
}
