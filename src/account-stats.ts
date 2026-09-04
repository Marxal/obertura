// A small per-account summary of how much has been built and trained, written
// into `profiles.stats` so the shape of the user base can be read without ever
// opening anybody's repertoire.
//
// The question it exists to answer is "do people actually train, or only
// build?", plus "which features get used at all" — both of which were
// previously unanswerable without downloading a user's whole synced blob and
// picking through it.
//
// ── IT IS REPORTED, NOT MEASURED ────────────────────────────────────────────
// Every number here is computed in the browser and uploaded by the browser, so
// it is forgeable by anyone willing to open devtools. NOTHING MAY EVER GATE ON
// IT. Entitlement is read from `profiles.entitled` alone (entitlement.ts), a
// column the anon key has no UPDATE grant on; this column has that grant, which
// is exactly why the two must never meet. If a future feature wants a number it
// can act on, that number has to be derived server-side, not synced from here.
//
// Nothing in this app reads the column back. It is write-only from the device's
// point of view, and that is deliberate.
//
// ── WHAT IT COSTS ───────────────────────────────────────────────────────────
// ~300 bytes, against a core payload of 200 KB–1.3 MB. Every field is a bounded
// scalar — no arrays, no per-line or per-game entries — so it cannot grow with
// the size of a library. The database refuses anything over 8 KB in this column
// (see SUPABASE-SYNC.md §1), which makes that a wall rather than a promise.
//
// It rides the existing debounced push and costs no request of its own: see
// pushDirtyParts in repertoire-sync.ts, where it is attached only inside the
// branch that has already decided to write the repertoire column.
//
// ── AND IT IS NOT COVERED BY THE ANONYMOUS COUNTER'S OPT-OUT ────────────────
// `obertura.metricsOptOut` (metrics.ts) switches this device out of the
// ANONYMOUS event counts — figures with no identifier, where the only way to
// exclude someone is not to count them. This is different in kind: it is
// account data, tied to a user id, disclosed in the privacy policy next to the
// repertoire and the games, and removed with the account. Stretching a switch
// that means "don't count this device anonymously" to cover it would blur what
// that switch promises, so the two are kept apart on purpose.

import { countGames } from './storage';
import { projectLines } from './lines-view';
import type { Repertoire } from './repertoire';
import { currentStreak, getTrainingDays } from './streak';
import { getPuzzleDays } from './puzzle-log';
import { getDailyLog, localDayKey } from './daily-recap';
import { getEndgameProgress } from './endgame-progress';
import { getMistakeDrillsDone } from './mistake-scan';
import { isOnboardingComplete } from './prefs';

/**
 * The synced summary. A flat object of integers plus two strings — no nesting,
 * so `stats->>'drillsCompleted'` is the whole query.
 *
 * Several of these are honest about being narrower than their names suggest;
 * the comments say which, because a number read six months from now with the
 * wrong idea of what it counts is worse than no number.
 */
export interface AccountStats {
  /** Lines derived from every non-archived book. */
  lines: number;
  /** …of which are enrolled in training. The build-vs-train ratio lives here. */
  linesInTraining: number;
  /** Non-archived books. Two by default. */
  repertoires: number;
  /** Games in IndexedDB on this device — not the 500 that sync. */
  gamesImported: number;
  /**
   * Full-line drills, summed from each line's `timesTrained`. Counts only lines
   * that STILL EXIST (deleting a line takes its count with it) and only from
   * the release that added the field, so it is a floor, not a total.
   */
  drillsCompleted: number;
  /** Puzzles solved. The log prunes to 120 days, so this is a window. */
  puzzlesSolved: number;
  /** Days the daily challenge was fully cleared. The log prunes to 180 days. */
  dailyChallengesCompleted: number;
  /** Distinct classic endgames converted at least once. Lifetime, no window. */
  endgamesSolved: number;
  /** Mistake drills answered, clean or not. Lifetime from its release. */
  mistakeDrillsCompleted: number;
  /** Consecutive days trained, as the Train screen shows it. */
  currentStreak: number;
  /**
   * Days with a COMPLETED TRAINING SESSION — not days the app was opened.
   * Nothing on the device records the latter: the two keys that could
   * (`obertura.installedAt`, `obertura.metricsSeen`) are deliberately
   * device-local and never travel. Named for what it measures.
   */
  trainingDays: number;
  /** 1 once the first-run flow has ever been finished, else 0. */
  onboardingCompleted: number;
  /**
   * The local calendar day this summary was written, "YYYY-MM-DD". Since a push
   * only happens when something actually changed, it dates real activity rather
   * than an app launch.
   */
  lastActiveDay: string;
  /** The build that wrote it — without this, "unused" and "too old to have it"
   *  are indistinguishable. */
  appVersion: string;
}

/**
 * Build the summary from books already in hand.
 *
 * The repertoires are passed in rather than re-read because the only caller
 * already holds them: `exportCore()` loaded them a few lines earlier, and
 * opening that store twice per push for a counter would be silly. Everything
 * else is a localStorage read except the games, which is a `count()` on the
 * object store — no game is ever deserialised.
 */
export async function buildAccountStats(repertoires: Repertoire[]): Promise<AccountStats> {
  const books = repertoires.filter((r) => !r.archived);
  const lines = projectLines(books);
  const puzzles = getPuzzleDays().reduce((n, d) => n + d.solved, 0);
  const dailyDone = getDailyLog().filter((d) => d.done).length;
  const endgames = Object.values(getEndgameProgress()).filter((r) => r.solved).length;

  return {
    lines: lines.length,
    linesInTraining: lines.filter((l) => l.inTraining).length,
    repertoires: books.length,
    gamesImported: await countGames(),
    drillsCompleted: lines.reduce((n, l) => n + (l.timesTrained ?? 0), 0),
    puzzlesSolved: puzzles,
    dailyChallengesCompleted: dailyDone,
    endgamesSolved: endgames,
    mistakeDrillsCompleted: getMistakeDrillsDone(),
    currentStreak: currentStreak(),
    trainingDays: getTrainingDays().length,
    onboardingCompleted: isOnboardingComplete() ? 1 : 0,
    lastActiveDay: localDayKey(),
    appVersion: __APP_VERSION__,
  };
}
