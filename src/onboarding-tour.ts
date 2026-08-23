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
// lands just inside the screen edge, where it can actually be seen. The padding
// AROUND the target is trimmed symmetrically when that clamp bites, so a button
// near the screen edge still gets a ring that looks centred on it rather than
// one that bulges out on the roomy side.
//
// A STEP CAN BE LIVE. `interactive` drops the overlay's own pointer capture so
// taps reach the app underneath, and `watch` lets a step advance on something
// the user DID (a move played on the board, the next tab tapped) rather than
// only on the Next button. That's the difference between a slideshow about the
// screen and a walkthrough of it.
//
// AND A STEP CAN BE LOOK-ONLY. `lookOnly` is the middle setting between the two:
// the app underneath stays live enough to read and scroll, but nothing in it can
// be tapped except the panel tabs. The panel steps use it, because every one of
// those panels has moves in it that PLAY when tapped — and a first-timer who
// taps one has silently walked their line off the opening they just chose, three
// bubbles before the walkthrough asks them to save it.
//
// IT GOES BOTH WAYS. Every bubble carries Back as well as Next, and a step's
// `onEnter` is re-run on the way back — so the board rewinds, the right panel
// reopens, the engine goes back off. Back on the FIRST bubble leaves the
// walkthrough entirely and hands the user back to the screen they came from.
//
// It never blocks the app: every exit runs the caller's callback, the back
// gesture included, so a walkthrough can't strand anyone.

import {
  isBuilderTourSeen,
  setBuilderTourSeen,
  clearBuilderTourSeen,
  isBuilderTourDone,
  setBuilderTourDone,
} from './prefs';
import { pushBack } from './back-nav';
import { Icons } from './icons';

// Gap between the spotlight and the bubble, how far the spotlight is inflated
// past the target's own box, how far inside the viewport a spot edge is always
// kept (so a full-bleed target still shows its ring), and how close to a corner
// the tail is allowed to sit.
const BUBBLE_GAP = 12;
// The default pause between `watch` firing and the bubble moving on — long
// enough for the move that triggered it to land on the board.
const WATCH_BEAT = 400;
const SPOT_PAD = 6;
const EDGE_INSET = 9;
const TAIL_INSET = 24;

// One button on a bubble. When `actions` is omitted a step gets the standard
// Back / Next pair, which walks the sequence.
export interface CoachAction {
  label: string;
  // 'primary' fills with the accent; 'quiet' is a plain text button.
  variant?: 'primary' | 'quiet';
  onClick?: () => void;
  // Carry on through the sequence: the next step, or — on the LAST step — the
  // ordinary end, which runs onDone. Without it an action is an exit that
  // REPLACES onDone, which is what a "this ends the walkthrough and starts
  // something else" button (Save the line) wants.
  advance?: boolean;
}

export interface CoachStep {
  // What to point at. First VISIBLE match wins; a step whose targets are all
  // missing is dropped rather than pointed at nothing.
  selector: string[];
  // A SECOND thing the same spotlight should also cover: the cut-out becomes
  // the box enclosing both. The Explore bubble uses it to light up the panel
  // AND the dock beneath it, because "the controls under the board" is part of
  // what the panel step is describing and a hole that stopped at the panel's
  // bottom edge said the opposite. Missing → the spot is just `selector`'s.
  spanSelector?: string[];
  title: string;
  // A function when the sentence depends on what the user has done by the time
  // the bubble is painted — the last board step asks for a move that may already
  // have been played from the Explore panel.
  body: string | (() => string);
  // Extra room around this target (a small header button wants a bit so the
  // ring doesn't crowd it; a full-width board wants none).
  pad?: number;
  // Replaces the whole footer. An action without `advance` ends the sequence
  // whichever step it's on. Used by the one-off bubbles (the trainer intro),
  // not by the walkthrough itself. An EMPTY array is meaningful: it means "this
  // bubble defines its own footer, and it hasn't got one" — the way a step whose
  // only controls are a mainAction and a corner Skip gets rid of Back/Next.
  actions?: CoachAction[];
  // The quiet way out, in the bubble's top-right corner. The walkthrough puts
  // one on every step but its last; a one-off bubble asks for it here.
  cornerSkip?: () => void;
  // The one thing this step is really asking for — Connect Lichess, Import my
  // games, Save line — as a full-width button above the Back/Next row. It EXITS
  // the walkthrough, because what it opens takes the screen; bringing the
  // walkthrough back is the caller's job.
  mainAction?: { label: string; onClick: () => void; icon?: SVGElement };
  // Shown in the main action's place once its job is done ("Connected").
  mainDone?: string;
  // Run when the step becomes the current one — forwards OR backwards — so it's
  // used to put the screen into the state the step describes (open the panel,
  // rewind the board, switch the engine on).
  onEnter?: () => void;
  // Label for the Next button (the last step's Next is an exit, and sometimes
  // wants naming: "Add more moves").
  nextLabel?: string;
  // Subscribe to something in the app that should advance this step: a move
  // played on the board, the next tab tapped. Return the unsubscribe.
  watch?: (advance: () => void) => () => void;
  // How long to sit on the current bubble after `watch` fires. The default beat
  // lets the thing the user just did finish animating before the bubble moves
  // off it. Zero is for a watch whose event TAKES THE SCREEN — the save button,
  // which starts the trainer — where a bubble that lingers is a bubble sitting
  // on top of the next screen.
  watchDelay?: number;
  // Let taps through to the app underneath. The bubble stays clickable; the
  // rest of the screen is live, so the thing being described can be used while
  // it's being described.
  interactive?: boolean;
  // Live to LOOK at, not to use: taps reach the app (so the panel lists still
  // scroll and the tab strip still switches panels) but every control inside the
  // screen is inert. For a step whose panel is full of moves that play when
  // tapped, this is the difference between reading about the panel and
  // accidentally rewriting the line with it. Implies `interactive`.
  lookOnly?: boolean;
  // Back on the FIRST step, which has no bubble behind it: exits the sequence
  // and hands control back (the first-run picker). Omitted → no Back button.
  onBack?: () => void;
}

