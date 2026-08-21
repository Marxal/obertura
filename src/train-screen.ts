import type { Line } from './types';
import type { MoveNode } from './tree';
import { getAllLines, getLine, saveLine } from './storage';
import {
  startDrill, startPositionsDrill, startTimedDrill,
  type DrillOptions, type DivertChoice,
} from './drill';
import { positionIndex } from './position-index';
import { siblingCredits, applyReviewAt, judgeOtherLineMove } from './train-index';
import { selectIndividualPositions, selectTimedPositions } from './individual';
import { planRepertoireRun, runSavingNote, type RunPlan, type RunPosition } from './repertoire-run';
import { getAllRepertoires, saveRepertoire } from './storage';
import { locateLine } from './lines-view';
import { PRIORITY_SPACING } from './scheduler';
import type { Repertoire } from './repertoire';
import { Icons } from './icons';
import {
  getTimedBest,
  recordTimedBest,
  getDefaultTrainingMode,
  setOnboardingComplete,
  TIMED_DURATIONS,
  type TimedMinutes,
} from './prefs';
import { isOpponentTag } from './scout';
import { recordMissedMove, clearForgottenMove } from './forgotten-moves';
import { startFixIt } from './fix-it';
import {
  chronicCount,
  shouldAskForNote,
  shouldOfferFix,
  markNoteAskedAt,
} from './struggle';
import { openMoveNoteSheet } from './note-sheet';
import { openPositionPeek, type PeekAction } from './position-peek';
import { renderForgottenSection } from './forgotten-section';
import { lineTrainingCount } from './stats';
import { lineMastered } from './line-status';
import { formatMove } from './notation';
import { Chess } from 'chess.js';
import { ONBOARDING_GOAL } from './onboarding-starter';
import { TRAINING_UNLOCK_LINES, trainingLockReason } from './first-steps';
import { TrainingSession, type SessionItem } from './session';
import { countUp } from './count-up';
import type { Review } from './scheduler';
import {
  userMoveNodes,
  gradeReview,
  lineSpacing,
  newReview,
  qualityFromMisses,
  lineConfidence,
  dueLines,
  describeDue,
  recentlyAddedLines,
  weakestLines,
} from './scheduler';
import {
  recordTrainingDay,
  recordReviewed,
  reviewedToday,
  recordReviewOutcome,
} from './streak';
import type { TaskOutcome } from './daily-recap';
import { renderLoadError } from './load-error';
import { lineFinalFen } from './card-position';
import { burstConfetti, starfall, celebratePawn } from './confetti';
import { pushBack } from './back-nav';
import { openInfoSheet, buildInfoButton } from './info-sheet';
import { showToast } from './toast';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// How the quiet "view line" icon opens a line (in the builder, to step through
// it). An optional atFen opens the builder at that position (used by the drill's
// in-session "Edit" control). Set on every screen entry; held at module scope so
// the many internal doRender(container) calls — which only pass the container —
// keep working.
let onViewLine: ((line: Line, atFen?: string) => void) | null = null;

// The empty-state route: open the builder on a fresh line. Module scope for the
// same reason as onViewLine.
let onBuildLine: (() => void) | null = null;

// Show/hide the global FAB (wired from main.ts, which owns the controller). The
// finish screens hide it so its ＋ doesn't sit over the celebration; the train
// list restores it. Navigating away resets it via the router, so a stale-hidden
// FAB can't leak onto other tabs.
let setFabVisible: ((visible: boolean) => void) | null = null;

// One missed spot worth revisiting at the end of a session: the position to
// show, the move that should have been played there, and the opponent's move
// that led into it (so the mistakes-retry drill can replay it, matching how the
// individual-moves drill shows the position in context).
interface Mistake {
  preFen: string;
  expected: MoveNode;
  prevUci?: string;   // the opponent's move into preFen
  prevFen?: string;   // the position the opponent moved from
}

// Add a missed position to the review list, de-duplicated by position + answer
// (the same move can be missed twice — e.g. across timed laps — but is only
// worth reviewing once).
function addMistake(
  list: Mistake[],
  keys: Set<string>,
  preFen: string,
  expected: MoveNode,
  prelude?: { prevUci?: string; prevFen?: string },
): void {
  const key = preFen + ' ' + expected.uci;
  if (keys.has(key)) return;
  keys.add(key);
  list.push({ preFen, expected, prevUci: prelude?.prevUci, prevFen: prelude?.prevFen });
}

// ── Credit shared work once (TRANSPOSITIONS.md §8) ──────────────────────────────
//
// A move is a move. If six of my lines all play 3.Bc4 in this position, drilling
// it in one of them has trained it in all six — so the record that grading just
// produced is copied to every other line playing THAT MOVE from THAT POSITION.
// Without it the same move is drilled six times over and its schedule is
// nonsense.
//
// Keyed on position AND move together: a different move from the same position
// is different knowledge and is never touched (drilling the Scandinavian
// main-line answer must not credit the surprise weapon filed at the same spot).
// User moves only — an opponent reply carries no review record.
//
// The index is used purely as a lookup ("which line, which ply"); each credited
// line is then re-read from storage, written and saved. Nothing is written
// through the index's live nodes, so a drill needs no hold on it, and a
// write-through can never resurrect a stale copy of a line the session changed
// some other way (pausing it mid-drill, say).

interface MoveCredit {
  preFen: string;
  uci: string;
  review: Review;
}

async function writeThroughCredits(credits: MoveCredit[], fromLineId: string): Promise<void> {
  if (credits.length === 0) return;
  const index = await positionIndex();

  // lineId → the writes it needs. One line can share several of these moves, and
  // it should be read and saved once, not once per move.
  const plan = new Map<string, { ply: number; uci: string; review: Review }[]>();
  for (const c of credits) {
    for (const e of siblingCredits(index, c.preFen, c.uci, fromLineId)) {
      const write = { ply: e.ply, uci: e.uci, review: c.review };
      const list = plan.get(e.lineId);
      if (list) list.push(write);
      else plan.set(e.lineId, [write]);
    }
  }

  for (const [lineId, writes] of plan) {
    const line = await getLine(lineId);
    if (!line) continue;
    let changed = false;
    for (const w of writes) {
      if (applyReviewAt(line, w.ply, w.uci, w.review)) changed = true;
    }
    if (!changed) continue; // the line moved on since the index was built
    // Confidence is a pure function of the records we just changed, so leaving
    // it stale would misreport a line that IS now known. lastTrained and
    // timesTrained are deliberately NOT touched: the user didn't sit down with
    // this line, and nothing here counts as a second review — that is the whole
    // point of crediting shared work once.
    line.confidence = lineConfidence(line);
    await saveLine(line);
  }
}

// Write-throughs run one at a time. Two positions in the same sitting can credit
// the SAME other line, and two overlapping read-modify-writes would lose one.
let creditChain: Promise<void> = Promise.resolve();

function queueWriteThrough(credits: MoveCredit[], fromLineId: string): Promise<void> {
  creditChain = creditChain
    .then(() => writeThroughCredits(credits, fromLineId))
    .catch(() => { /* a failed credit must never break the session */ });
  return creditChain;
}

// ── Screen entry point ──────────────────────────────────────────────────────────

export function renderTrainScreen(
  container: HTMLElement,
  opts: {
    focusLineId?: string;
    autoStart?: boolean;
    onOpenLine?: (line: Line, atFen?: string) => void;
    onBuildLine?: () => void;
    onSetFabVisible?: (visible: boolean) => void;
  } = {},
): void {
  onViewLine = opts.onOpenLine ?? null;
  onBuildLine = opts.onBuildLine ?? null;
  setFabVisible = opts.onSetFabVisible ?? null;
  void doRender(container, opts.focusLineId, opts.autoStart);
}

async function doRender(
  container: HTMLElement,
  focusLineId?: string,
  autoStart?: boolean,
): Promise<void> {
  // Leaving any finish screen lands back here ("Close training" / "Save &
  // close"), so this is where the FAB the completion panel hid comes back.
  setFabVisible?.(true);
  container.innerHTML = '<p class="lines-loading">Loading…</p>';
  let allLines: Line[];
  let books: Repertoire[];
  try {
    [allLines, books] = await Promise.all([getAllLines(), getAllRepertoires()]);
  } catch (err) {
    renderLoadError(container, err, () => void doRender(container, focusLineId, autoStart));
    return;
  }
  container.innerHTML = '';

  const trainingLines = allLines.filter(l => l.inTraining);

  // No first-run gate any more. This screen used to swap itself for a full-page
  // onboarding view until ONBOARDING_GOAL lines were in training, which meant
  // anyone who backed out of the first-run picker never saw the app at all —
  // they got a second onboarding screen instead. The Get-started checklist
  // (first-steps.ts, above the tabs) now does that job while the real hub stays
  // visible underneath it, with every Practise mode honestly greyed out until
  // there's something to drill.
  //
  // The completion flag is still stamped once the goal is reached, because
  // shouldShowFirstRun() reads it to decide whether the picker has had its turn.
  if (trainingLines.length >= ONBOARDING_GOAL) setOnboardingComplete();

  // TRAINING IS LOCKED until TRAINING_UNLOCK_LINES lines are saved. A session
  // built from one line isn't a session — it shows you the thing you just
  // learned, declares you finished, and teaches the user that the loop they came
  // for is trivial. So the Practise menu greys out and the due hero stays away
  // until there's a rotation worth rotating; the Get-started panel above the tabs
  // (which shows over exactly the same range) says how many are left.
  //
  // What is NOT locked: the confirm run a line goes through when it's saved, and
  // the Drill button on a specific line elsewhere in the app. Both are "run this
  // one line", asked for by name — the lock is about the hub offering a session.
  const trainingLocked = allLines.length < TRAINING_UNLOCK_LINES;

  // Arrived here from a "Drill" button on another screen: skip the list and
  // drill that one line straight away. When it finishes, the completion panel's
  // "Back to training" returns to the normal (unfocused) Train screen.
  if (focusLineId) {
    const focus = trainingLines.find(l => l.id === focusLineId);
    if (focus) {
      const session = new TrainingSession([focus], { explicit: true });
      runSession(session, container, makeStats());
      return;
    }
  }

  const due = dueLines(trainingLines);

  // Arrived from the Home screen's "Start training": jump straight into a session
  // built from the user's default training mode (Settings), rather than showing
  // the list first. Falls through to the list when the chosen mode has nothing to
  // drill (e.g. "Due now" with nothing due — so the "all caught up" header shows).
  if (autoStart && !trainingLocked) {
    const lines = linesForDefaultMode(trainingLines, due);
    if (lines) {
      startRounds(lines, container, { explicit: true });
      return;
    }
  }

  // The pane's blocks are split into two groups by what they're FOR: the things
  // to do next (the due hero + the Practise menu) and the state you've built up
  // (what's enrolled, what you keep forgetting). On a phone the two groups are
  // `display: contents` — the DOM order below is exactly the old single column,
  // unchanged. Above $desktop-nav they become the pane's two columns, so the
  // extra width carries state alongside the actions instead of stretching one
  // column (see .train-pane-openings in style.css).
  //
  // Each renderer takes (host, container): `host` is the column it draws into,
  // `container` stays the pane itself — every re-render and drill launch has to
  // rebuild the WHOLE pane, not just one column.
  const doNext = document.createElement('div');
  doNext.className = 'train-col train-col--do';
  const state = document.createElement('div');
  state.className = 'train-col train-col--state';
  container.append(doNext, state);

  // (The three contextual cards that used to sit here — import your games,
  // connect Lichess, make it yours — are gone. Two of them repeated the
  // Get-started checklist above the tabs, and the third asked about theme and
  // notation, which nobody comes to Train to answer. Settings still has all
  // three, which is where someone looking for them would look.)

  // The streak now lives on the daily-challenge card above the tabs, so Train's
  // own head is gone — the hero (when anything's due) is the top of this pane.
  if (!trainingLocked) renderHero(doNext, container, due, trainingLines, books);
  renderModeCards(doNext, container, trainingLines, allLines, books, trainingLocked);
  // What keeps slipping — the worst moves and the weakest lines — closes the
  // pane. The "Lines in training" list that used to sit here is gone: it was a
  // second copy of My Lines, one screen away from the real one, and the only
  // thing it could do that My Lines couldn't was flick a switch My Lines also
  // has. Training belongs to what you drill; the book belongs to My Lines.
  renderForgottenSection(state, allLines, {
    onFixMove: (m, lines) => startMoveFix(
      { preFen: m.preFen, san: m.san, colour: m.colour, count: m.lapses },
      lines,
      () => void doRender(container),
    ),
    onDrillLine: (line) => startRounds([line], container, { explicit: true }),
    onOpenLine: onViewLine ? (line) => onViewLine!(line) : undefined,
    onStartTraining: () => void doRender(container),
  });
}

