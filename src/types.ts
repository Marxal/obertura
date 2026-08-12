import type { MoveNode } from './tree';

// How often a line should come round in training, relative to what the
// scheduler would ask for on its own. Not every line in a repertoire matters
// equally: the main line you get in half your games deserves to be asked about
// more often than a sideline you keep for completeness, and the scheduler can't
// know which is which. See PRIORITY_SPACING in scheduler.ts for what each one
// actually does to the schedule.
export type LinePriority = 'high' | 'standard' | 'low';

// A saved opening line. Belongs to a repertoire (white or black), carries a few
// bits of metadata for training later, and holds the full move tree built on
// the board. `tree` is the serialisable root MoveNode from tree.ts.
export interface Line {
  id: string;
  name: string;
  tags: string[];
  colour: 'white' | 'black';
  openingName: string | null;
  confidence: number;
  lastTrained: string | null;
  inTraining: boolean;
  tree: MoveNode;
  createdAt?: number;
  // Absent on every line saved before priorities existed, and on any line the
  // user hasn't touched the control on — both mean 'standard'. Read it through
  // linePriority() rather than directly, so the default lives in one place.
  priority?: LinePriority;
  // How many times this line has been drilled start-to-finish. Gives the recall
  // percentage a denominator — 50% over two runs reads very differently from
  // 50% over twenty. Optional and only counted from the release that added it,
  // so older lines fall back to an estimate (see stats.lineTrainingCount).
  timesTrained?: number;
}