// A running sequence, so the caller can drive it from outside — the builder
// walkthrough jumps between steps when the user taps a panel tab.
export interface CoachHandle {
  // Tear the overlay down WITHOUT firing onDone (a caller that's taking over).
  teardown: () => void;
  goToStep: (index: number) => void;
  currentStep: () => number;
  stepCount: number;
}

// Show a sequence of coach-marks. `onDone` fires once, on whatever exit
// happens: the last step's button, Skip, or the back gesture.
export function showCoachMarks(
  steps: CoachStep[],
  onDone: () => void = () => {},
  startAt = 0,
): CoachHandle {
  const all = steps.filter(s => findTarget(s) !== null);
  if (all.length === 0) {
    onDone();
    return { teardown: () => {}, goToStep: () => {}, currentStep: () => 0, stepCount: 0 };
  }

  let index = Math.min(Math.max(0, startAt), all.length - 1);

  const overlay = document.createElement('div');
  overlay.className = 'tour-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', all[index].title);

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

  // The step's own big ask (Connect Lichess, Save line), above the nav row.
  const main = document.createElement('div');
  main.className = 'tour-main';
  bubble.appendChild(main);

  const foot = document.createElement('div');
  foot.className = 'tour-foot';
  bubble.appendChild(foot);

  // Skip sits in the bubble's top-right corner, as a bare word. On its own line
  // under the footer it was a third full-width control competing with Back and
  // Next — three ways out of a bubble whose whole job is to move you to the next
  // one. In the corner it's where a dismiss always is: findable, and not part of
  // the decision.
  const skipRow = document.createElement('div');
  skipRow.className = 'tour-skiprow';
  bubble.appendChild(skipRow);

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
    setLookOnly(false);
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

  // Back one bubble. On the first step it's the sequence's own exit, if the
  // caller gave it one.
  function back(): void {
    if (finished) return;
    if (index === 0) {
      const exit = all[0].onBack;
      if (!exit) return;
      teardown();
      exit();
      return;
    }
    index--;
    paint();
  }

  function goToStep(target: number): void {
    if (finished) return;
    const next = Math.min(Math.max(0, target), all.length - 1);
    if (next === index) return;
    index = next;
    paint();
  }

  function paint(): void {
    const step = all[index];
    const target = findTarget(step);
    if (!target) { finish(); return; }

    dropWatch();
    step.onEnter?.();

    // A live step lets taps reach the app; the bubble keeps its own pointer
    // events so its buttons still work (see the CSS). A look-only step is live
    // too — it just has the app's own controls switched off underneath it.
    overlay.classList.toggle('tour-overlay--live', !!(step.interactive || step.lookOnly));
    setLookOnly(!!step.lookOnly);

    overlay.setAttribute('aria-label', step.title);
    title.textContent = step.title;
    body.textContent = typeof step.body === 'function' ? step.body() : step.body;
    dotEls.forEach((d, i) => d.classList.toggle('tour-dot--on', i === index));

    // The step's big ask, or the pill that says it's already done.
    main.replaceChildren();
    main.hidden = true;
    if (step.mainDone) {
      const pill = document.createElement('div');
      pill.className = 'tour-done';
      pill.textContent = step.mainDone;
      main.appendChild(pill);
      main.hidden = false;
    } else if (step.mainAction) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tour-main-btn';
      if (step.mainAction.icon) btn.appendChild(step.mainAction.icon);
      btn.appendChild(document.createTextNode(step.mainAction.label));
      btn.addEventListener('click', () => {
        const run = step.mainAction!.onClick;
        teardown();
        run();
      });
      main.appendChild(btn);
      main.hidden = false;
    }

    // Rebuild the foot: Back, the dots, then Next — or the step's own actions,
    // for the one-off bubbles that aren't a sequence at all.
    foot.replaceChildren();
    skipRow.replaceChildren();
    const last = index >= all.length - 1;

    // The step's own corner Skip wins; otherwise the walkthrough puts one on
    // every bubble but the last, where there is nothing left to skip.
    if (step.cornerSkip) skipRow.appendChild(cornerSkip(() => { teardown(); step.cornerSkip!(); }));

    if (step.actions) {
      foot.classList.add('tour-foot--actions');
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
      foot.classList.remove('tour-foot--actions');
      // Back on the left, always in the same place — including on the first
      // bubble, where it leaves the walkthrough for the screen before it.
      if (index > 0 || step.onBack) {
        foot.appendChild(actionButton('Back', 'quiet', back));
      } else {
        const spacer = document.createElement('span');
        spacer.className = 'tour-back-spacer';
        foot.appendChild(spacer);
      }
      if (all.length > 1) foot.appendChild(dots);
      foot.appendChild(actionButton(step.nextLabel ?? (last ? 'Got it' : 'Next'), 'primary', advance));
      // Nothing left to skip on the last bubble.
      if (!last && !step.cornerSkip) skipRow.appendChild(cornerSkip(finish));
    }

    // Whatever the step watches for (a move, a tab tap) advances it too. A short
    // beat first, so the thing the user just did finishes animating before the
    // bubble moves off it.
    if (step.watch) {
      const stepIndex = index;
      const beat = step.watchDelay ?? WATCH_BEAT;
      unwatch = step.watch(() => {
        if (finished || index !== stepIndex) return;
        if (beat <= 0) { advance(); return; }
        setTimeout(() => { if (!finished && index === stepIndex) advance(); }, beat);
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

    const want = step.pad ?? SPOT_PAD;
    const r = unionRect(target, step.spanSelector);
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Trim the padding symmetrically when the target sits near an edge, so the
    // ring stays centred on the thing rather than bulging out on the side that
    // happens to have room. (The Save button lives in the top-right corner —
    // padded blindly, its ring hung off to the left of the button.)
    const padX = Math.max(0, Math.min(want, r.left - EDGE_INSET, vw - EDGE_INSET - r.right));
    const padY = Math.max(0, Math.min(want, r.top - EDGE_INSET, vh - EDGE_INSET - r.bottom));

    const left = Math.max(EDGE_INSET, r.left - padX);
    const right = Math.min(vw - EDGE_INSET, r.right + padX);
    const top = Math.max(EDGE_INSET, r.top - padY);
    const bottom = Math.min(vh - EDGE_INSET, r.bottom + padY);
    const height = Math.max(0, bottom - top);

    spot.style.top = `${top}px`;
    spot.style.left = `${left}px`;
    spot.style.width = `${Math.max(0, right - left)}px`;
    spot.style.height = `${height}px`;

    placeBubble(top, height, (left + right) / 2);
  }

  // Put the bubble on whichever side of the spotlight has more room, and point
  // the tail back at it. Measured, not guessed: the board is most of a phone
  // screen, so "always below" would push the bubble off the bottom.
  function placeBubble(spotTop: number, spotHeight: number, spotCentreX: number): void {
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

    // The tail points AT the spotlight, not at the middle of the bubble: a
    // corner button (Save) gets a tail over on its side, which is the whole
    // reason a bubble has a tail.
    const bubbleRect = bubble.getBoundingClientRect();
    const x = spotCentreX - bubbleRect.left;
    const clamped = Math.min(Math.max(x, TAIL_INSET), Math.max(TAIL_INSET, bubbleRect.width - TAIL_INSET));
    tail.style.left = `${clamped}px`;
  }

  document.body.appendChild(overlay);
  paint();
  // The dock can grow (the eval bar), the keyboard can open, the phone can turn.
  window.addEventListener('resize', reposition);
  window.addEventListener('orientationchange', reposition);

  return { teardown, goToStep, currentStep: () => index, stepCount: all.length };
}

// Look-only: one class on #app, and the CSS (see "Coach-marks" in style.css)
// switches off the board, the dock, the header, the nav and every control inside
// the panels — while leaving the panels themselves scrollable and the tab strip
// tappable, which are the two things a look-only step still needs.
function setLookOnly(on: boolean): void {
  document.getElementById('app')?.classList.toggle('tour-lookonly', on);
}

// The bubble's way out: one quiet word in the top-right corner. Shared by the
// walkthrough and the one-off bubbles, so "Skip" is in the same place whichever
// coach-mark is on screen.
function cornerSkip(onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tour-skip tour-skip--corner';
  btn.textContent = 'Skip';
  btn.setAttribute('aria-label', 'Skip');
  btn.addEventListener('click', onClick);
  return btn;
}

function actionButton(label: string, variant: 'primary' | 'quiet', onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = variant === 'primary' ? 'tour-next' : 'tour-skip';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

// The box the spotlight has to cover: the target's own rect, grown to enclose
// the first visible `spanSelector` match too. Two elements that sit one above
// the other (the builder's panel and its dock) give ONE tall hole rather than
// two, which is the only shape a single box-shadow cut-out can paint.
interface SpotRect { left: number; right: number; top: number; bottom: number }

function unionRect(target: HTMLElement, span?: string[]): SpotRect {
  const r = target.getBoundingClientRect();
  const box: SpotRect = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  const extra = span ? findVisible(span) : null;
  if (!extra) return box;
  const e = extra.getBoundingClientRect();
  return {
    left: Math.min(box.left, e.left),
    right: Math.max(box.right, e.right),
    top: Math.min(box.top, e.top),
    bottom: Math.max(box.bottom, e.bottom),
  };
}

// The first selector in the list that resolves to something actually visible.
//
// Measured, not `offsetParent`: the builder's panel sheet is position:fixed, and
// a fixed element's offsetParent is null however plainly visible it is — which
// silently dropped every panel step from the walkthrough. A box with area is on
// screen; a hidden one (or one under a `display: none` ancestor) has none.
function findVisible(selectors: string[]): HTMLElement | null {
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

// What a step points at — the first of its own selectors that is on screen.
function findTarget(step: CoachStep): HTMLElement | null {
  return findVisible(step.selector);
}

// ── Watching the app ─────────────────────────────────────────────────────────

// Fired by the builder whenever the USER plays a move into the line by hand (on
// the board, or by tapping a suggested continuation). Not fired for moves the
// app lays down itself — a line playing itself in isn't the user doing anything.
export const BUILDER_MOVE_EVENT = 'bito:builder-move';

// Fired by Settings → Feedback & about → "Replay walkthrough". main.ts owns the
// actual builder state (the line, the board, the panels), so a leaf screen asks
// for this by event rather than importing main.ts back.
export const REPLAY_WALKTHROUGH_EVENT = 'obertura:replaywalkthrough';

export function notifyBuilderMove(): void {
  document.dispatchEvent(new Event(BUILDER_MOVE_EVENT));
}

function onBuilderMove(advance: () => void): () => void {
  document.addEventListener(BUILDER_MOVE_EVENT, advance);
  return () => document.removeEventListener(BUILDER_MOVE_EVENT, advance);
}

// ── The builder walkthrough ──────────────────────────────────────────────────
//
// SIX BUBBLES, ON AN EMPTY BOARD, AND THAT IS THE WHOLE THING:
//
//   1. the board — play your first move, and watch the answer come back,
//   2. Explore   — where that answer came from,
//   3. Library   — the masters and the online games,
//   4. My lines  — your saved lines and your own games,
//   5. the board again — two more moves,
//   6. Save.
//
// WHAT IT USED TO BE, AND WHY IT ISN'T. The first run began with a form —
// colour, depth, style — that handed the builder a CURATED line, and the
// walkthrough then walked the user through the last two moves of a line
// somebody else had chosen. Eight bubbles, two of them (Line info, Engine) about
// panels a first-timer has no use for yet, one of them an account ask. It taught
// the app and skipped the point: the app is for building YOUR line, and the
// fastest way to understand that is to build one, from move one, on an empty
// board.
//
// So the picker asks one question (which colour) and every walkthrough now runs
// on an empty board. Auto-reply is switched on for it, which is what makes a
// three-move line take three taps: you play your move, the opponent's commonest
// answer appears, you play the next one. The Explore bubble then explains the
// thing that has already visibly happened, rather than describing something the
// user has yet to see.
//
// A pack line opened in the builder no longer triggers this. It gets the
// play-it-in-and-save flow it has always got afterwards — a walkthrough whose
// first instruction is "play your first move" makes no sense on a board that
// already has eight moves on it.

// The panels the walkthrough drives, by name (main.ts owns the real ordering).
// Line info and Engine are still real panels — they just have no bubble, so the
// walkthrough locks their tabs while it runs (see setSideTabsDisabled).
export type TourSlide = 'explore' | 'library' | 'mylines' | 'line' | 'engine';

// Step indices, so a tab tap can jump to the step that describes that tab and a
// Lichess round-trip can come back to the one it left from.
const STEP_BOARD = 0;
const STEP_EXPLORE = 1;
const STEP_LIBRARY = 2;
const STEP_MYLINES = 3;

// Which walkthrough step each panel tab belongs to: tapping a tab moves the
// walkthrough to the bubble that explains it. A tab with no entry here is locked
// while the walkthrough runs, rather than letting a tap land on a panel the
// bubbles never mention.
const TAB_STEPS: Partial<Record<TourSlide, number>> = {
  explore: STEP_EXPLORE,
  library: STEP_LIBRARY,
  mylines: STEP_MYLINES,
};

// Where to resume the walkthrough after a Lichess connect, which redirects the
// whole page away and back. Same shape (and the same 10-minute staleness window)
// as lichess-auth's own stashReturn / takeReturn.
const RESUME_KEY = 'obertura.tourResume';

// How many of the user's OWN moves the "Back to your line" bubble waits for
// before handing over to the save bubble.
const BACK_TO_LINE_MOVES = 2;

export interface TourResume {
  step: number;
  // Where the cursor was sitting in the line, so the board comes back on the
  // same position and not at the end of it.
  cursor?: number;
  // The line's working title, which isn't part of the stashed move list.
  name?: string;
}

function stashTourStep(state: TourResume): void {
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ ...state, t: Date.now() }));
  } catch { /* storage off — we simply won't resume the walkthrough */ }
}