// The ordered list of lines that "Start training" drills, per the default-mode
// pref. Already filtered/ordered and known-drillable, so the caller can hand it
// straight to startRounds with explicit:true. Returns null when the chosen mode
// has nothing to drill, so the caller falls back to the list/header.
function linesForDefaultMode(trainingLines: Line[], due: Line[]): Line[] | null {
  switch (getDefaultTrainingMode()) {
    case 'recent': {
      const ordered = recentlyAddedLines(trainingLines).slice(0, PICKER_SESSION_CAP);
      return ordered.length ? ordered : null;
    }
    case 'weakest': {
      const ordered = weakestLines(trainingLines).slice(0, PICKER_SESSION_CAP);
      return ordered.length ? ordered : null;
    }
    default:
      return due.length > 0 ? due : null;
  }
}

// ── Hero: "Due now" · "Reviewed today" ────────────────────────────────────────
//
// The front door. Two compact stats side by side — lines due and today's effort —
// at half the old headline height, with the primary Start button full-width
// below. Same data, calmer footprint. The counts animate up on entry.

// Lines drilled per explicit-mode session, so Fresh/Weak stay bite-sized.
const PICKER_SESSION_CAP = 12;

// A long session is split into bite-sized rounds so progress can be banked
// without finishing everything in one sitting. Each completed line is already
// graded and saved as it finishes, so closing between rounds loses nothing and
// reopening simply resumes from the (now smaller) due pile.
const ROUND_SIZE = 5;            // full lines per round
const ROUND_SIZE_POSITIONS = 10; // single moves per round (quicker, so a bigger chunk)

function renderHero(
  host: HTMLElement,
  container: HTMLElement,
  due: Line[],
  allTraining: Line[],
  // The books, for the Repertoire run half of the refresh pair.
  books: Repertoire[],
): void {
  // Nothing due now → no hero at all. The card only earns its space when there's
  // something to review; "all caught up" is implied by its absence.
  if (due.length === 0) return;

  const hero = document.createElement('div');
  hero.className = 'card train-hero';

  // Two stats in a row: "Due now" and "Reviewed today". Numbers above, labels
  // beneath, each at roughly half the old single big count.
  const stats = document.createElement('div');
  stats.className = 'train-hero-stats';

  const dueNum = document.createElement('span');
  dueNum.className = 'train-hero-stat-num';
  dueNum.textContent = '0';
  stats.appendChild(buildHeroStat('due', dueNum, 'Due now'));
  countUp(dueNum, due.length);

  const revNum = document.createElement('span');
  revNum.className = 'train-hero-stat-num';
  revNum.textContent = '0';
  stats.appendChild(buildHeroStat('reviewed', revNum, 'Reviewed today'));
  countUp(revNum, reviewedToday());

  // How many rounds the due pile breaks into. Stateless — it shrinks as rounds
  // are banked across sittings. It used to hide at one round, which made the row
  // flip between two stats and three; it is one of the three figures this card
  // is for, so it holds its column and reads "1" on a short day.
  const roundsLeft = Math.max(1, Math.ceil(due.length / ROUND_SIZE));
  const roundsNum = document.createElement('span');
  roundsNum.className = 'train-hero-stat-num';
  roundsNum.textContent = '0';
  stats.appendChild(buildHeroStat('rounds', roundsNum, 'Rounds left'));
  countUp(roundsNum, roundsLeft);

  hero.appendChild(stats);

  // ── Refresh your moves ─────────────────────────────────────────────────────
  //
  // One button used to sit here, called "Refresh lines", and it ran full lines.
  // The other way through the same due pile — Repertoire run, which asks each
  // due MOVE once instead of replaying a shared opening once per line — was
  // buried a third of the way down the Practise menu, where nobody comparing
  // "how shall I do today's review?" would find it. They are two answers to one
  // question, so they belong side by side, the same size, under the question.
  //
  // Each says its own size underneath, because that is the actual difference
  // between them and the reason to pick one: the same due pile is N lines one
  // way and M moves the other.
  const runPlan = planRepertoireRun(books);
  const refreshTitle = document.createElement('div');
  refreshTitle.className = 'train-refresh-title';
  refreshTitle.textContent = 'Refresh your moves';
  hero.appendChild(refreshTitle);

  const row = document.createElement('div');
  row.className = 'train-refresh-row';
  row.appendChild(refreshButton(
    Icons.brain(18),
    'Full lines',
    `${due.length} ${due.length === 1 ? 'line' : 'lines'} due`,
    () => startRounds(dueLines(allTraining), container, { explicit: true }),
  ));
  // Only when there is a book to run. A repertoire with nothing due through this
  // route would open a session with nothing in it.
  if (runPlan && runPlan.dueMoves > 0) {
    row.appendChild(refreshButton(
      Icons.list(18),
      'Repertoire run',
      `${runPlan.dueMoves} ${runPlan.dueMoves === 1 ? 'move' : 'moves'} due`,
      () => runRepertoireRun(container, books),
    ));
  } else {
    row.classList.add('train-refresh-row--single');
  }
  hero.appendChild(row);

  host.appendChild(hero);
}

// One of the pair. Equal width by construction (the row is a two-column grid),
// with the count as a quiet second line so the two are comparable at a glance.
function refreshButton(
  icon: SVGElement,
  label: string,
  sub: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-primary train-refresh-btn';

  const top = document.createElement('span');
  top.className = 'train-refresh-btn-top';
  top.appendChild(icon);
  const name = document.createElement('span');
  name.textContent = label;
  top.appendChild(name);
  btn.appendChild(top);

  const note = document.createElement('span');
  note.className = 'train-refresh-btn-sub';
  note.textContent = sub;
  btn.appendChild(note);

  btn.addEventListener('click', onClick);
  return btn;
}

// One column of the hero pair: a big-ish number stacked over its label.
function buildHeroStat(kind: 'due' | 'reviewed' | 'rounds', num: HTMLElement, label: string): HTMLElement {
  const col = document.createElement('div');
  col.className = `train-hero-stat train-hero-stat--${kind}`;
  col.appendChild(num);
  const lbl = document.createElement('div');
  lbl.className = 'train-hero-stat-label';
  lbl.textContent = label;
  col.appendChild(lbl);
  return col;
}

// ── Mode cards ──────────────────────────────────────────────────────────────────
//
// One clear front door per training mode. Each card carries a line icon, a name,
// a one-line subtitle and a live stat shown as a small badge. They replace the
// old separate buttons and the practice picker — same underlying modes, presented
// as one menu. Each mode owns a subtle accent colour (a left edge bar, its icon
// chip and its stat badge) so Time attack reads distinctly from a review card at
// a glance — game-y identity without any points/XP.

// Per-mode accent colours. Muted, warm-classic-friendly hues, each clearly
// distinct from the next; applied via the --mode-accent custom property and
// tinted softly in CSS (color-mix), so they sit happily on light and dark chrome
// alike. The board squares are never touched.
const MODE_ACCENT = {
  fix:    '#c0603f', // terracotta — corrective
  timed:  '#c79a2a', // gold — against the clock
  fresh:  '#4e8063', // green — new growth
  weak:   '#7d5a86', // plum — shore up the soft spots
  prep:   '#3f7d8a', // teal — strategy against an opponent
  run:    '#5b6ea8', // indigo — one pass through the whole book
} as const;

function renderModeCards(
  host: HTMLElement,
  container: HTMLElement,
  allTraining: Line[],
  allLines: Line[],
  books: Repertoire[],
  // Under TRAINING_UNLOCK_LINES saved lines: every mode is off, with the count
  // still to go as the reason.
  locked: boolean,
): void {
  const section = document.createElement('div');
  section.className = 'section mode-cards';

  // Title + the (i). The subtitle on each card has to stay one short line for
  // the menu to stay scannable, which leaves nowhere to say how "Repertoire run"
  // differs from "Drill new lines" — so that answer lives one tap away instead
  // of on every card forever.
  const head = document.createElement('div');
  head.className = 'section-head-row';
  const label = document.createElement('div');
  label.className = 'section-title';
  label.textContent = 'Practise';
  head.appendChild(label);
  head.appendChild(buildInfoButton('About the practice modes', openPracticeInfo));
  section.appendChild(head);

  // Under the unlock every card below is greyed out for the same reason, and
  // saying it once at the top is what makes the six repetitions read as one
  // rule rather than six separate dead ends.
  if (locked) {
    const left = Math.max(0, TRAINING_UNLOCK_LINES - allLines.length);
    const note = document.createElement('p');
    note.className = 'section-desc mode-cards-locked';
    note.textContent = allLines.length === 0
      ? `Save ${TRAINING_UNLOCK_LINES} lines to switch practice on. Fewer than that and a `
        + 'session is the same line over and over, which is where the habit dies.'
      : `Save at least ${TRAINING_UNLOCK_LINES} lines to switch practice on — `
        + `you have ${allLines.length}, so ${left} to go.`;
    section.appendChild(note);
  }

  // Why a mode is greyed out. Under the unlock, every card here says the same
  // thing and says it first — the answer is "go and save more lines", whatever
  // else is or isn't in the rotation. Above it, the old reasons apply: with
  // nothing saved at all every card is a dead end; once lines exist but none are
  // enrolled, the material is there, it just isn't in the rotation.
  const nothingSaved = allLines.length === 0;
  const noLinesReason = locked
    ? trainingLockReason(allLines.length)
    : nothingSaved
      ? 'Save a line first — then there’s something to drill'
      : 'Switch a line on in My Lines to drill it';

  // Time attack leads the list — three timed runs, each with its own personal
  // best. Always playable when there's any saved position anywhere (it falls back
  // to shallow and paused lines); only disabled when nothing is saved at all.
  const timedReady = !locked && selectTimedPositions(allLines, { max: 80 }).length > 0;
  section.appendChild(buildTimedCard(container, allLines, timedReady, locked ? noLinesReason : undefined));

  // Review missed moves — single moves you've missed. Tappable as long as there's
  // anything deep enough to drill (the mode falls back to weak/upcoming moves). No
  // due-count badge: the daily challenge and hero already carry the "what's due"
  // signal, so this stays a clean entry point.
  const hasPositions = !locked && selectIndividualPositions(allTraining).length > 0;
  section.appendChild(buildModeCard({
    accent: MODE_ACCENT.fix,
    icon: Icons.zap(20),
    name: 'Review missed moves',
    sub: 'single moves you’ve missed',
    disabled: !hasPositions,
    // "Train a little more" is only true once there IS something to train.
    disabledReason: locked || nothingSaved
      ? noLinesReason
      : 'Train a little more to unlock single-move drills',
    onClick: () => runIndividual(container, allTraining),
  }));

  // Repertoire run — one walk through the book, asking each move once. The line
  // modes below replay a shared opening once per line; this one doesn't, and the
  // card says so in the number of repeats it saves rather than in an
  // explanation nobody would read.
  const runPlan = locked ? null : planRepertoireRun(books);
  if (runPlan && runPlan.totalMoves > 0) {
    const saving = runSavingNote(runPlan);
    section.appendChild(buildModeCard({
      accent: MODE_ACCENT.run,
      icon: Icons.list(20),
      name: 'Repertoire run',
      sub: saving ? `one pass through your book — ${saving}` : 'one pass through your book',
      stat: runPlan.dueMoves,
      statLabel: runPlan.dueMoves === 1 ? 'move due' : 'moves due',
      onClick: () => runRepertoireRun(container, books),
    }));
  }

  // Fresh lines — full runs of the newest lines first. Both this and Target
  // weak areas below used to stay live with an empty rotation and start a
  // session with nothing in it; they now grey out like the two above.
  const freshLines = recentlyAddedLines(allTraining).slice(0, PICKER_SESSION_CAP);
  section.appendChild(buildModeCard({
    accent: MODE_ACCENT.fresh,
    icon: Icons.plus(20),
    name: 'Drill new lines',
    sub: 'full runs of your newest lines',
    disabled: locked || freshLines.length === 0,
    disabledReason: noLinesReason,
    onClick: () => startRounds(freshLines, container, { explicit: true }),
  }));

  // Weak spots — full runs of the weakest lines first.
  const weakLines = weakestLines(allTraining).slice(0, PICKER_SESSION_CAP);
  section.appendChild(buildModeCard({
    accent: MODE_ACCENT.weak,
    icon: Icons.trending(20),
    name: 'Target weak areas',
    sub: 'full runs of your weakest lines',
    disabled: locked || weakLines.length === 0,
    disabledReason: noLinesReason,
    onClick: () => startRounds(weakLines, container, { explicit: true }),
  }));

  // Prep — full runs of lines prepared against a scouted opponent. Only shown
  // when any opponent-tagged lines are in training.
  const prepLines = allTraining.filter(l => l.tags.some(isOpponentTag));
  if (prepLines.length > 0 && !locked) {
    section.appendChild(buildModeCard({
      accent: MODE_ACCENT.prep,
      icon: Icons.target(20),
      name: 'Prep',
      sub: 'opponent-tagged lines',
      stat: prepLines.length,
      statLabel: prepLines.length === 1 ? 'line' : 'lines',
      onClick: () => startRounds(
        prepLines.slice(0, PICKER_SESSION_CAP), container, { explicit: true }),
    }));
  }

  host.appendChild(section);
}

