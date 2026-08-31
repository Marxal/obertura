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
// line has been going, and offers the three moves worth preparing for; the user
// tapping one puts it on the board and then they are simply in the builder,
// with everything the builder has.
//
// The panel is a READOUT of where the cursor is. It has no state of its own
// beyond the target it was handed, which is what lets the user wander off down
// the Library tab and come back to a panel that still knows what it asked for.
// The line's own moves are NOT repeated here — the builder's move strip sits
// directly above every tab, including this one.

import type { GrowMove, GrowTarget } from './grow-line';
import { lineTraining, lineTrainingText } from './line-status';
import { formatMove } from './notation';
import { Icons } from './icons';

export interface GrowPanelDeps {
  el: HTMLElement;
  /** The UCI path to the builder's cursor — where we are relative to the end. */
  getUcis: () => string[];
  /** …and the same path in SAN, so the panel can name the moves just played. */
  getSans: () => string[];
  /** Play a move onto the line (the same hand-off the Explore tab makes). */
  onPlay: (uci: string) => void;
  /** Walk the cursor back to the end of the line being grown. */
  onBackToEnd: () => void;
  /** Add the drafted moves — the same action as the header's own button. */
  onCommit: () => void;
  /** "Skip for today" — a different line tomorrow. */
  onSkip: () => void;
  /** Are there moves waiting to be added? Skipping would throw them away. */
  hasDraft: () => boolean;
}

export interface GrowPanel {
  /** Point the panel at a line to grow, or null to stand down. */
  setTarget(target: GrowTarget | null): void;
  target(): GrowTarget | null;
  /**
   * The moves to draw on the BOARD right now — the three candidates while the
   * cursor is standing at the line end, and nothing once one has been played.
   * main.ts folds these into its one autoshapes pass.
   */
  arrows(): GrowMove[];
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

  /** The SAN of the move `n` plies past the line end, if it has been played. */
  function playedAt(n: number): string | null {
    if (!target) return null;
    return deps.getSans()[target.spot.ucis.length + n] ?? null;
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

    const at = step();
    wrap.appendChild(say(at, target));
    if (at === 'pick') {
      wrap.appendChild(picks(target.moves));
      wrap.appendChild(whys(target.moves));
    }
    if (at === 'astray') wrap.appendChild(backButton());
    if (at === 'commit') wrap.appendChild(commitButton());
    el.appendChild(wrap);
  }

  // ── The head: what this line is, how it has been going, and the way out ────
  //
  // The performance figures are the whole justification for the exercise being
  // offered at all ("you know this one"), so they are stated rather than
  // implied. They are the SAME figures the line's card and its popup show
  // (line-status.ts), so nothing here can disagree with My Lines.
  function head(t: GrowTarget): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'grow-head';

    const row = document.createElement('div');
    row.className = 'grow-head-row';
    const title = document.createElement('span');
    title.className = 'grow-head-title';
    const icon = Icons.sprout(16);
    icon.classList.add('grow-head-icon');
    title.appendChild(icon);
    const label = document.createElement('span');
    label.textContent = 'Grow this line';
    title.appendChild(label);
    row.appendChild(title);
    // Skipping is a legitimate answer — a position you don't want to think
    // about today is not a failure — so the way out sits beside the title where
    // it can be found, rather than at the bottom of a panel you have to read to
    // the end to escape. It goes while a draft is waiting: skipping then would
    // throw away moves the user has just played, which is not what it says.
    if (!deps.hasDraft()) row.appendChild(skipButton());
    wrap.appendChild(row);

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

  // ── What to do, at each step ───────────────────────────────────────────────
  //
  // The copy NAMES the move that was just played rather than describing it in
  // the abstract. "Now play your answer" leaves someone looking for what they
  // are answering; "They played 4…Nf6 — now play your reply" does not.
  function say(at: Step, t: GrowTarget): HTMLElement {
    const p = document.createElement('p');
    p.className = 'grow-say';
    if (at === 'astray') {
      p.textContent = 'You’ve moved off this line. The moves to prepare for are '
        + 'at the end of it.';
    } else if (at === 'pick') {
      p.textContent = t.moves.length === 1
        ? 'Your line stops here — and this is what you’d meet next. Tap it to '
          + 'put it on the board.'
        : 'Your line stops here. These are the moves you’d meet next — tap one '
          + 'to put it on the board.';
    } else if (at === 'reply') {
      const their = playedAt(0);
      p.textContent = (their ? `They’ve played ${formatMove(their)}. ` : '')
        + 'Now play YOUR answer on the board — drag the piece you’d reply with. '
        + 'One move is enough.';
    } else {
      const mine = playedAt(1);
      p.textContent = mine
        ? `${formatMove(mine)} is your answer. Add it to your line and today’s `
          + 'challenge moves on.'
        : 'That’s your answer. Add it to your line and today’s challenge moves on.';
    }
    return p;
  }

  // ── The three moves ────────────────────────────────────────────────────────
  //
  // The SAME three-across tile the Explore tab uses, down to the class names:
  // it is the same gesture doing the same thing (tap a suggested move, it goes
  // on the board), and teaching one gesture twice in two shapes would be
  // teaching it badly. The reasons follow underneath, where they have the width
  // to be read — a third of a phone is not enough for "you have faced this 4
  // times".
  function picks(moves: GrowMove[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'explore-picks grow-picks';
    for (const m of moves) wrap.appendChild(tile(m));
    return wrap;
  }

  function tile(m: GrowMove): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `explore-pick explore-pick--${m.source}`;
    btn.addEventListener('click', () => deps.onPlay(m.uci));

    const move = document.createElement('span');
    move.className = 'explore-pick-move';
    move.textContent = formatMove(m.san);
    btn.appendChild(move);

    const src = document.createElement('span');
    src.className = 'explore-pick-src';
    src.appendChild(sourceIcon(m));
    src.appendChild(document.createTextNode(sourceName(m)));
    btn.appendChild(src);

    const add = document.createElement('span');
    add.className = 'explore-pick-add';
    add.appendChild(Icons.plus(13));
    btn.appendChild(add);

    btn.setAttribute('aria-label', `Play ${m.san} — ${m.reason}`);
    btn.title = m.reason;
    return btn;
  }

  /** One line per move: why it is worth an answer. The exercise, in words. */
  function whys(moves: GrowMove[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'grow-whys';
    for (const m of moves) {
      const row = document.createElement('div');
      row.className = `grow-why grow-why--${m.source}`;
      const san = document.createElement('span');
      san.className = 'grow-why-move';
      san.textContent = formatMove(m.san);
      row.appendChild(san);
      const why = document.createElement('span');
      why.className = 'grow-why-text';
      why.textContent = m.reason;
      row.appendChild(why);
      wrap.appendChild(row);
    }
    return wrap;
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

  // The header's "Add N moves" is the same action and is two centimetres away,
  // but it is a small control in a bar full of small controls. At the one moment
  // the exercise has a single obvious next step, the panel says so in full.
  function commitButton(): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-primary grow-commit';
    btn.textContent = 'Add it to my line';
    btn.addEventListener('click', deps.onCommit);
    return btn;
  }

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
    arrows(): GrowMove[] {
      return target && step() === 'pick' ? target.moves : [];
    },
    render,
  };
}