// Consume the stashed step (once). Null if there is none, it's malformed, or
// it's stale (a leftover from a connect the user abandoned).
export function takeTourResume(): TourResume | null {
  return readTourResume(true);
}

// Is a resume waiting, without spending it? The boot sequence asks before
// anything consumes it: a walkthrough that is about to come back owns the
// screen, and the first-run picker — the question that STARTED that walkthrough
// — must not be stacked on top of its bubbles.
export function hasTourResume(): boolean {
  return readTourResume(false) !== null;
}

function readTourResume(consume: boolean): TourResume | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    if (consume) localStorage.removeItem(RESUME_KEY);
    const v = JSON.parse(raw) as TourResume & { t?: number };
    if (typeof v.step !== 'number' || Date.now() - (v.t ?? 0) > 600_000) return null;
    return {
      step: Math.max(0, v.step),
      cursor: typeof v.cursor === 'number' ? v.cursor : undefined,
      name: typeof v.name === 'string' ? v.name : undefined,
    };
  } catch {
    return null;
  }
}

// Is the walkthrough still owed on this device? Callers check before deciding
// how to sequence the builder, then call markBuilderTourSeen once it starts.
//
// `firstRun` is the second chance. On a genuine first run — the picker only
// appears when there are no saved lines and onboarding was never finished —
// someone who SKIPPED the walkthrough last time gets offered it again, because
// "seen for four seconds and dismissed" is not the same as "had their turn".
// Anywhere else (a starter-pack line months later) seen is enough: the
// walkthrough is never forced on someone twice for the same reason.
export function isBuilderTourOwed(o: { firstRun?: boolean } = {}): boolean {
  if (!isBuilderTourSeen()) return true;
  return !!o.firstRun && !isBuilderTourDone();
}

