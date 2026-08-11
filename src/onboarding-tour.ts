// The builder walkthrough — coach-marks over the real builder, shown once.
//
// WHY IT EXISTS. The builder is a dense screen: a board, a move list, a five-tab
// carousel and a dock full of controls. Someone seeing it for the first time
// reads it as "a chess board with some stuff around it" and never finds the
// tabs, which is where the app's library actually lives. The coach strip in the
// dock can't fix that on its own — it's one line at the bottom of a screen the
// user is already lost in, and it can only talk about the line, not the
// furniture.
//
// WHY IT'S ANCHORED, NOT A CARD STACK. The first cut was three cards on an empty
// screen before the builder appeared. It read fine and taught nothing: naming
// "the tabs under the board" while there are no tabs on screen asks the user to
// hold a description in their head and match it to something they'll see later.
// So the bubbles now sit ON the builder, each one dimming everything except the
// thing it's describing — the tabs light up while the sentence about the tabs is
// being read, and matching is not the user's job.
//
// HOW THE SPOTLIGHT WORKS. One scrim element per step, positioned over the
// target's rect and given an enormous `box-shadow` spread in the scrim colour.
// The element itself is transparent, so the shadow paints everything AROUND it —
// a cut-out with no SVG masks, no four-rectangle jigsaw, and no clipping bugs
// when the target sits at a screen edge. Nothing has to be re-stacked to stay
// bright, either: a box-shadow paints strictly OUTSIDE its element's box, so the
// hole shows the real screen underneath at full strength, whatever stacking
// contexts the app's own layout happens to create around the target.
//
// It never blocks the app: the whole overlay dismisses to the caller's callback,
// the back gesture included, so a walkthrough can't strand anyone.
//
// It runs ONCE ever (prefs' builderTourSeen), including for someone who arrives
// via a starter pack long after their first run.

import { isBuilderTourSeen, setBuilderTourSeen } from './prefs';
import { pushBack } from './back-nav';

// Gap between the spotlight and the bubble, and how far the spotlight is
// inflated past the target's own box.
const BUBBLE_GAP = 12;
const SPOT_PAD = 6;

interface TourStep {
  // What to point at. First match wins; a step whose target is missing from the
  // DOM is skipped rather than pointed at nothing.
  selector: string[];
  title: string;
  body: string;
  // Extra room around this target (the board wants none, a small header button
  // wants a bit so the ring doesn't crowd it).
  pad?: number;
}

export interface TourLine {
  // The opening's curated name and how many moves the user has to remember.
  // Absent when the tour fronts an EMPTY builder ("build my own line"), where
  // there is no line to describe yet.
  name: string;
  ownMoves: number;
}

function steps(line?: TourLine): TourStep[] {
  return [
    {
      selector: ['#board'],
      title: 'The board is the line',
      body: line
        ? `This is the ${line.name} — ${line.ownMoves} move${line.ownMoves === 1 ? '' : 's'} `
          + 'for you to remember. Play a different move any time and the line follows you.'
        : 'Play moves on the board and they become your line, move by move. '
          + 'Change your mind and just play a different move.',
    },
    {
      selector: ['#builder-slide-tabs'],
      title: 'Everything else is here',
      body: 'Line is the moves so far. Library shows what strong players play from '
        + 'this position. My lines is your own repertoire, and Learn holds notes '
        + 'and videos.',
      pad: 4,
    },
    {
      selector: ['#header-save', '#save-line-btn'],
      title: 'Save when it looks right',
      body: 'Nothing is saved until you press this — so there’s nothing to break. '
        + 'Save it and the trainer takes over.',
      pad: 8,
    },
  ];
}

// Run the walkthrough, then call `onDone`. If it has already been seen, `onDone`
// fires immediately — so callers can always wrap what comes next in this, with
// no branching of their own. `ran` says whether the user actually saw it, which
// is what the coach strip needs to know: after a walkthrough it can go straight
// to its save decision instead of repeating what the bubbles just said.
export function runBuilderTour(onDone: (ran: boolean) => void, line?: TourLine): void {
  if (isBuilderTourSeen()) { onDone(false); return; }
  setBuilderTourSeen();
  openTour(onDone, line);
}

