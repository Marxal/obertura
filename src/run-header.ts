// The bar across the top of every exercise overlay: WHICH EXERCISE THIS IS, on
// the left, and the way out of it, on the right.
//
// WHY IT EXISTS. Every training mode in the app already owns an icon, a colour
// and a name — on the card that launched it. The moment the overlay opened, all
// three vanished: the header was one "‹ End session" button and nothing else,
// and the only clue to what you had started was whatever the block above the
// board happened to say (a line name, an opponent, sometimes nothing at all).
// Chained runs made it worse — "Next challenge →" hands you straight from
// puzzles to endgames to your own blunders with no screen in between.
//
// So the identity moves into the header, where it is in the same place in every
// mode, and the exit moves to the far right. The exercise's accent tints the
// icon chip, so Blunder detective's indigo and Puzzles' bronze read apart at a
// glance without a word being read.
//
// Every overlay's title block (.pt-top) used to carry a .pt-mode-title saying
// the same thing a second time. Those go: the header says it now, and the block
// above the board goes back to being about THIS position — the line, the
// opponent, the rating.

import { Icons } from './icons';

export interface RunHeader {
  /** The `.pt-header` element itself — append it to the overlay as before. */
  el: HTMLElement;
  /** Rename mid-session (a mode whose title tracks the current item). */
  setTitle: (title: string) => void;
  /**
   * The slot between the identity and the exit, for a mode's own header
   * furniture — Time attack's clock and score, the endgame timer, the confirm
   * run's "Add without playing".
   */
  extras: HTMLElement;
}

export interface RunHeaderOptions {
  /** The exercise's icon, at 18px to match the chip. */
  icon?: SVGElement;
  /** The exercise's name — "Blunder detective", "Puzzles", "Time attack". */
  title: string;
  /**
   * The SESSION's framing above the name — "Daily challenge", "Your games mix".
   * Context, not identity: it used to be passed as the title, which meant three
   * different exercises in one chained run all called themselves "Daily
   * challenge" and none of them said what they actually were.
   */
  kicker?: string;
  /**
   * The exercise's colour. Defaults to the overlay's own tint, which every
   * exercise already sets, so passing it is only needed where the two differ
   * (the three Middle-game exercises share one tint but not one accent).
   */
  accent?: string;
  /** Wording for the exit. Defaults to "End session". */
  endLabel?: string;
  /** Omit the exit entirely (the guided first run — see drill.ts's hideExit). */
  onEnd?: () => void;
}

export function buildRunHeader(o: RunHeaderOptions): RunHeader {
  const el = document.createElement('div');
  el.className = 'pt-header';
  if (o.accent) el.style.setProperty('--pt-accent', o.accent);

  const id = document.createElement('div');
  id.className = 'pt-header-id';

  if (o.icon) {
    const chip = document.createElement('span');
    chip.className = 'pt-header-icon';
    chip.setAttribute('aria-hidden', 'true');
    chip.appendChild(o.icon);
    id.appendChild(chip);
  }

  const text = document.createElement('div');
  text.className = 'pt-header-text';
  if (o.kicker) {
    const kicker = document.createElement('div');
    kicker.className = 'pt-header-kicker';
    kicker.textContent = o.kicker;
    text.appendChild(kicker);
  }
  const title = document.createElement('div');
  title.className = 'pt-header-title';
  title.textContent = o.title;
  text.appendChild(title);
  id.appendChild(text);
  el.appendChild(id);

  const extras = document.createElement('div');
  extras.className = 'pt-header-extras';
  el.appendChild(extras);

  if (o.onEnd) {
    const end = document.createElement('button');
    end.type = 'button';
    // Keeps .pt-back-btn so every existing rule about the exit still applies;
    // the modifier is what moves it to the right and swaps the chevron for an ✕.
    end.className = 'pt-back-btn pt-header-end';
    end.appendChild(document.createTextNode(o.endLabel ?? 'End session'));
    end.appendChild(Icons.close(15));
    end.addEventListener('click', o.onEnd);
    el.appendChild(end);
  }

  return {
    el,
    setTitle: (t: string) => { title.textContent = t; },
    extras,
  };
}
