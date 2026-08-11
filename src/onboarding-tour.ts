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
// HOW THE SPOTLIGHT WORKS. One scrim element, positioned over the target's rect
// and given an enormous `box-shadow` spread in the scrim colour. The element
// itself is transparent, so the shadow paints everything AROUND it — a cut-out
// with no SVG masks, no four-rectangle jigsaw, and no clipping bugs when the
// target sits at a screen edge. Nothing has to be re-stacked to stay bright,
// either: a box-shadow paints strictly OUTSIDE its element's box, so the hole
// shows the real screen at full strength whatever stacking contexts the app's
// own layout creates around the target.
//
// THE EDGE INSET. A phone board is the full width of the screen, so a spotlight
// drawn exactly on its rect puts its ring off-screen on both sides and the
// "highlight" reads as no highlight at all. Every spot is therefore clamped to
// sit at least EDGE_INSET inside the viewport: on a full-bleed target the ring
// lands just inside the screen edge, where it can actually be seen.
//
// A STEP CAN BE LIVE. `interactive` drops the overlay's own pointer capture so
// taps reach the app underneath, and `watch` lets a step advance on something
// the user DID (a move played on the board, the next tab tapped) rather than
// only on the Next button. That's the difference between a slideshow about the
// screen and a walkthrough of it.
//
// It never blocks the app: every exit runs the caller's callback, the back
// gesture included, so a walkthrough can't strand anyone.

import { isBuilderTourSeen, setBuilderTourSeen } from './prefs';
import { pushBack } from './back-nav';

// Gap between the spotlight and the bubble, how far the spotlight is inflated
// past the target's own box, and how far inside the viewport a spot edge is
// always kept (so a full-bleed target still shows its ring).
const BUBBLE_GAP = 12;
const SPOT_PAD = 6;
const EDGE_INSET = 9;

// One button on a bubble. When `actions` is omitted a step gets the default
// Next / Got it, which advances or ends the sequence.
export interface CoachAction {
  label: string;
  // 'primary' fills with the accent; 'quiet' is a plain text button.
  variant?: 'primary' | 'quiet';
  onClick?: () => void;
  // Carry on through the sequence: the next step, or — on the LAST step — the
  // ordinary end, which runs onDone. Without it an action is an exit that
  // REPLACES onDone, which is what a "this ends the walkthrough and starts
  // something else" button (Save the line, Import games) wants.
  advance?: boolean;
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
  // Replaces the default Next / Got it. An action without `advance` ends the
  // sequence whichever step it's on.
  actions?: CoachAction[];
  // Run when the step becomes the current one — used to put the screen in the
  // state the step describes (switch the builder to the panel being named).
  onEnter?: () => void;
  // Subscribe to something in the app that should advance this step: a move
  // played on the board, the next tab tapped. Return the unsubscribe.
  watch?: (advance: () => void) => () => void;
  // Let taps through to the app underneath. The bubble stays clickable; the
  // rest of the screen is live, so the thing being described can be used while
  // it's being described.
  interactive?: boolean;
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

  // The current step's `watch` subscription, dropped whenever the step changes.
  let unwatch: (() => void) | null = null;
  function dropWatch(): void {
    unwatch?.();
    unwatch = null;
  }