function openTour(onDone: (ran: boolean) => void, line?: TourLine): void {
  // Only steps whose target is actually on screen. #save-line-btn is hidden on a
  // fresh line and #header-save is hidden on desktop, hence the fallback list.
  const all = steps(line).filter(s => findTarget(s) !== null);
  if (all.length === 0) { onDone(false); return; }

  let index = 0;

  const overlay = document.createElement('div');
  overlay.className = 'tour-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'How the builder works');

  // The cut-out. Transparent itself; its box-shadow paints the scrim.
  const spot = document.createElement('div');
  spot.className = 'tour-spot';
  overlay.appendChild(spot);

  const bubble = document.createElement('div');
  bubble.className = 'tour-bubble';
  overlay.appendChild(bubble);

  const tail = document.createElement('div');
  tail.className = 'tour-tail';
  bubble.appendChild(tail);

  const title = document.createElement('h2');
  title.className = 'tour-title';
  bubble.appendChild(title);

  const body = document.createElement('p');
  body.className = 'tour-body';
  bubble.appendChild(body);

  const foot = document.createElement('div');
  foot.className = 'tour-foot';

  const dots = document.createElement('div');
  dots.className = 'tour-dots';
  const dotEls = all.map(() => {
    const d = document.createElement('span');
    d.className = 'tour-dot';
    dots.appendChild(d);
    return d;
  });
  foot.appendChild(dots);

  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'tour-skip';
  skip.textContent = 'Skip';
  skip.addEventListener('click', () => finish());
  foot.appendChild(skip);

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'tour-next';
  next.addEventListener('click', () => {
    if (index >= all.length - 1) { finish(); return; }
    index++;
    paint();
  });
  foot.appendChild(next);

  bubble.appendChild(foot);

  let finished = false;
  // Every exit — Skip, the last bubble's button, the back gesture — lands here,
  // so whatever comes next always happens.
  function finish(): void {
    if (finished) return;
    finished = true;
    window.removeEventListener('resize', paint);
    window.removeEventListener('orientationchange', paint);
    overlay.remove();
    removeBack();
    onDone(true);
  }
  const removeBack = pushBack(finish);

  function paint(): void {
    const step = all[index];
    const target = findTarget(step);
    if (!target) { finish(); return; }

    const pad = step.pad ?? SPOT_PAD;
    const r = target.getBoundingClientRect();
    const top = r.top - pad;
    const left = r.left - pad;
    const width = r.width + pad * 2;
    const height = r.height + pad * 2;

    spot.style.top = `${top}px`;
    spot.style.left = `${left}px`;
    spot.style.width = `${width}px`;
    spot.style.height = `${height}px`;

    title.textContent = step.title;
    body.textContent = step.body;
    dotEls.forEach((d, i) => d.classList.toggle('tour-dot--on', i === index));
    next.textContent = index >= all.length - 1 ? 'Got it' : 'Next';

    placeBubble(top, height);

    // Re-run the entry animation so each bubble arrives rather than swapping
    // text under a static frame.
    bubble.classList.remove('tour-bubble--in');
    void bubble.offsetWidth;
    bubble.classList.add('tour-bubble--in');
  }

  // Put the bubble on whichever side of the spotlight has more room, and point
  // the tail back at it. Measured, not guessed: the board is most of a phone
  // screen, so "always below" would push the bubble off the bottom.
  function placeBubble(spotTop: number, spotHeight: number): void {
    const vh = window.innerHeight;
    const spotBottom = spotTop + spotHeight;
    const roomBelow = vh - spotBottom;
    const roomAbove = spotTop;

    // Measure the bubble at its natural height before deciding.
    bubble.style.top = '0px';
    bubble.style.bottom = 'auto';
    bubble.classList.remove('tour-bubble--above');
    const h = bubble.offsetHeight;

    const below = roomBelow >= h + BUBBLE_GAP || roomBelow >= roomAbove;
    if (below) {
      bubble.style.top = `${Math.min(spotBottom + BUBBLE_GAP, vh - h - 8)}px`;
      bubble.classList.remove('tour-bubble--above');
    } else {
      bubble.style.top = `${Math.max(spotTop - BUBBLE_GAP - h, 8)}px`;
      bubble.classList.add('tour-bubble--above');
    }
  }

  document.body.appendChild(overlay);
  paint();
  // The dock can grow (the eval bar), the keyboard can open, the phone can turn.
  window.addEventListener('resize', paint);
  window.addEventListener('orientationchange', paint);
}

// The first selector in the list that resolves to something actually visible.
function findTarget(step: TourStep): HTMLElement | null {
  for (const sel of step.selector) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && el.offsetParent !== null) return el;
  }
  return null;
}