export function markBuilderTourSeen(): void {
  setBuilderTourSeen();
}

// Reached the last bubble — the walkthrough has actually been walked, so it
// stops being offered even on a first run that comes round again.
export function markBuilderTourDone(): void {
  setBuilderTourDone();
}

// Has it ever been walked to the end? The Get-started checklist ticks its
// "Take the walkthrough" row off this.
export function isBuilderTourComplete(): boolean {
  return isBuilderTourDone();
}

// Backing out to the first-run screen: the next pick has to bring the
// walkthrough with it, so the "seen" flag this run set is handed back.
export function unmarkBuilderTourSeen(): void {
  clearBuilderTourSeen();
}

// What the walkthrough's ending tells its caller. `saveOffered` is the one thing
// the caller can't work out for itself: whether the last bubble — the one that
// offers Save — was actually reached. Without it the empty-board first line
// re-arms its own standalone save prompt the instant the walkthrough hands back,
// and someone who has just tapped "Add more moves" is answered by the identical
// bubble a second time.
export interface TourEnd {
  saveOffered: boolean;
}

export interface BuilderIntroDeps {
  // Fires on whatever exit happens — the last step, Skip, or the back gesture.
  onDone: (end: TourEnd) => void;
  // Show a builder carousel slide, so each panel step opens the panel it names.
  showSlide: (id: TourSlide) => void;
  // Back off the FIRST bubble: there's nothing behind it in the builder, so it
  // goes right back to the screen the colour was chosen on.
  onRestart?: () => void;
  /**
   * Switch Explore's auto-reply on (or off).
   *
   * This is what makes the first bubble's promise true. The user plays a move
   * and the opponent's commonest answer comes back on its own, so a first line
   * is three taps rather than six, and — more to the point — nobody has to
   * decide what Black "should" reply on their first minute in a chess app.
   * Left ON afterwards: the walkthrough said out loud that it does this, and its
   * switch is right there on the Explore panel.
   */
  setAutoReply: (on: boolean) => void;
  // Put the cursor at the end of the line for the save step: saving from the
  // middle of a line raises the builder's "save up to here?" nudge, which is a
  // question about an edit the user hasn't made. The first bubble tells people
  // they can step back through their moves, so this is not a rare case.
  goToLineEnd: () => void;
  // "Save line" on the last bubble.
  onSave: () => void;
  // Where the cursor is in the line (ply count), stashed across a Lichess
  // connect so the board comes back on the same position.
  cursorPly?: () => number;
  lineName?: () => string;
  // "Connect Lichess" on the Library step. Redirects the page away and back;
  // the walkthrough stashes where it was first, so it resumes here on return.
  onConnectLichess: () => void;
  // "Import my games" on the My lines step. The import takes the whole screen,
  // so the walkthrough steps aside and the callback brings it back to this very
  // step once the sheet closes — imported or not.
  onImportGames: (resume: () => void) => void;
  isLichessConnected: () => boolean;
  // Are there imported games on the device? The My-lines bubble's "Import my
  // games" becomes a "Games imported" pill once there are.
  hasImportedGames: () => boolean;
  // How many moves of the USER's own are on the line right now — the bar the
  // "two more moves" bubble waits on.
  ownMoveCount: () => number;
  // Start partway in (STEP_LIBRARY) — how the walkthrough picks itself back up
  // after the Lichess round-trip.
  startStep?: number;
}

