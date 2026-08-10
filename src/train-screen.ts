import type { Line } from './types';
import type { MoveNode } from './tree';
import { getAllLines, saveLine, countGames } from './storage';
import {
  requestTrainingSlot,
  isEntitled,
  FREE_TRAINING_LINES,
  TRAINING_COUNT_VISIBLE_FROM,
} from './entitlement';
import { startDrill, startPositionsDrill, startTimedDrill, type DrillOptions } from './drill';
import { selectIndividualPositions, selectTimedPositions } from './individual';
import { Icons } from './icons';
import {
  getTimedBest,
  recordTimedBest,
  getDefaultTrainingMode,
  getShowPausedLines,
  setShowPausedLines,
  isOnboardingComplete,
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
import { formatMove } from './notation';
import { Chess } from 'chess.js';
import { buildEmptyState } from './empty-state';
import { renderStarterOnboarding, ONBOARDING_GOAL, type LineSeed, type AddLineMode } from './onboarding-starter';
import { renderTrainCards } from './train-cards';
import { createFilterBar, type FilterSelection } from './filters';
import { renderFamilyGroups, renderVariationGroups } from './line-groups';
import { showDialog } from './dialog';
import { TrainingSession, type SessionItem } from './session';
import { countUp } from './count-up';
import {
  userMoveNodes,
  gradeReview,
  newReview,
  qualityFromMisses,
  lineConfidence,
  lineBucket,
  dueLines,
  nextDue,
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
import { renderLoadError } from './load-error';
import { buildPositionCard, colourPip, lineFinalFen } from './card-position';
import { burstConfetti, starfall, celebratePawn } from './confetti';
import { pushBack } from './back-nav';
import { showToast } from './toast';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// How the quiet "view line" icon opens a line (in the builder, to step through
// it). An optional atFen opens the builder at that position (used by the drill's
// in-session "Edit" control). Set on every screen entry; held at module scope so
// the many internal doRender(container) calls — which only pass the container —
// keep working.
let onViewLine: ((line: Line, atFen?: string) => void) | null = null;

// The empty-state routes (open the builder; open the import-your-games flow).
// Module scope for the same reason as onViewLine.
let onBuildLine: (() => void) | null = null;
let onImportGames: (() => void) | null = null;
// "Connect Lichess", from the contextual card below the training list.
let onConnectLichess: (() => void) | null = null;
// Add a starter/suggested line to training (wired from main.ts, which owns
// lineFromUcis + addLineToTraining). See AddLineMode for what each mode does.
// Module scope, like the routes above.
let onAddStarterLine:
  | ((seed: LineSeed, colour: 'white' | 'black', mode: AddLineMode, onDone: () => void, onCancel: () => void) => void)
  | null = null;
// Onboarding's quieter routes: browse the opening library / build by playing the
// engine. Module scope, wired from main.ts like the others.
let onBrowseLibrary: (() => void) | null = null;
let onBuildWithEngine: (() => void) | null = null;

// Show/hide the global FAB (wired from main.ts, which owns the controller). The
// finish screens hide it so its ＋ doesn't sit over the celebration; the train
// list restores it. Navigating away resets it via the router, so a stale-hidden
// FAB can't leak onto other tabs.
let setFabVisible: ((visible: boolean) => void) | null = null;

// Which opening families are expanded in the grouped in-training list. Module
// scope so it survives the list's in-place rebuilds.
const trainExpanded = new Set<string>();

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

// ── Screen entry point ──────────────────────────────────────────────────────────

export function renderTrainScreen(
  container: HTMLElement,
  opts: {
    focusLineId?: string;
    autoStart?: boolean;
    onOpenLine?: (line: Line, atFen?: string) => void;
    onBuildLine?: () => void;
    onImportGames?: () => void;
    onAddStarterLine?: (
      seed: LineSeed,
      colour: 'white' | 'black',
      mode: AddLineMode,
      onDone: () => void,
      onCancel: () => void,
    ) => void;
    onBrowseLibrary?: () => void;
    onBuildWithEngine?: () => void;
    onConnectLichess?: () => void;
    onSetFabVisible?: (visible: boolean) => void;
  } = {},
): void {
  onViewLine = opts.onOpenLine ?? null;
  onBuildLine = opts.onBuildLine ?? null;
  onImportGames = opts.onImportGames ?? null;
  onConnectLichess = opts.onConnectLichess ?? null;
  onAddStarterLine = opts.onAddStarterLine ?? null;
  onBrowseLibrary = opts.onBrowseLibrary ?? null;
  onBuildWithEngine = opts.onBuildWithEngine ?? null;
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
  try {
    allLines = await getAllLines();
  } catch (err) {
    renderLoadError(container, err, () => void doRender(container, focusLineId, autoStart));
    return;
  }
  container.innerHTML = '';

  const trainingLines = allLines.filter(l => l.inTraining);

  // First-run gate: keep the onboarding flow up (no streak head — it reads as a
  // clean first run) until there are ONBOARDING_GOAL lines in training. Once the
  // user has ever reached the goal, the flag keeps them on the hub for good, even
  // if they later pause lines below it.
  if (!isOnboardingComplete() && trainingLines.length < ONBOARDING_GOAL) {
    renderEmpty(container, (await countGames()) > 0);
    return;
  }
  if (trainingLines.length >= ONBOARDING_GOAL) setOnboardingComplete();

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
  if (autoStart) {
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

  // The three offers the setup wizard used to make on first launch — import,
  // Lichess, appearance — now that there's a line for them to be about. Each
  // dismisses for good, so this is empty for anyone who's dealt with them.
  // Gated on actually having a line: someone who skipped the first run lands
  // here with nothing saved, and offering to restyle an empty repertoire is the
  // same mistimed question the wizard used to ask.
  if (allLines.length > 0) {
    renderTrainCards(state, {
      onImportGames: () => onImportGames?.(),
      onConnectLichess: () => onConnectLichess?.(),
      onChanged: () => void doRender(container),
    });
  }

  // The streak now lives on the daily-challenge card above the tabs, so Train's
  // own head is gone — the hero (when anything's due) is the top of this pane.
  renderHero(doNext, container, due, trainingLines);
  renderModeCards(doNext, container, trainingLines, allLines);
  // Lines in training rides directly under Practise; what keeps slipping —
  // the worst moves and the weakest lines — closes the pane.
  renderCardList(state, container, trainingLines, allLines.filter(l => !l.inTraining));
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

// ── Empty state ───────────────────────────────────────────────────────────────

function renderEmpty(container: HTMLElement, hasGames: boolean): void {
  // The onboarding flow (starter packs / game-based suggestions) needs a way to
  // add lines; the app always wires it. Fall back to the bare empty state only if
  // it's somehow missing, so this never becomes a dead end.
  if (onAddStarterLine) {
    renderStarterOnboarding(container, {
      hasGames,
      onAddLine: (seed, colour, mode, onDone, onCancel) =>
        onAddStarterLine!(seed, colour, mode, onDone, onCancel),
      // Leaving onboarding re-renders Train; once the goal is reached it lands on
      // the normal hub instead of here.
      onFinish: () => void doRender(container),
      onBuildManually: () => onBuildLine?.(),
      onImportGames: () => onImportGames?.(),
      onBrowseLibrary: () => onBrowseLibrary?.(),
      onBuildWithEngine: () => onBuildWithEngine?.(),
    });
    return;
  }

  container.appendChild(buildEmptyState({
    icon: Icons.zap(28),
    line: 'Nothing in training yet.',
    cta: { label: 'Build a line', onClick: () => onBuildLine?.() },
    // The "import your games" nudge belongs only before anything's imported;
    // once games are in, drop it (the user already has them).
    ...(hasGames ? {} : { link: { label: 'or import your games', onClick: () => onImportGames?.() } }),
  }));
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

function renderHero(host: HTMLElement, container: HTMLElement, due: Line[], allTraining: Line[]): void {
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
  // are banked across sittings. Only worth showing once there's more than one
  // round to do (otherwise it's just "Start review" as before).
  const roundsLeft = Math.ceil(due.length / ROUND_SIZE);
  if (roundsLeft > 1) {
    const roundsNum = document.createElement('span');
    roundsNum.className = 'train-hero-stat-num';
    roundsNum.textContent = '0';
    stats.appendChild(buildHeroStat('rounds', roundsNum, 'Rounds left'));
    countUp(roundsNum, roundsLeft);
  }

  hero.appendChild(stats);

  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'btn-primary train-hero-start';
  start.appendChild(Icons.brain(18));
  start.appendChild(document.createTextNode('Refresh lines'));
  start.addEventListener('click', () =>
    startRounds(dueLines(allTraining), container, { explicit: true }));
  hero.appendChild(start);

  host.appendChild(hero);
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
} as const;

function renderModeCards(host: HTMLElement, container: HTMLElement, allTraining: Line[], allLines: Line[]): void {
  const section = document.createElement('div');
  section.className = 'section mode-cards';

  const label = document.createElement('div');
  label.className = 'section-title';
  label.textContent = 'Practise';
  section.appendChild(label);

  // Time attack leads the list — three timed runs, each with its own personal
  // best. Always playable when there's any saved position anywhere (it falls back
  // to shallow and paused lines); only disabled when nothing is saved at all.
  const timedReady = selectTimedPositions(allLines, { max: 80 }).length > 0;
  section.appendChild(buildTimedCard(container, allLines, timedReady));

  // Review missed moves — single moves you've missed. Tappable as long as there's
  // anything deep enough to drill (the mode falls back to weak/upcoming moves). No
  // due-count badge: the daily challenge and hero already carry the "what's due"
  // signal, so this stays a clean entry point.
  const hasPositions = selectIndividualPositions(allTraining).length > 0;
  section.appendChild(buildModeCard({
    accent: MODE_ACCENT.fix,
    icon: Icons.zap(20),
    name: 'Review missed moves',
    sub: 'single moves you’ve missed',
    disabled: !hasPositions,
    disabledReason: 'Train a little more to unlock single-move drills',
    onClick: () => runIndividual(container, allTraining),
  }));

  // Fresh lines — full runs of the newest lines first.
  section.appendChild(buildModeCard({
    accent: MODE_ACCENT.fresh,
    icon: Icons.plus(20),
    name: 'Drill new lines',
    sub: 'full runs of your newest lines',
    onClick: () => startRounds(
      recentlyAddedLines(allTraining).slice(0, PICKER_SESSION_CAP), container, { explicit: true }),
  }));

  // Weak spots — full runs of the weakest lines first.
  section.appendChild(buildModeCard({
    accent: MODE_ACCENT.weak,
    icon: Icons.trending(20),
    name: 'Target weak areas',
    sub: 'full runs of your weakest lines',
    onClick: () => startRounds(
      weakestLines(allTraining).slice(0, PICKER_SESSION_CAP), container, { explicit: true }),
  }));

  // Prep — full runs of lines prepared against a scouted opponent. Only shown
  // when any opponent-tagged lines are in training.
  const prepLines = allTraining.filter(l => l.tags.some(isOpponentTag));
  if (prepLines.length > 0) {
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
  // Only ever greyed when there's nothing saved at all — say so.
  if (!enabled) {
    text.appendChild(buildModeReason('Save a line first to play Time attack'));
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

// ── "In training" list (filter + sort + rows) ────────────────────────────────────
//
// A filter row (colour · status · sort) sits above the list; every choice is
// persisted (prefs.ts) so it survives a reload. Status buckets come straight from
// the scheduler (see lineBucket): Due now / Learning (short intervals or a recent
// miss) / Solid (long intervals). Each row carries the line, a "Train now" primary
// action and two quiet icons — view the line, or remove it from training.

// Persistence key + sort options for the shared filter bar (filters.ts).
const TRAIN_FILTER_KEY = 'obertura.train.filter';
const TRAIN_SORTS = [
  { key: 'weakest', label: 'Weakest' },
  { key: 'oldest', label: 'Oldest trained' },
  { key: 'newest', label: 'Newest' },
  { key: 'name', label: 'A–Z' },
];

// Apply the bar's colour + tag + status selection, then the chosen ordering.
// Tags are OR'd: a line shows if it carries any selected tag (user or opponent).
function viewTrainingLines(lines: Line[], sel: FilterSelection): Line[] {
  let out = lines;
  if (sel.colour !== 'all') out = out.filter(l => l.colour === sel.colour);
  if (sel.tags.length > 0) out = out.filter(l => sel.tags.some(t => l.tags.includes(t)));
  if (sel.status !== 'all') out = out.filter(l => lineBucket(l) === sel.status);
  return sortTrainingLines(out, sel.sort);
}

function sortTrainingLines(lines: Line[], sort: string): Line[] {
  switch (sort) {
    case 'newest':
      return recentlyAddedLines(lines);
    case 'name':
      return [...lines].sort((a, b) =>
        (a.name || 'Untitled line').localeCompare(b.name || 'Untitled line'));
    case 'oldest':
      // Oldest trained first; never-trained lines (no timestamp) lead.
      return [...lines].sort((a, b) => trainedTime(a) - trainedTime(b));
    case 'weakest':
    default:
      return weakestLines(lines);
  }
}

function trainedTime(line: Line): number {
  return line.lastTrained ? new Date(line.lastTrained).getTime() : 0;
}

// Whether the "In training" list is expanded — ALWAYS collapsed on page load so
// the Train hub stays short. Session-only (not localStorage): re-renders within
// a visit (pausing a line, flipping a switch) keep the state, a reload resets it.
let trainListOpen = false;

function renderCardList(host: HTMLElement, container: HTMLElement, trainingLines: Line[], pausedLines: Line[]): void {
  const section = document.createElement('div');
  section.className = 'section train-list-section';

  // Paused lines (out of training) show by default, dimmed with their switch
  // off; a quiet header toggle hides them. Pausing/resuming flips a card in
  // place — no re-render — so the page never jumps. The toggle just flips a CSS
  // class on the list, so it never re-renders either. State persists.
  let showPaused = getShowPausedLines();

  // The whole section collapses behind its header (chevron + title + count),
  // exactly like a family group. Everything below lives in `body`.
  let openList = trainListOpen;

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'train-collapse';
  const chev = document.createElement('span');
  chev.className = 'lines-fam-chev';
  chev.setAttribute('aria-hidden', 'true');
  chev.appendChild(Icons.chevronRight(18));
  head.appendChild(chev);
  const heading = document.createElement('span');
  heading.className = 'section-title train-collapse-title';
  heading.textContent = 'Lines in training';
  head.appendChild(heading);
  const countBadge = document.createElement('span');
  countBadge.className = 'lines-fam-count';
  countBadge.textContent = String(trainingLines.length);
  head.appendChild(countBadge);
  section.appendChild(head);

  // Free tier only: show the ceiling once it's close, so it's never a surprise
  // at line eleven. Entitled users see nothing at all. Sits outside `body` so it
  // stays visible when the section is collapsed.
  //
  // Deliberately silent ABOVE the cap: grandfathered users (early testers with
  // dozens enrolled) keep every line, and "14 of 10" would be nonsense. They
  // find out where the ceiling is if they ever try to add one more.
  const count = trainingLines.length;
  if (!isEntitled() && count >= TRAINING_COUNT_VISIBLE_FROM && count <= FREE_TRAINING_LINES) {
    const cap = document.createElement('p');
    cap.className = 'section-desc train-cap-note';
    cap.textContent = `${count} of ${FREE_TRAINING_LINES} lines in training`;
    section.appendChild(cap);
  }

  const body = document.createElement('div');
  body.className = 'train-collapse-body';
  section.appendChild(body);

  const setListOpen = (o: boolean): void => {
    openList = o;
    trainListOpen = o;
    head.classList.toggle('train-collapse--open', o);
    head.setAttribute('aria-expanded', String(o));
    body.hidden = !o;
  };
  head.addEventListener('click', () => setListOpen(!openList));

  // The list itself; paused rows live in it always, shown/hidden via CSS.
  const listEl = document.createElement('div');
  listEl.className = 'train-lines group' + (showPaused ? '' : ' train-lines--hide-paused');

  if (pausedLines.length > 0) {
    const tools = document.createElement('div');
    tools.className = 'train-list-tools';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'train-show-paused';
    const syncToggle = () => {
      toggle.classList.toggle('active', showPaused);
      toggle.setAttribute('aria-pressed', String(showPaused));
      toggle.textContent = showPaused ? 'Hide paused' : 'Show paused';
    };
    syncToggle();
    toggle.addEventListener('click', () => {
      showPaused = !showPaused;
      setShowPausedLines(showPaused);
      listEl.classList.toggle('train-lines--hide-paused', !showPaused);
      syncToggle();
      // Rebuild so the "nothing here" note reflects what's now visible; only the
      // list's contents change, so the page doesn't jump.
      rebuildList();
    });
    tools.appendChild(toggle);
    body.appendChild(tools);
  }

  // The shared two-row filter bar (filters.ts). It owns and persists the
  // selection; we read filter.selection on every rebuild and do the filtering
  // here. My own tags lead the chip row, vs-opponent tags follow, status pills
  // close it.
  // Tag chips cover every shown line — paused included, since they're listed too.
  const allShown = [...trainingLines, ...pausedLines];
  const filter = createFilterBar({
    persistKey: TRAIN_FILTER_KEY,
    sorts: TRAIN_SORTS,
    defaultSort: 'weakest',
    userTags: distinctUserTags(allShown),
    opponentTags: distinctOpponentTags(allShown),
    colourCounts: countLinesByColour(allShown),
    countsForColour: (colour) => {
      const subset = colour === 'all' ? allShown : allShown.filter(l => l.colour === colour);
      return { tagCounts: countLinesByTag(subset), statusCounts: countLinesByStatus(subset) };
    },
    status: true,
    group: true,
    onChange: () => rebuildList(),
  });

  function rebuildList(): void {
    listEl.innerHTML = '';
    const inTraining = viewTrainingLines(trainingLines, filter.selection);
    // Paused rows are always built; CSS (.train-lines--hide-paused) shows/hides
    // them, and a card flipped to paused settles into view (or out) in place.
    const paused = viewTrainingLines(pausedLines, filter.selection);
    const visible = inTraining.length + (showPaused ? paused.length : 0);
    if (visible === 0) {
      const note = document.createElement('p');
      note.className = 'train-lines-empty';
      note.textContent = 'No lines match these filters.';
      listEl.appendChild(note);
      return;
    }
    // In-training rows first; paused rows follow, dimmed with their switch off.
    // Grouped views carry a per-branch pause control on each family header.
    if (filter.selection.group) {
      const renderGrouped = filter.selection.group === 'variation' ? renderVariationGroups : renderFamilyGroups;
      renderGrouped(listEl, inTraining, line => buildTrainRow(line, container), trainExpanded, {
        headExtra: (family, lines) => buildBranchPause(family, lines, container),
      });
    } else {
      for (const line of inTraining) listEl.appendChild(buildTrainRow(line, container));
    }
    for (const line of paused) listEl.appendChild(buildTrainRow(line, container));
  }

  body.appendChild(filter.element);
  rebuildList();
  body.appendChild(listEl);
  setListOpen(openList);
  host.appendChild(section);
}

// The "pause this whole branch" control on a group header: one tap (plus a
// confirm) takes every line of the family out of the training rotation. The
// per-line switches — and the paused rows below — are the way back.
const PAUSE_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" stroke="none" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';

function buildBranchPause(family: string, lines: Line[], container: HTMLElement): HTMLElement | null {
  const active = lines.filter(l => l.inTraining);
  if (active.length === 0) return null;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lines-fam-pause';
  btn.title = 'Pause this whole branch';
  btn.setAttribute('aria-label', `Pause training for ${family}`);
  btn.innerHTML = PAUSE_SVG;
  btn.addEventListener('click', () => {
    showDialog({
      title: 'Pause this whole branch?',
      body: `${active.length === 1 ? 'One line leaves' : `${active.length} lines leave`} the training rotation — “${family}” stops coming up until you switch its lines back on.`,
      buttons: [
        { label: 'Pause branch', variant: 'danger', onClick: () => { void pauseBranch(active, container); } },
        { label: 'Keep training', variant: 'secondary' },
      ],
    });
  });
  return btn;
}

async function pauseBranch(lines: Line[], container: HTMLElement): Promise<void> {
  for (const line of lines) await saveLine({ ...line, inTraining: false });
  showToast('Branch paused — resume any line with its switch.');
  void doRender(container);
}

// Every distinct opponent tag ("vs <name>") across the training lines, sorted.
function distinctOpponentTags(lines: Line[]): string[] {
  const set = new Set<string>();
  for (const l of lines) for (const t of l.tags) if (isOpponentTag(t)) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

// Line counts per colour, for the All / White / Black tab badges.
function countLinesByColour(lines: Line[]): { all: number; white: number; black: number } {
  let white = 0, black = 0;
  for (const l of lines) (l.colour === 'black' ? black++ : white++);
  return { all: lines.length, white, black };
}

// Line counts per tag (user + opponent), for the chip badges.
function countLinesByTag(lines: Line[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const l of lines) for (const t of l.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

// Line counts per status bucket, for the Due / Learning / Solid pill badges.
function countLinesByStatus(lines: Line[]): { due: number; learning: number; solid: number } {
  const counts = { due: 0, learning: 0, solid: 0 };
  for (const l of lines) counts[lineBucket(l)]++;
  return counts;
}

// Every distinct user-authored tag (everything that isn't a "vs <name>" tag).
function distinctUserTags(lines: Line[]): string[] {
  const set = new Set<string>();
  for (const l of lines) for (const t of l.tags) if (!isOpponentTag(t)) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

function buildTrainRow(line: Line, container: HTMLElement): HTMLElement {
  const bucket = lineBucket(line);

  // Tapping the board miniature jumps straight into training this line — the
  // same action as "Train now" — since that's the action you come to this list
  // to take. The view icon (below) is the one that still opens the line itself.
  const startTraining = () => {
    const session = new TrainingSession([line], { explicit: true });
    runSession(session, container, makeStats());
  };

  // Shared position-card scaffold: title + colour pip on row 1, a miniature on
  // the left of row 2 with the meta + actions on the right. The board respects
  // the same global "show miniatures" Settings toggle as the other listings.
  const { card, titleRow, content } = buildPositionCard({
    fen: lineFinalFen(line.tree),
    orientation: line.colour,
    className: 'train-row' + (bucket !== 'due' ? ' line-card--rested' : ''),
    onMiniClick: startTraining,
    miniLabel: 'Train now',
  });

  // Paused rows (revealed by "Show paused") read dimmed, switch off.
  if (!line.inTraining) card.classList.add('train-row--paused');

  // Title row — colour pip + the line name.
  titleRow.appendChild(colourPip(line.colour));
  const nameEl = document.createElement('span');
  nameEl.className = 'pcard-name';
  nameEl.textContent = line.name || 'Untitled line';
  titleRow.appendChild(nameEl);

  // Meta line (status · next due). Colour is already shown by the pip above.
  const meta = document.createElement('div');
  meta.className = 'line-card-meta train-row-meta';

  const statusChip = document.createElement('span');
  statusChip.className = `status-chip status-chip--${bucket}`;
  statusChip.textContent = bucket === 'due' ? 'Due' : bucket === 'learning' ? 'Learning' : 'Solid';
  meta.appendChild(statusChip);

  const dueSpan = document.createElement('span');
  dueSpan.className = 'training-stat';
  dueSpan.textContent = describeDue(nextDue(line));
  meta.appendChild(dueSpan);

  content.appendChild(meta);

  // Actions — a clear primary plus two quiet icons.
  const actions = document.createElement('div');
  actions.className = 'train-row-actions';

  const train = document.createElement('button');
  train.type = 'button';
  train.className = 'btn-primary train-row-train';
  train.textContent = 'Train now';
  train.addEventListener('click', startTraining);
  actions.appendChild(train);

  const view = document.createElement('button');
  view.type = 'button';
  view.className = 'dline-icon train-row-view';
  view.setAttribute('aria-label', 'View line');
  view.title = 'View line';
  view.appendChild(Icons.eye(18));
  view.addEventListener('click', () => onViewLine?.(line));
  actions.appendChild(view);

  // The one training control — the exact In-training switch My Lines uses. ON
  // here means "in the drill pool". Flicking it just flips the card in place
  // (dim + switch), exactly like My Lines: no re-render, so the page never
  // jumps. A paused line stays put, dimmed; if paused lines are hidden it slips
  // out via CSS. The switch itself is the (reversible) undo.
  actions.appendChild(buildTrainingSwitch(line, card));

  content.appendChild(actions);

  return card;
}

// The In-training switch, identical in markup to the My Lines control so it
// looks and behaves the same everywhere.
function buildTrainingSwitch(line: Line, row: HTMLElement): HTMLElement {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'dline-toggle train-row-toggle';
  applySwitchState(toggle, row, line.inTraining);

  const sw = document.createElement('span');
  sw.className = 'dline-switch';
  const knob = document.createElement('span');
  knob.className = 'dline-switch-knob';
  sw.appendChild(knob);
  toggle.appendChild(sw);

  const label = document.createElement('span');
  label.className = 'dline-toggle-label';
  toggle.appendChild(label);
  applySwitchLabel(toggle, line.inTraining);

  toggle.addEventListener('click', () => void toggleTraining(line, row, toggle));
  return toggle;
}

// Flip a line in/out of the drill pool, updating its card in place — no
// re-render, so the page keeps its scroll position (matching My Lines).
//
// Only the OFF→ON direction meets the free-tier cap; pausing is always allowed
// and frees its slot straight away, so a free user can rotate their ten freely.
async function toggleTraining(line: Line, row: HTMLElement, toggle: HTMLElement): Promise<void> {
  const next = !line.inTraining;
  if (next && !(await requestTrainingSlot())) return;
  await saveLine({ ...line, inTraining: next });
  line.inTraining = next; // keep the in-memory line in step for repeat flicks
  applySwitchState(toggle, row, next);
  applySwitchLabel(toggle, next);
}

// Paint the switch + its row for the given on/off state. A paused row reads
// dimmed (and, when paused lines are hidden, drops out via CSS).
function applySwitchState(toggle: HTMLElement, row: HTMLElement, inTraining: boolean): void {
  toggle.classList.toggle('dline-toggle--on', inTraining);
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', String(inTraining));
  toggle.setAttribute('aria-label', inTraining ? 'In training' : 'Paused');
  row.classList.toggle('train-row--paused', !inTraining);
}

function applySwitchLabel(toggle: HTMLElement, inTraining: boolean): void {
  const label = toggle.querySelector('.dline-toggle-label');
  if (label) label.textContent = `Training ${inTraining ? 'ON' : 'OFF'}`;
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
// "Next task →" so a finished task chains straight into the next one.
type NextAction = { label: string; run: () => void };

interface RoundRunner {
  lines: Line[];
  explicit: boolean;
  index: number;       // how many lines consumed so far
  roundNo: number;     // 1-based current round
  totalRounds: number;
  stats: SessionStats;
  // Fires once the whole sitting reaches the final session-complete screen (not
  // between rounds). Used by the daily challenge to mark its lines task done.
  onComplete?: () => void;
  nextAction?: NextAction;
}

function startRounds(
  lines: Line[],
  container: HTMLElement,
  opts: { explicit?: boolean; onComplete?: () => void; nextAction?: NextAction } = {},
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
  onComplete?: () => void,
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
  onComplete: () => void,
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
        expected.review = gradeReview(expected.review ?? newReview(now), quality, now);
        line.lastTrained = now.toISOString();
        line.confidence = lineConfidence(line);
        void saveLine(line);
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
        onComplete();
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
  };
  const slice = runner.lines.slice(runner.index, runner.index + ROUND_SIZE);
  runner.index += slice.length;
  runner.roundNo += 1;

  const session = new TrainingSession(slice, { explicit: runner.explicit });
  runSession(session, container, runner.stats, () => {
    if (runner.index >= runner.lines.length) {
      renderSessionComplete(container, runner.stats, runner.nextAction);
      runner.onComplete?.();
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
): void {
  const { line } = item;

  // Deep-clone so grading edits don't mutate the queued/in-memory line until we
  // deliberately persist.
  const lineCopy: Line = { ...line, tree: structuredClone(line.tree) };
  const copyMoves = mainlineOf(lineCopy.tree);
  const userNodes = userMoveNodes(lineCopy.tree, lineCopy.colour);

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

  const drillOpts: DrillOptions = {
    wrongMoveMode: 'full',
    confirmAbandon: true,
    modeLabel: 'Training',
    // Session-level progress bar: lines completed so far out of the lines the
    // session started with. linesReviewed counts completions, so for the current
    // line this is "line linesReviewed+1 of total".
    sessionProgress: {
      completed: stats.linesReviewed,
      total: session.initialCount,
    },
    celebrateOnComplete: true,
    completeMessage: 'Line complete',
    // Training is strict: only the move stored in the line is accepted. We
    // deliberately do NOT pass checkAlternative/onExplore here — a sound but
    // off-line move is treated as a plain miss (correct-move arrow as usual).
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
      for (const node of userNodes) {
        const misses = missed.has(node.id) ? 1 : 0;
        const quality = qualityFromMisses(misses);
        node.review = gradeReview(node.review ?? newReview(now), quality, now);
        node.missedThisSession = false;
      }
      lineCopy.lastTrained = now.toISOString();
      lineCopy.confidence = lineConfidence(lineCopy);
      // One full run of the line — the denominator behind its recall figure.
      // Counted only here: the positions modes grade single moves, not lines.
      lineCopy.timesTrained = runsBefore + 1;
      await saveLine(lineCopy);
      recordReviewed(userNodes.length);
      // Feed the Statistics remembered-vs-failed bar: this line's moves split
      // into recalled-first-try vs missed.
      recordReviewOutcome(userNodes.length - missed.size, missed.size);
    },
    onComplete: () => {
      stats.linesReviewed++;
      stats.movesMissed += missed.size;
      stats.totalMoves += userNodes.length;
      // Accumulate per-line stats; handles the same line appearing twice in
      // an explicit single-line drill session.
      const prev = stats.lineStats.get(line.id);
      if (prev) {
        prev.misses += missed.size;
        prev.totalMoves += userNodes.length;
        prev.line = lineCopy; // keep the freshest graded state
      } else {
        stats.lineStats.set(line.id, {
          line: lineCopy,
          lineName: line.name || 'Untitled',
          openingName: line.openingName,
          misses: missed.size,
          totalMoves: userNodes.length,
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
    const before = { reviewed: stats.reviewed, missed: stats.missed };
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
          expected.review = gradeReview(expected.review ?? newReview(now), quality, now);
          line.lastTrained = now.toISOString();
          line.confidence = lineConfidence(line);
          void saveLine(line);
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
  };
  const close = (): void => {
    dismiss();
    void doRender(container);
  };
  removeBack = pushBack(close);
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
}

function bumpOpening(
  tally: Map<string, OpeningTally>,
  key: string,
  name: string,
  correct: number,
  incorrect: number,
  extras?: Pick<OpeningTally, 'onOpen' | 'statsLine'>,
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
    });
  }
  return tally;
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
  actions.push({
    icon: Icons.pencil(18),
    label: 'Edit',
    onClick: ({ close }) => { close(); opts.onEdit(); },
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
  head.classList.add('pz-results-head--fill');
  appendStatsRow(head, opts.correct, opts.missed, 'missed');

  const note = document.createElement('div');
  note.className = 'train-all-done';
  note.textContent = opts.remainingLabel;
  head.appendChild(note);
  panel.appendChild(head);

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
  before: { lines: number; missed: number; moves: number },
): void {
  if (runner.stats.linesReviewed > 0) recordTrainingDay();

  const roundMoves = runner.stats.totalMoves - before.moves;
  const roundMissed = runner.stats.movesMissed - before.missed;
  const remaining = runner.lines.length - runner.index;

  renderRoundScreen(container, {
    roundNo: runner.roundNo,
    totalRounds: runner.totalRounds,
    correct: roundMoves - roundMissed,
    missed: roundMissed,
    remainingLabel: `${remaining} line${remaining === 1 ? '' : 's'} left`,
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
