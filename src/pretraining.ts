import type { Line } from './types';
import type { MoveNode } from './tree';
import { saveLine } from './storage';
import { startDrill } from './drill';
import { newReview } from './scheduler';
import { watchSpeedMs } from './prefs';

// Enrol a line into training straight away, with no confirm run. Used when the
// "Confirm run before training" pref is OFF. Clones so the caller's in-memory
// copy isn't mutated; persists with inTraining = true.
export async function enrolLineDirectly(line: Line): Promise<void> {
  await saveLine({ ...line, tree: structuredClone(line.tree), inTraining: true });
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

// Mounts a full-screen pre-training run over the current view.
// Walks the mainline only. First auto-plays the whole line through once (at the
// user's watch speed) so they see it, then asks them to play it themselves. A
// wrong move uses training's "full" flow: flash → snap back → (retries) → draw
// the correct-move arrow → require the correct replay.
// On one clean run: sets inTraining = true, persists lapse data, shows
// confirmation, then calls onComplete. Cancel exits without saving.
export function startPretrainingRun(
  line: Line,
  onComplete: () => void,
  onCancel: () => void
): void {
  // Deep-clone so lapse edits don't mutate the caller's copy in memory.
  const lineCopy: Line = { ...line, tree: structuredClone(line.tree) };
  const copyMoves = mainlineOf(lineCopy.tree);

  function recordMiss(node: MoveNode): void {
    const target = copyMoves.find(m => m.id === node.id);
    if (!target) return;
    if (!target.review) {
      target.review = newReview();
    }
    target.review.lapses++;
  }

  startDrill(lineCopy, {
    // No backLabel override: the in-session exit control reads "End session"
    // everywhere (the default), with the header chevron as its icon.
    modeLabel: 'Confirm line',
    completeMessage: 'Line confirmed — added to training',
    // Watch the line through once first, at the user's chosen watch speed.
    watchFirstMs: watchSpeedMs(),
    // A wrong move draws the correct-move arrow and requires the replay — the
    // same hint mechanism training uses.
    wrongMoveMode: 'full',
    recordMiss,
    // Save before the success message appears, matching original behaviour.
    onBeforeComplete: async () => {
      lineCopy.inTraining = true;
      await saveLine(lineCopy);
    },
    onComplete,
    onCancel,
  });
}
