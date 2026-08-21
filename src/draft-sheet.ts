// "What am I actually saving?" — the draft, laid out as the LINES it will add.
//
// THE PROBLEM THIS EXISTS FOR. Inside a book the draft is book-wide: play three
// moves off the French, walk back, play two off the King's Indian, and the
// header offers "Add 5 moves". That is the truth — one tap writes both — but it
// is a count of moves, and what the user built was two LINES. Two lines are two
// decisions: this one is worth training, that one is a sideline I want stored
// and left alone, and that third one I only played to see where it went.
//
// So when a draft finishes more than one line, the header opens this instead of
// writing straight away. Every line it is about to add gets a row: what the line
// is, whether it goes into training, and a bin. Then one button adds them all,
// and the trainer opens on whichever of them said yes.
//
// The same sheet answers the way OUT of the builder, which used to offer a bare
// "Discard" that silently threw away everything at once.

import { Icons } from './icons';
import { pushBack } from './back-nav';

export interface DraftSheetLine {
  /** The node the line ends on — how the caller finds it again after the write. */
  endId: string;
  /** What removing this line cuts (builder-book's DraftLine.cutId). */
  cutId: string;
  /** The line's name: its opening, or its notation when the book doesn't know one. */
  name: string;
  /** "1.e4 e5 2.Nf3" — the whole line, so it can be recognised at a glance. */
  moves: string;
  /** How many of those moves are new. */
  added: number;
  /**
   * Does this line go into training when it lands? MUTATED BY THE SHEET — the
   * caller reads it back after "Add", which is the whole point of the switch
   * being here rather than in a modal afterwards.
   */
  training: boolean;
}

export interface DraftSheetOptions {
  lines: DraftSheetLine[];
  /**
   * Leaving the builder rather than tapping the header, which adds the one
   * button the header case must never show: throw the whole draft away.
   */
  leaving?: boolean;
  /** Add everything, with whatever the switches now say. */
  onAddAll: () => void;
  /** Drop one line and repaint — the sheet closes if nothing is left. */
  onRemove: (cutId: string) => void;
  /** Stand on this line's last move (closes the sheet). */
  onGoTo: (endId: string) => void;
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
  h.textContent = opts.leaving ? 'Add these lines before you go?' : 'Lines you’re about to add';
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

  // Repainted in place rather than reopened, so dropping one line doesn't flash
  // the sheet away and back.
  let lines = opts.lines;

  function paint(): void {
    const moves = lines.reduce((n, l) => n + l.added, 0);
    const training = lines.filter(l => l.training).length;
    lede.textContent =
      `${quantity(lines.length, 'line')}, ${quantity(moves, 'new move')}. `
      + (training === 0
        ? 'None of them will go into training.'
        : training === lines.length
          ? (lines.length === 1
            ? 'It goes into training, with one run to confirm it.'
            : 'Each one goes into training, one run at a time.')
          : training === 1
            ? 'One of them goes into training, with one run to confirm it.'
            : `${training} of them go into training, one run at a time.`);

    list.innerHTML = '';
    for (const line of lines) list.appendChild(buildRow(line));

    btnRow.innerHTML = '';
    btnRow.appendChild(button(
      lines.length === 1 ? 'Add this line' : `Add all ${lines.length} lines`,
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

  function buildRow(line: DraftSheetLine): HTMLElement {
    const row = document.createElement('div');
    row.className = 'draft-row';

    // The line itself: name on top, moves under it. Tapping goes and stands on
    // it, which is the only way to check a line you are unsure about.
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'draft-row-text';
    go.setAttribute('aria-label', `Go to ${line.name}`);
    const name = document.createElement('div');
    name.className = 'draft-where';
    name.textContent = line.name;
    go.appendChild(name);
    const moves = document.createElement('div');
    moves.className = 'draft-moves';
    moves.textContent = line.moves;
    go.appendChild(moves);
    go.addEventListener('click', () => { close(); opts.onGoTo(line.endId); });
    row.appendChild(go);

    // The decision that belongs with the line, not with a modal afterwards.
    const train = document.createElement('button');
    train.type = 'button';
    train.className = 'draft-train dline-toggle' + (line.training ? ' dline-toggle--on' : '');
    train.setAttribute('role', 'switch');
    train.setAttribute('aria-checked', String(line.training));
    const sw = document.createElement('span');
    sw.className = 'dline-switch';
    sw.setAttribute('aria-hidden', 'true');
    const knob = document.createElement('span');
    knob.className = 'dline-switch-knob';
    sw.appendChild(knob);
    train.appendChild(sw);
    const trainLabel = document.createElement('span');
    trainLabel.className = 'dline-toggle-label';
    trainLabel.textContent = line.training ? 'Train' : 'Store';
    train.appendChild(trainLabel);
    const label = line.training
      ? 'Goes into training — tap to just store it'
      : 'Stored without training — tap to train it';
    train.setAttribute('aria-label', label);
    train.title = label;
    train.addEventListener('click', () => {
      line.training = !line.training;
      paint();
    });
    row.appendChild(train);

    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'draft-row-btn draft-row-btn--danger';
    drop.setAttribute('aria-label', `Don’t add ${line.name}`);
    drop.title = 'Don’t add this line';
    drop.appendChild(Icons.trash(16));
    drop.addEventListener('click', () => {
      opts.onRemove(line.cutId);
      lines = lines.filter(l => l.cutId !== line.cutId);
      // Nothing left to decide about. On the way out that means the guard has
      // been answered — dropping the last line IS discarding it all, and
      // stranding the user back in the builder would ignore what they asked for.
      if (lines.length === 0) {
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

function quantity(n: number, noun: string): string {
  return `${n} ${n === 1 ? noun : noun + 's'}`;
}
