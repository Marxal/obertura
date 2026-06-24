// The setup wizard — a focused 4-step flow shown once, right after the intro
// finishes (and replayable from Settings → "Replay setup"). Each step is a real
// choice rather than another pitch slide:
//   1. Move notation
//   2. Theme + board colour
//   3. Connect to Lichess, or skip
//   4. Import your games, or skip
//
// Steps 1-2 write straight to the same prefs Settings → Appearance uses, via the
// exact same controls (segmented / boardSwatches / buildThemeRow), so there's
// nothing to "save" — every choice already lives wherever it always has.
//
// Step 3's Connect does a full-page OAuth redirect away and back, which reloads
// the app and loses this sheet's in-memory step. We stash which step we were on
// before redirecting (obertura.wizardStep, a tiny JSON blob with a 10-minute
// staleness window — the same pattern lichess-auth.ts uses for stashReturn /
// takeReturn, just wizard-local) so the wizard reopens at step 4 instead of
// restarting from step 1.

import { Icons } from './icons';
import { pushBack } from './back-nav';
import { segmented, boardSwatches, buildThemeRow } from './settings-screen';
import { getMoveNotation, setMoveNotation, type MoveNotation } from './notation';
import { getBoardColour, setBoardColour } from './appearance';
import { isConnected, connect } from './lichess-auth';
import { openImportPanel } from './import-panel';

const WIZARD_SEEN_KEY = 'obertura.wizardSeen';
const WIZARD_STEP_KEY = 'obertura.wizardStep';
const STEP_COUNT = 4;