  let finished = false;
  function teardown(): void {
    if (finished) return;
    finished = true;
    dropWatch();
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

  // Next step, or the end of the sequence. The one path every advance goes
  // through — the Next button, a custom advancing action, and `watch`.
  function advance(): void {
    if (finished) return;
    if (index >= all.length - 1) { finish(); return; }
    index++;
    paint();
  }

  function paint(): void {
    const step = all[index];
    const target = findTarget(step);
    if (!target) { finish(); return; }

    dropWatch();
    step.onEnter?.();

    // A live step lets taps reach the app; the bubble keeps its own pointer
    // events so its buttons still work (see the CSS).
    overlay.classList.toggle('tour-overlay--live', !!step.interactive);

    title.textContent = step.title;
    body.textContent = step.body;
    dotEls.forEach((d, i) => d.classList.toggle('tour-dot--on', i === index));

    // Rebuild the foot: dots (only when there's a sequence to track), then the
    // step's own actions or the default Skip / Next pair.
    foot.replaceChildren();
    foot.classList.toggle('tour-foot--single', all.length === 1);
    if (all.length > 1) foot.appendChild(dots);

    if (step.actions?.length) {
      // An exiting action REPLACES onDone rather than running alongside it: the
      // whole point of a custom action is that this exit means something
      // specific. onDone stays the fallback for a back gesture or a vanished
      // target. An advancing action just runs and moves on.
      for (const a of step.actions) {
        foot.appendChild(actionButton(a.label, a.variant ?? 'primary', () => {
          if (a.advance) { a.onClick?.(); advance(); return; }
          teardown();
          a.onClick?.();
        }));
      }
    } else {
      const last = index >= all.length - 1;
      if (!last) foot.appendChild(actionButton('Skip', 'quiet', finish));
      foot.appendChild(actionButton(last ? 'Got it' : 'Next', 'primary', advance));
    }

    // Whatever the step watches for (a move, a tab tap) advances it too. A short
    // beat first, so the thing the user just did finishes animating before the
    // bubble moves off it.
    if (step.watch) {
      const stepIndex = index;
      unwatch = step.watch(() => {
        if (finished || index !== stepIndex) return;
        setTimeout(() => { if (!finished && index === stepIndex) advance(); }, 400);
      });
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
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Clamped into the viewport, so a full-bleed target (the board on a phone)
    // still has both of its rings on screen.
    const left = Math.max(EDGE_INSET, r.left - pad);
    const right = Math.min(vw - EDGE_INSET, r.right + pad);
    const top = Math.max(EDGE_INSET, r.top - pad);
    const bottom = Math.min(vh - EDGE_INSET, r.bottom + pad);
    const height = Math.max(0, bottom - top);

    spot.style.top = `${top}px`;
    spot.style.left = `${left}px`;
    spot.style.width = `${Math.max(0, right - left)}px`;
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
//
// Measured, not `offsetParent`: the builder's panel sheet is position:fixed, and
// a fixed element's offsetParent is null however plainly visible it is — which
// silently dropped every panel step from the walkthrough. A box with area is on
// screen; a hidden one (or one under a `display: none` ancestor) has none.
function findTarget(step: CoachStep): HTMLElement | null {
  for (const sel of step.selector) {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

// ── Watching the app ─────────────────────────────────────────────────────────

// Fired by the builder whenever the USER plays a move into the line by hand (on
// the board, or by tapping a suggested continuation). Not fired for moves the
// app lays down itself — a line playing itself in isn't the user doing anything.
export const BUILDER_MOVE_EVENT = 'bito:builder-move';

export function notifyBuilderMove(): void {
  document.dispatchEvent(new Event(BUILDER_MOVE_EVENT));
}

function onBuilderMove(advance: () => void): () => void {
  document.addEventListener(BUILDER_MOVE_EVENT, advance);
  return () => document.removeEventListener(BUILDER_MOVE_EVENT, advance);
}

// Advance when the user taps the tab the NEXT step is about — so "or tap
// Library" is a real instruction, not a description of a button we've disabled.
function onTabTap(slide: number): (advance: () => void) => () => void {
  return (advance) => {
    const el = document.querySelector<HTMLElement>(`#builder-slide-tabs .slide-tab[data-slide="${slide}"]`);
    if (!el) return () => {};
    el.addEventListener('click', advance);
    return () => el.removeEventListener('click', advance);
  };
}

// ── The builder walkthrough ──────────────────────────────────────────────────
//
// Split in two around the line playing itself in, because the two halves are
// about different things. Before: what this screen IS — the board you build on,
// then the panels beside it, one at a time. After: the decision the user now has
// to make, with a finished line sitting in front of them.

// Carousel slide indices the walkthrough drives (main.ts owns the real list).
const LINE_SLIDE = 0;
const LIBRARY_SLIDE = 1;
const MYLINES_SLIDE = 2;

// Where to resume the walkthrough after a Lichess connect, which redirects the
// whole page away and back. Same shape (and the same 10-minute staleness window)
// as lichess-auth's own stashReturn / takeReturn.
const RESUME_KEY = 'obertura.tourResume';

function stashTourStep(step: number): void {
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ step, t: Date.now() }));
  } catch { /* storage off — we simply won't resume the walkthrough */ }
}

// Consume the stashed step (once). Null if there is none, it's malformed, or
// it's stale (a leftover from a connect the user abandoned).
export function takeTourResume(): number | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    localStorage.removeItem(RESUME_KEY);
    const v = JSON.parse(raw) as { step?: number; t?: number };
    if (typeof v.step !== 'number' || Date.now() - (v.t ?? 0) > 600_000) return null;
    return Math.max(0, v.step);
  } catch {
    return null;
  }
}

