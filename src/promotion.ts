// The pawn-promotion picker. When a pawn reaches the last rank, the board asks
// which piece it becomes instead of silently queening. Rendered as a lichess-
// style column of four choices (queen, rook, bishop, knight) dropped over the
// destination file, plus a dimming backdrop that cancels the promotion on an
// outside tap.
//
// The picker lives INSIDE the chessground wrap (#board, which carries .cg-wrap)
// so each <piece> element inherits the active piece set's background image — the
// same glyphs shown on the board, in the promoting side's colour.

import type { Key } from 'chessground/types';

type Role = 'q' | 'r' | 'b' | 'n';

// Queen nearest the promotion square, then rook, bishop, knight cascading inward.
const CHOICES: { role: Role; name: string }[] = [
  { role: 'q', name: 'queen' },
  { role: 'r', name: 'rook' },
  { role: 'b', name: 'bishop' },
  { role: 'n', name: 'knight' },
];

// Show the picker over `boardEl` (the .cg-wrap) and resolve with the chosen
// piece letter, or null if the user cancels. `dest` is the square the pawn just
// landed on; `orientation` is the board's current facing, so the column starts
// at the pawn and cascades toward the middle of the board.
export function askPromotion(
  boardEl: HTMLElement,
  colour: 'white' | 'black',
  dest: Key,
  orientation: 'white' | 'black',
): Promise<Role | null> {
  return new Promise((resolve) => {
    const fileIdx = dest.charCodeAt(0) - 97;          // a=0 … h=7
    const rankNum = Number(dest[1]);                  // 1 … 8
    const visualCol = orientation === 'white' ? fileIdx : 7 - fileIdx;
    const visualRow = orientation === 'white' ? 8 - rankNum : rankNum - 1;
    const down = visualRow === 0;                     // promotion at the top → cascade down

    const overlay = document.createElement('div');
    overlay.className = 'promotion-overlay';

    const column = document.createElement('div');
    column.className = 'promotion-column';
    column.style.left = `${visualCol * 12.5}%`;
    if (down) column.style.top = '0';
    else { column.style.bottom = '0'; column.classList.add('promotion-column--up'); }

    let settled = false;
    const close = (role: Role | null): void => {
      if (settled) return;
      settled = true;
      overlay.remove();
      resolve(role);
    };

    for (const { role, name } of CHOICES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'promotion-choice';
      btn.setAttribute('aria-label', name);
      const piece = document.createElement('piece');
      piece.className = `${name} ${colour}`;
      btn.appendChild(piece);
      btn.addEventListener('click', (e) => { e.stopPropagation(); close(role); });
      column.appendChild(btn);
    }

    overlay.addEventListener('click', () => close(null));
    overlay.appendChild(column);
    boardEl.appendChild(overlay);
  });
}