// What each practice mode actually is, in the words the one-line subtitles have
// no room for. Kept beside renderModeCards on purpose: a mode added to the menu
// and not to this list is an obvious omission when the two sit together.
function openPracticeInfo(): void {
  openInfoSheet({
    title: 'The practice modes',
    intro: 'Six ways through the same repertoire. They differ in WHAT they ask you and '
      + 'how much of a line you play.',
    entries: [
      {
        icon: Icons.clock(18), accent: MODE_ACCENT.timed,
        label: 'Time attack',
        detail: 'Single positions against the clock — 1, 3 or 5 minutes, each with its own '
          + 'personal best. It draws on everything you have saved, including paused and '
          + 'shallow lines, so it stays playable early on.',
      },
      {
        icon: Icons.zap(18), accent: MODE_ACCENT.fix,
        label: 'Review missed moves',
        detail: 'One move at a time, from the positions you have actually got wrong. No '
          + 'run-up: you are dropped straight into the position that beat you.',
      },
      {
        icon: Icons.list(18), accent: MODE_ACCENT.run,
        label: 'Repertoire run',
        detail: 'One pass through your whole book, asking every move exactly once. Lines '
          + 'that share an opening replay it once here instead of once per line, which is '
          + 'why it is much shorter than drilling the same lines one by one.',
      },
      {
        icon: Icons.plus(18), accent: MODE_ACCENT.fresh,
        label: 'Drill new lines',
        detail: 'Full runs of your newest lines, start to finish. The one to use straight '
          + 'after building something, while it is still fresh enough to fix.',
      },
      {
        icon: Icons.trending(18), accent: MODE_ACCENT.weak,
        label: 'Target weak areas',
        detail: 'Full runs of the lines you score worst on. Same shape as the one above, '
          + 'picked from the other end of the list.',
      },
      {
        icon: Icons.target(18), accent: MODE_ACCENT.prep,
        label: 'Prep',
        detail: 'Full runs of the lines you tagged against a scouted opponent. It only '
          + 'appears once you have some.',
      },
    ],
    footnote: 'Time attack and Review missed moves ask single positions; the rest walk whole '
      + 'lines. Nothing here changes your review schedule differently — a move answered is a '
      + 'move reviewed, whichever door you came in by.',
  });
}

// Exported: the Mistake retry pane builds its category cards with the same
// chrome (mistakes-screen.ts).
export function buildModeCard(o: {
  accent: string;
  icon: SVGElement;
  name: string;
  sub: string;
  stat?: number;
  statLabel?: string;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
}): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'mode-card' + (o.disabled ? ' mode-card--disabled' : '');
  card.style.setProperty('--mode-accent', o.accent);
  card.disabled = !!o.disabled;

  const icon = document.createElement('span');
  icon.className = 'mode-card-icon';
  icon.appendChild(o.icon);
  card.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'mode-card-text';
  const name = document.createElement('span');
  name.className = 'mode-card-name';
  name.textContent = o.name;
  const sub = document.createElement('span');
  sub.className = 'mode-card-sub';
  sub.textContent = o.sub;
  text.appendChild(name);
  text.appendChild(sub);
  // When greyed out, explain why right beneath the title so the card isn't a
  // dead end with no reason given.
  if (o.disabled && o.disabledReason) {
    text.appendChild(buildModeReason(o.disabledReason));
  }
  card.appendChild(text);

  if (o.stat !== undefined) {
    const stat = document.createElement('span');
    stat.className = 'mode-card-stat';
    const num = document.createElement('span');
    num.className = 'mode-card-stat-num';
    num.textContent = '0';
    countUp(num, o.stat);
    const lbl = document.createElement('span');
    lbl.className = 'mode-card-stat-label';
    lbl.textContent = o.statLabel ?? '';
    stat.appendChild(num);
    stat.appendChild(lbl);
    card.appendChild(stat);
  }

  if (!o.disabled) card.addEventListener('click', o.onClick);
  return card;
}

// The one-line "why is this greyed out" note shown beneath a disabled card's
// title.
function buildModeReason(text: string): HTMLElement {
  const reason = document.createElement('span');
  reason.className = 'mode-card-reason';
  reason.textContent = text;
  return reason;
}

// Time attack: the card body isn't itself tappable — its three duration chips
// are, each starting a run of that length and showing its own personal best.
// The pool is every saved line (selectTimedPositions falls back to shallow /
// paused positions), so it stays playable with very little trained.
function buildTimedCard(
  container: HTMLElement,
  allLines: Line[],
  enabled: boolean,
  // Overrides the default "save a line first" note — the training lock has its
  // own count to report.
  reason?: string,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'mode-card mode-card--timed' + (enabled ? '' : ' mode-card--disabled');
  card.style.setProperty('--mode-accent', MODE_ACCENT.timed);

  const head = document.createElement('div');
  head.className = 'mode-card-head';
  const icon = document.createElement('span');
  icon.className = 'mode-card-icon';
  icon.appendChild(Icons.clock(20));
  head.appendChild(icon);
  const text = document.createElement('span');
  text.className = 'mode-card-text';
  const name = document.createElement('span');
  name.className = 'mode-card-name';
  name.textContent = 'Time attack';
  const sub = document.createElement('span');
  sub.className = 'mode-card-sub';
  sub.textContent = 'beat your best in 1, 3 or 5 minutes';
  text.appendChild(name);
  text.appendChild(sub);
  // Greyed either by the training lock or by having nothing saved at all.
  if (!enabled) {
    text.appendChild(buildModeReason(reason ?? 'Save a line first to play Time attack'));
  }
  head.appendChild(text);
  card.appendChild(head);

  const chips = document.createElement('div');
  chips.className = 'timed-chips';
  for (const minutes of TIMED_DURATIONS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'timed-chip';
    chip.disabled = !enabled;

    const dur = document.createElement('span');
    dur.className = 'timed-chip-dur';
    dur.textContent = `${minutes}m`;
    chip.appendChild(dur);

    const best = getTimedBest(minutes);
    const bestEl = document.createElement('span');
    bestEl.className = 'timed-chip-best';
    if (best > 0) {
      bestEl.appendChild(document.createTextNode('best '));
      const num = document.createElement('span');
      num.className = 'timed-chip-best-num';
      num.textContent = '0';
      bestEl.appendChild(num);
      countUp(num, best);
    } else {
      bestEl.textContent = '—';
    }
    chip.appendChild(bestEl);

    if (enabled) chip.addEventListener('click', () => runTimed(container, allLines, minutes));
    chips.appendChild(chip);
  }
  card.appendChild(chips);

  return card;
}

// ── Locating a forgotten move ─────────────────────────────────────────────────
//
// The "Fix it" drill needs to know which saved line a bare position+move belongs
// to, so it can name the opening and replay the whole line afterwards.

interface ForgottenLocation {
  line: Line;
  prelude?: { uci: string; fromFen: string };
}
function locateForgotten(fen: string, san: string, lines: Line[]): ForgottenLocation | null {
  for (const line of lines) {
    const moves = mainlineOf(line.tree);
    for (let i = 0; i < moves.length; i++) {
      const preFen = i === 0 ? START_FEN : moves[i - 1].fen;
      if (preFen === fen && moves[i].san === san) {
        // The opponent's move into this position, if there is one (it's the
        // previous ply), played from the position two moves back.
        const prelude = i >= 1
          ? { uci: moves[i - 1].uci, fromFen: i >= 2 ? moves[i - 2].fen : START_FEN }
          : undefined;
        return { line, prelude };
      }
    }
  }
  return null;
}

// The from/to squares of a SAN move at a position, for the board arrow. Null if
// it doesn't resolve (stale data) — the board just renders without an arrow.

// One move you keep forgetting: the playful three-rep "Fix it" drill, then —
// when the move belongs to a saved line — the full line, so it lands back in
// context. Shared by the Openings carousel and the Statistics forgotten-moves
// list; `onDone` re-renders whichever screen launched it.
export function startMoveFix(
  move: { preFen: string; san: string; colour: 'white' | 'black'; count: number },
  lines: Line[],
  onDone: () => void,
): void {
  const located = locateForgotten(move.preFen, move.san, lines);
  // Fixed: drop it from the log so the next-worst move surfaces on the carousel.
  const clear = (): void => clearForgottenMove(move.preFen, move.san);

  startFixIt(
    {
      preFen: move.preFen,
      san: move.san,
      colour: move.colour,
      count: move.count,
      openingName: located?.line.openingName,
      prelude: located?.prelude,
    },
    {
      playFullLine: !!located,
      onComplete: () => {
        if (!located) { clear(); onDone(); return; }
        startDrill(located.line, {
          wrongMoveMode: 'full',
          modeLabel: 'Fix it',
          completeMessage: 'Fixed! 🎉',
          celebrateOnComplete: true,
          backLabel: 'Done',
          onComplete: () => { clear(); onDone(); },
          onCancel: onDone,
        });
      },
      onCancel: onDone,
    },
  );
}

// ── Driving a session ───────────────────────────────────────────────────────────

interface LineSessionStat {
  // The graded, saved clone — reflects the line's post-session review state
  // (used to open it in the builder and to show its up-to-date stats).
  line: Line;
  lineName: string;
  openingName: string | null;
  misses: number;
  totalMoves: number;
}

interface SessionStats {
  linesReviewed: number;
  movesMissed: number;
  totalMoves: number;
  lineStats: Map<string, LineSessionStat>;
  // Distinct missed positions, for the end-of-session "try your mistakes" review.
  mistakes: Mistake[];
  mistakeKeys: Set<string>;
}

