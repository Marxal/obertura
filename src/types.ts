import type { MoveNode } from './tree';

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
  // How many times this line has been drilled start-to-finish. Gives the recall
  // percentage a denominator — 50% over two runs reads very differently from
  // 50% over twenty. Optional and only counted from the release that added it,
  // so older lines fall back to an estimate (see stats.lineTrainingCount).
  timesTrained?: number;
}
