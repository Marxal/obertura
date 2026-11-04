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
// WHAT IT ASKS FOR. In the goal phase the line goal is not one item among several
// — it is the whole point, and everything else is optional. So it gets the top of
// the card, the bar, and the two fastest routes to a line as a pair of primary
// buttons: your games (import them, or pick from them once they're here) and the
// starter packs. The rest are quiet checklist rows underneath:
//   · install    — Android only, and only in a browser tab. One tap, no
//                  explanation: people know what installing an app is.
//   · an account — the only thing that survives losing the phone
//   · games      — past the goal only, as the way to add more
//   · the walkthrough — "Build a line by hand", the one way to the builder here
//
// Connecting Lichess is not a row any more (UX-AUDIT 2.4.2). It only helps someone
// already using the explorer, and the builder's Library panel and Settings offer
// it in the place it means something.

import { Icons } from './icons';
import { isSupabaseConfigured } from './supabase';
import { getAuthUser } from './auth';
import { canInstallApp, isAppInstalled } from './gate';
import { isEntitled } from './entitlement';
import { isBuilderTourComplete } from './onboarding-tour';
import { TRAINING_UNLOCK_LINES } from './training-goal';
import { hasEnoughGames } from './onboarding-recap';
import { t } from './i18n';

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
  onImportGames: () => void;
  // Games are on the device already: choose lines from them again, no re-import.
  onPickFromGames: () => void;
  // Lines are saved and training has unlocked: start a session.
  onStartTraining: () => void;
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

// Set for the rest of this session when first run has just finished. See
// firstStepsOwnsSlot for why.
const JUST_ONBOARDED_KEY = 'obertura.justOnboarded';

/**
 * Mark that first run has just completed, so the checklist leads the hub for the
 * rest of this session.
 *
 * The games-first run can hand someone four saved lines in a single tap, which
 * puts them past TRAINING_UNLOCK_LINES before they have seen the app at all —
 * so the rule below handed the slot straight to the daily challenge, and their
 * first ever view of the hub was a challenge about lines they had owned for
 * three seconds. The checklist is what a brand-new user actually needs there
 * ("import your games", "connect Lichess", "create an account"), so it keeps
 * the slot for this session however many lines arrived.
 *
 * sessionStorage, not local: it is about THIS visit, and a returning user is
 * not new any more.
 */
export function noteJustOnboarded(): void {
  try { sessionStorage.setItem(JUST_ONBOARDED_KEY, '1'); } catch { /* storage off */ }
}

function justOnboarded(): boolean {
  try { return sessionStorage.getItem(JUST_ONBOARDED_KEY) === '1'; } catch { return false; }
}

