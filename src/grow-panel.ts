// The builder's "Grow line" tab — the instructions half of the grow exercise.
//
// WHY IT IS A TAB AND NOT AN OVERLAY. Every other daily part runs in its own
// full-screen session, because every other part has one right answer and one
// way to give it. This one doesn't: adding a move is BUILDING, and the builder
// is where the tools are — the board, the opening library, your own games, the
// engine, the position explorer. Wrapping any of that in a bespoke exercise
// screen would have meant a worse version of five panels that already exist.
//
// So the exercise is a tab beside them. It says what the job is, shows how the
// line has been going, and lists the three moves worth preparing for; the user
// tapping one puts it on the board and then they are simply in the builder,
// with everything the builder has. The header's own "Add N moves" button is
// what finishes the job — this panel never grows a second one.
//
// The panel is a READOUT of where the cursor is. It has no state of its own
// beyond the target it was handed, which is what lets the user wander off down
// the Library tab and come back to a panel that still knows what it asked for.

import type { GrowMove, GrowTarget } from './grow-line';
import { lineTraining, lineTrainingText } from './line-status';
import { formatMove, formatSanLine } from './notation';
import { Icons } from './icons';

export interface GrowPanelDeps {
  el: HTMLElement;
  /** The UCI path to the builder's cursor — where we are relative to the end. */
  getUcis: () => string[];
  /** Play a move onto the line (the same hand-off the Explore tab makes). */
  onPlay: (uci: string) => void;
  /** Walk the cursor back to the end of the line being grown. */
  onBackToEnd: () => void;
  /** "Skip for today" — a different line tomorrow. */
  onSkip: () => void;
  /** Are there moves waiting to be added? Skipping would throw them away. */
  hasDraft: () => boolean;
}

export interface GrowPanel {
  /** Point the panel at a line to grow, or null to stand down. */
  setTarget(target: GrowTarget | null): void;
  target(): GrowTarget | null;
  render(): void;
}

/** Which step of the exercise the cursor is standing on. */
type Step = 'pick' | 'reply' | 'commit' | 'astray';