export function showBuilderIntro(deps: BuilderIntroDeps): void {
  let handle: CoachHandle | null = null;
  // Set the moment the last bubble is painted — see TourEnd.
  let saveOffered = false;

  const done = (): void => {
    setSideTabsDisabled(false);
    dropTabNav();
    deps.onDone({ saveOffered });
  };

  // Leave the walkthrough on screen but hand the screen to something else (the
  // import sheet, the Lichess redirect). No onDone: it isn't over.
  const stepAside = (): void => {
    setSideTabsDisabled(false);
    dropTabNav();
  };

  let dropTabNav: () => void = () => {};

  const launch = (from: number): void => {
    setSideTabsDisabled(true);
    handle = showCoachMarks(
      markDoneOnLastStep(buildSteps(deps, launch, stepAside), () => { saveOffered = true; }),
      done,
      from,
    );
    // Tapping a panel tab moves the WALKTHROUGH to that tab's step — tapping
    // Line goes back to the Line bubble, not just to the Line panel. So the
    // walkthrough is navigable by its own buttons and by the tabs, and by
    // nothing else.
    dropTabNav = watchTabTaps((step) => handle?.goToStep(step));
  };

  launch(deps.startStep ?? 0);
}

// "Done" is reaching the LAST bubble, not surviving to whatever exit fires
// onDone — Skip and the back gesture end the walkthrough too, and neither means
// the user has been through it. So the last step's onEnter records it.
function markDoneOnLastStep(steps: CoachStep[], onReached: () => void): CoachStep[] {
  const last = steps[steps.length - 1];
  if (!last) return steps;
  const before = last.onEnter;
  return [...steps.slice(0, -1), {
    ...last,
    onEnter: () => { before?.(); onReached(); markBuilderTourDone(); },
  }];
}

