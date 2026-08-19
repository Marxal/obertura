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
// TWO PHASES. Under TRAINING_UNLOCK_LINES saved lines it's the GOAL panel: it
// takes the daily challenge's slot outright, because a user with no repertoire
// has no use for a daily challenge, and it leads with the line goal, its bar and
// the routes to moving it. At three lines the goal block drops away, the daily
// card takes its slot back, and what's left — the checklist — rides underneath
// it. The remaining items are the ones that matter most and are easiest to put
// off, so they don't get to vanish just because the training lock opened.
//
// HOW IT ENDS. Two ways, and neither is "after N lines":
//   · A discrete × hides it FOR THIS SESSION (sessionStorage). Offered only in
//     the second phase — in the first there is nothing to dismiss it into.
//   · It retires for good once the user has an account or has installed the app.
//     Those are the two steps that actually change what the app can do for them;
//     past either one, a to-do list is nagging.
//
// WHAT IT ASKS FOR. In the goal phase the line goal is not one item among four —
// it is the whole point, and everything else is optional. So it gets the top of
// the card, the bar, and the two real routes to a line as a pair of primary
// buttons (Build a line · Starter packs) with the engine as a discrete link
// under them; the rest are quiet checklist rows underneath:
//   · install    — Android only, and only in a browser tab. One tap, no
//                  explanation: people know what installing an app is.
//   · games      — import from Chess.com / Lichess; feeds suggestions, the
//                  mistake scan, endgames, statistics, scouting
//   · Lichess    — the connection that unlocks the live explorer, the puzzle
//                  dashboard and a stronger engine
//   · an account — the only thing that survives losing the phone
//
//   · the walkthrough — the builder coach-marks, on demand. First in the list
//                  and always there, ticked off once it's been walked: the
//                  walkthrough is offered once during the first run, and someone
//                  who skipped it then and came back later needs a way back to
//                  it that isn't buried in Settings.
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
import { isEntitled } from './entitlement';
import { isBuilderTourComplete } from './onboarding-tour';
import { TRAINING_UNLOCK_LINES } from './training-goal';

// The three-line goal lives in training-goal.ts — a leaf module, so the daily
// challenge can have the number without dragging this file's browser
// dependencies (auth, Supabase, the install gate) into the headless self-tests.
// Re-exported here because this panel is where it is most obviously about.
export { TRAINING_UNLOCK_LINES, trainingLockReason } from './training-goal';

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
  onGoPro: () => void;
  // "Take the walkthrough" — the builder coach-marks, on demand. The one row
  // here that isn't a setup step: it's the second chance for whoever skipped the
  // walkthrough on their first visit and came back later wondering what any of
  // this is. (Settings → Feedback & about has the same thing, for after this
  // panel has retired.)
  onWalkthrough: () => void;
  // The × was tapped: the caller re-renders, and shouldShowFirstSteps now says
  // no for the rest of the session.
  onHide: () => void;
}

// Hidden for THIS browsing session only. sessionStorage, deliberately: closing
// the app and coming back is a new session and a fair moment to ask again, but
// tapping through the app in one sitting shouldn't bring the panel back.
const HIDDEN_KEY = 'obertura.firstStepsHidden';

function hiddenThisSession(): boolean {
  try { return sessionStorage.getItem(HIDDEN_KEY) === '1'; } catch { return false; }
}

export function hideFirstSteps(): void {
  try { sessionStorage.setItem(HIDDEN_KEY, '1'); } catch { /* storage off */ }
}

// Retired for good: the user has an account or has installed the app. Both are
// steps that change what the app can actually do for them, and past either one a
// standing to-do list is nagging rather than helping.
function retired(): boolean {
  return !!getAuthUser() || isAppInstalled();
}

// Whether the panel belongs on screen at all. Exported so the caller can decide
// between this and the daily-challenge card without building either first.
export function shouldShowFirstSteps(): boolean {
  return !retired() && !hiddenThisSession();
}