function makeStats(): SessionStats {
  return {
    linesReviewed: 0,
    movesMissed: 0,
    totalMoves: 0,
    lineStats: new Map(),
    mistakes: [],
    mistakeKeys: new Set(),
  };
}

// Drive one queue of lines to the end. `onEmpty` runs when the queue drains —
// it defaults to the final session-complete screen, but the round driver passes
// its own so it can show an intermediate round screen and start the next round.
function runSession(
  session: TrainingSession,
  container: HTMLElement,
  stats: SessionStats,
  onEmpty?: () => void,
): void {
  const item = session.next();
  if (!item) {
    (onEmpty ?? (() => renderSessionComplete(container, stats)))();
    return;
  }
  runItem(item, session, container, stats, onEmpty);
}

// ── Rounds ──────────────────────────────────────────────────────────────────
//
// A long sitting is chunked into rounds of ROUND_SIZE lines. Each round is its
// own little TrainingSession (so missed-line resurfacing stays inside the round
// it happened in). Because every finished line is graded and saved the moment
// it completes, banking a round and closing loses nothing: the lines just drop
// out of the due pile, so reopening resumes from where you stopped. The stats
// object is shared across the whole sitting, so the final screen and the
// end-of-session mistakes review cover everything; the round screen shows just
// that round's delta.

// A completion screen's optional extra primary — the daily challenge passes
// "Next challenge →" so a finished part chains straight into the next one.
type NextAction = { label: string; run: () => void };

interface RoundRunner {
  lines: Line[];
  explicit: boolean;
  index: number;       // how many lines consumed so far
  roundNo: number;     // 1-based current round
  totalRounds: number;
  stats: SessionStats;
  // Fires once the whole sitting reaches the final session-complete screen (not
  // between rounds). Used by the daily challenge to mark its lines task done —
  // and to file how the sitting went, for the completion popup's recap.
  onComplete?: (outcome: TaskOutcome) => void;
  nextAction?: NextAction;
}

function startRounds(
  lines: Line[],
  container: HTMLElement,
  opts: { explicit?: boolean; onComplete?: (outcome: TaskOutcome) => void; nextAction?: NextAction } = {},
): void {
  const runner: RoundRunner = {
    lines,
    explicit: opts.explicit ?? false,
    index: 0,
    roundNo: 0,
    totalRounds: Math.max(1, Math.ceil(lines.length / ROUND_SIZE)),
    stats: makeStats(),
    onComplete: opts.onComplete,
    nextAction: opts.nextAction,
  };
  runRound(runner, container);
}

// Run a full-line training session over a specific, already-ordered set of lines,
// calling back when the whole sitting finishes. The daily challenge uses this to
// drill its three lines and learn when they're done.
export function startLineSession(
  lines: Line[],
  container: HTMLElement,
  onComplete?: (outcome: TaskOutcome) => void,
  nextAction?: NextAction,
): void {
  startRounds(lines, container, { explicit: true, onComplete, nextAction });
}

// Run a short, fixed-size individual-positions session (the daily challenge's
// "N positions to refresh"), calling back only once the set is actually
// reviewed and closed — not on a cancel. A stripped-down sibling of
// runIndividual below: same per-position grading/persist logic, but no
// round-chunking (the daily count is always small) and a caller-supplied
// completion hook instead of always landing on the mode-card flow.
export function startPositionsSession(
  lines: Line[],
  container: HTMLElement,
  count: number,
  onComplete: (outcome: TaskOutcome) => void,
  nextAction?: NextAction,
): void {
  const trainingLines = lines.filter(l => l.inTraining);
  const clones = trainingLines.map(l => ({ ...l, tree: structuredClone(l.tree) }));
  const positions = selectIndividualPositions(clones, { max: count });
  if (positions.length === 0) {
    void doRender(container);
    return;
  }

  const cloneById = new Map(clones.map(c => [c.id, c]));
  const lineByNode = new Map(positions.map(p => [p.expected, cloneById.get(p.lineId)!]));

  const missed = new Set<string>();
  const stats = { reviewed: 0, missed: 0, openings: new Map<string, OpeningTally>() };
  const mistakes: Mistake[] = [];
  const mistakeKeys = new Set<string>();

  startPositionsDrill(
    positions.map(p => ({ preFen: p.preFen, expected: p.expected, prevUci: p.prevUci, prevFen: p.prevFen })),
    {
      wrongMoveMode: 'full',
      confirmAbandon: true,
      modeLabel: 'Positions to refresh',
      playPrelude: true,
      celebrateOnComplete: true,
      completeMessage: 'Positions cleared ✓',
      recordMiss: (node) => { missed.add(node.id); },
      onStepComplete: (expected) => {
        const line = lineByNode.get(expected);
        if (!line) return;
        const pos = positions.find(p => p.expected === expected);
        const now = new Date();
        const wasMissed = missed.has(expected.id);
        if (wasMissed && pos) {
          addMistake(mistakes, mistakeKeys, pos.preFen, expected);
          recordMissedMove(pos.preFen, expected.san, line.colour);
        }
        const quality = qualityFromMisses(wasMissed ? 1 : 0);
        expected.review = gradeReview(
          expected.review ?? newReview(now), quality, now, lineSpacing(line));
        line.lastTrained = now.toISOString();
        line.confidence = lineConfidence(line);
        void saveLine(line);
        // The same move in any other line is the same work (§8).
        if (pos) {
          void queueWriteThrough(
            [{ preFen: pos.preFen, uci: expected.uci, review: expected.review }], line.id);
        }
        recordReviewed(1);
        // One move graded: one entry on the remembered-vs-failed bar.
        recordReviewOutcome(wasMissed ? 0 : 1, wasMissed ? 1 : 0);
        bumpOpening(
          stats.openings, `${line.id}:${expected.id}`, line.openingName || line.name,
          wasMissed ? 0 : 1, wasMissed ? 1 : 0,
          {
            onOpen: () => openTrainingPeek({
              fen: pos?.preFen ?? expected.fen,
              orientation: line.colour,
              hintUci: expected.uci,
              onNote: () => openQuickNoteSheet(line, expected),
              onTurnOff: () => { void saveLine({ ...line, inTraining: false }); },
              onEdit: () => onViewLine?.(line, pos?.preFen),
            }),
            statsLine: reviewStatsLine(expected.review),
          },
        );
        stats.reviewed++;
        if (wasMissed) stats.missed++;
      },
      onComplete: () => {
        renderIndividualComplete(container, stats, mistakes, nextAction);
        onComplete({ right: stats.reviewed - stats.missed, wrong: stats.missed });
      },
      onCancel: () => void doRender(container),
    },
  );
}

function runRound(runner: RoundRunner, container: HTMLElement): void {
  // Snapshot the cumulative counters so the round screen can show this round's
  // own numbers (current − before).
  const before = {
    lines: runner.stats.linesReviewed,
    missed: runner.stats.movesMissed,
    moves: runner.stats.totalMoves,
    // …and which lines were already recapped, so the round screen can list only
    // the ones this round adds.
    lineIds: new Set(runner.stats.lineStats.keys()),
  };
  const slice = runner.lines.slice(runner.index, runner.index + ROUND_SIZE);
  runner.index += slice.length;
  runner.roundNo += 1;

  const session = new TrainingSession(slice, { explicit: runner.explicit });
  runSession(session, container, runner.stats, () => {
    if (runner.index >= runner.lines.length) {
      renderSessionComplete(container, runner.stats, runner.nextAction);
      runner.onComplete?.({
        right: runner.stats.totalMoves - runner.stats.movesMissed,
        wrong: runner.stats.movesMissed,
      });
    } else {
      renderRoundComplete(container, runner, before);
    }
  });
}

function mainlineOf(tree: MoveNode): MoveNode[] {
  const result: MoveNode[] = [];
  let node = tree.children[0];
  while (node) {
    result.push(node);
    node = node.children[0];
  }
  return result;
}

