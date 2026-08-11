// "Get started" — the to-do panel that sits at the top of Train until the user
// has a repertoire worth training.
//
// WHY IT EXISTS. The first-run picker (onboarding-picker.ts) gets a visitor to
// one saved line in under a minute, but it can be backed out of — the system
// back gesture, a mis-tap on "Import them", a reload at the wrong moment — and
// whoever does that lands on a Train hub with nothing on it and no idea what the
// app wanted from them. This panel is that missing instruction sheet, and it's
// deliberately the loudest thing on the screen: an accent-washed card with a
// progress bar, above the tabs, where the daily challenge normally sits.
//
// It shows while fewer than TRAINING_UNLOCK_LINES lines are saved and disappears
// on its own at three — the same number that unlocks training, so the panel and
// the lock tell one story instead of two. There's no dismiss button, because
// there is nothing to dismiss it INTO: a user with no lines has no other use for
// the screen.
//
// WHAT IT ASKS FOR. The line goal is not one item among four — it is the whole
// point, and everything else is optional. So it gets the top of the card, the
// bar, and a full-width primary button ("Build a line"); the rest are quiet
// checklist rows underneath:
//   · install    — Android only, and only in a browser tab. One tap, no
//                  explanation: people know what installing an app is.
//   · games      — import from Chess.com / Lichess; feeds suggestions, the
//                  mistake scan, endgames, statistics, scouting
//   · Lichess    — the connection that unlocks the live explorer, the puzzle
//                  dashboard and a stronger engine
//   · an account — the only thing that survives losing the phone
//
// The middle two come with genuine payoffs, which is why they're offered HERE
// rather than sprung on the user at the moment they're needed. The account ask
// is last and never nags: it's a row in a checklist, and it only exists in a
// build that has accounts at all.

import { Icons } from './icons';
import { isConnected as lichessIsConnected } from './lichess-auth';
import { isSupabaseConfigured } from './supabase';
import { getAuthUser } from './auth';
import { canInstallApp, isAppInstalled } from './gate';

// The number of SAVED lines that unlocks training, and the goal this panel's bar
// counts toward. They're deliberately the same number.
//
// Why three and not one: training with a single line is a party trick, not a
// habit. The scheduler shows you the one thing you already know, declares you
// finished, and the whole loop the app is built around never gets a chance to
// look like anything. Three lines is the smallest rotation where a session has
// some variety in it and "due today" means something. It's still small enough to
// reach in one sitting — a starter pack alone clears it.
export const TRAINING_UNLOCK_LINES = 3;

// Why training is greyed out below the goal, for the Train screen's mode cards.
export function trainingLockReason(lineCount: number): string {
  const left = Math.max(0, TRAINING_UNLOCK_LINES - lineCount);
  return lineCount === 0
    ? `Save ${TRAINING_UNLOCK_LINES} lines to unlock training`
    : `${left} more line${left === 1 ? '' : 's'} to unlock training`;
}

export interface FirstStepsDeps {
  // How many lines are SAVED (not how many are in training) — the panel is about
  // having material at all, and a paused line is still material.
  lineCount: number;
  gameCount: number;
  onPickStarterPack: () => void;
  onBuildLine: () => void;
  onBuildWithEngine: () => void;
  onImportGames: () => void;
  onConnectLichess: () => void;
  onSignIn: () => void;
  onInstallApp: () => void;
}

// Whether the panel belongs on screen at all. Exported so the caller can decide
// between this and the daily-challenge card without building either first.
export function shouldShowFirstSteps(lineCount: number): boolean {
  return lineCount < TRAINING_UNLOCK_LINES;
}

interface Step {
  icon: SVGElement;
  title: string;
  body: string;
  done: boolean;
  onClick: () => void;
}