// Does it take the daily challenge's slot outright, or ride underneath it? The
// goal phase owns the slot; past the unlock the daily card comes back and this
// becomes a compact checklist below it.
export function firstStepsOwnsSlot(lineCount: number): boolean {
  return justOnboarded() || lineCount < TRAINING_UNLOCK_LINES;
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
      title: t('steps.install.title'),
      body: t('steps.install.body'),
      done: false,
      onClick: deps.onInstallApp,
    });
  }

  // ── THE ORDER FOLLOWS WHAT FIRST RUN ALREADY DID ──────────────────────────
  //
  // This panel was written when everyone arrived here with an empty app, so it
  // led with the builder walkthrough. Most people now reach it having already
  // imported their games and saved four lines (onboarding-where.ts →
  // onboarding-recap-screen.ts), which ticks the import row off before they
  // have seen the panel at all.
  //
  // So the account leads instead. It is the only row that protects what they
  // just made, and the only one whose absence loses work — everything else
  // adds something. Rows they have already done still appear, ticked: a
  // checklist that hides its finished items reads as a shorter list of things
  // undone rather than as progress.

  // Only where accounts exist. The internal GitHub Pages build ships without
  // Supabase, so there is nothing to sign into and the row would be a dead end.
  if (isSupabaseConfigured) {
    steps.push({
      icon: Icons.userCircle(18),
      title: getAuthUser() ? t('steps.account.done') : t('common.createAccount'),
      body: getAuthUser()
        ? t('signup.lead.signup')
        : t('steps.account.body'),
      done: !!getAuthUser(),
      onClick: deps.onSignIn,
    });
  }

  // Which phase: the goal panel, or the compact checklist that rides under the
  // daily card once training has unlocked.
  const showGoal = firstStepsOwnsSlot(lines);
  const unlocked = lines >= TRAINING_UNLOCK_LINES;
  const hasGames = deps.gameCount > 0;
  // Fewer than this and the openings screen has nothing honest to say.
  const canPickFromGames = hasEnoughGames(deps.gameCount);

  // "Add openings you play", not "Import your games": the import is the
  // mechanism, and this row should name what the user GETS from it. Under the goal
  // the goal's own first button is this same offer, and two ways to one thing
  // read as two different things.
  if (unlocked) {
    steps.push({
      icon: Icons.download(18),
      title: t('steps.games.title'),
      body: t('steps.games.body'),
      done: hasGames,
      onClick: deps.onImportGames,
    });
  }

  // The ONE way to the builder on this card (UX-AUDIT 2.4.1). Never ticked off:
  // it's how a second line gets built too, and a struck-through row reads as
  // something that can't be done again. So it opens the walkthrough until that has
  // been walked, and the builder itself after (Settings can still replay the tour).
  const walked = isBuilderTourComplete();
  steps.push({
    icon: Icons.play(18),
    title: t('steps.build.title'),
    body: walked
      ? t('steps.build.walked')
      : t('steps.build.tour'),
    done: false,
    onClick: walked ? deps.onBuildLine : deps.onWalkthrough,
  });

  // The line goal counts as one step, done or not, so the "N of M" in the header
  // matches the rows the user can actually see.
  const total = steps.length + 1;
  const doneCount = steps.filter(s => s.done).length + (unlocked ? 1 : 0);

  const card = document.createElement('div');
  card.className = 'card first-steps' + (showGoal ? '' : ' first-steps--compact');

  // ── Head: the title, how far through the list they are, and (past the goal)
  //    the way out ──
  const head = document.createElement('div');
  head.className = 'first-steps-head';

  const title = document.createElement('span');
  title.className = 'first-steps-title';
  title.textContent = t('steps.title');
  head.appendChild(title);

  const tally = document.createElement('span');
  tally.className = 'first-steps-tally';
  tally.textContent = t('steps.tally', { done: doneCount, total });
  head.appendChild(tally);

  // Deliberately tiny, and only in the second phase — in the first there is
  // nothing to dismiss the panel INTO. Hiding lasts for the session; the panel
  // only goes for good once there's an account or an install (see retired()).
  if (!showGoal) {
    const hide = document.createElement('button');
    hide.type = 'button';
    hide.className = 'first-steps-hide';
    hide.setAttribute('aria-label', t('steps.hideLabel'));
    hide.title = t('steps.hide');
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
  goalTitle.textContent = t(unlocked ? 'steps.goal.ready' : 'steps.goal.save');
  goalHead.appendChild(goalTitle);
  const goalCount = document.createElement('span');
  goalCount.className = 'first-steps-goal-count';
  // Past the goal the bar has said what it had to. A fresh import can land here
  // with five lines, and "5 / 3" over a full bar is a sum, not a state.
  if (!unlocked) {
    goalCount.textContent = `${lines} / ${TRAINING_UNLOCK_LINES}`;
    goalHead.appendChild(goalCount);
  }
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
  if (!unlocked) goal.appendChild(bar);

  // Say what the number is FOR, as something to do rather than a rule. Under the
  // goal this used to read "-2 more lines and training unlocks" for anyone a fresh
  // import had just taken past it, which is most people.
  const left = TRAINING_UNLOCK_LINES - lines;
  const goalNote = document.createElement('p');
  goalNote.className = 'first-steps-goal-note';
  goalNote.textContent = unlocked
    ? t('steps.note.ready', { n: lines })
    : lines === 0
      ? t('steps.note.first', { n: TRAINING_UNLOCK_LINES })
      : t('steps.note.more', { n: left });
  goal.appendChild(goalNote);

  const routes = document.createElement('div');
  routes.className = 'first-steps-routes';
  if (unlocked) {
    routes.appendChild(routeButton(t('firstRun.startTraining'), Icons.zap(18), deps.onStartTraining));
  } else {
    // The two fastest routes to a line. Their own openings come first when
    // there's any way to reach them, because that's where the app is at its best.
    routes.appendChild(canPickFromGames
      ? routeButton(t('steps.route.pick'), Icons.download(18), deps.onPickFromGames)
      : routeButton(t('tour.lines.import'), Icons.download(18), deps.onImportGames));
    routes.appendChild(routeButton(t('starter.title'), Icons.build(18), deps.onPickStarterPack));
  }
  goal.appendChild(routes);

  // "Or build one against the engine" used to sit here — a third way in that was
  // a game first and a line second. Auto-reply on the builder's Explore slide
  // does the same job in the place a line is actually built, so the whole
  // sparring feature went and this link with it.

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
    proLabel.textContent = t('pro.get');
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