// Any tab the walkthrough has no bubble for is switched off while it runs,
// rather than letting a tap land on a panel the bubbles never explain.
function setSideTabsDisabled(disabled: boolean): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>('#builder-slide-tabs .slide-tab');
  for (const tab of tabs) {
    const id = tab.dataset.slideId as TourSlide | undefined;
    if (id && TAB_STEPS[id] !== undefined) continue;
    tab.disabled = disabled;
    tab.classList.toggle('slide-tab--locked', disabled);
  }
}

function watchTabTaps(go: (step: number) => void): () => void {
  const strip = document.getElementById('builder-slide-tabs');
  if (!strip) return () => {};
  const onClick = (e: Event): void => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('.slide-tab');
    if (!tab) return;
    const step = TAB_STEPS[tab.dataset.slideId as TourSlide];
    if (step === undefined) return;
    // After the panel has actually swapped, so the bubble lands on the panel
    // it's describing.
    setTimeout(() => go(step), 60);
  };
  strip.addEventListener('click', onClick);
  return () => strip.removeEventListener('click', onClick);
}

function buildSteps(
  deps: BuilderIntroDeps,
  relaunch: (from: number) => void,
  stepAside: () => void,
): CoachStep[] {
  const connected = deps.isLichessConnected();
  const imported = deps.hasImportedGames();
  // The "two more moves" bar, set when that step is entered (see below).
  let movesWanted = Number.POSITIVE_INFINITY;

  return [
    {
      selector: ['#board'],
      title: 'Enter your line',
      body: 'Make your moves on the board to build a line you can train after. '
        + 'You can step back and forward through them at any time to add more. '
        + 'Play your first move!',
      pad: 0,
      // Live, and it advances on a move: the fastest way to learn that the board
      // is yours to play on is to play on it.
      interactive: true,
      watch: onBuilderMove,
      onEnter: () => {
        // Explore has to be the panel on screen for its auto-reply to answer —
        // a board that moved on its own while the user was reading the Library
        // would be a haunting, so the panel only replies while it is showing.
        // Opening it here is also what puts the next bubble's subject on screen
        // before the bubble talks about it.
        deps.setAutoReply(true);
        deps.showSlide('explore');
      },
      onBack: deps.onRestart,
    },
    {
      selector: ['#builder-sheet'],
      // The dock goes inside the same hole. The bubble names auto-reply, and
      // auto-reply's switch is a scroll down the panel — a spotlight that
      // stopped at the panel's bottom edge lit the tiles and hid the one
      // control the sentence is about. Covering panel + dock also says, without
      // a sentence, that everything under the board belongs to this step.
      spanSelector: ['#builder-dock'],
      title: 'Explore',
      body: 'Suggested moves from your games, the library and the engine. '
        + 'Auto-reply plays the suggested answer for you.',
      pad: 4,
      // Look-only, and the panel's own tiles are the reason: every row here
      // PLAYS when tapped, so the panel that taught itself by being used was
      // also the fastest way to put a move down that nobody meant. The only ways
      // on are Next and the tabs.
      lookOnly: true,
      onEnter: () => {
        deps.showSlide('explore');
        // …at the TOP of the panel. The first cut scrolled the auto-reply switch
        // into view, which is a jump on arrival to reach something that is three
        // rows down anyway; from the top the whole of what the bubble describes —
        // the question, the three answers, the switch — is already on screen.
        requestAnimationFrame(() => {
          const panel = document.getElementById('slide-explore');
          if (panel) panel.scrollTop = 0;
        });
      },
    },
    {
      selector: ['#builder-sheet'],
      title: 'Opening Library',
      body: 'Get inspiration from Masters and online players. Connect your free '
        + 'Lichess account to analyze any position. You don’t need to be an '
        + 'active player of Lichess — a free account is enough.',
      pad: 4,
      // Look-only for the same reason as Explore: every book move in this list
      // plays onto the line when tapped.
      lookOnly: true,
      onEnter: () => deps.showSlide('library'),
      mainDone: connected ? 'Lichess connected' : undefined,
      mainAction: connected ? undefined : {
        label: 'Connect Lichess',
        // Come back to THIS step: the redirect reloads the app, and landing
        // back at the start of the walkthrough (or at no walkthrough at all)
        // is how a connect turns into a dead end.
        onClick: () => {
          stashTourStep({
            step: STEP_LIBRARY,
            cursor: deps.cursorPly?.(),
            name: deps.lineName?.(),
          });
          stepAside();
          deps.onConnectLichess();
        },
      },
    },
    {
      selector: ['#builder-sheet'],
      title: 'My lines',
      body: 'See your saved lines, moves you’ve played in your games, and '
        + 'scouted opponents here.',
      pad: 4,
      // Look-only. This panel doesn't just add moves — tapping a saved line
      // OPENS it, which would throw away the line the walkthrough is in the
      // middle of building.
      lookOnly: true,
      onEnter: () => deps.showSlide('mylines'),
      // The same before/after the Library step gives Lichess: once there are
      // games on the device the ask is answered, so the button becomes a pill
      // that says so rather than an invitation to do it again.
      mainDone: imported ? 'Games imported' : undefined,
      mainAction: imported ? undefined : {
        label: 'Import my games',
        onClick: () => {
          stepAside();
          // Imported or cancelled, the walkthrough comes back to this very
          // bubble — the import sheet is a detour, not an exit.
          deps.onImportGames(() => relaunch(STEP_MYLINES));
        },
      },
    },
    {
      // Back to the board. The panels have had their turn; this is where the
      // line actually gets built, and two more moves is enough to have one.
      selector: ['#board'],
      title: 'Back to your line',
      body: 'Play two more moves for now — you can keep adding moves later.',
      pad: 0,
      interactive: true,
      onEnter: () => {
        deps.showSlide('explore');
        // The bar this step is asking for, measured from wherever the line is
        // NOW — re-entering the step (Back, or a tab tap and back again) moves
        // the bar with it rather than counting moves made before it started.
        movesWanted = deps.ownMoveCount() + BACK_TO_LINE_MOVES;
      },
      // It asks for two moves; playing two moves is the answer, so it moves on
      // by itself. Next is still there for anyone who would rather read ahead.
      // Counting the USER's moves, not board events: with auto-reply on, every
      // move of theirs is followed by one of the opponent's, and a raw event
      // count would call one move two.
      watch: (advance) => onBuilderMove(() => {
        if (deps.ownMoveCount() >= movesWanted) advance();
      }),
    },
    {
      selector: ['#header-save', '#save-line-btn'],
      title: 'Ready when you are',
      body: 'Keep playing moves to make the line your own, or save it now to add '
        + 'it to your training repertoire.',
      pad: 8,
      interactive: true,
      onEnter: deps.goToLineEnd,
      // Saving is the big button above; carrying on is a bare word under it.
      // They used to be a primary Next and a primary main action side by side,
      // which asked the user to weigh two equal-looking options on the last
      // bubble of a walkthrough whose entire purpose was getting them to a saved
      // line.
      // stepAside first: saving takes the screen, and without it the walkthrough
      // would leave the panel tabs it locked on the way in still disabled.
      mainAction: { label: 'Save line', onClick: () => { stepAside(); deps.onSave(); } },
      // …and so does the real button under the spotlight. This step is live, so
      // the header's own Save ("Add 6 moves") is tappable — and tapping it saved
      // the line, started the trainer, and left this bubble sitting on top of it,
      // because the walkthrough only ever heard about its OWN button. It hears
      // about both now. No beat before it goes: the screen it is sitting on is
      // already changing.
      watch: (advance) => {
        const btn = findVisible(['#header-save', '#save-line-btn']);
        if (!btn) return () => {};
        const on = (): void => advance();
        btn.addEventListener('click', on);
        return () => btn.removeEventListener('click', on);
      },
      watchDelay: 0,
      // `advance` on the LAST step is the sequence's ordinary end, which runs
      // the walkthrough's own onDone — the tidy-up included. Calling deps.onDone
      // directly (what this used to do) skipped that AND re-armed the standalone
      // save prompt, so "Add more moves" was answered by the same bubble again.
      actions: [{ label: 'Add more moves', variant: 'quiet', advance: true }],
    },
  ];
}

