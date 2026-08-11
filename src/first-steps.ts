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
// It shows while fewer than GOAL_LINES lines are saved and disappears on its own
// at five — at which point the daily challenge takes the slot back. There's no
// dismiss button, because there is nothing to dismiss it INTO: a user with no
// lines has no other use for the screen.
//
// WHAT IT ASKS FOR, in order of how much it matters:
//   1. lines      — the only one that's really required, with the three routes
//                   to getting some (packs, by hand, against the engine)
//   2. games      — import from Chess.com / Lichess; feeds suggestions, the
//                   mistake scan, endgames, statistics, scouting
//   3. Lichess    — the connection that unlocks the live explorer, the puzzle
//                   dashboard and a stronger engine
//   4. an account — the only thing that survives losing the phone
//
// Two and three both come with genuine payoffs, which is exactly why they're
// offered HERE rather than sprung on the user at the moment they're needed. The
// account ask is last and never nags: it's a row in a checklist, and it only
// exists in a build that has accounts at all.

import { Icons } from './icons';
import { isConnected as lichessIsConnected } from './lichess-auth';
import { isSupabaseConfigured } from './supabase';
import { getAuthUser } from './auth';

// Lines that make this panel step aside. Training itself unlocks at the FIRST
// line (onboarding-starter.ts's ONBOARDING_GOAL) — five is the point at which a
// repertoire has enough in it that a daily rotation means something, so it's the
// goal the bar counts toward, not a second lock.
export const GOAL_LINES = 5;

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
}

// Whether the panel belongs on screen at all. Exported so the caller can decide
// between this and the daily-challenge card without building either first.
export function shouldShowFirstSteps(lineCount: number): boolean {
  return lineCount < GOAL_LINES;
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

  const steps: Step[] = [
    {
      icon: Icons.download(18),
      title: 'Import your games',
      body: 'From Chess.com or Lichess — the app then knows which openings you actually play.',
      done: deps.gameCount > 0,
      onClick: deps.onImportGames,
    },
    {
      icon: Icons.link(18),
      title: 'Connect Lichess',
      body: 'Unlocks the live opening explorer, your puzzle history and a stronger engine. Free, and no personal data.',
      done: lichessIsConnected(),
      onClick: deps.onConnectLichess,
    },
  ];

  // Only where accounts exist. The internal GitHub Pages build ships without
  // Supabase, so there is nothing to sign into and the row would be a dead end.
  if (isSupabaseConfigured) {
    steps.push({
      icon: Icons.userCircle(18),
      title: getAuthUser() ? 'Account created' : 'Create an account',
      body: 'Your lines live on this phone. An account keeps a copy, so they follow you to a new one.',
      done: !!getAuthUser(),
      onClick: deps.onSignIn,
    });
  }

  // The line goal counts as one step, done or not, so the "N of M" in the header
  // matches the rows the user can actually see.
  const total = steps.length + 1;
  const doneCount = steps.filter(s => s.done).length + (lines >= GOAL_LINES ? 1 : 0);

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

  // ── The line goal: the bar, the count, and the three ways to move it ──
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
  goalCount.textContent = `${lines} / ${GOAL_LINES}`;
  goalHead.appendChild(goalCount);
  goal.appendChild(goalHead);

  const bar = document.createElement('div');
  bar.className = 'first-steps-bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(GOAL_LINES));
  bar.setAttribute('aria-valuenow', String(Math.min(lines, GOAL_LINES)));
  const fill = document.createElement('div');
  fill.className = 'first-steps-bar-fill';
  fill.style.width = `${Math.min(1, lines / GOAL_LINES) * 100}%`;
  bar.appendChild(fill);
  goal.appendChild(bar);

  // Say what the number MEANS, and say it honestly: one line already unlocks
  // training (it's due tomorrow, and the loop works), five is what makes the
  // daily rotation feel like a repertoire rather than a single card.
  const left = GOAL_LINES - lines;
  const goalNote = document.createElement('p');
  goalNote.className = 'first-steps-goal-note';
  goalNote.textContent = lines === 0
    ? 'Save one line to unlock training. Five make a starter repertoire.'
    : left === 1
      ? 'Training is unlocked. One more line makes a starter repertoire.'
      : `Training is unlocked. ${left} more lines make a starter repertoire.`;
  goal.appendChild(goalNote);

  const routes = document.createElement('div');
  routes.className = 'first-steps-routes';
  routes.appendChild(routeButton('Starter packs', Icons.build(16), deps.onPickStarterPack));
  routes.appendChild(routeButton('Build a line', Icons.plus(16), deps.onBuildLine));
  routes.appendChild(routeButton('With the engine', Icons.zap(16), deps.onBuildWithEngine));
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