function runItem(
  item: SessionItem,
  session: TrainingSession,
  container: HTMLElement,
  stats: SessionStats,
  onEmpty?: () => void,
  // Set only by the divert (TRANSPOSITIONS.md §9): walk this line from the
  // position the user already reached, rather than from move one.
  startAtPly = 0,
): void {
  const { line } = item;

  // Deep-clone so grading edits don't mutate the queued/in-memory line until we
  // deliberately persist.
  const lineCopy: Line = { ...line, tree: structuredClone(line.tree) };
  const copyMoves = mainlineOf(lineCopy.tree);
  const userNodes = userMoveNodes(lineCopy.tree, lineCopy.colour);
  // What this run actually tests. On a divert the earlier moves were auto-played
  // as context, never asked — grading them as clean recalls would be a lie.
  const gradedNodes = startAtPly > 0
    ? userNodes.filter(n => copyMoves.findIndex(m => m.id === n.id) >= startAtPly)
    : userNodes;

  // Track which user-moves were missed on this pass (one entry per node).
  const missed = new Set<string>();
  // The chronic-miss offer is spent once per LINE, not per drill run — a Fix it
  // replays the line from move 1, and that replay must not prompt again.
  let struggleUsed = false;

  // Where a move sits in the line: the position before it, plus the opponent's
  // move into that position (the previous ply), which the retry and Fix it
  // drills replay so the position doesn't read without its last move.
  function locate(node: MoveNode): { preFen: string; prevUci?: string; prevFen?: string } {
    const idx = copyMoves.findIndex(m => m.id === node.id);
    return {
      preFen: idx <= 0 ? START_FEN : copyMoves[idx - 1].fen,
      prevUci: idx >= 1 ? copyMoves[idx - 1].uci : undefined,
      prevFen: idx >= 1 ? (idx >= 2 ? copyMoves[idx - 2].fen : START_FEN) : undefined,
    };
  }

  function recordMiss(node: MoveNode): void {
    // drill.ts fires this once per node (first wrong attempt) in 'full' mode.
    const idx = copyMoves.findIndex(m => m.id === node.id);
    if (idx >= 0) copyMoves[idx].missedThisSession = true;
    // A Fix it replays the line, so the same move can be missed twice in one
    // sitting. The mistake list and the forgotten-moves tally should still count
    // it once — `missed` is a Set, and this guard covers the tally.
    const firstMiss = !missed.has(node.id);
    missed.add(node.id);
    const { preFen, prevUci, prevFen } = locate(node);
    const prelude = prevUci ? { prevUci, prevFen: prevFen! } : undefined;
    addMistake(stats.mistakes, stats.mistakeKeys, preFen, node, prelude);
    // Feed the "most forgotten move this week" card on Statistics.
    if (firstMiss) recordMissedMove(preFen, node.san, lineCopy.colour);
  }

  // Three reps of the move you keep forgetting, then the whole line again from
  // move 1 so it lands back in context. The clone and its `missed` set survive
  // the restart, so grading at the end stays honest about this sitting.
  function runStruggleFix(node: MoveNode, preFen: string): void {
    const { prevUci, prevFen } = locate(node);
    const replay = (): void => startDrill(lineCopy, drillOpts);
    startFixIt(
      {
        preFen,
        san: node.san,
        colour: lineCopy.colour,
        count: chronicCount(node, missed.has(node.id)),
        openingName: lineCopy.openingName,
        prelude: prevUci ? { uci: prevUci, fromFen: prevFen! } : undefined,
      },
      { playFullLine: true, onComplete: replay, onCancel: replay },
    );
  }

  // ── The divert (TRANSPOSITIONS.md §9) ──────────────────────────────────────
  //
  // "Continue in X": credit the move just played in X, take X out of the queue
  // if it was waiting there (it is being drilled now, not twice), and walk X
  // from this position on. The line we're leaving is graded not at all — it
  // stays exactly as due as it was.
  async function divertInto(choice: DivertChoice): Promise<void> {
    const target = await getLine(choice.lineId);
    const nodes = target ? mainlineOf(target.tree) : [];
    const node = nodes[choice.ply - 1];
    if (!target || !node || node.uci.slice(0, 4) !== choice.uci.slice(0, 4)) {
      // The line changed since the index was built — there is nothing to divert
      // into. Carry on with the rest of the session.
      runSession(session, container, stats, onEmpty);
      return;
    }

    const now = new Date();
    node.review = gradeReview(
      node.review ?? newReview(now), qualityFromMisses(0), now, lineSpacing(target));
    target.lastTrained = now.toISOString();
    target.confidence = lineConfidence(target);
    await saveLine(target);
    // Credited once, wherever else that move lives.
    await queueWriteThrough(
      [{ preFen: choice.preFen, uci: choice.uci, review: node.review }], target.id);

    session.remove(target.id);

    // Landed on the target's last move: nothing left to quiz there, so treat it
    // as done and move the session on.
    const isUserPly = (i: number) => (target.colour === 'white' ? i % 2 === 0 : i % 2 === 1);
    const more = nodes.findIndex((_, i) => i >= choice.ply && isUserPly(i));
    if (more < 0) {
      runSession(session, container, stats, onEmpty);
      return;
    }

    runItem({ line: target }, session, container, stats, onEmpty, choice.ply);
  }

  const drillOpts: DrillOptions = {
    wrongMoveMode: 'full',
    confirmAbandon: true,
    modeLabel: 'Training',
    startAtPly,
    // Session-level progress bar: lines completed so far out of the lines the
    // session started with. linesReviewed counts completions, so for the current
    // line this is "line linesReviewed+1 of total".
    sessionProgress: {
      completed: stats.linesReviewed,
      total: session.initialCount,
    },
    celebrateOnComplete: true,
    completeMessage: 'Line complete',
    // Training stays strict about the ENGINE's opinion: no onExplore, and a
    // merely sound move is still a miss. What it does recognise is the user's
    // OWN work — the position index knows when the move just played is another
    // of their lines' move from this very position (TRANSPOSITIONS.md §9).
    // Asked only after a move is played, never announced in advance.
    checkAlternative: async (preFen, userUci) => {
      const verdict = judgeOtherLineMove(await positionIndex(), preFen, userUci, line.id);
      if (!verdict) return null;
      return verdict.kind === 'parked'
        ? { kind: 'parked-line' as const, lineName: verdict.lineName }
        : { kind: 'other-line' as const, candidates: verdict.candidates };
    },
    onDivert: (choice) => { void divertInto(choice); },
    recordMiss,
    onCancel: () => void doRender(container),
    // Pause this line out of training mid-drill: persist inTraining=false, drop it
    // from the session, and carry on with whatever's left. Nothing is graded — the
    // clone is simply discarded.
    onPauseLine: () => {
      void saveLine({ ...line, inTraining: false });
      line.inTraining = false;
      runSession(session, container, stats, onEmpty);
    },
    // Edit this line mid-drill: leave the session and open the original line in
    // the builder, at the position on the board. Only offered when the app
    // provides a view-line route.
    onEditLine: onViewLine ? (atFen) => onViewLine!(line, atFen) : undefined,
    // A note added/edited during the drill: persist the clone (its tree, where
    // the note lives) so it survives even if the line isn't finished.
    onNoteEdit: () => { void saveLine(lineCopy); },
    // A move you keep forgetting (see struggle.ts). With no note, a quiet nudge
    // slides in below the board once you've fixed it; with a note, the reveal
    // offers the Fix it drill.
    struggle: {
      // Two different bars, because the two offers are not equally pushy: the
      // write nudge honours its snooze, the Fix it button only needs a note.
      offerFor: (node) => {
        if (struggleUsed) return null;
        const missedNow = missed.has(node.id);
        if (shouldOfferFix(node, missedNow)) return 'fix';
        if (shouldAskForNote(node, missedNow)) return 'note';
        return null;
      },
      missCount: (node) => chronicCount(node, missed.has(node.id)),
      onNoteChanged: () => { void saveLine(lineCopy); },
      onNoteDismissed: (node, count) => {
        markNoteAskedAt(node, count);
        void saveLine(lineCopy);
      },
      startFix: (node, preFen) => { struggleUsed = true; runStruggleFix(node, preFen); },
    },
    onBeforeComplete: async () => {
      const now = new Date();
      // Read the run count BEFORE grading. On a line with no stored counter yet
      // the count is derived from the review blocks (reps + lapses), and grading
      // is about to move those — reading after would fold this very run into the
      // estimate and then add it again below.
      const runsBefore = lineTrainingCount(lineCopy);
      // The line's priority stretches or compresses every one of its moves'
      // next-due dates by the same factor.
      const spacing = lineSpacing(lineCopy);
      // Every graded move, with the position it was played from — the other
      // lines that play the same move there get the same record (§8).
      const credits: MoveCredit[] = [];
      for (const node of gradedNodes) {
        const misses = missed.has(node.id) ? 1 : 0;
        const quality = qualityFromMisses(misses);
        node.review = gradeReview(node.review ?? newReview(now), quality, now, spacing);
        node.missedThisSession = false;
        credits.push({ preFen: locate(node).preFen, uci: node.uci, review: node.review });
      }
      lineCopy.lastTrained = now.toISOString();
      lineCopy.confidence = lineConfidence(lineCopy);
      // One full run of the line — the denominator behind its recall figure.
      // Counted only here: the positions modes grade single moves, not lines.
      // A diverted run walked only part of the line, so it isn't one.
      if (startAtPly === 0) lineCopy.timesTrained = runsBefore + 1;
      await saveLine(lineCopy);
      await queueWriteThrough(credits, lineCopy.id);
      recordReviewed(gradedNodes.length);
      // Feed the Statistics remembered-vs-failed bar: this line's moves split
      // into recalled-first-try vs missed.
      recordReviewOutcome(gradedNodes.length - missed.size, missed.size);
    },
    onComplete: () => {
      stats.linesReviewed++;
      stats.movesMissed += missed.size;
      stats.totalMoves += gradedNodes.length;
      // Accumulate per-line stats; handles the same line appearing twice in
      // an explicit single-line drill session.
      const prev = stats.lineStats.get(line.id);
      if (prev) {
        prev.misses += missed.size;
        prev.totalMoves += gradedNodes.length;
        prev.line = lineCopy; // keep the freshest graded state
      } else {
        stats.lineStats.set(line.id, {
          line: lineCopy,
          lineName: line.name || 'Untitled',
          openingName: line.openingName,
          misses: missed.size,
          totalMoves: gradedNodes.length,
        });
      }
      runSession(session, container, stats, onEmpty);
    },
  };

  startDrill(lineCopy, drillOpts);
}

// ── Individual-moves mode ─────────────────────────────────────────────────────────
//
// A stream of single positions rather than a walk down a line. The positions
// are a blend of scheduled-due and most-missed moves, each one starting
// mid-opening (see individual.ts). A correct move jumps to the next position; a
// wrong one runs the same full wrong-move flow as line training. Every position
// is graded and persisted on its own, reusing the spaced-repetition scheduler.

// ── Repertoire run ───────────────────────────────────────────────────────────
//
// One walk through the book, asking each move once. The line modes replay a
// shared opening once per line that passes through it; this mode visits every
// node exactly once, so the dedupe is structural rather than a filter someone
// has to keep honest (see repertoire-run.ts).
//
// Grading happens on CLONED books and reaches storage only through
// saveRepertoire, the same discipline the line modes use with saveLine.
function runRepertoireRun(container: HTMLElement, books: Repertoire[]): void {
  const clones = books.map(b => ({ ...b, tree: structuredClone(b.tree) }));
  const plan: RunPlan = planRepertoireRun(clones);
  if (plan.positions.length === 0) {
    void doRender(container);
    return;
  }

  const bookById = new Map(clones.map(b => [b.id, b]));
  const posByNode = new Map<MoveNode, RunPosition>(plan.positions.map(p => [p.expected, p]));

  const missed = new Set<string>();
  const stats = { reviewed: 0, missed: 0, openings: new Map<string, OpeningTally>() };
  const mistakes: Mistake[] = [];
  const mistakeKeys = new Set<string>();

  // ONE chain for every write this mode makes. A step's own save has to land
  // before the cross-book credit re-reads storage, or the credit's
  // read-modify-write would overwrite the grade that was just made — and two
  // steps in the same book would race each other over the whole tree.
  let writes: Promise<unknown> = Promise.resolve();
  const queue = (job: () => Promise<unknown>): void => {
    writes = writes.then(job, job);
  };

  const totalRounds = Math.max(1, Math.ceil(plan.positions.length / ROUND_SIZE_POSITIONS));
  let index = 0;
  let roundNo = 0;

  function runRunRound(): void {
    // …plus which recap rows already existed, so the round screen can list only
    // what this round adds (see renderRoundScreen).
    const before = {
      reviewed: stats.reviewed,
      missed: stats.missed,
      keys: new Set(stats.openings.keys()),
    };
    const slice = plan.positions.slice(index, index + ROUND_SIZE_POSITIONS);
    index += slice.length;
    roundNo += 1;

    startPositionsDrill(
      slice.map(p => ({ preFen: p.preFen, expected: p.expected, prevUci: p.prevUci, prevFen: p.prevFen })),
      {
        wrongMoveMode: 'full',
        confirmAbandon: true,
        modeLabel: 'Repertoire run',
        playPrelude: true,
        celebrateOnComplete: true,
        completeMessage: 'Book walked ✓',
        recordMiss: (node) => { missed.add(node.id); },
        onStepComplete: (expected) => {
          const pos = posByNode.get(expected);
          const book = pos ? bookById.get(pos.repertoireId) : undefined;
          if (!pos || !book) return;
          const now = new Date();
          const wasMissed = missed.has(expected.id);
          if (wasMissed) {
            addMistake(mistakes, mistakeKeys, pos.preFen, expected,
              { prevUci: pos.prevUci, prevFen: pos.prevFen });
            recordMissedMove(pos.preFen, expected.san, pos.colour);
          }
          const quality = qualityFromMisses(wasMissed ? 1 : 0);
          // Spacing comes from the priority resolved AT THIS NODE, so a branch
          // the user marked "less often" is respected move by move rather than
          // through whichever line happens to be named here.
          expected.review = gradeReview(
            expected.review ?? newReview(now), quality, now, PRIORITY_SPACING[pos.priority]);
          // "Last trained" is a fact about a line, so it lands on the line end
          // this move belongs to rather than on the move itself.
          const owner = locateLine([book], pos.lineId);
          if (owner) owner.end.lastTrained = now.toISOString();

          queue(() => saveRepertoire(book));
          // The same move in another BOOK is still the same work (§8). Inside
          // this book there is nothing to credit — the node is already shared.
          queue(() => queueWriteThrough(
            [{ preFen: pos.preFen, uci: expected.uci, review: expected.review! }], pos.lineId));

          recordReviewed(1);
          recordReviewOutcome(wasMissed ? 0 : 1, wasMissed ? 1 : 0);
          bumpOpening(
            stats.openings, `${pos.repertoireId}:${expected.id}`, pos.lineName,
            wasMissed ? 0 : 1, wasMissed ? 1 : 0,
            {
              onOpen: () => openTrainingPeek({
                fen: pos.preFen,
                orientation: pos.colour,
                hintUci: expected.uci,
                onTurnOff: () => void getLine(pos.lineId).then(l => {
                  if (l) void saveLine({ ...l, inTraining: false });
                }),
                onEdit: () => void getLine(pos.lineId).then(l => {
                  if (l) onViewLine?.(l, pos.preFen);
                }),
              }),
              statsLine: reviewStatsLine(expected.review),
            },
          );
          stats.reviewed++;
          if (wasMissed) stats.missed++;
        },
        onComplete: () => {
          if (index >= plan.positions.length) {
            renderIndividualComplete(container, stats, mistakes);
          } else {
            if (stats.reviewed > 0) recordTrainingDay();
            const remaining = plan.positions.length - index;
            renderRoundScreen(container, {
              roundNo,
              totalRounds,
              correct: (stats.reviewed - before.reviewed) - (stats.missed - before.missed),
              missed: stats.missed - before.missed,
              remainingLabel: `${remaining} move${remaining === 1 ? '' : 's'} left`,
              rows: reviewedOpeningRows(newTally(stats.openings, before.keys)),
              rowsLabel: 'Moves in this round',
              onNext: runRunRound,
            });
          }
        },
        onCancel: () => void doRender(container),
      },
    );
  }

  runRunRound();
}