// Is the walkthrough still owed on this device? Callers check before deciding
// how to sequence the builder, then call markBuilderTourSeen once it starts.
export function isBuilderTourOwed(): boolean {
  return !isBuilderTourSeen();
}

export function markBuilderTourSeen(): void {
  setBuilderTourSeen();
}

export interface BuilderIntroDeps {
  // Fires on whatever exit happens — the last step, Skip, or the back gesture.
  onDone: () => void;
  // Show a builder carousel slide, so each panel step opens the panel it names.
  showSlide: (index: number) => void;
  // "Connect Lichess" on the Library step. Redirects the page away and back;
  // the walkthrough stashes where it was first, so it resumes here on return.
  onConnectLichess: () => void;
  // "Import my games" on the My lines step — the Chess.com / Lichess username
  // import, which is what fills that panel.
  onImportGames: () => void;
  isLichessConnected: () => boolean;
  // Start partway in (2 = the Library step) — how the walkthrough picks itself
  // back up after the Lichess round-trip.
  startStep?: number;
}

// Part one: the board, then the three panels one at a time. Runs BEFORE the line
// plays in.
//
// The panels used to be a single step that listed all three in one paragraph. A
// bubble that names three things teaches none of them, and the panel it was
// pointing at was whichever one happened to be showing. Now each panel gets its
// own step, its own panel actually open behind it, and — where the panel is only
// half a feature without one — its own connect.
export function showBuilderIntro(deps: BuilderIntroDeps): void {
  const steps: CoachStep[] = [
    {
      selector: ['#board'],
      title: 'Build your line',
      // Short on purpose. This is the first bubble a stranger ever reads, and
      // the whole product fits in one sentence.
      body: 'Play the line you want to save, save it, and train it on Bito Chess.',
      pad: 0,
      // Live, and it advances on a move: the fastest way to learn that the board
      // is yours to play on is to play on it.
      interactive: true,
      watch: onBuilderMove,
    },
    {
      selector: ['#builder-sheet'],
      title: 'Line',
      body: 'Every move you\'ve played. Tap one to jump back to it, rename the '
        + 'line, add tags, or leave a note on a move to help you remember it.',
      pad: 4,
      interactive: true,
      onEnter: () => deps.showSlide(LINE_SLIDE),
      watch: onTabTap(LIBRARY_SLIDE),
    },
    {
      selector: ['#builder-sheet'],
      title: 'Library',
      body: deps.isLichessConnected()
        ? 'What strong players actually play from here, with the win rates. '
          + 'You\'re connected to Lichess, so it answers for every position.'
        : 'What strong players actually play from here, with the win rates. '
          + 'Connect Lichess and it answers for every position, live.',
      pad: 4,
      interactive: true,
      onEnter: () => deps.showSlide(LIBRARY_SLIDE),
      watch: onTabTap(MYLINES_SLIDE),
      actions: deps.isLichessConnected() ? undefined : [
        {
          label: 'Connect Lichess',
          variant: 'quiet',
          // Come back to THIS step: the redirect reloads the app, and landing
          // back at the start of the walkthrough (or at no walkthrough at all)
          // is how a connect turns into a dead end.
          onClick: () => { stashTourStep(2); deps.onConnectLichess(); },
        },
        { label: 'Next', variant: 'primary', advance: true },
      ],
    },
    {
      selector: ['#builder-sheet'],
      title: 'My lines',
      body: 'The lines you\'ve already saved from this position — and, once you '
        + 'import from Chess.com or Lichess, the moves you actually face in '
        + 'your own games.',
      pad: 4,
      interactive: true,
      onEnter: () => deps.showSlide(MYLINES_SLIDE),
      actions: [
        // Import EXITS the walkthrough (the sheet needs the screen) and hands
        // the continuation to that sheet's onClose — see builderIntroDeps in
        // main.ts. "Got it" is the ordinary end.
        { label: 'Import games', variant: 'quiet', onClick: deps.onImportGames },
        { label: 'Got it', variant: 'primary', advance: true },
      ],
    },
  ];

  showCoachMarks(steps.slice(deps.startStep ?? 0), deps.onDone);
}

// Part two: the save decision. Runs AFTER the line has played itself in (or, on
// an empty board, once a few moves are down), so the user is looking at a line
// when they're asked what to do with it.
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
      body: 'The board plays your line once. Then it\'s your turn, from memory — '
        + 'two tries before the move is shown. Bito Chess keeps what you miss '
        + 'and brings it back until it sticks.',
      pad: 0,
      actions: [{ label: 'Start training', variant: 'primary', onClick: onStart }],
    },
  ], onStart);
}
