// The coach strip for the guided first line.
//
// Three short beats, and then it stops talking — but it does NOT get out of the
// way, because the last beat is the one that matters: the line only becomes real
// when it's saved, and a user who never presses Save leaves with nothing.
//
// It rides INSIDE the builder's bottom dock (#builder-dock), which is the one
// place in the builder that is already allowed to change height — the engine's
// eval bar slides open there and the sheet re-lays out around it. Sitting in the
// dock means the strip works unchanged in both builder layouts (fixed to the
// bottom of the phone screen, docked under the board on desktop) and, crucially,
// never covers the board. A coach that can swallow a move is worse than no coach.
//
// The beats advance on a timer, but ANY move the user plays jumps straight to
// the last one — someone who has already started editing doesn't need to be told
// they're allowed to.
//
// THE LAST BEAT is a call to action, not a caption. It used to be the sentence
// "Happy with it? Save the line." in the same quiet grey as the other two, with
// a faint pulse on a Save button somewhere off in the header — which is to say,
// invisible. Now the strip itself turns accent-coloured and grows its OWN Save
// button, right where the user's thumb already is. The header pulse stays as a
// second pointer, for anyone who looks up.

import { setOnboardingComplete } from './prefs';

// How long each beat holds before the next one takes over. Slow enough to read
// twice, short enough that a fast user isn't waiting on us.
const BEAT_MS = [4500, 5000];

// The controls the last beat points at. Both are "Save" — the header button on
// the phone, the panel row inside the Line slide — so whichever is visible
// picks up the pulse.
const SAVE_SELECTORS = ['#header-save', '#save-line-btn'];

export interface GuideDeps {
  // The opening's name, as resolved for this cut.
  openingName: string;
  // How many moves the user actually has to remember.
  ownMoves: number;
  // "Skip this" — leave for Train, onboarding done.
  onSkip: () => void;
  // The strip's own Save button. Runs the builder's normal save.
  onSave: () => void;
  // Skip the two informational beats and open on the closing call to action.
  // Set when the walkthrough (onboarding-tour.ts) has just run: it named the
  // line and said you can change it, so repeating both here is nine seconds of
  // the user being told what they were told.
  startAtCta?: boolean;
  // Called after the strip mounts or unmounts, so the builder can re-measure
  // the dock and re-lay the sheet (same thing the eval bar's toggle does).
  onLayoutChange: () => void;
}

export interface GuideHandle {
  // The user played a move of their own: jump to the closing beat.
  noteUserMove(): void;
  destroy(): void;
}

export function mountFirstLineGuide(deps: GuideDeps): GuideHandle {
  const dock = document.getElementById('builder-dock');
  if (!dock) {
    // No dock means no builder on screen — nothing to coach against. Hand back
    // an inert handle so callers never have to null-check.
    return { noteUserMove: () => {}, destroy: () => {} };
  }

  const beats = [
    `This is the ${deps.openingName}. `
      + `${deps.ownMoves} move${deps.ownMoves === 1 ? '' : 's'} for you to remember.`,
    'Play a different move any time to make it yours.',
    // Names BOTH ways forward. The strip is the moment the line stops being
    // something that happened to the user and starts being a decision, and
    // "keep playing" is a real answer — the board stays live behind it.
    'Keep playing with it, or save it and train it.',
  ];
  const lastBeat = beats.length - 1;

  let index = deps.startAtCta ? lastBeat : 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;

  const strip = document.createElement('div');
  strip.className = 'guide-strip';
  strip.setAttribute('role', 'status');
  strip.setAttribute('aria-live', 'polite');

  const text = document.createElement('p');
  text.className = 'guide-strip-text';
  strip.appendChild(text);

  // The closing beat's own Save. Hidden until then — an "are you done?" button
  // offered before the user has looked at the line is just noise.
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'guide-strip-save';
  save.textContent = 'Save the line';
  save.hidden = true;
  save.addEventListener('click', () => deps.onSave());
  strip.appendChild(save);

  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'guide-strip-skip';
  skip.textContent = 'Skip this';
  skip.addEventListener('click', () => {
    // Skipping still counts as having been through the first run — we asked, and
    // they answered. Re-showing the picker on the next launch would be nagging.
    setOnboardingComplete();
    destroy();
    deps.onSkip();
  });
  strip.appendChild(skip);

  // Above the eval bar and the button row, so the strip reads as a header on the
  // dock rather than something wedged between the controls.
  dock.prepend(strip);

  function paint(): void {
    text.textContent = beats[index];
    const closing = index === lastBeat;
    // Re-trigger the entry animation on each new beat.
    strip.classList.remove('guide-strip--in');
    void strip.offsetWidth;
    strip.classList.add('guide-strip--in');
    strip.classList.toggle('guide-strip--cta', closing);
    save.hidden = !closing;
    if (closing) {
      highlightSave(true);
      // The dock just grew a button row — the sheet has to be re-measured, the
      // same way it is when the strip first mounts.
      deps.onLayoutChange();
    }
  }

  function schedule(): void {
    if (index >= BEAT_MS.length) return;
    timer = setTimeout(() => {
      if (destroyed) return;
      index++;
      paint();
      schedule();
    }, BEAT_MS[index]);
  }

  function goToLastBeat(): void {
    if (destroyed || index === lastBeat) return;
    if (timer) clearTimeout(timer);
    index = lastBeat;
    paint();
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    if (timer) clearTimeout(timer);
    highlightSave(false);
    strip.remove();
    deps.onLayoutChange();
  }

  paint();
  schedule();
  deps.onLayoutChange();

  return { noteUserMove: goToLastBeat, destroy };
}

// Pulse the Save control(s) so the closing beat has something to point at.
function highlightSave(on: boolean): void {
  for (const selector of SAVE_SELECTORS) {
    document.querySelector(selector)?.classList.toggle('guide-attention', on);
  }
}
