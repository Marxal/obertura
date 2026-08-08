// Chronic misses — the moves you keep forgetting no matter how often the
// scheduler brings them back.
//
// SM-2 already reschedules a missed move for tomorrow, but nothing ever changes
// WHY you forget it, so the loop never closes. Once a move has been missed
// enough times, training offers to let you write a note; from then on the note
// surfaces every time you slip, next to a "Fix it" drill.
//
// This module owns the whole policy — the threshold, the "have we asked
// already" snooze, the counting — so drill.ts and train-screen.ts stay free of
// magic numbers. Pure data in, booleans out; self-tested in struggle.selftest.ts.

import type { MoveNode } from './tree';

// Misses before a move counts as chronic. Six is deliberately high: it has to
// be a move that has survived several scheduling cycles, not one bad morning.
export const STRUGGLE_LAPSES = 6;

// After a prompt is dismissed, how many FURTHER misses before we ask again.
// So the asks land at 6, 10, 14 … — often enough to matter, rare enough to
// never feel like nagging.
export const ASK_AGAIN_AFTER = 4;

// Lifetime misses on this move, counting the one happening right now.
//
// Grading runs at line completion, so mid-drill `review.lapses` is still the
// PRE-session figure. `missedNow` adds the in-flight miss, which is what the
// user is actually looking at ("missed 6×" as they miss it for the sixth time).
export function chronicCount(node: MoveNode, missedNow: boolean): number {
  return (node.review?.lapses ?? 0) + (missedNow ? 1 : 0);
}

// Has this move been missed enough times to deserve special treatment?
export function isChronicMiss(node: MoveNode, missedNow: boolean): boolean {
  return chronicCount(node, missedNow) >= STRUGGLE_LAPSES;
}

// Should we open the write-a-note sheet for this move?
//
// Only when you've just missed it, it's chronic, it has no note yet, and either
// we've never asked or it's been missed ASK_AGAIN_AFTER more times since.
//
// The `missedNow` guard is the module's own invariant, not a caller's job:
// nothing about a move you've just recalled cleanly deserves an interruption,
// however lapsed its history.
export function shouldAskForNote(node: MoveNode, missedNow: boolean): boolean {
  if (!missedNow) return false;
  if (node.note) return false;
  if (!isChronicMiss(node, missedNow)) return false;
  const asked = node.noteAskedAtLapses;
  if (asked === undefined) return true;
  return chronicCount(node, missedNow) >= asked + ASK_AGAIN_AFTER;
}

// Should the note card carry a "Fix it" button?
//
// The note already shows on every reveal (drill.ts); the drill offer is only
// for moves that have gone chronic, so a move you've missed twice doesn't get
// pushed into a three-rep drill. Same "you just missed it" guard as above.
export function shouldOfferFix(node: MoveNode, missedNow: boolean): boolean {
  return missedNow && !!node.note && isChronicMiss(node, missedNow);
}

// Remember that we asked, so the snooze can hold. Called whether the sheet was
// saved or dismissed — a saved note stops the asks by itself (shouldAskForNote
// bails on `node.note`), and the stamp keeps that true if the note is later
// cleared.
export function markNoteAsked(node: MoveNode, missedNow: boolean): void {
  node.noteAskedAtLapses = chronicCount(node, missedNow);
}
