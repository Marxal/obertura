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
}
