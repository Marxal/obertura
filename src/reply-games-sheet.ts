// The list behind "Faced 4 times": every game where this reply was played.
//
// Newest first. Tapping a game opens it in the analyser, at this position.

import { pushBack } from './back-nav';
import { Icons } from './icons';
import type { ImportedGame } from './import-core';
import { agoText, timesText } from './reply-games';

const RESULT: Record<ImportedGame['result'], { label: string; className: string }> = {
  win: { label: 'Won', className: 'nr-result--win' },
  draw: { label: 'Drew', className: 'nr-result--draw' },
  loss: { label: 'Lost', className: 'nr-result--loss' },
};

function gameRow(game: ImportedGame, onOpen: () => void): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'nr-game';

  const result = document.createElement('span');
  const look = RESULT[game.result];
  result.className = `nr-result ${look.className}`;
  result.textContent = look.label;

  const who = document.createElement('span');
  who.className = 'nr-game-who';
  const name = document.createElement('span');
  name.className = 'nr-game-name';
  name.textContent = game.opponent;
  who.appendChild(name);
  if (game.opponentRating) {
    const rating = document.createElement('span');
    rating.className = 'nr-game-rating';
    rating.textContent = String(game.opponentRating);
    who.appendChild(rating);
  }

  const when = document.createElement('span');
  when.className = 'nr-game-when';
  when.textContent = agoText(game.endTime);

  row.append(result, who, when, Icons.chevronRight(15));
  row.addEventListener('click', onOpen);
  return row;
}

export function openFacedGames(
  games: ImportedGame[],
  moveLabel: string,
  onOpen: (game: ImportedGame) => void,
): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet nr-games-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');

  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = `${moveLabel}: ${timesText(games.length).toLowerCase()}`;
  sheet.appendChild(title);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  };

  const list = document.createElement('div');
  list.className = 'nr-games';
  const newest = [...games].sort((a, b) => b.endTime - a.endTime);
  list.append(...newest.map(game => gameRow(game, () => {
    close();
    onOpen(game);
  })));
  sheet.appendChild(list);

  const row = document.createElement('div');
  row.className = 'dialog-btn-row';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'dialog-btn btn-secondary';
  done.textContent = 'Close';
  done.addEventListener('click', close);
  row.appendChild(done);
  sheet.appendChild(row);

  const removeBack = pushBack(close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}
