import type { MoveNode } from './tree';
import {
  STRUGGLE_LAPSES,
  ASK_AGAIN_AFTER,
  chronicCount,
  isChronicMiss,
  shouldAskForNote,
  shouldOfferFix,
  markNoteAsked,
} from './struggle';

// Pure checks of the chronic-miss policy — the threshold, the in-flight +1, and
// the snooze that stops a dismissed prompt coming straight back.

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

// A bare user move with a given lifetime lapse count. `lapses: undefined` means
// "never drilled" — the node carries no review block at all.
function move(lapses?: number, extra: Partial<MoveNode> = {}): MoveNode {
  const node: MoveNode = { id: 'n1', san: 'Nf3', uci: 'g1f3', fen: '', children: [], ...extra };
  if (lapses !== undefined) {
    node.review = { ease: 2.5, interval: 1, reps: 0, lapses, due: new Date() };
  }
  return node;
}

export function runStruggleSelfTest(): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail });
  };

  // ── Counting ───────────────────────────────────────────────────────────────

  check(
    'never drilled counts as zero',
    chronicCount(move(), false) === 0,
    String(chronicCount(move(), false)),
  );
  check(
    'the in-flight miss adds one',
    chronicCount(move(5), true) === 6 && chronicCount(move(5), false) === 5,
    `${chronicCount(move(5), true)} / ${chronicCount(move(5), false)}`,
  );

  // ── Threshold: exactly at 6, not 5 ─────────────────────────────────────────

  check(
    'five misses is not chronic',
    !isChronicMiss(move(4), true),
    `count=${chronicCount(move(4), true)}`,
  );
  check(
    'the sixth miss goes chronic',
    isChronicMiss(move(5), true),
    `count=${chronicCount(move(5), true)}`,
  );
  check(
    'threshold constant is what the copy promises',
    STRUGGLE_LAPSES === 6 && ASK_AGAIN_AFTER === 4,
    `${STRUGGLE_LAPSES} / ${ASK_AGAIN_AFTER}`,
  );

  // ── Asking for a note ──────────────────────────────────────────────────────

  check('asks on the sixth miss', shouldAskForNote(move(5), true));
  check('does not ask below the threshold', !shouldAskForNote(move(3), true));
  check(
    'never asks when a note already exists',
    !shouldAskForNote(move(20, { note: 'knight first' }), true),
  );
  check(
    'does not ask on a clean pass, however lapsed',
    !shouldAskForNote(move(9), false) && shouldAskForNote(move(9), true),
    'a chronic move only prompts when you actually miss it',
  );

  // ── The snooze: dismissed at 6, quiet until 10 ─────────────────────────────

  const snoozed = move(5);
  markNoteAsked(snoozed, true);           // dismissed on the sixth miss
  check('markNoteAsked stamps the current count', snoozed.noteAskedAtLapses === 6,
    String(snoozed.noteAskedAtLapses));

  const at = (lapses: number): MoveNode => move(lapses, { noteAskedAtLapses: 6 });
  check('snooze holds at the seventh', !shouldAskForNote(at(6), true), 'count=7');
  check('snooze holds at the eighth',  !shouldAskForNote(at(7), true), 'count=8');
  check('snooze holds at the ninth',   !shouldAskForNote(at(8), true), 'count=9');
  check('snooze releases at the tenth', shouldAskForNote(at(9), true), 'count=10');

  // Re-stamping at the tenth pushes the next ask out to fourteen.
  const restamped = at(9);
  markNoteAsked(restamped, true);
  check(
    're-asking pushes the next one out again',
    restamped.noteAskedAtLapses === 10
      && !shouldAskForNote(move(12, { noteAskedAtLapses: 10 }), true)
      && shouldAskForNote(move(13, { noteAskedAtLapses: 10 }), true),
    String(restamped.noteAskedAtLapses),
  );

  // Stamping twice at the same count is a no-op, so a double-fire can't shift
  // the snooze window.
  const twice = move(5);
  markNoteAsked(twice, true);
  markNoteAsked(twice, true);
  check('markNoteAsked is idempotent', twice.noteAskedAtLapses === 6,
    String(twice.noteAskedAtLapses));

  // ── Offering the Fix it drill ──────────────────────────────────────────────

  check(
    'Fix it needs both a note and a chronic move',
    shouldOfferFix(move(5, { note: 'knight first' }), true)
      && !shouldOfferFix(move(1, { note: 'knight first' }), true)
      && !shouldOfferFix(move(9), true),
  );
  check(
    'a stamped snooze never suppresses Fix it',
    shouldOfferFix(move(8, { note: 'knight first', noteAskedAtLapses: 6 }), true),
    'the note is the point — the snooze only gates the write prompt',
  );
  check(
    'no Fix it offer on a clean pass either',
    !shouldOfferFix(move(9, { note: 'knight first' }), false),
  );

  return results;
}
