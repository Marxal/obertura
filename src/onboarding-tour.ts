// Coach-marks — a bubble anchored beside the thing it's describing, with
// everything else dimmed. The builder walkthrough is built from these, and so is
// the trainer's one-card introduction.
//
// WHY IT EXISTS. The builder is a dense screen: a board, a move list, a five-tab
// carousel and a dock full of controls. Someone seeing it for the first time
// reads it as "a chess board with some stuff around it" and never finds the
// tabs, which is where the app's library actually lives.
//
// WHY IT'S ANCHORED, NOT A CARD STACK. The first cut was cards on an empty
// screen before the builder appeared. It read fine and taught nothing: naming
// "the tabs under the board" while there are no tabs on screen asks the user to
// hold a description in their head and match it to something they'll see later.
// The bubbles sit ON the real screen instead — the tabs light up while the
// sentence about the tabs is being read, and matching is not the user's job.
//
// WHY IT REPLACED THE COACH STRIP. There used to be a second teaching device: a
// strip in the builder's dock that cycled three sentences on a timer and ended
// with a Save button. Two systems saying overlapping things in different voices,
// one of which moved on whether or not you'd read it. The strip is gone; its
// job — the save decision — is the walkthrough's last step, which arrives after
// the line has played in and offers both answers as buttons.
//
// HOW THE SPOTLIGHT WORKS. One scrim element, positioned over the target's rect
// and given an enormous `box-shadow` spread in the scrim colour. The element
// itself is transparent, so the shadow paints everything AROUND it — a cut-out
// with no SVG masks, no four-rectangle jigsaw, and no clipping bugs when the
// target sits at a screen edge. Nothing has to be re-stacked to stay bright,
// either: a box-shadow paints strictly OUTSIDE its element's box, so the hole
// shows the real screen at full strength whatever stacking contexts the app's
// own layout creates around the target.
//
// It never blocks the app: every exit runs the caller's callback, the back
// gesture included, so a walkthrough can't strand anyone.

import { isBuilderTourSeen, setBuilderTourSeen } from './prefs';
import { pushBack } from './back-nav';

// Gap between the spotlight and the bubble, and how far the spotlight is
// inflated past the target's own box.
const BUBBLE_GAP = 12;
const SPOT_PAD = 6;

// One button on a bubble. When `actions` is omitted a step gets the default
// Next / Got it, which advances or ends the sequence.
export interface CoachAction {
  label: string;
  // 'primary' fills with the accent; 'quiet' is a plain text button. Both end
  // the sequence when clicked, after running onClick.
  variant?: 'primary' | 'quiet';
  onClick?: () => void;
}

export interface CoachStep {
  // What to point at. First VISIBLE match wins; a step whose targets are all
  // missing is dropped rather than pointed at nothing.
  selector: string[];
  title: string;
  body: string;
  // Extra room around this target (a small header button wants a bit so the
  // ring doesn't crowd it; a full-width board wants none).
  pad?: number;
  // Replaces the default Next / Got it. Only meaningful on the LAST step —
  // a step with actions ends the sequence whichever one is pressed.
  actions?: CoachAction[];
}

// Show a sequence of coach-marks. `onDone` fires once, on whatever exit
// happens: the last step's button, Skip, or the back gesture. Returns a function
// that tears the overlay down without firing onDone, for a caller that needs to
// cancel (the builder being left mid-tour, say).
export function showCoachMarks(steps: CoachStep[], onDone: () => void = () => {}): () => void {
  const all = steps.filter(s => findTarget(s) !== null);
  if (all.length === 0) { onDone(); return () => {}; }

  let index = 0;

  const overlay = document.createElement('div');
  overlay.className = 'tour-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', all[0].title);

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
  bubble.appendChild(foot);

  const dots = document.createElement('div');
  dots.className = 'tour-dots';
  const dotEls = all.map(() => {
    const d = document.createElement('span');
    d.className = 'tour-dot';
    dots.appendChild(d);
    return d;
  });

  let finished = false;
  function teardown(): void {
    if (finished) return;
    finished = true;
    window.removeEventListener('resize', reposition);
    window.removeEventListener('orientationchange', reposition);
    overlay.remove();
    removeBack();
  }
  function finish(): void {
    if (finished) return;
    teardown();
    onDone();
  }
  const removeBack = pushBack(finish);

  function paint(): void {
    const step = all[index];
    const target = findTarget(step);
    if (!target) { finish(); return; }

    title.textContent = step.title;
    body.textContent = step.body;
    dotEls.forEach((d, i) => d.classList.toggle('tour-dot--on', i === index));

    // Rebuild the foot: dots (only when there's a sequence to track), then the
    // step's own actions or the default Skip / Next pair.
    foot.replaceChildren();
    if (all.length > 1) foot.appendChild(dots);
    else foot.classList.add('tour-foot--single');

    if (step.actions?.length) {
      // An action REPLACES onDone rather than running alongside it: the whole
      // point of a custom action is that this exit means something specific.
      // onDone stays the fallback for a back gesture or a vanished target.
      for (const a of step.actions) {
        foot.appendChild(actionButton(a.label, a.variant ?? 'primary', () => {
          teardown();
          a.onClick?.();
        }));
      }
    } else {
      const last = index >= all.length - 1;
      if (!last) foot.appendChild(actionButton('Skip', 'quiet', finish));
      foot.appendChild(actionButton(last ? 'Got it' : 'Next', 'primary', () => {
        if (last) { finish(); return; }
        index++;
        paint();
      }));
    }

    reposition();

    // Re-run the entry animation so each bubble arrives rather than swapping
    // text under a static frame.
    bubble.classList.remove('tour-bubble--in');
    void bubble.offsetWidth;
    bubble.classList.add('tour-bubble--in');
  }

  // Place the spotlight and the bubble for the CURRENT step. Split out of paint
  // so a resize (the dock growing, the phone turning) can re-run just the
  // geometry without replaying the animation.
  function reposition(): void {
    const step = all[index];
    const target = findTarget(step);
    if (!target) return;

    const pad = step.pad ?? SPOT_PAD;
    const r = target.getBoundingClientRect();
    const top = r.top - pad;
    const height = r.height + pad * 2;

    spot.style.top = `${top}px`;
    spot.style.left = `${r.left - pad}px`;
    spot.style.width = `${r.width + pad * 2}px`;
    spot.style.height = `${height}px`;

    placeBubble(top, height);
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
    bubble.classList.remove('tour-bubble--above');
    const h = bubble.offsetHeight;

    if (roomBelow >= h + BUBBLE_GAP || roomBelow >= roomAbove) {
      bubble.style.top = `${Math.min(spotBottom + BUBBLE_GAP, vh - h - 8)}px`;
    } else {
      bubble.style.top = `${Math.max(spotTop - BUBBLE_GAP - h, 8)}px`;
      bubble.classList.add('tour-bubble--above');
    }
  }

  document.body.appendChild(overlay);
  paint();
  // The dock can grow (the eval bar), the keyboard can open, the phone can turn.
  window.addEventListener('resize', reposition);
  window.addEventListener('orientationchange', reposition);

  return teardown;
}

