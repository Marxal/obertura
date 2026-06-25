// The setup wizard — a focused, full-screen flow shown once, right after the
// intro finishes (and replayable from Settings → "Replay setup"). It mirrors the
// Beta survey's full-screen shape (header with step dots · scrollable body ·
// pinned footer) rather than a small bottom sheet, so each choice gets room to
// breathe. Each step is a real choice, not another pitch slide:
//   1. Move notation
//   2. Theme + board colour + piece set
//   3. Connect to Lichess, or skip
//   4. Import your games, or skip
//   5. "You're all set up" — the hand-off to adding lines / training
//
// Steps 1-2 write straight to the same prefs Settings → Appearance uses, via the
// exact same controls (segmented / boardSwatches / pieceSwatches / buildThemeRow),
// so there's nothing to "save" — every choice already lives wherever it always has.
//
// Step 3's Connect does a full-page OAuth redirect away and back, which reloads
// the app and loses this page's in-memory step. We stash which step we were on
// before redirecting (obertura.wizardStep, a tiny JSON blob with a 10-minute
// staleness window — the same pattern lichess-auth.ts uses for stashReturn /
// takeReturn, just wizard-local) so the wizard reopens at the import step instead
// of restarting from step 1.

import { Icons } from './icons';
import { pushBack } from './back-nav';
import {
  segmented,
  boardSwatches,
  buildThemeRow,
  pieceSwatches,
} from './settings-screen';
import { getMoveNotation, setMoveNotation, type MoveNotation } from './notation';
import { getBoardColour, setBoardColour, getPieceSet, setPieceSet } from './appearance';
import { isConnected, connect, LICHESS_CONNECT_BLURB } from './lichess-auth';
import { openImportPanel } from './import-panel';