export function createGrowPanel(deps: GrowPanelDeps): GrowPanel {
  let target: GrowTarget | null = null;

  function step(): Step {
    if (!target) return 'pick';
    const here = deps.getUcis();
    const want = target.spot.ucis;
    // Off the line entirely — the user navigated somewhere else in the book.
    if (here.length < want.length) return 'astray';
    for (let i = 0; i < want.length; i++) if (here[i] !== want[i]) return 'astray';
    const past = here.length - want.length;
    if (past === 0) return 'pick';
    if (past === 1) return 'reply';
    return 'commit';
  }

  function render(): void {
    const el = deps.el;
    el.replaceChildren();
    if (!target) {
      el.appendChild(note('Nothing to grow right now.'));
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'grow-panel';
    wrap.appendChild(head(target));
    wrap.appendChild(moveBox(target));

    const at = step();
    wrap.appendChild(say(at, target));
    if (at === 'pick') wrap.appendChild(picks(target.moves));
    if (at === 'astray') wrap.appendChild(backButton());
    // Skipping while moves are waiting to be added would throw them away —
    // which is not what "skip for today" says, and not what anyone who has just
    // played an answer means by it. The offer goes until the draft is dealt
    // with, one way or the other.
    if (!deps.hasDraft()) wrap.appendChild(skipButton());
    el.appendChild(wrap);
  }

  // ── The head: what this line is, and how it has been going ─────────────────
  //
  // The performance figures are the whole justification for the exercise being
  // offered at all ("you know this one"), so they are stated rather than
  // implied. They are the SAME figures the line's card and its popup show
  // (line-status.ts), so nothing here can disagree with My Lines.
  function head(t: GrowTarget): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'grow-head';

    const title = document.createElement('div');
    title.className = 'grow-head-title';
    const icon = Icons.sprout(16);
    icon.classList.add('grow-head-icon');
    title.appendChild(icon);
    const label = document.createElement('span');
    label.textContent = 'Grow this line';
    title.appendChild(label);
    wrap.appendChild(title);

    const name = document.createElement('div');
    name.className = 'grow-head-name';
    name.textContent = t.spot.line.name;
    wrap.appendChild(name);

    const stats = lineTrainingText(t.spot.line, lineTraining(t.spot.line));
    const chips = document.createElement('div');
    chips.className = 'grow-chips';
    if (stats) chips.appendChild(chip(stats));
    chips.appendChild(chip(`confidence ${t.spot.line.confidence}`));
    wrap.appendChild(chips);
    return wrap;
  }

  function chip(text: string): HTMLElement {
    const el = document.createElement('span');
    el.className = 'grow-chip';
    el.textContent = text;
    return el;
  }

  /** The line itself, wrapped, so "the end of the line" is a place you can see. */
  function moveBox(t: GrowTarget): HTMLElement {
    const box = document.createElement('div');
    box.className = 'grow-movebox';
    box.textContent = formatSanLine(t.spot.sans);
    return box;
  }

  function say(at: Step, t: GrowTarget): HTMLElement {
    const p = document.createElement('p');
    p.className = 'grow-say';
    if (at === 'astray') {
      p.textContent = 'You’ve moved off this line. The moves to prepare for are '
        + 'at the end of it.';
    } else if (at === 'pick') {
      p.textContent = t.moves.length === 1
        ? 'Your line stops here — and this is what you’d meet next. Tap it, then '
          + 'play your answer.'
        : 'Your line stops here. These are the moves you’d meet next: tap one, '
          + 'then play your answer on the board.';
    } else if (at === 'reply') {
      p.textContent = 'Now play your answer on the board. One move is enough — '
        + 'carry on if you know what comes after it.';
    } else {
      p.textContent = 'That’s it. Use the button at the top to add it to your '
        + 'line, and it joins your training.';
    }
    return p;
  }

  // ── The three moves ────────────────────────────────────────────────────────
  //
  // A COLUMN of wide rows, not the Explore tab's three-across grid, and the
  // difference is the reason. Explore's tiles are a quick pick between moves you
  // are already comparing on the board; here the reason IS the exercise — "you
  // have faced this 4 times" is what makes a move worth an answer — and a reason
  // has to be readable, which a third of a phone width is not.
  function picks(moves: GrowMove[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'grow-picks';
    for (const m of moves) wrap.appendChild(tile(m));
    return wrap;
  }

  function tile(m: GrowMove): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `grow-pick grow-pick--${m.source}`;
    btn.addEventListener('click', () => deps.onPlay(m.uci));

    const move = document.createElement('span');
    move.className = 'grow-pick-move';
    move.textContent = formatMove(m.san);
    btn.appendChild(move);

    const body = document.createElement('span');
    body.className = 'grow-pick-body';

    const src = document.createElement('span');
    src.className = 'grow-pick-src';
    src.appendChild(sourceIcon(m));
    src.appendChild(document.createTextNode(sourceName(m)));
    body.appendChild(src);

    const why = document.createElement('span');
    why.className = 'grow-pick-why';
    why.textContent = m.reason;
    body.appendChild(why);
    btn.appendChild(body);

    const add = document.createElement('span');
    add.className = 'grow-pick-add';
    add.appendChild(Icons.plus(14));
    btn.appendChild(add);

    btn.setAttribute('aria-label', `Play ${m.san} — ${m.reason}`);
    return btn;
  }

  function sourceIcon(m: GrowMove): SVGElement {
    if (m.source === 'games') return Icons.pawn(11);
    if (m.source === 'scout') return Icons.scout(11);
    return Icons.book(11);
  }

  function sourceName(m: GrowMove): string {
    if (m.source === 'games') return 'Your games';
    if (m.source === 'scout') return m.opponentName ?? 'Opponent';
    return 'Book';
  }

  function backButton(): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-secondary grow-back';
    btn.textContent = 'Back to the end of the line';
    btn.addEventListener('click', deps.onBackToEnd);
    return btn;
  }

  // Quiet on purpose. Skipping is a legitimate answer — a position you don't
  // want to think about today is not a failure — and a loud button would make
  // it read as one. It clears the row either way (daily-challenge.ts records no
  // right and no wrong for it), so nobody has to grow a line badly to finish
  // their day.
  function skipButton(): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'grow-skip';
    btn.textContent = 'Skip for today';
    btn.addEventListener('click', deps.onSkip);
    return btn;
  }

  function note(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'bx-empty';
    el.textContent = text;
    return el;
  }

  return {
    setTarget(next: GrowTarget | null): void { target = next; render(); },
    target(): GrowTarget | null { return target; },
    render,
  };
}
