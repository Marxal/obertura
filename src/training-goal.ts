// The three-line goal, on its own, because four different screens need to agree
// on it and one of them has to stay importable from Node.
//
// It used to live in first-steps.ts, which is the panel that counts toward it —
// the obvious home right up until the daily challenge needed the number too.
// first-steps.ts reaches auth, Supabase and the install gate, so importing it
// from daily-challenge.ts dragged the whole browser world into the headless
// self-test run. This module imports nothing at all, so anything may have it.
//
// first-steps.ts re-exports both names, so its existing consumers are unchanged.

// The number of SAVED lines that unlocks training, and the goal the Get-started
// panel's bar (and the daily challenge's locked card) count toward. They are
// deliberately the same number.
//
// Why three and not one: training with a single line is a party trick, not a
// habit. The scheduler shows you the one thing you already know, declares you
// finished, and the whole loop the app is built around never gets a chance to
// look like anything. Three lines is the smallest rotation where a session has
// some variety in it and "due today" means something. It's still small enough to
// reach in one sitting — a starter pack alone clears it.
export const TRAINING_UNLOCK_LINES = 3;

/** Why training is greyed out below the goal, for the Train screen's mode cards. */
export function trainingLockReason(lineCount: number): string {
  const left = Math.max(0, TRAINING_UNLOCK_LINES - lineCount);
  return lineCount === 0
    ? `Save ${TRAINING_UNLOCK_LINES} lines to unlock training`
    : `${left} more line${left === 1 ? '' : 's'} to unlock training`;
}