function actionButton(label: string, variant: 'primary' | 'quiet', onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = variant === 'primary' ? 'tour-next' : 'tour-skip';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

// The first selector in the list that resolves to something actually visible.
function findTarget(step: CoachStep): HTMLElement | null {
  for (const sel of step.selector) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && el.offsetParent !== null) return el;
  }
  return null;
}

// ── The builder walkthrough ──────────────────────────────────────────────────
//
// Split in two around the line playing itself in, because the two halves are
// about different things. Before: what this screen IS — the board you build on,
// and the panels beside it. After: the decision the user now has to make, with a
// finished line sitting in front of them.

export interface TourLine {
  // The opening's curated name and how many moves the user has to remember.
  // Absent when the tour fronts an EMPTY builder ("an empty board"), where there
  // is no line to describe yet.
  name: string;
  ownMoves: number;
}

// Is the walkthrough still owed on this device? Callers check before deciding
// how to sequence the builder, then call markBuilderTourSeen once it starts.
export function isBuilderTourOwed(): boolean {
  return !isBuilderTourSeen();
}

export function markBuilderTourSeen(): void {
  setBuilderTourSeen();
}

// Part one: the board, then the panels. Runs BEFORE the line plays in.
export function showBuilderIntro(line: TourLine | undefined, onDone: () => void): void {
  showCoachMarks([
    {
      selector: ['#board'],
      title: line ? 'Build your line here' : 'Your line starts here',
      body: line
        ? `This is the ${line.name}. Play moves on the board to change it, add to `
          + 'it, or take it somewhere else — then save it, and the app drills you '
          + 'on it until you know it cold.'
        : 'Play moves on the board and they become your line, move by move. When '
          + 'it looks right you save it, and the app drills you on it until you '
          + 'know it cold.',
    },
    {
      selector: ['#builder-slide-tabs'],
      title: 'Three panels to build from',
      // Named one by one, because "the tabs" is the thing nobody finds. Learn
      // and Scouting are deliberately left out — they're for later, and a
      // walkthrough that lists five things teaches none of them.
      body: 'Line — every move you\'ve played, tap one to jump back to it. '
        + 'Library — what strong players actually play from this position, with '
        + 'the win rates. My lines — your own repertoire, to copy from or check '
        + 'against.',
      pad: 4,
    },
  ], onDone);
}

// Part two: the save decision. Runs AFTER the line has played itself in, so the
// user is looking at a finished line when they're asked what to do with it.
//
// Not a "nothing is saved until you press this" warning any more — that framing
// tells a first-time user the app is fragile, which is both unfriendly and
// untrue. It's a choice between two good outcomes, and both are buttons.
export function showSaveStep(o: { onSave: () => void; onKeepEditing?: () => void }): void {
  showCoachMarks([
    {
      selector: ['#header-save', '#save-line-btn'],
      title: 'Ready when you are',
      body: 'Keep playing moves to make the line your own, or save it now — '
        + 'saving is what puts it into training.',
      pad: 8,
      actions: [
        { label: 'Keep editing', variant: 'quiet', onClick: o.onKeepEditing },
        { label: 'Save the line', variant: 'primary', onClick: o.onSave },
      ],
    },
  ]);
}

// The trainer's introduction, on the trainer, over the board it's about to play.
// A coach-mark rather than the dialog this used to be: a card in the middle of
// the screen explains the app, a bubble on the board explains THE BOARD.
export function showTrainerIntro(onStart: () => void): void {
  showCoachMarks([
    {
      selector: ['.pt-board', '.pt-board-wrap'],
      title: 'Saved. Now learn it.',
      body: 'First the board plays your line through once. Then it\'s your turn, '
        + 'from memory — get one wrong and it shows you. One clean run and the '
        + 'line joins your training.',
      actions: [{ label: 'Watch it', variant: 'primary', onClick: onStart }],
    },
  ], onStart);
}