function runIndividual(container: HTMLElement, trainingLines: Line[]): void {
  // Work on clones so grading edits only persist through saveLine, never the
  // in-memory list.
  const clones = trainingLines.map(l => ({ ...l, tree: structuredClone(l.tree) }));
  const positions = selectIndividualPositions(clones);
  if (positions.length === 0) {
    void doRender(container);
    return;
  }

  const cloneById = new Map(clones.map(c => [c.id, c]));
  // Map each quizzed node back to its line, so a finished position knows what
  // to grade and save.
  const lineByNode = new Map(positions.map(p => [p.expected, cloneById.get(p.lineId)!]));

  const missed = new Set<string>();
  const stats = { reviewed: 0, missed: 0, openings: new Map<string, OpeningTally>() };
  const mistakes: Mistake[] = [];
  const mistakeKeys = new Set<string>();

  // Chunk the stream into rounds so a long Fix-mistakes run can be banked in
  // stages. Each position is graded and saved on its own (onStepComplete), so
  // closing between rounds loses nothing. stats/mistakes accumulate across the
  // whole sitting; the round screen shows just that round's delta.
  const totalRounds = Math.max(1, Math.ceil(positions.length / ROUND_SIZE_POSITIONS));
  let index = 0;
  let roundNo = 0;

  function runPositionRound(): void {
    const before = {
      reviewed: stats.reviewed,
      missed: stats.missed,
      keys: new Set(stats.openings.keys()),
    };
    const slice = positions.slice(index, index + ROUND_SIZE_POSITIONS);
    index += slice.length;
    roundNo += 1;

    startPositionsDrill(
      slice.map(p => ({ preFen: p.preFen, expected: p.expected, prevUci: p.prevUci, prevFen: p.prevFen })),
      {
        wrongMoveMode: 'full',
        confirmAbandon: true,
        modeLabel: 'Individual moves',
        // Replay the opponent's move into each position so you see how it arose.
        playPrelude: true,
        celebrateOnComplete: true,
        completeMessage: 'Positions cleared ✓',
        // Strict training: no checkAlternative/onExplore — only the stored move
        // is accepted; anything else is a miss.
        recordMiss: (node) => { missed.add(node.id); },
        onStepComplete: (expected) => {
          const line = lineByNode.get(expected);
          if (!line) return;
          const pos = positions.find(p => p.expected === expected);
          const now = new Date();
          const wasMissed = missed.has(expected.id);
          if (wasMissed && pos) {
            addMistake(mistakes, mistakeKeys, pos.preFen, expected, { prevUci: pos.prevUci, prevFen: pos.prevFen });
            recordMissedMove(pos.preFen, expected.san, line.colour);
          }
          const quality = qualityFromMisses(wasMissed ? 1 : 0);
          expected.review = gradeReview(
            expected.review ?? newReview(now), quality, now, lineSpacing(line));
          line.lastTrained = now.toISOString();
          line.confidence = lineConfidence(line);
          void saveLine(line);
          // The same move in any other line is the same work (§8).
          if (pos) {
            void queueWriteThrough(
              [{ preFen: pos.preFen, uci: expected.uci, review: expected.review }], line.id);
          }
          recordReviewed(1);
          // One move graded: one entry on the remembered-vs-failed bar.
          recordReviewOutcome(wasMissed ? 0 : 1, wasMissed ? 1 : 0);
          bumpOpening(
            stats.openings, `${line.id}:${expected.id}`, line.openingName || line.name,
            wasMissed ? 0 : 1, wasMissed ? 1 : 0,
            {
              onOpen: () => openTrainingPeek({
                fen: pos?.preFen ?? expected.fen,
                orientation: line.colour,
                hintUci: expected.uci,
                onNote: () => openQuickNoteSheet(line, expected),
                onTurnOff: () => { void saveLine({ ...line, inTraining: false }); },
                onEdit: () => onViewLine?.(line, pos?.preFen),
              }),
              statsLine: reviewStatsLine(expected.review),
            },
          );
          stats.reviewed++;
          if (wasMissed) stats.missed++;
        },
        onComplete: () => {
          if (index >= positions.length) {
            renderIndividualComplete(container, stats, mistakes);
          } else {
            if (stats.reviewed > 0) recordTrainingDay();
            const remaining = positions.length - index;
            renderRoundScreen(container, {
              roundNo,
              totalRounds,
              correct: (stats.reviewed - before.reviewed) - (stats.missed - before.missed),
              missed: stats.missed - before.missed,
              remainingLabel: `${remaining} position${remaining === 1 ? '' : 's'} left`,
              rows: reviewedOpeningRows(newTally(stats.openings, before.keys)),
              rowsLabel: 'Moves in this round',
              onNext: runPositionRound,
            });
          }
        },
        onCancel: () => void doRender(container),
      },
    );
  }

  runPositionRound();
}

function renderIndividualComplete(
  container: HTMLElement,
  stats: { reviewed: number; missed: number; openings: Map<string, OpeningTally> },
  mistakes: Mistake[],
  nextAction?: NextAction,
): void {
  if (stats.reviewed > 0) recordTrainingDay();

  const { panel, close, dismiss } = mountCompletionOverlay(container);

  const correct = stats.reviewed - stats.missed;
  const head = completionHead(
    'Positions cleared ✓',
    `${stats.reviewed} position${stats.reviewed === 1 ? '' : 's'} drilled`,
  );
  appendStatsRow(head, correct, stats.missed, 'missed', 'first try');

  const reschedNote = document.createElement('div');
  reschedNote.className = 'train-all-done';
  reschedNote.textContent = stats.missed > 0
    ? 'Missed positions are scheduled to come back sooner.'
    : 'Clean run — every position remembered!';
  head.appendChild(reschedNote);

  // Per-opening recap (same style as the puzzle results).
  const openingRows = reviewedOpeningRows(stats.openings);
  if (openingRows.length > 0) {
    const sectionHead = document.createElement('div');
    sectionHead.className = 'summary-needs-work-head';
    sectionHead.textContent = 'Openings reviewed';
    head.appendChild(sectionHead);
    panel.appendChild(head);
    panel.appendChild(completionList(openingRows));
  } else {
    head.classList.add('pz-results-head--fill');
    panel.appendChild(head);
  }

  const actions = completionActions();
  appendReviewActions(actions, container, mistakes, close, dismiss, nextAction);
  panel.appendChild(actions);

  if (stats.reviewed > 0) burstConfetti(panel);
}

// Give a finished-screen panel its playful send-off: the hopping pixel pawn at
// the top, and a staggered entrance for everything beneath it. Call this once
// the panel's content is built (the pawn is prepended, so it leads the stagger).
// Shared by every completion screen so they all feel of a piece.
// ── Full-screen completion overlay ───────────────────────────────────────────
//
// The final completion screens (session / positions / mistakes / timed) take
// over the whole screen — no app header, no bottom nav — exactly like the puzzle
// results, so they read as a clean "you're done" moment. The panel reuses the
// puzzle results layout (`.pz-results`): a fixed head up top, an optional faded
// scroll list, and the action buttons pinned to the bottom.
//
// `close()` tears the overlay down and returns to the Train hub (restoring the
// FAB); `dismiss()` just removes the overlay (used when handing straight off to a
// retry/replay drill that will draw its own overlay).
// The completion overlay currently on screen, if there is one. Anything that
// LEAVES training from inside it has to take it down on the way out: it's a
// fixed, full-screen layer on <body>, so navigating out from under it lands you
// on the builder with the results screen still covering it — which is exactly
// what "the Edit button doesn't open the line" looked like.
let dismissCompletion: (() => void) | null = null;

function mountCompletionOverlay(container: HTMLElement): {
  panel: HTMLElement;
  close: () => void;
  dismiss: () => void;
} {
  setFabVisible?.(false);

  const overlay = document.createElement('div');
  overlay.className = 'pt-overlay train-complete-overlay';

  const panel = document.createElement('div');
  panel.className = 'train-completion train-completion--enter pz-results';
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  let done = false;
  let removeBack: (() => void) | null = null;
  const dismiss = (): void => {
    if (done) return;
    done = true;
    removeBack?.();
    overlay.remove();
    if (dismissCompletion === dismiss) dismissCompletion = null;
  };
  const close = (): void => {
    dismiss();
    void doRender(container);
  };
  removeBack = pushBack(close);
  dismissCompletion = dismiss;
  return { panel, close, dismiss };
}

// The head block of a completion panel: the hopping pawn, the "done" line and a
// subtitle. Returns the head element so the caller can append its own extras
// (stat row, notes, best line) before the list/actions.
function completionHead(doneText: string, subText: string): HTMLElement {
  const head = document.createElement('div');
  head.className = 'pz-results-head';
  head.appendChild(celebratePawn());
  const done = document.createElement('div');
  done.className = 'train-completion-done';
  done.textContent = doneText;
  head.appendChild(done);
  const sub = document.createElement('div');
  sub.className = 'train-completion-name';
  sub.textContent = subText;
  head.appendChild(sub);
  return head;
}

