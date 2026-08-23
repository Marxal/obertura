import type { Line } from './types';
import type { MoveNode } from './tree';
import { saveLine } from './storage';
import { startDrill } from './drill';
import { newReview } from './scheduler';
import { watchSpeedMs } from './prefs';
import { showToast } from './toast';

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
  onCancel: () => void,
  // The guided first run replaces the closing line with one that says what
  // happens NEXT ("it'll come back tomorrow"), because at that point the user
  // has never seen a review land and "added to training" doesn't yet mean
  // anything to them. It also introduces itself: `beforeWatch` holds the moves
  // on a mounted board while a card explains what the next twenty seconds are.
  opts: {
    completeMessage?: string;
    beforeWatch?: (start: () => void, skip: () => void) => void;
    // The guided first line names its first move and draws it — see DrillOptions.
    firstMoveHint?: string;
  } = {},
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
    //
    // …except on the guided first line — the run with a `beforeWatch`
    // introduction — where there is no exit control at all. Same reasoning as
    // skipRun below: that run is the payoff of the whole first visit and lasts
    // about twenty seconds, and its own coach-mark already carries a quiet
    // "Skip this time". Advertising a louder way out beside it is offering an
    // escape from the thing you most wanted them to see. The back gesture still
    // works either way.
    hideExit: !!opts.beforeWatch,
    modeLabel: 'Confirm line',
    completeMessage: opts.completeMessage ?? 'Line confirmed — added to training',
    // Watch the line through once first, at the user's chosen watch speed.
    watchFirstMs: watchSpeedMs(),
    beforeWatch: opts.beforeWatch,
    firstMoveHint: opts.firstMoveHint,
    // A wrong move draws the correct-move arrow and requires the replay — the
    // same hint mechanism training uses.
    wrongMoveMode: 'full',
    recordMiss,
    // Save before the success message appears, matching original behaviour.
    onBeforeComplete: async () => {
      lineCopy.inTraining = true;
      await saveLine(lineCopy);
    },
    // A way past the run for a line you already know — you built it, after all.
    // It saves exactly what a clean run would have saved, minus the lapse data
    // a run would have recorded, so nothing about the line's schedule depends on
    // having played it. Quiet, because playing it once IS worth doing: it is the
    // first review, and the one that tells you whether you can actually recall
    // what you just wrote down.
    //
    // Not offered on the guided first line (the one run with a `beforeWatch`
    // introduction): that run is the payoff of the whole first-run flow, and it
    // already carries its own quiet "Skip this time" on the coach-mark — two
    // ways past one screen, one of them under an overlay, is worse than one.
    skipRun: opts.beforeWatch ? undefined : {
      label: 'Add without playing',
      onSkip: () => {
        void enrolLineDirectly(line).then(() => {
          showToast('Added to training');
          onComplete();
        });
      },
    },
    onComplete,
    onCancel,
  });
}