const WIZARD_SEEN_KEY = 'obertura.wizardSeen';
const WIZARD_STEP_KEY = 'obertura.wizardStep';
const STEP_COUNT = 5;
const CONNECT_STEP = 2;
const IMPORT_STEP = 3;
const ALLSET_STEP = 4;

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
  // How many games the in-wizard import pulled in (null until it runs). Drives the
  // import step's success state, so importing confirms in place instead of jumping.
  let importedCount: number | null = null;

  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay edit-overlay--full wizard-overlay';

  function close(): void {
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(() => {
    // The system back gesture steps back one screen, closing at the first.
    if (step <= 0) close();
    else { step--; render(); }
  });

  function finish(): void {
    try { localStorage.removeItem(WIZARD_STEP_KEY); } catch { /* storage off */ }
    markWizardSeen();
    close();
    opts.onFinish();
  }

  function render(): void {
    overlay.innerHTML = '';
    overlay.appendChild(buildPage(step, importedCount, {
      onBack: () => { step--; render(); },
      onNext: () => { step++; render(); },
      onConnect: () => {
        // Resume on THIS step after the OAuth round-trip, so the connect screen
        // can confirm success in place rather than skipping ahead.
        stashStep(CONNECT_STEP);
        void connect();
      },
      onImport: () => {
        // A successful import confirms in place (success + game count) rather than
        // bailing out of setup — the user taps Continue to move on.
        openImportPanel({ onImported: (count) => { importedCount = count; render(); } });
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

function buildPage(step: number, importedCount: number | null, actions: StepActions): HTMLElement {
  const page = document.createElement('div');
  page.className = 'edit-sheet edit-sheet--full survey-page wizard-page';

  // ── Header: step dots ──
  const header = document.createElement('div');
  header.className = 'survey-header wizard-header';
  const dots = document.createElement('div');
  dots.className = 'intro-dots wizard-dots';
  for (let i = 0; i < STEP_COUNT; i++) {
    const dot = document.createElement('span');
    dot.className = 'intro-dot' + (i === step ? ' is-active' : '');
    dots.appendChild(dot);
  }
  header.appendChild(dots);
  page.appendChild(header);

  // ── Body: the step's content, centred in the screen (the theme step is the one
  // tall step, so it top-aligns and scrolls if it has to). ──
  const body = document.createElement('div');
  body.className = 'survey-body wizard-body' + (step === 1 ? ' wizard-body--top' : '');
  if (step === 0) body.appendChild(buildNotationStep());
  else if (step === 1) body.appendChild(buildThemeStep());
  else if (step === CONNECT_STEP) body.appendChild(buildConnectStep(actions.onConnect));
  else if (step === IMPORT_STEP) body.appendChild(buildImportStep(importedCount, actions.onImport));
  else body.appendChild(buildAllSetStep());
  page.appendChild(body);

  // ── Footer: a primary advance button (when the step has one), plus discrete
  // Back / Skip links styled like the survey's. Opt-in steps carry their own
  // full-width CTA in the body, so the only way forward there is the discrete
  // Skip — no competing primary. Once a step has succeeded (Lichess connected,
  // games imported) it stops being opt-in and the primary Continue returns. ──
  const connected = isConnected();
  const imported = importedCount !== null;
  const isOptIn = (step === CONNECT_STEP && !connected) || (step === IMPORT_STEP && !imported);

  const footer = document.createElement('div');
  footer.className = 'survey-footer';

  if (!isOptIn) {
    const primary = document.createElement('button');
    primary.type = 'button';
    primary.className = 'btn-primary survey-next';
    primary.textContent = step === ALLSET_STEP ? 'Start with Obertura' : 'Continue';
    primary.addEventListener('click', step === ALLSET_STEP ? actions.onFinish : actions.onNext);
    footer.appendChild(primary);
  }

  const links = document.createElement('div');
  links.className = 'survey-foot-links';
  if (step > 0) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'survey-skip';
    back.textContent = 'Back';
    back.addEventListener('click', actions.onBack);
    links.appendChild(back);
  }
  if (isOptIn) {
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'survey-skip';
    skip.textContent = 'Skip';
    skip.addEventListener('click', actions.onNext);
    links.appendChild(skip);
  }
  footer.appendChild(links);
  page.appendChild(footer);

  return page;
}

// The shared step header: an optional accent icon disc (intro-style), a big
// centred title, then one or more body paragraphs. The icon is omitted on the
// theme step (it's visual enough on its own, and the room is better spent
// keeping every control on one screen).
function stepHeading(title: string, body: string, icon?: SVGElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'wizard-step-head';
  if (icon) {
    const disc = document.createElement('div');
    disc.className = 'wizard-step-icon';
    disc.setAttribute('aria-hidden', 'true');
    disc.appendChild(icon);
    wrap.appendChild(disc);
  }
  const h = document.createElement('h3');
  h.className = 'edit-sheet-title wizard-title';
  h.textContent = title;
  wrap.appendChild(h);
  for (const para of body.split('\n\n')) {
    const p = document.createElement('p');
    p.className = 'section-desc wizard-body-text';
    p.textContent = para;
    wrap.appendChild(p);
  }
  return wrap;
}

function buildNotationStep(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'survey-step wizard-step';
  wrap.appendChild(stepHeading(
    'How should moves look?',
    'Pick how moves are written everywhere in the app — you can change this later in Settings.',
    Icons.list(40),
  ));
  wrap.appendChild(segmented<MoveNotation>(
    [
      { value: 'standard', label: 'Nf3', sublabel: 'Classic notation' },
      { value: 'figurine', label: '♞f3', sublabel: 'Emoji notation' },
    ],
    getMoveNotation(),
    (v) => setMoveNotation(v),
    { fullWidth: true },
  ));
  return wrap;
}

function buildThemeStep(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'survey-step wizard-step';
  wrap.appendChild(stepHeading(
    'Pick a look',
    'You can always change this later in Settings.',
  ));
  wrap.appendChild(buildThemeRow());
  const boardUI = boardSwatches(getBoardColour(), (v) => setBoardColour(v));
  wrap.appendChild(boardUI.element);
  wrap.appendChild(pieceSwatches(getPieceSet(), (v) => setPieceSet(v)));
  return wrap;
}

function buildConnectStep(onConnect: () => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'survey-step wizard-step';

  // After the OAuth round-trip we resume here connected — confirm it in place
  // (a success header) and let the footer's Continue carry on.
  if (isConnected()) {
    wrap.appendChild(stepHeading(
      'Connected to Lichess',
      'You’ve unlocked the live opening library, a stronger engine, and the ' +
        'Lichess puzzle dashboard. Tap Continue.',
      Icons.checkCircle(40),
    ));
    wrap.classList.add('wizard-step--success');
    return wrap;
  }

  wrap.appendChild(stepHeading('Unlock Features with Lichess', LICHESS_CONNECT_BLURB, Icons.link(40)));

  const cta = document.createElement('button');
  cta.type = 'button';
  cta.className = 'btn-primary settings-connect-btn wizard-cta';
  cta.appendChild(Icons.link(16));
  cta.appendChild(document.createTextNode('Connect to Lichess'));
  cta.addEventListener('click', onConnect);
  wrap.appendChild(cta);

  return wrap;
}

function buildImportStep(importedCount: number | null, onImport: () => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'survey-step wizard-step';

  // Imported already — confirm in place with the game count; the footer's
  // Continue moves on to the closing step.
  if (importedCount !== null) {
    const games = `${importedCount} game${importedCount === 1 ? '' : 's'}`;
    wrap.appendChild(stepHeading(
      'Games imported',
      `We pulled in ${games}. We'll use them to suggest the openings you actually ` +
        'play when you build your first lines.',
      Icons.checkCircle(40),
    ));
    wrap.classList.add('wizard-step--success');
    return wrap;
  }

  wrap.appendChild(stepHeading(
    'Start with Your Own Games',
    'Pull your recent games from Chess.com or Lichess to see which openings you ' +
      'actually play — it doesn\'t require login, only your username.',
    Icons.download(40),
  ));

  const cta = document.createElement('button');
  cta.type = 'button';
  cta.className = 'btn-primary settings-connect-btn wizard-cta';
  cta.appendChild(Icons.download(16));
  cta.appendChild(document.createTextNode('Import my games'));
  cta.addEventListener('click', onImport);
  wrap.appendChild(cta);

  return wrap;
}

function buildAllSetStep(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'survey-step wizard-step';
  wrap.appendChild(stepHeading(
    'You’re all set up',
    'Add at least 5 lines to unlock training — we recommend keeping around 10 ' +
      'active. Enter them yourself, grab a ready-made starter pack, or get ' +
      'recommendations built from the games you just imported.',
    Icons.sparkles(40),
  ));
  return wrap;
}