// A scrollable list with a bottom gradient fade — the same "there's more below"
// affordance the puzzle results use. Pass the already-built rows.
function completionList(rows: HTMLElement[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pz-results-list-wrap';
  const list = document.createElement('div');
  list.className = 'pz-results-list';
  for (const r of rows) list.appendChild(r);
  wrap.appendChild(list);
  const fade = document.createElement('div');
  fade.className = 'pz-results-fade';
  fade.setAttribute('aria-hidden', 'true');
  wrap.appendChild(fade);
  return wrap;
}

// The bottom action strip (flex:none), pinned below the head/list.
function completionActions(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'pz-results-actions';
  return el;
}

// A correct/missed stat pair, shared by the round and session screens.
function appendStatsRow(
  wrap: HTMLElement,
  correct: number,
  missed: number,
  missLabel: string,
  correctLabel = 'correct',
): void {
  const statsRow = document.createElement('div');
  statsRow.className = 'summary-stats-row';

  const rightBox = document.createElement('div');
  rightBox.className = 'summary-stat-box summary-stat-box--right';
  const rightVal = document.createElement('div');
  rightVal.className = 'summary-stat-value';
  countUp(rightVal, correct);
  const rightLbl = document.createElement('div');
  rightLbl.className = 'summary-stat-label';
  rightLbl.textContent = correctLabel;
  rightBox.appendChild(rightVal);
  rightBox.appendChild(rightLbl);
  statsRow.appendChild(rightBox);

  const missBox = document.createElement('div');
  missBox.className = `summary-stat-box ${missed > 0 ? 'summary-stat-box--missed' : 'summary-stat-box--zero'}`;
  const missVal = document.createElement('div');
  missVal.className = 'summary-stat-value';
  countUp(missVal, missed);
  const missLbl = document.createElement('div');
  missLbl.className = 'summary-stat-label';
  missLbl.textContent = missLabel;
  missBox.appendChild(missVal);
  missBox.appendChild(missLbl);
  statsRow.appendChild(missBox);

  wrap.appendChild(statsRow);
}

// ── Reviewed-openings list (every mode) ───────────────────────────────────────
//
// A per-opening recap in the puzzle-results style: one row per opening you just
// reviewed, a ✓ when nothing was missed in it and a ✕ when something was, plus a
// "correct/total" tally on the right. Worst-first so the spots needing work lead.
// Built from a small tally each mode fills as it grades.
//
// Every row links back to its position (onOpen — opens the position-peek
// popup in place, see openPositionPeek below) and shows what the scheduler
// already knows about it (statsLine). Rows are keyed per-line (session-
// complete) or per-quizzed-move (timed/individual/positions), never merged
// across different lines sharing an opening name, so onOpen always points at
// one real position.

interface OpeningTally {
  name: string;
  correct: number;
  incorrect: number;
  onOpen?: () => void;
  statsLine?: string;
  // Set on a line that has now been drilled clean often enough to have proved
  // itself. The row says so and the way on is its popup's Edit.
  grow?: boolean;
}

function bumpOpening(
  tally: Map<string, OpeningTally>,
  key: string,
  name: string,
  correct: number,
  incorrect: number,
  extras?: Pick<OpeningTally, 'onOpen' | 'statsLine' | 'grow'>,
): void {
  const cur = tally.get(key) ?? { name: name || 'Untitled', correct: 0, incorrect: 0, ...extras };
  cur.correct += correct;
  cur.incorrect += incorrect;
  tally.set(key, cur);
}

// A one-line caption from what the scheduler already stores on a move: lifetime
// misses, the current clean-recall streak, and when it's next due.
function reviewStatsLine(review: MoveNode['review'] | undefined): string {
  const parts: string[] = [];
  if (review) {
    parts.push(`Failed ${review.lapses}×`);
    parts.push(`${review.reps} in a row`);
  }
  parts.push(describeDue(review?.due ?? null));
  return parts.join(' · ');
}

// The same caption for a whole line: its weakest user-move (shortest interval /
// soonest due) decides, mirroring how lineBucket() already picks the weakest
// move to bucket a line as due/learning/solid.
function lineStatsLine(line: Line): string | undefined {
  const nodes = userMoveNodes(line.tree, line.colour);
  if (nodes.length === 0) return undefined;
  let weakest = nodes[0];
  let weakestInterval = weakest.review?.interval ?? -1;
  for (const n of nodes) {
    const iv = n.review?.interval ?? -1;
    if (iv < weakestInterval) { weakest = n; weakestInterval = iv; }
  }
  return reviewStatsLine(weakest.review);
}

// One row per reviewed line, keyed by line.id so two different lines never
// merge even if they share a detected opening name.
function tallyFromLineStats(lineStats: Map<string, LineSessionStat>): Map<string, OpeningTally> {
  const tally = new Map<string, OpeningTally>();
  for (const [id, s] of lineStats) {
    tally.set(id, {
      name: s.openingName || s.lineName,
      correct: s.totalMoves - s.misses,
      incorrect: s.misses,
      // A finished line has no single "next move" to hint at, so no hintUci —
      // just the end position, with a note on its last move.
      onOpen: () => {
        const moves = mainlineOf(s.line.tree);
        openTrainingPeek({
          fen: lineFinalFen(s.line.tree),
          orientation: s.line.colour,
          onNote: () => openQuickNoteSheet(s.line, moves[moves.length - 1]),
          onTurnOff: () => { void saveLine({ ...s.line, inTraining: false }); },
          onEdit: () => onViewLine?.(s.line),
        });
      },
      statsLine: lineStatsLine(s.line),
      // The line just came round again and was graded, so this is the moment
      // its recall is most worth reading: a line that comes back clean run after
      // run has stopped teaching anything, and the useful next step is more
      // moves rather than more reps.
      grow: lineMastered(s.line),
    });
  }
  return tally;
}

// The recap entries a round ADDED — everything whose key wasn't there when the
// round started. Rounds never revisit material, so a plain key diff is exact and
// costs nothing to keep: no per-round bookkeeping alongside the cumulative
// tally that the final screen needs anyway.
function newTally(
  tally: Map<string, OpeningTally>,
  before: Set<string>,
): Map<string, OpeningTally> {
  return new Map([...tally].filter(([key]) => !before.has(key)));
}

function reviewedOpeningRows(tally: Map<string, OpeningTally>): HTMLElement[] {
  const ordered = [...tally.values()].sort((a, b) => {
    const total = (o: OpeningTally): number => o.correct + o.incorrect;
    const rateA = total(a) ? a.incorrect / total(a) : 0;
    const rateB = total(b) ? b.incorrect / total(b) : 0;
    return rateB !== rateA ? rateB - rateA : b.incorrect - a.incorrect;
  });
  return ordered.map((o) => {
    const total = o.correct + o.incorrect;
    const clean = o.incorrect === 0;
    const row = document.createElement('div');
    row.className = 'pz-result-row ' + (clean ? 'pz-result-row--solved' : 'pz-result-row--missed')
      + (o.onOpen ? ' pz-result-row--linked' : '');

    if (o.onOpen) {
      const onOpen = o.onOpen;
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      row.addEventListener('click', () => onOpen());
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } });
    }

    const dot = document.createElement('span');
    dot.className = 'pz-result-dot';
    dot.textContent = clean ? '✓' : '✕';
    row.appendChild(dot);

    const main = document.createElement('div');
    main.className = 'pz-result-main';
    const name = document.createElement('div');
    name.className = 'pz-result-name';
    name.textContent = o.name;
    main.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'pz-result-meta';
    meta.textContent = clean ? 'all remembered' : `${o.incorrect} missed`;
    main.appendChild(meta);
    if (o.statsLine) {
      const stats = document.createElement('div');
      stats.className = 'pz-result-stats';
      stats.textContent = o.statsLine;
      main.appendChild(stats);
    }
    if (o.grow) {
      const grow = document.createElement('div');
      grow.className = 'pz-result-grow';
      grow.textContent = '★ Mastered — keep adding moves';
      main.appendChild(grow);
    }
    row.appendChild(main);

    const tallyEl = document.createElement('span');
    tallyEl.className = 'pz-result-rating';
    tallyEl.textContent = `${o.correct}/${total}`;
    row.appendChild(tallyEl);

    return row;
  });
}

// A minimal note editor for a specific line's move — used by the results
// screen's position-peek popup, where the move being noted isn't the
// currently-open builder line. The sheet itself lives in note-sheet.ts (shared
// with the chronic-miss prompt); this just supplies the copy and the save.
function openQuickNoteSheet(line: Line, node: MoveNode): void {
  void openMoveNoteSheet({
    node,
    title: `Note for ${formatMove(node.san)}`,
    placeholder: 'Reminder or plan for this move…',
    onSave: () => { void saveLine(line); },
  });
}

// A results-screen row, tapped: show the position right here rather than
// leaving training for the Board Builder. The popup itself lives in
// position-peek.ts (shared with Statistics); this wires the training-specific
// actions — Add note / Turn off, plus one explicit Edit, the only action that
// leaves for the Board Builder, so navigating away is always a deliberate tap.
function openTrainingPeek(opts: {
  fen: string;
  orientation: 'white' | 'black';
  hintUci?: string;
  onNote?: () => void;
  onTurnOff?: () => void;
  onEdit: () => void;
}): void {
  const actions: PeekAction[] = [];

  if (opts.onNote) {
    const onNote = opts.onNote;
    actions.push({ icon: Icons.note(18), label: 'Add note', onClick: () => onNote() });
  }
  if (opts.onTurnOff) {
    const onTurnOff = opts.onTurnOff;
    actions.push({
      icon: Icons.toggleOff(18),
      label: 'Turn off',
      onClick: ({ disable }) => {
        onTurnOff();
        disable();
        showToast('Line turned off, continue training');
      },
    });
  }
  // Edit is the one action here that leaves training, so it takes the results
  // screen down with it — the popup alone isn't the whole layer in the way.
  actions.push({
    icon: Icons.pencil(18),
    label: 'Edit',
    onClick: ({ close }) => { close(); dismissCompletion?.(); opts.onEdit(); },
  });

  openPositionPeek({
    fen: opts.fen,
    orientation: opts.orientation,
    hintUci: opts.hintUci,
    actions,
  });
}

// ── Round-complete panel ─────────────────────────────────────────────────────
//
// Shown between rounds (only when material remains). Light by design: this
// round's numbers, a gentle starfall, and the choice to push on or bank it.
// Shared by the line-rounds and the individual-moves rounds.

function renderRoundScreen(
  container: HTMLElement,
  opts: {
    roundNo: number;
    totalRounds: number;
    correct: number;
    missed: number;
    remainingLabel: string;
    onNext: () => void;
    // The lines THIS round covered, as result rows. A four-round sitting used to
    // show nothing but a tally until the very end, which is the wrong twenty
    // minutes to wait: the round you have just played is the one you can still
    // remember, and the row is how you get to the position that beat you. The
    // final screen still lists the whole sitting.
    rows?: HTMLElement[];
    rowsLabel?: string;
  },
): void {
  // Mount as a full-screen overlay (like the session-complete screen) rather than
  // inline in the openings pane — otherwise the daily-challenge card and tabs
  // rendered above the pane stay visible behind this between-round recap.
  const { panel, close, dismiss } = mountCompletionOverlay(container);

  const head = completionHead(
    `Round ${opts.roundNo} done ✓`,
    `Round ${opts.roundNo} of ${opts.totalRounds}`,
  );
  appendStatsRow(head, opts.correct, opts.missed, 'missed');

  const note = document.createElement('div');
  note.className = 'train-all-done';
  note.textContent = opts.remainingLabel;
  head.appendChild(note);

  if (opts.rows?.length) {
    const sectionHead = document.createElement('div');
    sectionHead.className = 'summary-needs-work-head';
    sectionHead.textContent = opts.rowsLabel ?? 'This round';
    head.appendChild(sectionHead);
    panel.appendChild(head);
    panel.appendChild(completionList(opts.rows));
  } else {
    // Nothing to list — let the head fill the panel as it always did.
    head.classList.add('pz-results-head--fill');
    panel.appendChild(head);
  }

  const actions = completionActions();

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'btn-primary train-next-btn';
  next.textContent = 'Next round →';
  // Dismiss this overlay, then start the next round (which mounts its own
  // full-screen drill overlay) — the pane is never exposed in between.
  next.addEventListener('click', () => { dismiss(); opts.onNext(); });
  actions.appendChild(next);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn-secondary train-done-btn';
  closeBtn.textContent = 'Save & close';
  closeBtn.addEventListener('click', close);
  actions.appendChild(closeBtn);

  panel.appendChild(actions);

  // A gentle reward — lighter than the finish-line confetti.
  starfall(panel);
}

// The line-rounds round screen: this round's move tally + lines remaining. The
// streak is recorded here so closing mid-sitting still counts today.
function renderRoundComplete(
  container: HTMLElement,
  runner: RoundRunner,
  before: { lines: number; missed: number; moves: number; lineIds: Set<string> },
): void {
  if (runner.stats.linesReviewed > 0) recordTrainingDay();

  const roundMoves = runner.stats.totalMoves - before.moves;
  const roundMissed = runner.stats.movesMissed - before.missed;
  const remaining = runner.lines.length - runner.index;

  // lineStats is cumulative across the whole sitting, and each round draws a
  // distinct slice of the queue — so the entries that weren't there when this
  // round started ARE this round's lines.
  const thisRound = new Map(
    [...runner.stats.lineStats].filter(([id]) => !before.lineIds.has(id)));

  renderRoundScreen(container, {
    roundNo: runner.roundNo,
    totalRounds: runner.totalRounds,
    correct: roundMoves - roundMissed,
    missed: roundMissed,
    remainingLabel: `${remaining} line${remaining === 1 ? '' : 's'} left`,
    rows: reviewedOpeningRows(tallyFromLineStats(thisRound)),
    rowsLabel: 'Lines in this round',
    onNext: () => runRound(runner, container),
  });
}

// ── Session-complete panel ──────────────────────────────────────────────────────