// Does it take the daily challenge's slot outright, or ride underneath it? The
// goal phase owns the slot; past the unlock the daily card comes back and this
// becomes a compact checklist below it.
export function firstStepsOwnsSlot(lineCount: number): boolean {
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
  // that changes how the app itself behaves. Only shown when there's a real
  // install prompt in hand (see canInstallApp), so tapping it always installs;
  // there is no instructions fallback behind this row.
  if (canInstallApp()) {
    steps.push({
      icon: Icons.download(18),
      title: 'Install the app',
      body: 'Put Bito Chess on your home screen.',
      done: false,
      onClick: deps.onInstallApp,
    });
  }

  // The walkthrough, first — before the connect-this, import-that rows. Someone
  // still looking at this panel is someone the app hasn't explained itself to
  // yet, and this is the row that does the explaining. It never disappears once
  // taken; it just ticks off, because re-running it is a perfectly reasonable
  // thing to want.
  steps.push({
    icon: Icons.play(18),
    title: 'Take the walkthrough',
    body: 'A guided tour of the builder — the board, the panels, and how a line '
      + 'gets saved. About a minute.',
    done: isBuilderTourComplete(),
    onClick: deps.onWalkthrough,
  });

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
      title: getAuthUser() ? 'Account created' : 'Create a free account',
      body: 'Your lines and progress follow you to any phone you sign in on.',
      done: !!getAuthUser(),
      onClick: deps.onSignIn,
    });
  }

  // Which phase: the goal panel, or the compact checklist that rides under the
  // daily card once training has unlocked.
  const showGoal = firstStepsOwnsSlot(lines);

  // The line goal counts as one step, done or not, so the "N of M" in the header
  // matches the rows the user can actually see.
  const total = steps.length + 1;
  const doneCount = steps.filter(s => s.done).length
    + (lines >= TRAINING_UNLOCK_LINES ? 1 : 0);

  const card = document.createElement('div');
  card.className = 'card first-steps' + (showGoal ? '' : ' first-steps--compact');

  // ── Head: the title, how far through the list they are, and (past the goal)
  //    the way out ──
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

  // Deliberately tiny, and only in the second phase — in the first there is
  // nothing to dismiss the panel INTO. Hiding lasts for the session; the panel
  // only goes for good once there's an account or an install (see retired()).
  if (!showGoal) {
    const hide = document.createElement('button');
    hide.type = 'button';
    hide.className = 'first-steps-hide';
    hide.setAttribute('aria-label', 'Hide until next time');
    hide.title = 'Hide for now';
    hide.appendChild(Icons.close(15));
    hide.addEventListener('click', () => { hideFirstSteps(); deps.onHide(); });
    head.appendChild(hide);
  }

  card.appendChild(head);

  // ── The line goal: the hero of the first phase ──
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

  // The two real routes to a line, side by side and equally weighted: building
  // one by hand is what the app IS, and taking a starter pack is the fastest way
  // to clear the training lock. Neither is the recommendation.
  const routes = document.createElement('div');
  routes.className = 'first-steps-routes';
  routes.appendChild(routeButton('Build a line', Icons.plus(18), deps.onBuildLine));
  routes.appendChild(routeButton('Starter packs', Icons.build(18), deps.onPickStarterPack));
  goal.appendChild(routes);

  // Sparring the engine is a third way in, but it's a game first and a line
  // second — a discrete link under the pair rather than a peer of them.
  const engine = document.createElement('button');
  engine.type = 'button';
  engine.className = 'first-steps-engine';
  engine.appendChild(Icons.gamepad(15));
  const engineLabel = document.createElement('span');
  engineLabel.textContent = 'Or build one against the engine';
  engine.appendChild(engineLabel);
  engine.addEventListener('click', deps.onBuildWithEngine);
  goal.appendChild(engine);

  if (showGoal) card.appendChild(goal);

  // ── The remaining steps, as a checklist ──
  const list = document.createElement('div');
  list.className = 'first-steps-list';
  for (const step of steps) list.appendChild(buildStep(step));
  card.appendChild(list);

  // ── Go pro ──
  // Last, and only for someone who isn't already entitled. It's an offer, not a
  // to-do, so it isn't a checklist row and never counts toward the tally.
  if (!isEntitled()) {
    const pro = document.createElement('button');
    pro.type = 'button';
    pro.className = 'first-steps-pro';
    pro.appendChild(Icons.sparkles(16));
    const proLabel = document.createElement('span');
    proLabel.textContent = 'Go pro';
    pro.appendChild(proLabel);
    pro.addEventListener('click', deps.onGoPro);
    card.appendChild(pro);
  }

  return card;
}

function routeButton(label: string, icon: SVGElement, onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-primary first-steps-route';
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