export function hasSeenWizard(): boolean {
  try {
    return localStorage.getItem(WIZARD_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markWizardSeen(): void {
  try { localStorage.setItem(WIZARD_SEEN_KEY, '1'); } catch { /* storage off */ }
}

// Stash the step to resume at before a Lichess OAuth redirect away from the app.
function stashStep(step: number): void {
  try {
    localStorage.setItem(WIZARD_STEP_KEY, JSON.stringify({ step, t: Date.now() }));
  } catch { /* storage blocked/full — we simply won't resume mid-wizard */ }
}

// Consume the stashed step (once). Null if there is none, it's malformed, or
// it's stale (> 10 min — a leftover from a connect the user abandoned).
function takeStashedStep(): number | null {
  try {
    const raw = localStorage.getItem(WIZARD_STEP_KEY);
    if (!raw) return null;
    localStorage.removeItem(WIZARD_STEP_KEY);
    const v = JSON.parse(raw) as { step?: number; t?: number };
    if (typeof v.step !== 'number' || Date.now() - (v.t ?? 0) > 600_000) return null;
    return Math.max(0, Math.min(STEP_COUNT - 1, v.step));
  } catch {
    return null;
  }
}

// True right after the app reboots mid-wizard (after a Lichess OAuth redirect).
// Peeks without consuming, so the boot sequence can decide whether to resume the
// wizard before the wizard itself consumes the marker.
export function wizardStepPending(): boolean {
  try {
    return localStorage.getItem(WIZARD_STEP_KEY) !== null;
  } catch {
    return false;
  }
}

export interface WizardOptions {
  onFinish: () => void;
}

export function showOnboardingWizard(opts: WizardOptions): void {
  let step = takeStashedStep() ?? 0;

  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';

  function close(): void {
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  function finish(): void {
    try { localStorage.removeItem(WIZARD_STEP_KEY); } catch { /* storage off */ }
    markWizardSeen();
    close();
    opts.onFinish();
  }

  function render(): void {
    overlay.innerHTML = '';
    overlay.appendChild(buildSheet(step, {
      onBack: () => { step--; render(); },
      onNext: () => { step++; render(); },
      onConnect: () => {
        stashStep(STEP_COUNT - 1);
        void connect();
      },
      onImport: () => {
        openImportPanel({ onImported: () => finish() });
      },
      onFinish: finish,
    }));
  }

  document.body.appendChild(overlay);
  render();
}

interface StepActions {
  onBack: () => void;
  onNext: () => void;
  onConnect: () => void;
  onImport: () => void;
  onFinish: () => void;
}

function buildSheet(step: number, actions: StepActions): HTMLElement {
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet wizard-sheet';

  const dots = document.createElement('div');
  dots.className = 'intro-dots wizard-dots';
  for (let i = 0; i < STEP_COUNT; i++) {
    const dot = document.createElement('span');
    dot.className = 'intro-dot' + (i === step ? ' is-active' : '');
    dots.appendChild(dot);
  }
  sheet.appendChild(dots);

  if (step === 0) sheet.appendChild(buildNotationStep());
  else if (step === 1) sheet.appendChild(buildThemeStep());
  else if (step === 2) sheet.appendChild(buildConnectStep(actions.onConnect));
  else sheet.appendChild(buildImportStep(actions.onImport));

  const btnRow = document.createElement('div');
  btnRow.className = 'edit-btn-row';

  if (step > 0) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'edit-cancel-btn';
    back.textContent = 'Back';
    back.addEventListener('click', actions.onBack);
    btnRow.appendChild(back);
  }

  // Steps 0-1 are plain preferences — "Next" carries you forward regardless.
  // Steps 2-3 are opt-in (Lichess, import), each with its own CTA above, so the
  // shared continue button reads "Skip" there instead — unless step 2 already
  // found an existing connection, in which case there's nothing left to skip.
  const isOptIn = step >= 2 && !(step === 2 && isConnected());
  const cont = document.createElement('button');
  cont.type = 'button';
  cont.className = isOptIn ? 'btn-secondary' : 'btn-primary';
  cont.textContent = isOptIn ? 'Skip' : 'Next';
  cont.addEventListener('click', step < STEP_COUNT - 1 ? actions.onNext : actions.onFinish);
  btnRow.appendChild(cont);

  sheet.appendChild(btnRow);
  return sheet;
}

function stepHeading(title: string, body: string): HTMLElement {
  const wrap = document.createElement('div');
  const h = document.createElement('h3');
  h.className = 'edit-sheet-title';
  h.textContent = title;
  wrap.appendChild(h);
  for (const para of body.split('\n\n')) {
    const p = document.createElement('p');
    p.className = 'section-desc';
    p.textContent = para;
    wrap.appendChild(p);
  }
  return wrap;
}

function buildNotationStep(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.appendChild(stepHeading(
    'How should moves look?',
    'Pick how moves are written everywhere in the app — you can change this later in Settings.',
  ));
  wrap.appendChild(segmented<MoveNotation>(
    [{ value: 'standard', label: 'Nf3' }, { value: 'figurine', label: '♞f3' }],
    getMoveNotation(),
    (v) => setMoveNotation(v),
    { fullWidth: true },
  ));
  return wrap;
}

function buildThemeStep(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.appendChild(stepHeading(
    'Pick a look',
    'You can always change this later in Settings.',
  ));
  wrap.appendChild(buildThemeRow());
  const boardUI = boardSwatches(getBoardColour(), (v) => setBoardColour(v));
  wrap.appendChild(boardUI.element);
  return wrap;
}

function buildConnectStep(onConnect: () => void): HTMLElement {
  const wrap = document.createElement('div');

  if (isConnected()) {
    wrap.appendChild(stepHeading('Connected to Lichess', 'You\'re all set — tap Next to continue.'));
    return wrap;
  }

  wrap.appendChild(stepHeading(
    'Connect to Lichess?',
    'It unlocks the live opening Library for every position, and the Lichess puzzle ' +
      'dashboard — your rating, and it skips puzzles you\'ve already seen.\n\n' +
      'It\'s free, reads no personal data, and puzzles work fine either way — even a ' +
      'throwaway account works.',
  ));

  const cta = document.createElement('button');
  cta.type = 'button';
  cta.className = 'btn-primary settings-connect-btn';
  cta.appendChild(Icons.compass(16));
  cta.appendChild(document.createTextNode('Connect to Lichess'));
  cta.addEventListener('click', onConnect);
  wrap.appendChild(cta);

  return wrap;
}

function buildImportStep(onImport: () => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.appendChild(stepHeading(
    'Import your games?',
    'Pull your recent games from Chess.com or Lichess to see which openings you actually play.',
  ));

  const cta = document.createElement('button');
  cta.type = 'button';
  cta.className = 'btn-primary settings-connect-btn';
  cta.appendChild(Icons.download(16));
  cta.appendChild(document.createTextNode('Import my games'));
  cta.addEventListener('click', onImport);
  wrap.appendChild(cta);

  return wrap;
}