// The save decision on its own, for a line the walkthrough isn't running on: a
// starter-pack line months later, or an empty-board first line that had no
// script to walk through.
//
// Not a "nothing is saved until you press this" warning — that framing tells a
// first-time user the app is fragile, which is both unfriendly and untrue. It's
// a choice between two good outcomes, and both are buttons.
export function showSaveStep(o: { onSave: () => void; onKeepEditing?: () => void }): void {
  showCoachMarks([
    {
      selector: ['#header-save', '#save-line-btn'],
      title: 'Ready when you are',
      body: 'Keep playing moves to make the line your own, or save it now to add '
        + 'it to your training repertoire.',
      pad: 8,
      actions: [
        { label: 'Add more moves', variant: 'quiet', onClick: o.onKeepEditing },
        { label: 'Save line', variant: 'primary', onClick: o.onSave },
      ],
    },
  ]);
}

// The trainer's introduction, on the trainer, over the board it's about to play.
// A coach-mark rather than the dialog this used to be: a card in the middle of
// the screen explains the app, a bubble on the board explains THE BOARD.
//
// "Skip this time" is deliberately quiet and deliberately there: someone who has
// just saved their first line and wants to look around shouldn't have to sit
// through a run to get into the app.
export function showTrainerIntro(o: { onStart: () => void; onSkip: () => void }): void {
  showCoachMarks([
    {
      selector: ['.pt-board', '.pt-board-wrap'],
      title: 'Saved. Now learn it.',
      body: 'Watch the line played once, then repeat it from memory. You get two '
        + 'attempts before the move is revealed. Bito Chess tracks your mistakes '
        + 'so you can master them.',
      pad: 0,
      // The Train tab's own bolt on the button that starts training, so the
      // thing about to happen is named with the mark it lives under in the app.
      mainAction: { label: 'Start training', onClick: o.onStart, icon: Icons.zap(17) },
      // One thing to do and one quiet way out of it, in the same corner the
      // walkthrough's Skip sits in — so "Skip" is in one place in the app.
      actions: [],
      cornerSkip: o.onSkip,
    },
  ], o.onStart);
}
