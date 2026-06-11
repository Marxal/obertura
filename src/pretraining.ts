import type { Line } from './types';
import type { MoveNode } from './tree';
import { saveLine } from './storage';
import { startDrill } from './drill';
import { newReview } from './scheduler';

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
// Walks the mainline only. Auto-plays the opponent side; validates user moves.
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
    backLabel: '← Cancel',
    modeLabel: 'Confirm line',
    completeMessage: 'Line confirmed — added to training',
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