export function renderFirstSteps(deps: FirstStepsDeps): HTMLElement {
  const lines = Math.max(0, deps.lineCount);

  const steps: Step[] = [];

  // Install first, when it applies — it's the shortest row here and the only one
  // that changes how the app itself behaves. Never shown once installed, and
  // never on a browser that can't do it (see canInstallApp).
  if (canInstallApp() && !isAppInstalled()) {
    steps.push({
      icon: Icons.download(18),
      title: 'Install the app',
      body: 'Put Bito Chess on your home screen.',
      done: false,
      onClick: deps.onInstallApp,
    });
  }

  steps.push({
    icon: Icons.download(18),
    title: 'Import your games',
    body: 'From Chess.com or Lichess — the app then knows which openings you actually play.',
    done: deps.gameCount > 0,
    onClick: deps.onImportGames,
  });

  steps.push({
    icon: Icons.link(18),
    title: 'Connect Lichess',
    body: 'Unlocks the live opening explorer, your puzzle history and a stronger engine. Free, and no personal data.',
    done: lichessIsConnected(),
    onClick: deps.onConnectLichess,
  });

  // Only where accounts exist. The internal GitHub Pages build ships without
  // Supabase, so there is nothing to sign into and the row would be a dead end.
  if (isSupabaseConfigured) {
    steps.push({
      icon: Icons.userCircle(18),
      title: getAuthUser() ? 'Account created' : 'Create an account',
      body: 'Saves your progress, so it survives this phone.',
      done: !!getAuthUser(),
      onClick: deps.onSignIn,
    });
  }

  // The line goal counts as one step, done or not, so the "N of M" in the header
  // matches the rows the user can actually see.
  const total = steps.length + 1;
  const doneCount = steps.filter(s => s.done).length
    + (lines >= TRAINING_UNLOCK_LINES ? 1 : 0);

  const card = document.createElement('div');
  card.className = 'card first-steps';

  // ── Head: the title and how far through the list they are ──
  const head = document.createElement('div');
  head.className = 'first-steps-head';

  const title = document.createElement('span');
  title.className = 'first-steps-title';
  title.textContent = 'Get started';
  head.appendChild(title);

  const tally = document.createElement('span');
  tally.className = 'first-steps-tally';
  tally.textContent = `${doneCount} of ${total} done`;
  head.appendChild(tally);

  card.appendChild(head);

  // ── The line goal: the hero of this card ──
  const goal = document.createElement('div');
  goal.className = 'first-steps-goal';

  const goalHead = document.createElement('div');
  goalHead.className = 'first-steps-goal-head';
  const goalTitle = document.createElement('span');
  goalTitle.className = 'first-steps-goal-title';
  goalTitle.textContent = 'Save your first lines';
  goalHead.appendChild(goalTitle);
  const goalCount = document.createElement('span');
  goalCount.className = 'first-steps-goal-count';
  goalCount.textContent = `${lines} / ${TRAINING_UNLOCK_LINES}`;
  goalHead.appendChild(goalCount);
  goal.appendChild(goalHead);

  const bar = document.createElement('div');
  bar.className = 'first-steps-bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(TRAINING_UNLOCK_LINES));
  bar.setAttribute('aria-valuenow', String(Math.min(lines, TRAINING_UNLOCK_LINES)));
  const fill = document.createElement('div');
  fill.className = 'first-steps-bar-fill';
  fill.style.width = `${Math.min(1, lines / TRAINING_UNLOCK_LINES) * 100}%`;
  bar.appendChild(fill);
  goal.appendChild(bar);

  // Say what the number MEANS: it's the training lock, not an arbitrary target.
  const left = TRAINING_UNLOCK_LINES - lines;
  const goalNote = document.createElement('p');
  goalNote.className = 'first-steps-goal-note';
  goalNote.textContent = lines === 0
    ? `Training unlocks at ${TRAINING_UNLOCK_LINES} lines. A starter pack gets you there in one go.`
    : left === 1
      ? 'One more line and training unlocks.'
      : `${left} more lines and training unlocks.`;
  goal.appendChild(goalNote);

  // The big one. Building a line by hand is the thing this app IS, so it's the
  // full-width primary; the other two ways in sit under it as quiet chips.
  const build = document.createElement('button');
  build.type = 'button';
  build.className = 'btn-primary first-steps-build';
  build.appendChild(Icons.plus(18));
  build.appendChild(document.createTextNode('Build a line'));
  build.addEventListener('click', deps.onBuildLine);
  goal.appendChild(build);

  const routes = document.createElement('div');
  routes.className = 'first-steps-routes';
  routes.appendChild(routeButton('Starter packs', Icons.build(16), deps.onPickStarterPack));
  routes.appendChild(routeButton('Play the engine', Icons.gamepad(16), deps.onBuildWithEngine));
  goal.appendChild(routes);

  card.appendChild(goal);

  // ── The remaining steps, as a checklist ──
  const list = document.createElement('div');
  list.className = 'first-steps-list';
  for (const step of steps) list.appendChild(buildStep(step));
  card.appendChild(list);

  return card;
}

function routeButton(label: string, icon: SVGElement, onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'first-steps-route';
  btn.appendChild(icon);
  const text = document.createElement('span');
  text.textContent = label;
  btn.appendChild(text);
  btn.addEventListener('click', onClick);
  return btn;
}

// One checklist row. A done row still opens — importing more games or switching
// account is a perfectly reasonable thing to want — it just stops shouting.
function buildStep(step: Step): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'first-steps-step' + (step.done ? ' first-steps-step--done' : '');

  const mark = document.createElement('span');
  mark.className = 'first-steps-step-icon';
  mark.appendChild(step.done ? Icons.checkCircle(18) : step.icon);
  row.appendChild(mark);

  const text = document.createElement('span');
  text.className = 'first-steps-step-text';
  const title = document.createElement('span');
  title.className = 'first-steps-step-title';
  title.textContent = step.title;
  text.appendChild(title);
  const body = document.createElement('span');
  body.className = 'first-steps-step-body';
  body.textContent = step.body;
  text.appendChild(body);
  row.appendChild(text);

  const chev = document.createElement('span');
  chev.className = 'first-steps-step-chev';
  chev.setAttribute('aria-hidden', 'true');
  chev.appendChild(Icons.chevronRight(16));
  row.appendChild(chev);

  row.addEventListener('click', step.onClick);
  return row;
}
