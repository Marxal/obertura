// "What am I actually saving?" — the draft, laid out.
//
// THE PROBLEM THIS EXISTS FOR. Inside a book the draft is book-wide: play three
// moves off the French, walk back, play two off the King's Indian, and the
// header offers "Add 5 moves". That is the truth — one tap writes both — but
// every OTHER view of the draft is line-wide. The move strip only ever draws the
// line you are standing in, so it shows two of those five, or none at all once
// you have walked somewhere else. A button counting work you cannot see is a
// button you cannot trust, and the honest fix is not to count less. It is to
// show the work.
//
// So: when everything you have added is on the line in front of you, the header
// just does it — that is the ordinary case and it stays one tap. When it isn't,
// the tap opens this instead, listing each piece of work with the moves it would
// write, a way to go and look at it, and a way to drop just that one.
//
// The same sheet answers the way out of the builder, which used to offer a bare
// "Discard" that silently threw away every branch at once.

import type { MoveNode } from './tree';
import type { DraftBranch } from './builder-book';
import { formatMove } from './notation';
import { Icons } from './icons';
import { pushBack } from './back-nav';

export interface DraftSheetOptions {
  branches: DraftBranch[];
  /** Total added moves — the number the header button is quoting. */
  moves: number;
  /**
   * Leaving the builder rather than tapping the header, which adds the one
   * button the header case must never show: throw the whole draft away.
   */
  leaving?: boolean;
  /** Add everything. */
  onAddAll: () => void;
  /** Drop one branch and repaint — the sheet closes if nothing is left. */
  onDiscardBranch: (rootId: string) => void;
  /** Stand on this branch's last added move (closes the sheet). */
  onGoTo: (lastId: string) => void;
  /** Leaving only: drop the whole draft and go. */
  onDiscardAll?: () => void;
  /** Leaving only: stay in the builder. */
  onKeepEditing?: () => void;
}

export function openDraftSheet(opts: DraftSheetOptions): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet draft-sheet';

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  };

  const h = document.createElement('h3');
  h.className = 'edit-sheet-title';
  h.textContent = 'Moves you haven’t added yet';
  sheet.appendChild(h);

  const lede = document.createElement('p');
  lede.className = 'section-desc';
  sheet.appendChild(lede);

  const list = document.createElement('div');
  list.className = 'draft-list';
  sheet.appendChild(list);

  // Always three-ish rows of choice; stacked, like every other dialog with
  // more than two ways out.
  const btnRow = document.createElement('div');
  btnRow.className = 'dialog-btn-row dialog-btn-row--stack';
  sheet.appendChild(btnRow);

  // Repainted in place rather than reopened, so dropping one branch doesn't
  // flash the sheet away and back.
  let branches = opts.branches;

  function paint(): void {
    const moves = branches.reduce((n, b) => n + b.moves.length, 0);
    lede.textContent = branches.length === 1
      ? `${quantity(moves, 'move')}, in one place you haven’t added yet.`
      : `${quantity(moves, 'move')}, in ${quantity(branches.length, 'place')}. Adding writes all of them.`;

    list.innerHTML = '';
    for (const branch of branches) list.appendChild(buildRow(branch));

    btnRow.innerHTML = '';
    btnRow.appendChild(button(
      moves === 1 ? 'Add it' : `Add all ${moves} moves`,
      'primary',
      () => { close(); opts.onAddAll(); },
    ));
    if (opts.leaving) {
      btnRow.appendChild(button('Discard them all', 'danger', () => {
        close();
        opts.onDiscardAll?.();
      }));
    }
    btnRow.appendChild(button('Keep editing', 'secondary', () => {
      close();
      opts.onKeepEditing?.();
    }));
  }

  function buildRow(branch: DraftBranch): HTMLElement {
    const row = document.createElement('div');
    row.className = 'draft-row';

    const text = document.createElement('div');
    text.className = 'draft-row-text';

    // Where it hangs off. Only the last few prepared moves — the branch point is
    // the end of that path, and an ellipsis on one line would cut off exactly
    // the part that locates it. A branch played from the very start has nothing
    // above it, and "after nothing" is worse than saying "from the start".
    const where = document.createElement('div');
    where.className = 'draft-where';
    where.textContent = branch.from.length ? `after ${tail(branch.from)}` : 'from the start';
    text.appendChild(where);

    // The moves it would write, numbered from where they really fall — a branch
    // starting at move 7 must not read as move 1.
    const moves = document.createElement('div');
    moves.className = 'draft-moves';
    moves.textContent = notate(branch.moves, branch.from.length + 1);
    text.appendChild(moves);

    row.appendChild(text);

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'draft-row-btn';
    go.setAttribute('aria-label', 'Go to these moves');
    go.title = 'Go to these moves';
    go.appendChild(Icons.chevronRight(18));
    go.addEventListener('click', () => { close(); opts.onGoTo(branch.lastId); });
    row.appendChild(go);

    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'draft-row-btn draft-row-btn--danger';
    drop.setAttribute('aria-label', 'Discard these moves');
    drop.title = 'Discard these moves';
    drop.appendChild(Icons.trash(16));
    drop.addEventListener('click', () => {
      opts.onDiscardBranch(branch.rootId);
      branches = branches.filter(b => b.rootId !== branch.rootId);
      // Nothing left to decide about. On the way out that means the guard has
      // been answered — dropping the last branch IS discarding it all, and
      // stranding the user back in the builder would ignore what they asked for.
      if (branches.length === 0) {
        close();
        if (opts.leaving) opts.onDiscardAll?.();
        else opts.onKeepEditing?.();
        return;
      }
      paint();
    });
    row.appendChild(drop);

    return row;
  }

  paint();

  const removeBack = pushBack(() => { close(); opts.onKeepEditing?.(); });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { close(); opts.onKeepEditing?.(); }
  });
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}

function button(
  label: string, variant: 'primary' | 'secondary' | 'danger', onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `dialog-btn btn-${variant}`;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

/** The last few prepared moves, with a leading ellipsis when there were more. */
function tail(from: MoveNode[], keep = 4): string {
  const start = Math.max(0, from.length - keep);
  const shown = notate(from.slice(start), start + 1);
  return start > 0 ? `…${shown}` : shown;
}

/** "3.e3 Nf6" — moves numbered from the ply they actually fall on. */
function notate(nodes: MoveNode[], startPly: number): string {
  const parts: string[] = [];
  nodes.forEach((node, i) => {
    const ply = startPly + i;
    const white = ply % 2 === 1;
    const number = Math.floor((ply + 1) / 2);
    const move = formatMove(node.san);
    // A black move only carries its number when it opens the quote, where
    // "e6" alone would leave the reader counting.
    parts.push(white ? `${number}.${move}` : i === 0 ? `${number}…${move}` : move);
  });
  return parts.join(' ');
}

function quantity(n: number, noun: string): string {
  return `${n} ${n === 1 ? noun : noun + 's'}`;
}