function renderSessionComplete(container: HTMLElement, stats: SessionStats, nextAction?: NextAction): void {
  // A session that reviewed at least one line counts as today's training for
  // the Home-screen streak.
  if (stats.linesReviewed > 0) recordTrainingDay();

  const { panel, close, dismiss } = mountCompletionOverlay(container);

  const correctMoves = stats.totalMoves - stats.movesMissed;
  const head = completionHead(
    'Session complete ✓',
    `${stats.linesReviewed} line${stats.linesReviewed === 1 ? '' : 's'} reviewed`,
  );
  appendStatsRow(head, correctMoves, stats.movesMissed, 'missed');

  // A clean run still gets its one-line cheer above the list.
  if (stats.movesMissed === 0 && stats.linesReviewed > 0) {
    const cleanEl = document.createElement('div');
    cleanEl.className = 'summary-clean-run';
    cleanEl.textContent = 'Clean run — all moves remembered!';
    head.appendChild(cleanEl);
  }

  // Lines that have now been round enough times, clean, to count as learned.
  // The trainer knows where the book stops, so this is the one screen that can
  // honestly say "this one is done — go and make it longer": the reps have
  // stopped paying, and depth is what's left to gain.
  const mastered = [...stats.lineStats.values()].filter(l => lineMastered(l.line));
  if (mastered.length > 0) {
    const grown = document.createElement('div');
    grown.className = 'summary-mastered';
    // The rows below name the lines (and carry their own ★ chip), so the
    // headline doesn't repeat a name that would wrap to three lines.
    grown.textContent = mastered.length === 1
      ? "You've mastered this line — keep adding moves to it."
      : `You've mastered ${mastered.length} of these lines — keep adding moves.`;
    head.appendChild(grown);
  }

  // Every reviewed opening, recapped with correct/incorrect in the puzzle-results
  // style (worst-first). The same faded, scrollable affordance keeps it to one
  // screen.
  const openingRows = reviewedOpeningRows(tallyFromLineStats(stats.lineStats));
  if (openingRows.length > 0) {
    const sectionHead = document.createElement('div');
    sectionHead.className = 'summary-needs-work-head';
    sectionHead.textContent = 'Openings reviewed';
    head.appendChild(sectionHead);
    panel.appendChild(head);
    panel.appendChild(completionList(openingRows));

    if (stats.movesMissed > 0) {
      const reschedNote = document.createElement('div');
      reschedNote.className = 'train-all-done train-all-done--pinned';
      reschedNote.textContent = 'Missed moves are scheduled to come back sooner.';
      panel.appendChild(reschedNote);
    }
  } else {
    head.classList.add('pz-results-head--fill');
    panel.appendChild(head);
  }

  const actions = completionActions();
  appendReviewActions(actions, container, stats.mistakes, close, dismiss, nextAction);
  panel.appendChild(actions);

  // Celebrate a genuinely-finished session (at least one line reviewed) with the
  // same tasteful burst the per-line drill uses. Honours reduced-motion itself.
  if (stats.linesReviewed > 0) burstConfetti(panel);
}

// ── End-of-session review (all modes) ─────────────────────────────────────────
//
// Every completed session ends the same way: if anything was missed, offer to
// drill just those positions ("Try your mistakes again"); otherwise just close.
// The retry reuses the normal teaching drill (arrows + notes), so it doubles as
// a focused fix-up of the exact spots that tripped you up.

function appendReviewActions(
  actions: HTMLElement,
  container: HTMLElement,
  mistakes: Mistake[],
  close: () => void,
  dismiss: () => void,
  nextAction?: NextAction,
): void {
  // Daily challenge: the chain to the next task leads, and the mistake retry
  // steps down to a secondary so there's exactly one green action.
  if (nextAction) {
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'btn-primary train-next-btn';
    next.textContent = nextAction.label;
    next.addEventListener('click', () => { dismiss(); nextAction.run(); });
    actions.appendChild(next);
  }

  if (mistakes.length > 0) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = nextAction ? 'btn-secondary train-done-btn' : 'btn-primary train-next-btn';
    retry.textContent = `Try your mistakes again (${mistakes.length})`;
    retry.addEventListener('click', () => { dismiss(); runMistakesReview(container, mistakes); });
    actions.appendChild(retry);
  }

  const close_ = document.createElement('button');
  close_.type = 'button';
  close_.className = 'btn-secondary train-done-btn';
  close_.textContent = 'Close training';
  close_.addEventListener('click', close);
  actions.appendChild(close_);
}

// Re-drill a set of missed positions in the normal teaching mode. Whatever's
// still shaky afterwards can be looped through again.
function runMistakesReview(container: HTMLElement, mistakes: Mistake[]): void {
  if (mistakes.length === 0) { void doRender(container); return; }

  const stillMissed = new Set<MoveNode>();

  startPositionsDrill(
    mistakes.map(m => ({ preFen: m.preFen, expected: m.expected, prevUci: m.prevUci, prevFen: m.prevFen })),
    {
      wrongMoveMode: 'full',
      modeLabel: 'Your mistakes',
      // Replay the opponent's last move into each position so it reads in
      // context (matches the individual-moves drill) instead of appearing cold.
      playPrelude: true,
      celebrateOnComplete: true,
      completeMessage: 'Mistakes reviewed ✓',
      // Strict training: no checkAlternative/onExplore — only the stored move
      // is accepted; anything else is a miss.
      recordMiss: (node) => { stillMissed.add(node); },
      onComplete: () => {
        const again = mistakes.filter(m => stillMissed.has(m.expected));
        renderReviewComplete(container, mistakes.length, again);
      },
      onCancel: () => void doRender(container),
    },
  );
}

function renderReviewComplete(
  container: HTMLElement,
  reviewed: number,
  again: Mistake[],
): void {
  recordTrainingDay();

  const { panel, close, dismiss } = mountCompletionOverlay(container);

  const head = completionHead(
    'Mistakes reviewed ✓',
    `${reviewed} position${reviewed === 1 ? '' : 's'} revisited`,
  );
  head.classList.add('pz-results-head--fill');

  const note = document.createElement('div');
  note.className = 'train-all-done';
  note.textContent = again.length > 0
    ? `Still shaky on ${again.length} — give them another go.`
    : 'All cleared — nicely done!';
  head.appendChild(note);
  panel.appendChild(head);

  const actions = completionActions();
  appendReviewActions(actions, container, again, close, dismiss);
  panel.appendChild(actions);

  burstConfetti(panel);
}

// ── Timed mode ────────────────────────────────────────────────────────────────
//
// A countdown (1, 3 or 5 minutes) over individual positions: the goal is as many
// correct as possible. A wrong answer flashes and skips on at once (no
// dwelling); the pool cycles until the clock runs out. The end screen shows the
// score against this duration's personal best, with a "Retry mistakes" drill of
// everything missed.

function runTimed(container: HTMLElement, allLines: Line[], minutes: TimedMinutes): void {
  const clones = allLines.map(l => ({ ...l, tree: structuredClone(l.tree) }));
  // Always-playable pool: normal in-training positions first, falling back to
  // any saved position (shallow / paused) when little has been trained.
  const positions = selectTimedPositions(clones, { max: 80 });
  if (positions.length === 0) { void doRender(container); return; }

  // Map each quizzed move back to its line — used for the recap's opening
  // name, its link back to the position, and its Add note/Turn off/Edit
  // controls. Timed mode never grades (it's a scored sprint, not spaced
  // repetition), so a position's review here is whatever it already was.
  const cloneById = new Map(clones.map(c => [c.id, c]));
  const lineByNode = new Map(positions.map(p => [p.expected, cloneById.get(p.lineId)!]));

  const mistakes: Mistake[] = [];
  const mistakeKeys = new Set<string>();
  const openings = new Map<string, OpeningTally>();
  let correct = 0;
  let wrong = 0;

  startTimedDrill(
    positions.map(p => ({ preFen: p.preFen, expected: p.expected, prevUci: p.prevUci, prevFen: p.prevFen })),
    {
      timedMs: minutes * 60 * 1000,
      confirmAbandon: true,
      modeLabel: 'Timed',
      // Mark the opponent's last move so the position reads at a glance (no replay —
      // speed is the point).
      showLastMove: true,
      onTimedResult: (ok, pos) => {
        if (ok) {
          correct++;
        } else {
          wrong++;
          // The drill's result position drops the prelude; recover it from the
          // source pool so a later mistakes-retry can replay the opponent's move.
          const src = positions.find(p => p.expected === pos.expected);
          addMistake(mistakes, mistakeKeys, pos.preFen, pos.expected, { prevUci: src?.prevUci, prevFen: src?.prevFen });
        }
        const line = lineByNode.get(pos.expected);
        bumpOpening(
          openings, line ? `${line.id}:${pos.expected.id}` : pos.expected.id,
          line ? (line.openingName || line.name) : 'Untitled',
          ok ? 1 : 0, ok ? 0 : 1,
          line ? {
            onOpen: () => openTrainingPeek({
              fen: pos.preFen,
              orientation: line.colour,
              hintUci: pos.expected.uci,
              onNote: () => openQuickNoteSheet(line, pos.expected),
              onTurnOff: () => { void saveLine({ ...line, inTraining: false }); },
              onEdit: () => onViewLine?.(line, pos.preFen),
            }),
            statsLine: reviewStatsLine(pos.expected.review),
          } : undefined,
        );
      },
      onComplete: () => renderTimedComplete(container, allLines, minutes, correct, wrong, mistakes, openings),
      onCancel: () => void doRender(container),
    },
  );
}

function renderTimedComplete(
  container: HTMLElement,
  allLines: Line[],
  minutes: TimedMinutes,
  correct: number,
  wrong: number,
  mistakes: Mistake[],
  openings: Map<string, OpeningTally>,
): void {
  if (correct > 0 || wrong > 0) recordTrainingDay();

  const prevBest = getTimedBest(minutes);
  const isNewBest = recordTimedBest(minutes, correct);

  const { panel, close, dismiss } = mountCompletionOverlay(container);

  const head = completionHead(
    "Time's up ⏱",
    `${correct} correct in ${minutes} minute${minutes === 1 ? '' : 's'}`,
  );
  appendStatsRow(head, correct, wrong, 'mistakes');

  // Personal best line.
  const pb = document.createElement('div');
  if (isNewBest && correct > 0) {
    pb.className = 'timed-best timed-best--new';
    pb.textContent = `New personal best! 🎉 (was ${prevBest})`;
  } else {
    pb.className = 'timed-best';
    pb.textContent = prevBest > 0
      ? `Personal best: ${prevBest} — beat it next time`
      : 'Answer one to set your first personal best!';
  }
  head.appendChild(pb);

  // Per-opening recap (same style as the puzzle results).
  const openingRows = reviewedOpeningRows(openings);
  if (openingRows.length > 0) {
    const sectionHead = document.createElement('div');
    sectionHead.className = 'summary-needs-work-head';
    sectionHead.textContent = 'Openings reviewed';
    head.appendChild(sectionHead);
    panel.appendChild(head);
    panel.appendChild(completionList(openingRows));
  } else {
    head.classList.add('pz-results-head--fill');
    panel.appendChild(head);
  }

  // Actions: retry mistakes (teaching drill), play again, close.
  const actions = completionActions();
  if (mistakes.length > 0) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn-primary train-next-btn';
    retry.textContent = `Retry mistakes (${mistakes.length})`;
    retry.addEventListener('click', () => { dismiss(); runMistakesReview(container, mistakes); });
    actions.appendChild(retry);
  }

  const again = document.createElement('button');
  again.type = 'button';
  again.className = mistakes.length > 0 ? 'btn-secondary train-done-btn' : 'btn-primary train-next-btn';
  again.textContent = 'Play again';
  again.addEventListener('click', () => { dismiss(); runTimed(container, allLines, minutes); });
  actions.appendChild(again);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn-secondary train-done-btn';
  closeBtn.textContent = 'Close training';
  closeBtn.addEventListener('click', close);
  actions.appendChild(closeBtn);

  panel.appendChild(actions);

  burstConfetti(panel);
}
