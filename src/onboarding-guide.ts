// The coach strip for the guided first line.
//
// Three short beats, and then it gets out of the way. It rides INSIDE the
// builder's bottom dock (#builder-dock), which is the one place in the builder
// that is already allowed to change height — the engine's eval bar slides open
// there and the sheet re-lays out around it. Sitting in the dock means the strip
// works unchanged in both builder layouts (fixed to the bottom of the phone
// screen, docked under the board on desktop) and, crucially, never covers the
// board. A coach that can swallow a move is worse than no coach.
//
// The beats advance on a timer, but ANY move the user plays jumps straight to
// the last one — someone who has already started editing doesn't need to be told
// they're allowed to.

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
    'Happy with it? Save the line.',
  ];

  let index = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;

  const strip = document.createElement('div');
  strip.className = 'guide-strip';
  strip.setAttribute('role', 'status');
  strip.setAttribute('aria-live', 'polite');

  const text = document.createElement('p');
  text.className = 'guide-strip-text';
  strip.appendChild(text);

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
    // Re-trigger the entry animation on each new beat.
    strip.classList.remove('guide-strip--in');
    void strip.offsetWidth;
    strip.classList.add('guide-strip--in');
    if (index === beats.length - 1) highlightSave(true);
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
    if (destroyed || index === beats.length - 1) return;
    if (timer) clearTimeout(timer);
    index = beats.length - 1;
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
